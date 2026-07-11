// llm — 通用流式聊天客户端,三协议:OpenAI Responses / Chat Completions / Anthropic Messages
// 协议差异集中在 request_body / extract_delta 两个纯函数;SSE 逐行缓冲主体协议无关。
// 多轮 messages 入参:summarize 只传一条 user,将来"基于笔记和字幕聊天"直接复用
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    OpenAiResponses,
    OpenAiCompletions,
    AnthropicMessages,
}

impl Protocol {
    /// 设置字符串 → 协议;token 与 Node CLI 的 PI_API 同名同义,未知值回落 Responses
    pub fn from_id(id: &str) -> Self {
        match id {
            "openai-completions" => Self::OpenAiCompletions,
            "anthropic-messages" => Self::AnthropicMessages,
            _ => Self::OpenAiResponses,
        }
    }

    /// 拼在 base_url(如 https://api.codexzh.com/v1)后面的请求路径
    pub fn path(&self) -> &'static str {
        match self {
            Self::OpenAiResponses => "/responses",
            Self::OpenAiCompletions => "/chat/completions",
            Self::AnthropicMessages => "/messages",
        }
    }
}

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub base_url: String, // 如 https://api.codexzh.com/v1
    pub api_key: String,
    pub model: String, // 如 grok-4.5
    pub protocol: Protocol,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    /// "user" | "assistant"
    pub role: String,
    pub content: String,
}

pub fn user_message(content: impl Into<String>) -> ChatMessage {
    ChatMessage { role: "user".into(), content: content.into() }
}

/// 按协议构造请求体(纯函数,单测友好)
pub fn request_body(
    protocol: Protocol,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
) -> Value {
    let msgs: Vec<Value> = messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    match protocol {
        Protocol::OpenAiResponses => json!({
            "model": model,
            "instructions": system,
            "input": msgs,
            "stream": true,
        }),
        Protocol::OpenAiCompletions => {
            let mut all = vec![json!({ "role": "system", "content": system })];
            all.extend(msgs);
            json!({ "model": model, "messages": all, "stream": true })
        }
        Protocol::AnthropicMessages => json!({
            "model": model,
            "system": system,
            "messages": msgs,
            // Anthropic 必填;取各型号输出上限交集,避免超过模型上限被拒
            "max_tokens": 8192,
            "stream": true,
        }),
    }
}

/// 单条 SSE 事件的解析结果
#[derive(Debug, PartialEq)]
pub enum Delta {
    Text(String),
    Err(String),
    None,
}

