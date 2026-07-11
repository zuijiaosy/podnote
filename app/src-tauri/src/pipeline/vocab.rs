// vocab — fun-asr 定制热词:每期临时词表(创建 → 转写 → 删除)
// API: POST {host}/api/v1/services/audio/asr/customization,model "speech-biasing"
// 词表来源:shownotes 实体(LLM 提取)+ 频道纠正词表(glossary);任何失败降级为无热词转写
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use super::glossary::GlossaryEntry;
use super::llm::{self, user_message, LlmConfig};

/// 词表前缀:配额清扫时按它识别本应用的残表
pub const PREFIX: &str = "podnote";
/// 官方限制:单表最多 500 词
const MAX_TERMS: usize = 500;

const ENTITIES_PROMPT: &str = include_str!("../../../../prompts/entities.md");
const ENTITIES_SYSTEM: &str =
    "你负责从文本中提取专有名词。只输出一个合法的 JSON 字符串数组,不要任何前后说明。";

async fn customization(
    client: &reqwest::Client,
    host: &str,
    key: &str,
    input: Value,
) -> Result<Value> {
    let res = client
        .post(format!("{host}/api/v1/services/audio/asr/customization"))
        .bearer_auth(key)
        .json(&json!({ "model": "speech-biasing", "input": input }))
        .send()
        .await
        .context("热词服务请求失败")?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        bail!("热词服务出错 ({status}): {body}");
    }
    Ok(body)
}

pub async fn create_vocabulary(
    client: &reqwest::Client,
    host: &str,
    key: &str,
    terms: &[String],
) -> Result<String> {
    let vocabulary: Vec<Value> = terms.iter().map(|t| json!({ "text": t, "weight": 4 })).collect();
    let out = customization(
        client,
        host,
        key,
        json!({
            "action": "create_vocabulary",
            "target_model": "fun-asr",
            "prefix": PREFIX,
            "vocabulary": vocabulary,
        }),
    )
    .await?;
    out.pointer("/output/vocabulary_id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .with_context(|| format!("创建热词表没返回 id: {out}"))
}

pub async fn delete_vocabulary(
    client: &reqwest::Client,
    host: &str,
    key: &str,
    vocabulary_id: &str,
) -> Result<()> {
    customization(
        client,
        host,
        key,
        json!({ "action": "delete_vocabulary", "vocabulary_id": vocabulary_id }),
    )
    .await?;
    Ok(())
}

/// 本应用前缀下的全部词表 id(配额清扫用)
pub async fn list_podnote_vocabularies(
    client: &reqwest::Client,
    host: &str,
    key: &str,
) -> Result<Vec<String>> {
    let out = customization(
        client,
        host,
        key,
        json!({ "action": "list_vocabulary", "prefix": PREFIX, "page_index": 0, "page_size": 100 }),
    )
    .await?;
    Ok(out
        .pointer("/output/vocabulary_list")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.get("vocabulary_id").and_then(|x| x.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

/// shownotes → 专有名词列表(一次 LLM 调用);任何失败返回空,不阻断转写
pub async fn extract_entities(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    podcast: &str,
    title: &str,
    shownotes: &str,
) -> Vec<String> {
    if shownotes.trim().is_empty() || cfg.api_key.is_empty() {
        return vec![];
    }
    let prompt = ENTITIES_PROMPT
        .replace("{{podcast}}", podcast)
        .replace("{{title}}", title)
        .replace("{{shownotes}}", shownotes);
    match llm::stream_chat(client, cfg, ENTITIES_SYSTEM, &[user_message(&prompt)], &|_| {}).await {
        Ok(out) => parse_string_array(&out),
        Err(_) => vec![],
    }
}

/// 容忍代码围栏与前后杂讯:取首个 [ 到末个 ] 之间解析(与 note.rs 的 JSON 容错同思路)
pub fn parse_string_array(raw: &str) -> Vec<String> {
    let (Some(s), Some(e)) = (raw.find('['), raw.rfind(']')) else { return vec![] };
    if e <= s {
        return vec![];
    }
    serde_json::from_str::<Vec<String>>(&raw[s..=e]).unwrap_or_default()
}

/// 官方长度限制:非 ASCII ≤15 字符;纯 ASCII 按空格 ≤7 段
fn term_ok(t: &str) -> bool {
    if t.is_empty() {
        return false;
    }
    if t.is_ascii() {
        (1..=7).contains(&t.split_whitespace().count())
    } else {
        t.chars().count() <= 15
    }
}

/// 合并词源 → 合法词表:纠正词优先(它们是实打实转错过的),去重、过滤、截断 500
pub fn build_terms(entities: Vec<String>, glossary: &[&GlossaryEntry]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for t in glossary.iter().map(|e| e.corrected.clone()).chain(entities) {
        let t = t.trim().to_string();
        if term_ok(&t) && seen.insert(t.clone()) {
            out.push(t);
            if out.len() >= MAX_TERMS {
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(corrected: &str) -> GlossaryEntry {
        GlossaryEntry {
            show: "s".into(),
            original: "o".into(),
            corrected: corrected.into(),
            evidence_url: None,
            confidence: "confirmed".into(),
            ts: 0,
        }
    }

    #[test]
    fn parses_array_with_noise() {
        assert_eq!(
            parse_string_array("好的:\n```json\n[\"No Priors\", \"面基\"]\n```"),
            vec!["No Priors".to_string(), "面基".to_string()]
        );
        assert!(parse_string_array("抱歉做不到").is_empty());
        assert!(parse_string_array("]倒置[").is_empty());
    }

    #[test]
    fn build_terms_filters_and_dedupes() {
        let e1 = g("面基");
        let entries = vec![&e1];
        let terms = build_terms(
            vec![
                "面基".into(),                          // 与纠正词重复 → 去重
                "  Lex Fridman  ".into(),               // trim 后保留
                "一二三四五六七八九十一二三四五六".into(), // 16 个非 ASCII 字符 → 过滤
                "a b c d e f g h".into(),              // 8 段 ASCII → 过滤
                "".into(),
            ],
            &entries,
        );
        assert_eq!(terms, vec!["面基".to_string(), "Lex Fridman".to_string()]);
    }

    #[test]
    fn build_terms_caps_at_500() {
        let terms = build_terms((0..600).map(|i| format!("term{i}")).collect(), &[]);
        assert_eq!(terms.len(), 500);
    }
}
