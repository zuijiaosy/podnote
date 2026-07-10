// summarize — 转写稿 → 笔记 JSON(移植自 src/summarize.mjs)
// openai-responses 协议 SSE 流;LLM 偶发噪声 token,自动重试一次
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::note::{parse_note, to_anyhow, Note};
use super::resolve::EpisodeMeta;

/// prompt 唯一真源:仓库根 prompts/note.md
const PROMPT_TEMPLATE: &str = include_str!("../../../../prompts/note.md");
const SYSTEM_PROMPT: &str =
    "你是一个中文播客笔记助手。只输出一个合法的 JSON 对象,不要 Markdown 代码块,不要任何前言后语。";
const MAX_TRIES: usize = 2;

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub base_url: String, // 如 https://api.codexzh.com/v1
    pub api_key: String,
    pub model: String, // 如 grok-4.5
}

pub fn build_prompt(meta: &EpisodeMeta, timed_text: &str) -> String {
    PROMPT_TEMPLATE
        .replace("{{title}}", &meta.title)
        .replace("{{podcast}}", &meta.podcast)
        .replace(
            "{{shownotes}}",
            if meta.shownotes.is_empty() { "(无)" } else { &meta.shownotes },
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
    progress: Progress<'_>,
) -> Result<Note> {
    if cfg.api_key.is_empty() {
        bail!("缺少 LLM API Key");
    }
    let prompt = build_prompt(meta, timed_text);
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
    let res = client
        .post(format!("{}/responses", cfg.base_url.trim_end_matches('/')))
        .bearer_auth(&cfg.api_key)
        .json(&json!({
            "model": cfg.model,
            "instructions": SYSTEM_PROMPT,
            "input": prompt,
            "stream": true,
        }))
        .send()
        .await
        .context("LLM 请求失败")?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        bail!("LLM 请求失败 {status}: {}", body.chars().take(300).collect::<String>());
    }

    // SSE:逐行取 data: {...};累积 response.output_text.delta
    let mut out = String::new();
    let mut err_msg: Option<String> = None;
    let mut buf = String::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("LLM 流读取失败")?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
            let ty = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match ty {
                "response.output_text.delta" => {
                    if let Some(d) = event.get("delta").and_then(|v| v.as_str()) {
                        out.push_str(d);
                        progress(out.chars().count());
                    }
                }
                "response.failed" | "error" => {
                    let msg = event
                        .pointer("/response/error/message")
                        .or_else(|| event.pointer("/error/message"))
                        .or_else(|| event.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知错误");
                    err_msg = Some(msg.to_string());
                }
                _ => {}
            }
        }
    }
    if let Some(msg) = err_msg {
        bail!("LLM 请求失败: {msg}");
    }
    if out.trim().is_empty() {
        bail!("LLM 没有返回任何内容——检查网关地址、模型名和 key 是否正确");
    }
    parse_note(&out).map_err(to_anyhow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_template_has_placeholders_filled() {
        let meta = EpisodeMeta {
            url: "u".into(), audio_url: "a".into(),
            title: "标题X".into(), podcast: "节目Y".into(),
            shownotes: String::new(), duration: None, pub_date: None,
        };
        let p = build_prompt(&meta, "[00:01] S1: 你好");
        assert!(p.contains("标题X"));
        assert!(p.contains("节目Y"));
        assert!(p.contains("(无)"));
        assert!(p.contains("[00:01] S1: 你好"));
        assert!(!p.contains("{{"));
    }
}
