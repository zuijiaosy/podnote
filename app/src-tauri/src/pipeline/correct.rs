// correct — 划词纠正:LLM 拟搜索 query → Tavily 搜证 → LLM 判定正词
// 纠正记录落 corrections/<id>.json(重生成时兜底重放),并沉淀进 glossary 按频道复用
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

use super::llm::{self, user_message, LlmConfig};
use super::note;
use super::tavily::{self, SearchHit};
use super::vocab::parse_string_array;

const QUERY_PROMPT: &str = include_str!("../../../../prompts/verify_query.md");
const JUDGE_PROMPT: &str = include_str!("../../../../prompts/verify_judge.md");
const QUERY_SYSTEM: &str =
    "你负责设计网络搜索查询。只输出一个合法的 JSON 字符串数组,不要任何前后说明。";
const JUDGE_SYSTEM: &str = "你负责核实专有名词写法。只输出一个合法的 JSON 对象,不要任何前后说明。";

/// 查证结论(浮层展示用)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermVerdict {
    /// None = 原词没错或无法判断
    pub corrected: Option<String>,
    /// confirmed | speculative
    pub confidence: String,
    #[serde(default)]
    pub evidence_url: Option<String>,
    #[serde(default)]
    pub note: String,
}

/// 单集纠正记录(前端下划线标记 + 重生成兜底重放的数据源)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionRecord {
    pub original: String,
    pub corrected: String,
    #[serde(default)]
    pub evidence_url: Option<String>,
    /// confirmed | speculative | manual
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub ts: u64,
}

pub fn load_corrections(path: &Path) -> Vec<CorrectionRecord> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 追加一条;同 original 已存在则原位覆盖(以最新纠正为准)
pub fn append_correction(path: &Path, rec: CorrectionRecord) -> Result<()> {
    let mut records = load_corrections(path);
    match records.iter_mut().find(|r| r.original == rec.original) {
        Some(slot) => *slot = rec,
        None => records.push(rec),
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&records)?)?;
    Ok(())
}

/// asr 原始 JSON 逐句替换(字幕与笔记同步纠正);返回替换处数
pub fn replace_in_transcript(v: &mut Value, original: &str, corrected: &str) -> usize {
    let mut count = 0;
    let Some(transcripts) = v.get_mut("transcripts").and_then(|t| t.as_array_mut()) else {
        return 0;
    };
    for t in transcripts {
        let Some(sents) = t.get_mut("sentences").and_then(|s| s.as_array_mut()) else {
            continue;
        };
        for s in sents {
            let Some(text) = s.get_mut("text") else {
                continue;
            };
            if let Some(orig) = text.as_str() {
                let (new, n) = note::replace_in(orig, original, corrected);
                if n > 0 {
                    *text = Value::String(new);
                    count += n;
                }
            }
        }
    }
    count
}