/// 按协议从 SSE 事件 JSON 里取增量文本/错误(纯函数,单测友好)
pub fn extract_delta(protocol: Protocol, event: &Value) -> Delta {
    let ty = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match protocol {
        Protocol::OpenAiResponses => match ty {
            "response.output_text.delta" => event
                .get("delta")
                .and_then(|v| v.as_str())
                .map(|d| Delta::Text(d.into()))
                .unwrap_or(Delta::None),
            "response.failed" | "error" => Delta::Err(
                event
                    .pointer("/response/error/message")
                    .or_else(|| event.pointer("/error/message"))
                    .or_else(|| event.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误")
                    .into(),
            ),
            _ => Delta::None,
        },
        Protocol::OpenAiCompletions => {
            if let Some(msg) = event.pointer("/error/message").and_then(|v| v.as_str()) {
                return Delta::Err(msg.into());
            }
            event
                .pointer("/choices/0/delta/content")
                .and_then(|v| v.as_str())
                .filter(|d| !d.is_empty())
                .map(|d| Delta::Text(d.into()))
                .unwrap_or(Delta::None)
        }
        Protocol::AnthropicMessages => match ty {
            "content_block_delta" => event
                .pointer("/delta/text")
                .and_then(|v| v.as_str())
                .map(|d| Delta::Text(d.into()))
                .unwrap_or(Delta::None),
            "error" => Delta::Err(
                event
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误")
                    .into(),
            ),
            _ => Delta::None,
        },
    }
}

/// 流式聊天:返回完整文本,增量经 on_delta 回调(进度显示用)
pub async fn stream_chat(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    system: &str,
    messages: &[ChatMessage],
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<String> {
    if cfg.api_key.is_empty() {
        bail!("缺少 LLM API Key");
    }
    let url = format!("{}{}", cfg.base_url.trim_end_matches('/'), cfg.protocol.path());
    let mut req = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&request_body(cfg.protocol, &cfg.model, system, messages));
    if cfg.protocol == Protocol::AnthropicMessages {
        // 官方网关认 x-api-key + anthropic-version;兼容型网关认 Bearer,双发无害
        req = req
            .header("x-api-key", &cfg.api_key)
            .header("anthropic-version", "2023-06-01");
    }
    let res = req.send().await.context("LLM 请求失败")?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        bail!("LLM 请求失败 {status}: {}", body.chars().take(300).collect::<String>());
    }

    // SSE:逐行取 data: {...},协议差异交给 extract_delta
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
            match extract_delta(cfg.protocol, &event) {
                Delta::Text(d) => {
                    out.push_str(&d);
                    on_delta(&d);
                }
                Delta::Err(msg) => err_msg = Some(msg),
                Delta::None => {}
            }
        }
    }
    if let Some(msg) = err_msg {
        bail!("LLM 请求失败: {msg}");
    }
    if out.trim().is_empty() {
        bail!("LLM 没有返回任何内容——检查网关地址、模型名、协议和 key 是否正确");
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs() -> Vec<ChatMessage> {
        vec![user_message("你好")]
    }

    #[test]
    fn protocol_from_id_with_fallback() {
        assert_eq!(Protocol::from_id("openai-responses"), Protocol::OpenAiResponses);
        assert_eq!(Protocol::from_id("openai-completions"), Protocol::OpenAiCompletions);
        assert_eq!(Protocol::from_id("anthropic-messages"), Protocol::AnthropicMessages);
        assert_eq!(Protocol::from_id("something-else"), Protocol::OpenAiResponses);
        assert_eq!(Protocol::OpenAiCompletions.path(), "/chat/completions");
    }

    #[test]
    fn builds_responses_body() {
        let b = request_body(Protocol::OpenAiResponses, "m1", "sys", &msgs());
        assert_eq!(b["instructions"], "sys");
        assert_eq!(b["input"][0]["role"], "user");
        assert_eq!(b["input"][0]["content"], "你好");
        assert_eq!(b["stream"], true);
    }

    #[test]
    fn builds_completions_body_with_system_first() {
        let b = request_body(Protocol::OpenAiCompletions, "m1", "sys", &msgs());
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][0]["content"], "sys");
        assert_eq!(b["messages"][1]["role"], "user");
        assert!(b.get("input").is_none());
    }

    #[test]
    fn builds_anthropic_body_with_max_tokens() {
        let b = request_body(Protocol::AnthropicMessages, "m1", "sys", &msgs());
        assert_eq!(b["system"], "sys");
        assert_eq!(b["max_tokens"], 8192);
        assert_eq!(b["messages"][0]["role"], "user");
    }

    #[test]
    fn extracts_responses_delta_and_error() {
        let p = Protocol::OpenAiResponses;
        let ev: Value =
            serde_json::from_str(r#"{"type":"response.output_text.delta","delta":"abc"}"#).unwrap();
        assert_eq!(extract_delta(p, &ev), Delta::Text("abc".into()));
        let err: Value = serde_json::from_str(
            r#"{"type":"response.failed","response":{"error":{"message":"配额不足"}}}"#,
        )
        .unwrap();
        assert_eq!(extract_delta(p, &err), Delta::Err("配额不足".into()));
        let other: Value = serde_json::from_str(r#"{"type":"response.completed"}"#).unwrap();
        assert_eq!(extract_delta(p, &other), Delta::None);
    }

    #[test]
    fn extracts_completions_delta_and_error() {
        let p = Protocol::OpenAiCompletions;
        let ev: Value = serde_json::from_str(
            r#"{"id":"x","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(extract_delta(p, &ev), Delta::Text("你好".into()));
        // 首帧只有 role、尾帧 delta 为空对象:都不产出文本
        let role_only: Value = serde_json::from_str(
            r#"{"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(extract_delta(p, &role_only), Delta::None);
        let err: Value =
            serde_json::from_str(r#"{"error":{"message":"model not found","type":"invalid"}}"#)
                .unwrap();
        assert_eq!(extract_delta(p, &err), Delta::Err("model not found".into()));
    }

    #[test]
    fn extracts_anthropic_delta_and_error() {
        let p = Protocol::AnthropicMessages;
        let ev: Value = serde_json::from_str(
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"世界"}}"#,
        )
        .unwrap();
        assert_eq!(extract_delta(p, &ev), Delta::Text("世界".into()));
        let err: Value = serde_json::from_str(
            r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
        )
        .unwrap();
        assert_eq!(extract_delta(p, &err), Delta::Err("Overloaded".into()));
        let other: Value =
            serde_json::from_str(r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#)
                .unwrap();
        assert_eq!(extract_delta(p, &other), Delta::None);
    }
}
