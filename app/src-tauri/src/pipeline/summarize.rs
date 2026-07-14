// summarize — 转写稿 → 笔记 JSON(移植自 src/summarize.mjs)
// LLM 调用走 llm::stream_chat(三协议);LLM 偶发噪声 token,自动重试一次
use anyhow::{bail, Result};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::llm::{self, user_message};
use super::note::{parse_note, to_anyhow, Note};
use super::resolve::EpisodeMeta;

pub use super::llm::LlmConfig;

/// prompt 唯一真源:仓库根 prompts/note.md
const PROMPT_TEMPLATE: &str = include_str!("../../../../prompts/note.md");
const SYSTEM_PROMPT: &str =
    "你是播客笔记助手,无论节目是什么语言,笔记一律用中文书写(专有名词保留原文)。只输出一个合法的 JSON 对象,不要 Markdown 代码块,不要任何前言后语。";
const MAX_TRIES: usize = 2;

pub fn build_prompt(meta: &EpisodeMeta, timed_text: &str, glossary: &str) -> String {
    PROMPT_TEMPLATE
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
    meta: &EpisodeMeta,
    timed_text: &str,
    glossary: &str,
    progress: Progress<'_>,
) -> Result<Note> {
    if cfg.api_key.is_empty() {
        bail!("缺少 LLM API Key");
    }
    let prompt = build_prompt(meta, timed_text, glossary);
    let mut last_err = None;
    for _attempt in 0..MAX_TRIES {
        match run_once(client, cfg, &prompt, progress).await {
            Ok(note) => return Ok(note),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap())
}

async fn run_once(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    prompt: &str,
    progress: Progress<'_>,
) -> Result<Note> {
    // 进度语义保持:累计输出字符数
    let chars = AtomicUsize::new(0);
    let on_delta = |d: &str| {
        let n = chars.fetch_add(d.chars().count(), Ordering::Relaxed) + d.chars().count();
        progress(n);
    };
    let out = llm::stream_chat(
        client,
        cfg,
        SYSTEM_PROMPT,
        &[user_message(prompt)],
        &on_delta,
    )
    .await?;
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
}