fn render_evidence(hits: &[SearchHit]) -> String {
    hits.iter()
        .take(6)
        .map(|h| {
            let content: String = h.content.chars().take(400).collect();
            format!("- {}\n  {}\n  {}", h.title, h.url, content)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 容忍杂讯的 verdict 解析:取首 { 到末 }(与 note.rs 同思路)
fn parse_verdict(raw: &str) -> Option<TermVerdict> {
    let (s, e) = (raw.find('{')?, raw.rfind('}')?);
    if e <= s {
        return None;
    }
    serde_json::from_str(&raw[s..=e]).ok()
}

/// 整条查证链:拟 query(失败降级固定 query)→ 搜索(≤2 次)→ 判定(解析失败重试一次)
pub async fn research_term(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    tavily_key: &str,
    podcast: &str,
    term: &str,
    context: &str,
) -> Result<TermVerdict> {
    // 1. 拟搜索 query
    let fallback = format!("{term} {podcast} 播客");
    let query_prompt = QUERY_PROMPT
        .replace("{{podcast}}", podcast)
        .replace("{{term}}", term)
        .replace("{{context}}", context);
    let queries: Vec<String> = match llm::stream_chat(
        client,
        cfg,
        QUERY_SYSTEM,
        &[user_message(&query_prompt)],
        &|_| {},
    )
    .await
    {
        Ok(out) => {
            let qs = parse_string_array(&out);
            if qs.is_empty() {
                vec![fallback]
            } else {
                qs.into_iter().take(2).collect()
            }
        }
        Err(_) => vec![fallback],
    };

    // 2. 搜索聚合(按 url 去重);全部失败按"无证据"继续,由代码侧强制 speculative
    let debug = std::env::var("PN_DEBUG").is_ok();
    if debug {
        eprintln!("[correct] queries: {queries:?}");
    }
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for q in &queries {
        if let Ok(list) = tavily::search(client, tavily_key, q).await {
            for h in list {
                if !h.url.is_empty() && seen.insert(h.url.clone()) {
                    hits.push(h);
                }
            }
        }
    }
    if debug {
        for h in &hits {
            eprintln!("[correct] hit: {} | {}", h.title, h.url);
        }
    }

    // 3. 判定
    let evidence = if hits.is_empty() {
        "(没有搜到任何证据)".to_string()
    } else {
        render_evidence(&hits)
    };
    let judge_prompt = JUDGE_PROMPT
        .replace("{{podcast}}", podcast)
        .replace("{{term}}", term)
        .replace("{{context}}", context)
        .replace("{{evidence}}", &evidence);
    let mut verdict: Option<TermVerdict> = None;
    for _attempt in 0..2 {
        if let Ok(out) = llm::stream_chat(
            client,
            cfg,
            JUDGE_SYSTEM,
            &[user_message(&judge_prompt)],
            &|_| {},
        )
        .await
        {
            if let Some(v) = parse_verdict(&out) {
                verdict = Some(v);
                break;
            }
        }
    }
    let mut v = verdict.context("查证判定失败,请重试")?;

    // 4. 代码侧兜底:无证据强制推测档;corrected 与原词相同视为"没错"
    if hits.is_empty() {
        v.confidence = "speculative".into();
        v.evidence_url = None;
    }
    if v.corrected.as_deref() == Some(term) {
        v.corrected = None;
    }
    if v.confidence != "confirmed" {
        v.confidence = "speculative".into();
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdict_parses_with_noise() {
        let v = parse_verdict(
            "好的:\n```json\n{\"corrected\":\"No Priors\",\"confidence\":\"confirmed\",\"evidenceUrl\":\"https://x\",\"note\":\"官网写法\"}\n```",
        )
        .unwrap();
        assert_eq!(v.corrected.as_deref(), Some("No Priors"));
        assert_eq!(v.confidence, "confirmed");
        assert!(parse_verdict("抱歉").is_none());
    }

    #[test]
    fn transcript_replace_counts() {
        let mut v = serde_json::json!({
            "transcripts": [{ "sentences": [
                { "text": "我常听 No Players 这个节目,No Players 很好" },
                { "text": "无关句子" },
            ]}]
        });
        let n = replace_in_transcript(&mut v, "No Players", "No Priors");
        assert_eq!(n, 2);
        assert_eq!(
            v.pointer("/transcripts/0/sentences/0/text")
                .unwrap()
                .as_str()
                .unwrap(),
            "我常听 No Priors 这个节目,No Priors 很好"
        );
    }

    #[test]
    fn corrections_roundtrip_and_dedupe() {
        let dir = std::env::temp_dir().join(format!("pn-corr-{}", std::process::id()));
        let path = dir.join("ep1.json");
        let rec = |o: &str, c: &str| CorrectionRecord {
            original: o.into(),
            corrected: c.into(),
            evidence_url: None,
            confidence: "confirmed".into(),
            ts: 0,
        };
        append_correction(&path, rec("面筋", "面基")).unwrap();
        append_correction(&path, rec("No Players", "No Priors")).unwrap();
        append_correction(&path, rec("面筋", "面基基")).unwrap(); // 覆盖
        let all = load_corrections(&path);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].corrected, "面基基");
        let _ = fs::remove_dir_all(dir);
    }
}
