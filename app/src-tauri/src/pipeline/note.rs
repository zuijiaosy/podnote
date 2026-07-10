// note — 笔记数据结构:解析 LLM 输出 + Markdown 渲染(移植自 src/note.mjs)
// schema 与设计稿 view-model 对齐;t(秒)由 ts 派生,波形锚点 = t / durationSec
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::resolve::EpisodeMeta;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    #[serde(default)]
    pub speakers: BTreeMap<String, String>,
    pub tldr: String,
    pub points: Vec<Point>,
    pub quotes: Vec<Quote>,
    pub resources: Vec<Resource>,
    pub questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub ts: String,
    #[serde(default)]
    pub t: u64,
    #[serde(default)]
    pub who: Option<String>,
    pub h: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub ts: String,
    #[serde(default)]
    pub t: u64,
    #[serde(default)]
    pub who: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub name: String,
    pub note: String,
}

pub fn ts_to_seconds(ts: &str) -> u64 {
    ts.split(':')
        .filter_map(|p| p.trim().parse::<u64>().ok())
        .fold(0, |acc, n| acc * 60 + n)
}

/// 解析失败时带回原始输出,便于落盘调 prompt
#[derive(Debug)]
pub struct ParseError {
    pub message: String,
    pub raw: String,
}
impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for ParseError {}

/// 容忍代码围栏与前后杂讯:取首个 { 到末个 } 之间解析
pub fn parse_note(raw: &str) -> Result<Note, ParseError> {
    let err = |message: String| ParseError { message, raw: raw.to_string() };
    let start = raw.find('{').ok_or_else(|| err("LLM 输出里没找到 JSON 对象".into()))?;
    let end = raw.rfind('}').filter(|&e| e > start)
        .ok_or_else(|| err("LLM 输出里没找到 JSON 对象".into()))?;
    let mut note: Note = serde_json::from_str(&raw[start..=end])
        .map_err(|e| err(format!("笔记 JSON 解析失败: {e}")))?;
    for p in &mut note.points {
        p.t = ts_to_seconds(&p.ts);
    }
    for q in &mut note.quotes {
        q.t = ts_to_seconds(&q.ts);
    }
    Ok(note)
}

pub fn note_to_markdown(meta: &EpisodeMeta, note: &Note) -> String {
    let mut l: Vec<String> = Vec::new();
    l.push(format!("# {}", meta.title));
    l.push(String::new());
    l.push(format!("> {}", note.tldr));
    l.push(String::new());
    l.push("## 核心观点".into());
    l.push(String::new());
    for p in &note.points {
        let who = p.who.as_deref().map(|w| format!(" · {w}")).unwrap_or_default();
        l.push(format!("### {}{} ({})", p.h, who, p.ts));
        l.push(String::new());
        l.push(p.body.clone());
        l.push(String::new());
    }
    l.push("## 值得记住的话".into());
    l.push(String::new());
    for q in &note.quotes {
        let who = q.who.as_deref().map(|w| format!("—— {w} ")).unwrap_or_default();
        l.push(format!("> 「{}」{}({})", q.text, who, q.ts));
        l.push(String::new());
    }
    l.push("## 提到的资源".into());
    l.push(String::new());
    if note.resources.is_empty() {
        l.push("无".into());
    } else {
        l.push(
            note.resources
                .iter()
                .map(|r| format!("- **{}** — {}", r.name, r.note))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    l.push(String::new());
    l.push("## 我可能想深挖的".into());
    l.push(String::new());
    for (i, q) in note.questions.iter().enumerate() {
        l.push(format!("{}. {}", i + 1, q));
    }
    l.push(String::new());
    l.push("---".into());
    l.push(format!("节目: {}", meta.podcast));
    l.push(format!("原始链接: {}", meta.url));
    let mut out = l.join("\n");
    out.push('\n');
    out
}

/// 供调用侧把 anyhow 错误里的 raw 提出来落盘
pub fn raw_of(err: &anyhow::Error) -> Option<&str> {
    err.downcast_ref::<ParseError>().map(|e| e.raw.as_str())
}

pub fn to_anyhow(e: ParseError) -> anyhow::Error {
    anyhow!(e)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/ep125-note.json");

    #[test]
    fn ts_parsing() {
        assert_eq!(ts_to_seconds("04:12"), 252);
        assert_eq!(ts_to_seconds("1:02:19"), 3739);
    }

    #[test]
    fn parses_real_fixture_and_derives_t() {
        // fixture 是 App 产物 {meta, note},取 note 部分文本直接喂
        let v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let note_raw = serde_json::to_string(&v["note"]).unwrap();
        let wrapped = format!("好的,这是笔记:\n```json\n{note_raw}\n```\n以上。");
        let note = parse_note(&wrapped).unwrap();
        assert!(!note.tldr.is_empty());
        assert!(note.points.len() >= 4);
        assert!(note.points.iter().all(|p| p.t == ts_to_seconds(&p.ts)));
        assert!(note.quotes.iter().all(|q| q.who.is_some()));
        assert!(!note.speakers.is_empty());
    }

    #[test]
    fn missing_field_errors_with_raw() {
        let e = parse_note(r#"{"tldr":"x"}"#).unwrap_err();
        assert!(e.message.contains("解析失败"));
        assert_eq!(e.raw, r#"{"tldr":"x"}"#);
    }

    #[test]
    fn garbage_errors() {
        assert!(parse_note("抱歉我做不到").is_err());
    }

    #[test]
    fn markdown_renders_attribution() {
        let v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let note = parse_note(&serde_json::to_string(&v["note"]).unwrap()).unwrap();
        let meta = EpisodeMeta {
            url: "https://x".into(), audio_url: String::new(),
            title: "T".into(), podcast: "P".into(),
            shownotes: String::new(), duration: Some(100), pub_date: None,
        };
        let md = note_to_markdown(&meta, &note);
        assert!(md.contains("# T"));
        assert!(md.contains(" · ")); // 观点归属
        assert!(md.contains("—— ")); // 引用归属
        assert!(md.ends_with("原始链接: https://x\n"));
    }
}
