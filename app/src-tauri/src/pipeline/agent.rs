// agent — 块级批量核查:LLM 自主决定搜索几轮(tool-calling loop),全过程事件流式回调
// 事件即前端合同(Channel 推送,ResearchDrawer 消费);终局产出修正表,应用仍走 apply_correction
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

use super::llm::{self, agent_user, AgentMsg, LlmConfig, ToolCall, ToolDef};
use super::tavily;

const BLOCKS_PROMPT: &str = include_str!("../../../../prompts/verify_blocks.md");
const SYSTEM: &str = "你是播客笔记的专有名词核查员。你可以调用 search 工具搜索网络证据;\
核查完成后,只输出一个合法的 JSON 数组作为终局结论,不要 Markdown 代码块,不要任何其他文字。";
const MAX_ROUNDS: usize = 8;

/// 选中的笔记分块(前端入参)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockInput {
    pub text: String,
    #[serde(default)]
    pub who: String,
    #[serde(default)]
    pub ts: String,
}

/// 修正表条目;corrected=None 表示核实无误(前端渲染「✓ 无误」行,无应用按钮)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub original: String,
    #[serde(default)]
    pub corrected: Option<String>,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub evidence_url: Option<String>,
    #[serde(default)]
    pub note: String,
}

/// 搜索命中(事件展示用,content 已截断)
#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub title: String,
    pub url: String,
    pub content: String,
}

/// 核查过程事件——Channel 载荷,serde 形状即前端合同,勿随意改字段名
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentEvent {
    Round {
        n: usize,
    },
    TextDelta {
        text: String,
    },
    ToolCall {
        call_id: String,
        name: String,
        args: Value,
    },
    ToolResult {
        call_id: String,
        ok: bool,
        hits: Vec<Hit>,
        message: String,
    },
    Final {
        items: Vec<Suggestion>,
    },
    Error {
        message: String,
    },
}

