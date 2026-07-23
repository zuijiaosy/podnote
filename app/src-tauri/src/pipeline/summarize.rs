// summarize — 转写稿 → 笔记 JSON(移植自 src/summarize.mjs)
// LLM 调用走 llm::stream_chat(三协议);LLM 偶发噪声 token,自动重试一次
use anyhow::{bail, Result};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::llm::{self, user_message};
use super::note::{parse_note, to_anyhow, Note};
use super::resolve::EpisodeMeta;

pub use super::llm::LlmConfig;

/// prompt 唯一真源:仓库根 prompts/note.md(播客)与 prompts/meeting.md(会议录音)
const PROMPT_TEMPLATE: &str = include_str!("../../../../prompts/note.md");
const MEETING_TEMPLATE: &str = include_str!("../../../../prompts/meeting.md");
const SYSTEM_PROMPT: &str =
    "你是播客笔记助手,无论节目是什么语言,笔记一律用中文书写(专有名词保留原文)。只输出一个合法的 JSON 对象,不要 Markdown 代码块,不要任何前言后语。";
const MEETING_SYSTEM: &str =
    "你是会议纪要助手,无论会议是什么语言,纪要一律用中文书写(专有名词保留原文)。只输出一个合法的 JSON 对象,不要 Markdown 代码块,不要任何前言后语。";
const MAX_TRIES: usize = 2;

/// 内容类型:决定用哪套 prompt(会议纪要要结论与行动项,播客笔记要观点与金句)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Podcast,
    Meeting,
}

pub fn build_prompt(meta: &EpisodeMeta, timed_text: &str, glossary: &str) -> String {
    build_prompt_kind(Kind::Podcast, meta, timed_text, glossary)
}

pub fn build_prompt_kind(
    kind: Kind,
    meta: &EpisodeMeta,
    timed_text: &str,
    glossary: &str,
) -> String {
    let template = match kind {
        Kind::Podcast => PROMPT_TEMPLATE,
        Kind::Meeting => MEETING_TEMPLATE,
    };
    template
        .replace("{{title}}", &meta.title)
        .replace("{{podcast}}", &meta.podcast)
        .replace(
            "{{shownotes}}",
            if meta.shownotes.is_empty() {
                "(无)"
            } else {
                &meta.shownotes
            },
        )
        .replace(
            "{{glossary}}",
            if glossary.is_empty() {
                "(无)"
            } else {
                glossary
            },
        )
        .replace("{{transcript}}", timed_text)
}

/// 进度回调:累计输出字符数(设计稿 SUMMARIZE 阶段的 CHARS 读数)
pub type Progress<'a> = &'a (dyn Fn(usize) + Send + Sync);

pub async fn summarize(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    kind: Kind,
    meta: &EpisodeMeta,
    timed_text: &str,
    glossary: &str,
    progress: Progress<'_>,
) -> Result<Note> {
    if cfg.api_key.is_empty() {
        bail!("缺少 LLM API Key");
    }
    let system = match kind {
        Kind::Podcast => SYSTEM_PROMPT,
        Kind::Meeting => MEETING_SYSTEM,
    };
    let prompt = build_prompt_kind(kind, meta, timed_text, glossary);
    let mut last_err = None;
    for _attempt in 0..MAX_TRIES {
        match run_once(client, cfg, system, &prompt, progress).await {
            Ok(note) => return Ok(note),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap())
}

async fn run_once(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    system: &str,
    prompt: &str,
    progress: Progress<'_>,
) -> Result<Note> {
    // 进度语义保持:累计输出字符数
    let chars = AtomicUsize::new(0);
    let on_delta = |d: &str| {
        let n = chars.fetch_add(d.chars().count(), Ordering::Relaxed) + d.chars().count();
        progress(n);
    };
    let out = llm::stream_chat(client, cfg, system, &[user_message(prompt)], &on_delta).await?;
    parse_note(&out).map_err(to_anyhow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_template_has_placeholders_filled() {
        let meta = EpisodeMeta {
            url: "u".into(),
            audio_url: "a".into(),
            title: "标题X".into(),
            podcast: "节目Y".into(),
            shownotes: String::new(),
            duration: None,
            pub_date: None,
        };
        let p = build_prompt(&meta, "[00:01] S1: 你好", "");
        assert!(p.contains("标题X"));
        assert!(p.contains("节目Y"));
        assert!(p.contains("(无)"));
        assert!(p.contains("[00:01] S1: 你好"));
        assert!(!p.contains("{{"));
    }

    #[test]
    fn prompt_injects_glossary() {
        let meta = EpisodeMeta {
            url: "u".into(),
            audio_url: "a".into(),
            title: "T".into(),
            podcast: "P".into(),
            shownotes: String::new(),
            duration: None,
            pub_date: None,
        };
        let p = build_prompt(&meta, "x", "面筋 → 面基\nNo Players → No Priors");
        assert!(p.contains("面筋 → 面基"));
        assert!(p.contains("No Players → No Priors"));
        assert!(!p.contains("{{glossary}}"));
    }

    #[test]
    fn meeting_prompt_fills_placeholders() {
        let meta = EpisodeMeta {
            url: "/tmp/rec.m4a".into(),
            audio_url: String::new(),
            title: "产品周会".into(),
            podcast: "会议".into(),
            shownotes: "参会:张三、李四;议程:发版计划".into(),
            duration: None,
            pub_date: None,
        };
        let p = build_prompt_kind(Kind::Meeting, &meta, "[00:01] S1: 开始吧", "错词 → 正词");
        assert!(p.contains("产品周会"));
        assert!(p.contains("参会:张三、李四"));
        assert!(p.contains("错词 → 正词"));
        assert!(p.contains("[00:01] S1: 开始吧"));
        assert!(p.contains("decisions"));
        assert!(p.contains("actions"));
        assert!(!p.contains("{{"));
    }
}
