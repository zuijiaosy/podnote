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

/// 单串替换:纯 ASCII 词用 \b 词边界防子串误伤("No Players" 不吃 "No Playersx"),
/// 含 CJK 直接替换(中文无词边界,替换处数由 UI 预览把关);返回 (新串, 替换处数)
pub fn replace_in(s: &str, original: &str, corrected: &str) -> (String, usize) {
    if original.is_empty() || original == corrected {
        return (s.to_string(), 0);
    }
    if original.is_ascii() {
        let re = regex::Regex::new(&format!(r"\b{}\b", regex::escape(original)))
            .expect("escape 后的字面量必然合法");
        let n = re.find_iter(s).count();
        if n == 0 {
            return (s.to_string(), 0);
        }
        (re.replace_all(s, corrected).into_owned(), n)
    } else {
        let n = s.matches(original).count();
        if n == 0 {
            return (s.to_string(), 0);
        }
        (s.replace(original, corrected), n)
    }
}

/// 全笔记替换某词(划词纠正):结构化字段遍历,绝不碰 JSON 原文;返回替换处数
pub fn replace_term(note: &mut Note, original: &str, corrected: &str) -> usize {
    let mut count = 0;
    let mut apply = |s: &mut String| {
        let (new, n) = replace_in(s, original, corrected);
        if n > 0 {
            *s = new;
            count += n;
        }
    };
    apply(&mut note.tldr);
    for p in &mut note.points {
        apply(&mut p.h);
        apply(&mut p.body);
        if let Some(w) = &mut p.who {
            apply(w);
        }
    }
    for q in &mut note.quotes {
        apply(&mut q.text);
        if let Some(w) = &mut q.who {
            apply(w);
        }
    }
    for r in &mut note.resources {
        apply(&mut r.name);
        apply(&mut r.note);
    }
    for q in &mut note.questions {
        apply(q);
    }
    for v in note.speakers.values_mut() {
        apply(v);
    }
    count
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
    fn replace_in_ascii_respects_word_boundary() {
        let (s, n) = replace_in("听 No Players 和 No Playersx 的节目", "No Players", "No Priors");
        assert_eq!(n, 1);
        assert_eq!(s, "听 No Priors 和 No Playersx 的节目");
    }

    #[test]
    fn replace_in_cjk_and_noop() {
        let (s, n) = replace_in("面筋聊到面筋", "面筋", "面基");
        assert_eq!((s.as_str(), n), ("面基聊到面基", 2));
        assert_eq!(replace_in("原文", "词", "词").1, 0); // original == corrected
        assert_eq!(replace_in("原文", "", "x").1, 0);
        assert_eq!(replace_in("没出现", "面筋", "面基").1, 0);
    }

    #[test]
    fn replace_term_walks_all_fields_and_is_idempotent() {
        let mut note = Note {
            speakers: [("S1".to_string(), "面筋".to_string())].into_iter().collect(),
            tldr: "面筋这期讲面筋".into(),
            points: vec![Point { ts: "01:00".into(), t: 60, who: Some("面筋".into()), h: "标题".into(), body: "嘉宾提到面筋".into() }],
            quotes: vec![Quote { ts: "02:00".into(), t: 120, who: None, text: "面筋说的话".into() }],
            resources: vec![Resource { name: "面筋日谈".into(), note: "无关".into() }],
            questions: vec!["面筋是谁?".into()],
        };
        let n = replace_term(&mut note, "面筋", "面基");
        assert_eq!(n, 8);
        assert_eq!(note.tldr, "面基这期讲面基");
        assert_eq!(note.speakers["S1"], "面基");
        assert_eq!(note.resources[0].name, "面基日谈");
        // 幂等:再跑一遍不再命中
        assert_eq!(replace_term(&mut note, "面筋", "面基"), 0);
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