/// 拼 user prompt:节目名 + 编号分块(带 ts/who 元数据供 LLM 定位语境)
fn render_prompt(podcast: &str, blocks: &[BlockInput]) -> String {
    let rendered = blocks
        .iter()
        .enumerate()
        .map(|(i, b)| {
            let mut head = format!("【分块 {}】", i + 1);
            let meta: Vec<&str> = [b.ts.as_str(), b.who.as_str()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect();
            if !meta.is_empty() {
                head.push_str(&format!("({})", meta.join(" · ")));
            }
            format!("{head}\n{}", b.text)
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    BLOCKS_PROMPT
        .replace("{{podcast}}", podcast)
        .replace("{{blocks}}", &rendered)
}

fn search_tool() -> ToolDef {
    ToolDef {
        name: "search".into(),
        description: "网络搜索,用于查证专有名词的真实写法。返回若干条搜索结果(标题/链接/摘要)。"
            .into(),
        parameters: json!({
            "type": "object",
            "properties": { "query": { "type": "string", "description": "搜索查询词" } },
            "required": ["query"],
        }),
    }
}

/// 从工具调用参数串里取 query(纯函数,单测友好)
fn parse_query(arguments: &str) -> Result<String> {
    let v: Value = serde_json::from_str(arguments.trim())
        .map_err(|_| anyhow::anyhow!("参数不是合法 JSON: {arguments}"))?;
    match v
        .get("query")
        .and_then(|q| q.as_str())
        .map(str::trim)
        .filter(|q| !q.is_empty())
    {
        Some(q) => Ok(q.to_string()),
        None => bail!("参数里没有 query 字段"),
    }
}

/// 终局修正表容噪解析:取首 [ 到末 ](与 correct.rs parse_verdict 同思路)
fn parse_suggestions(raw: &str) -> Option<Vec<Suggestion>> {
    let (s, e) = (raw.find('[')?, raw.rfind(']')?);
    if e <= s {
        return None;
    }
    serde_json::from_str(&raw[s..=e]).ok()
}

/// 代码侧兜底(沿 correct.rs 规则):corrected 与原词相同视为无误;非 confirmed 一律归 speculative
fn sanitize(items: Vec<Suggestion>) -> Vec<Suggestion> {
    items
        .into_iter()
        .filter(|s| !s.original.trim().is_empty())
        .map(|mut s| {
            s.original = s.original.trim().to_string();
            s.corrected = s
                .corrected
                .map(|c| c.trim().to_string())
                .filter(|c| !c.is_empty() && c != &s.original);
            if s.confidence != "confirmed" {
                s.confidence = "speculative".into();
            }
            s
        })
        .collect()
}

/// 搜索命中转事件视图 + 回填 LLM 的文本(沿 correct.rs render_evidence 尺度:5 条 × 400 字)
fn render_hits(hits: &[tavily::SearchHit]) -> (Vec<Hit>, String) {
    let views: Vec<Hit> = hits
        .iter()
        .take(5)
        .map(|h| Hit {
            title: h.title.clone(),
            url: h.url.clone(),
            content: h.content.chars().take(400).collect(),
        })
        .collect();
    let text = if views.is_empty() {
        "(没有搜到任何结果)".to_string()
    } else {
        views
            .iter()
            .map(|h| format!("- {}\n  {}\n  {}", h.title, h.url, h.content))
            .collect::<Vec<_>>()
            .join("\n")
    };
    (views, text)
}

/// 整条核查链:多轮 tool-calling → 终局修正表。事件经 on_event 流出;cancel 置位即中止
pub async fn research_blocks(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    tavily_key: &str,
    podcast: &str,
    blocks: &[BlockInput],
    cancel: &AtomicBool,
    on_event: &(dyn Fn(AgentEvent) + Send + Sync),
) -> Result<Vec<Suggestion>> {
    if blocks.is_empty() {
        bail!("没有选中任何分块");
    }
    let tools = [search_tool()];
    let mut msgs = vec![agent_user(render_prompt(podcast, blocks))];
    let mut call_seq = 0usize;

    for round in 1..=MAX_ROUNDS {
        if cancel.load(Ordering::Relaxed) {
            bail!("已取消");
        }
        on_event(AgentEvent::Round { n: round });
        // 末轮收走工具,逼终局
        let last = round == MAX_ROUNDS;
        if last {
            msgs.push(agent_user(
                "不要再调用工具,直接根据已有证据输出终局 JSON 数组。",
            ));
        }
        let step = llm::stream_step(
            client,
            cfg,
            SYSTEM,
            &msgs,
            if last { &[] } else { &tools },
            Some(cancel),
            &|t| on_event(AgentEvent::TextDelta { text: t.into() }),
        )
        .await?;

        if step.tool_calls.is_empty() {
            // 终局轮:解析修正表;失败则 nudge 重试(轮次预算内)
            match parse_suggestions(&step.text) {
                Some(items) => {
                    let items = sanitize(items);
                    on_event(AgentEvent::Final {
                        items: items.clone(),
                    });
                    return Ok(items);
                }
                None => {
                    msgs.push(AgentMsg::Assistant {
                        text: step.text,
                        tool_calls: vec![],
                    });
                    msgs.push(agent_user(
                        "你输出的不是合法 JSON 数组。请只输出一个合法 JSON 数组,不要任何其他文字。",
                    ));
                    continue;
                }
            }
        }

        // 工具轮:网关可能不回 id(Anthropic 回传 tool_use 必须有 id),补合成 id
        let mut calls: Vec<ToolCall> = step.tool_calls;
        for c in calls.iter_mut() {
            if c.id.is_empty() {
                call_seq += 1;
                c.id = format!("call_{round}_{call_seq}");
            }
        }
        msgs.push(AgentMsg::Assistant {
            text: step.text,
            tool_calls: calls.clone(),
        });

        let mut results = Vec::new();
        for c in &calls {
            if cancel.load(Ordering::Relaxed) {
                bail!("已取消");
            }
            let args: Value = serde_json::from_str(&c.arguments)
                .unwrap_or_else(|_| json!({ "raw": c.arguments }));
            on_event(AgentEvent::ToolCall {
                call_id: c.id.clone(),
                name: c.name.clone(),
                args,
            });
            // 工具执行失败不中断:错误文本回填给 LLM 自行调整
            let (content, ok, hits, message) = if c.name != "search" {
                (
                    format!("未知工具: {}", c.name),
                    false,
                    vec![],
                    format!("未知工具: {}", c.name),
                )
            } else {
                match parse_query(&c.arguments) {
                    Err(e) => (format!("搜索失败: {e}"), false, vec![], e.to_string()),
                    Ok(query) => match tavily::search(client, tavily_key, &query).await {
                        Ok(list) => {
                            let (views, text) = render_hits(&list);
                            (text, true, views, String::new())
                        }
                        Err(e) => (format!("搜索失败: {e}"), false, vec![], e.to_string()),
                    },
                }
            };
            on_event(AgentEvent::ToolResult {
                call_id: c.id.clone(),
                ok,
                hits,
                message,
            });
            results.push(llm::ToolResult {
                call_id: c.id.clone(),
                content,
            });
        }
        msgs.push(AgentMsg::ToolResults(results));
    }
    bail!("核查在 {MAX_ROUNDS} 轮内没有收敛,请重试")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_parses_and_rejects() {
        assert_eq!(
            parse_query(r#"{"query":" No Priors "}"#).unwrap(),
            "No Priors"
        );
        assert!(parse_query("不是 json").is_err());
        assert!(parse_query(r#"{"q":"x"}"#).is_err());
        assert!(parse_query(r#"{"query":""}"#).is_err());
    }

    #[test]
    fn suggestions_parse_with_noise() {
        let raw = "好的,修正表如下:\n```json\n[{\"original\":\"No Players\",\"corrected\":\"No Priors\",\"confidence\":\"confirmed\",\"evidenceUrl\":\"https://x\",\"note\":\"官网写法\"},{\"original\":\"面基\",\"corrected\":null,\"confidence\":\"confirmed\",\"evidenceUrl\":null,\"note\":\"没错\"}]\n```";
        let items = parse_suggestions(raw).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].corrected.as_deref(), Some("No Priors"));
        assert!(items[1].corrected.is_none());
        assert!(parse_suggestions("抱歉").is_none());
    }

    #[test]
    fn sanitize_applies_fallbacks() {
        let items = sanitize(vec![
            // corrected == original → 视为无误
            Suggestion {
                original: "OSS Insight".into(),
                corrected: Some("OSS Insight".into()),
                confidence: "confirmed".into(),
                evidence_url: None,
                note: String::new(),
            },
            // 未知 confidence → speculative
            Suggestion {
                original: "阿沅".into(),
                corrected: Some(" 阿远 ".into()),
                confidence: "maybe".into(),
                evidence_url: None,
                note: String::new(),
            },
            // 空 original 整条丢弃
            Suggestion {
                original: "  ".into(),
                corrected: None,
                confidence: "confirmed".into(),
                evidence_url: None,
                note: String::new(),
            },
        ]);
        assert_eq!(items.len(), 2);
        assert!(items[0].corrected.is_none());
        assert_eq!(items[1].corrected.as_deref(), Some("阿远"));
        assert_eq!(items[1].confidence, "speculative");
    }

    #[test]
    fn prompt_renders_blocks_with_meta() {
        let p = render_prompt(
            "乱翻书",
            &[
                BlockInput {
                    text: "第一块".into(),
                    who: "施骅伦".into(),
                    ts: "01:10:41".into(),
                },
                BlockInput {
                    text: "第二块".into(),
                    who: String::new(),
                    ts: String::new(),
                },
            ],
        );
        assert!(p.contains("节目: 乱翻书"));
        assert!(p.contains("【分块 1】(01:10:41 · 施骅伦)\n第一块"));
        assert!(p.contains("【分块 2】\n第二块"));
    }

    #[test]
    fn events_serialize_to_contract_shape() {
        let ev = AgentEvent::ToolCall {
            call_id: "c1".into(),
            name: "search".into(),
            args: json!({ "query": "No Priors" }),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "toolCall");
        assert_eq!(v["callId"], "c1");
        assert_eq!(v["args"]["query"], "No Priors");
        let fin = AgentEvent::Final {
            items: vec![Suggestion {
                original: "a".into(),
                corrected: None,
                confidence: "speculative".into(),
                evidence_url: Some("https://x".into()),
                note: "n".into(),
            }],
        };
        let v = serde_json::to_value(&fin).unwrap();
        assert_eq!(v["type"], "final");
        assert_eq!(v["items"][0]["evidenceUrl"], "https://x");
        assert_eq!(
            serde_json::to_value(AgentEvent::TextDelta { text: "x".into() }).unwrap()["type"],
            "textDelta"
        );
    }
}
