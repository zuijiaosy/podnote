// llm — 通用流式聊天客户端,三协议:OpenAI Responses / Chat Completions / Anthropic Messages
// 协议差异集中在 request_body(_tools) / extract_deltas 纯函数;SSE 逐行缓冲主体协议无关。
// 两条入口:stream_chat(纯文本,summarize/correct 用)、stream_step(带工具的 agent 单轮,agent.rs 用)
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};

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

    /// 拼在 base_url(如 https://api.example.com/v1)后面的请求路径
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
    pub base_url: String, // 如 https://api.example.com/v1
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
    ChatMessage {
        role: "user".into(),
        content: content.into(),
    }
}

/// 工具定义;parameters 是 JSON Schema,三协议的字段差异见 request_body_tools
#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// LLM 发起的一次工具调用;arguments 保留原始 JSON 串(流式分片拼接的产物)
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// 工具执行结果,回填给 LLM 继续下一轮
#[derive(Debug, Clone)]
pub struct ToolResult {
    pub call_id: String,
    pub content: String,
}

/// agent 多轮消息(带工具轮次);纯文本对话仍走 ChatMessage/stream_chat
#[derive(Debug, Clone)]
pub enum AgentMsg {
    User {
        content: String,
    },
    Assistant {
        text: String,
        tool_calls: Vec<ToolCall>,
    },
    ToolResults(Vec<ToolResult>),
}

pub fn agent_user(content: impl Into<String>) -> AgentMsg {
    AgentMsg::User {
        content: content.into(),
    }
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

/// 按协议构造带工具的 agent 请求体(纯函数,单测友好);tools 为空则不带 tools 字段
pub fn request_body_tools(
    protocol: Protocol,
    model: &str,
    system: &str,
    messages: &[AgentMsg],
    tools: &[ToolDef],
) -> Value {
    match protocol {
        // Responses 无状态模式:工具调用与结果都是扁平 input item,全量回传
        Protocol::OpenAiResponses => {
            let mut input: Vec<Value> = Vec::new();
            for m in messages {
                match m {
                    AgentMsg::User { content } => {
                        input.push(json!({ "role": "user", "content": content }));
                    }
                    AgentMsg::Assistant { text, tool_calls } => {
                        if !text.is_empty() {
                            input.push(json!({ "role": "assistant", "content": text }));
                        }
                        for tc in tool_calls {
                            input.push(json!({
                                "type": "function_call",
                                "call_id": tc.id, "name": tc.name, "arguments": tc.arguments,
                            }));
                        }
                    }
                    AgentMsg::ToolResults(results) => {
                        for r in results {
                            input.push(json!({
                                "type": "function_call_output",
                                "call_id": r.call_id, "output": r.content,
                            }));
                        }
                    }
                }
            }
            let mut b =
                json!({ "model": model, "instructions": system, "input": input, "stream": true });
            if !tools.is_empty() {
                // Responses 的工具定义是扁平结构(不嵌套 function)
                b["tools"] = tools
                    .iter()
                    .map(|t| {
                        json!({ "type": "function", "name": t.name, "description": t.description, "parameters": t.parameters })
                    })
                    .collect::<Vec<_>>()
                    .into();
            }
            b
        }
        Protocol::OpenAiCompletions => {
            let mut msgs = vec![json!({ "role": "system", "content": system })];
            for m in messages {
                match m {
                    AgentMsg::User { content } => {
                        msgs.push(json!({ "role": "user", "content": content }));
                    }
                    AgentMsg::Assistant { text, tool_calls } => {
                        // 纯工具轮 content 置 null(OpenAI 规范允许,空串部分网关会拒)
                        let content = if text.is_empty() {
                            Value::Null
                        } else {
                            Value::String(text.clone())
                        };
                        let mut am = json!({ "role": "assistant", "content": content });
                        if !tool_calls.is_empty() {
                            am["tool_calls"] = tool_calls
                                .iter()
                                .map(|tc| {
                                    json!({
                                        "id": tc.id, "type": "function",
                                        "function": { "name": tc.name, "arguments": tc.arguments },
                                    })
                                })
                                .collect::<Vec<_>>()
                                .into();
                        }
                        msgs.push(am);
                    }
                    AgentMsg::ToolResults(results) => {
                        for r in results {
                            msgs.push(json!({ "role": "tool", "tool_call_id": r.call_id, "content": r.content }));
                        }
                    }
                }
            }
            let mut b = json!({ "model": model, "messages": msgs, "stream": true });
            if !tools.is_empty() {
                b["tools"] = tools
                    .iter()
                    .map(|t| {
                        json!({
                            "type": "function",
                            "function": { "name": t.name, "description": t.description, "parameters": t.parameters },
                        })
                    })
                    .collect::<Vec<_>>()
                    .into();
            }
            b
        }
        Protocol::AnthropicMessages => {
            let mut msgs: Vec<Value> = Vec::new();
            for m in messages {
                match m {
                    AgentMsg::User { content } => {
                        msgs.push(json!({ "role": "user", "content": content }));
                    }
                    AgentMsg::Assistant { text, tool_calls } => {
                        let mut blocks: Vec<Value> = Vec::new();
                        if !text.is_empty() {
                            blocks.push(json!({ "type": "text", "text": text }));
                        }
                        for tc in tool_calls {
                            // tool_use 的 input 是对象:arguments 串解析失败退空对象
                            let input: Value =
                                serde_json::from_str(&tc.arguments).unwrap_or_else(|_| json!({}));
                            blocks.push(json!({ "type": "tool_use", "id": tc.id, "name": tc.name, "input": input }));
                        }
                        msgs.push(json!({ "role": "assistant", "content": blocks }));
                    }
                    AgentMsg::ToolResults(results) => {
                        // Anthropic 的工具结果放在 user 消息的 tool_result 块里
                        let blocks: Vec<Value> = results
                            .iter()
                            .map(|r| json!({ "type": "tool_result", "tool_use_id": r.call_id, "content": r.content }))
                            .collect();
                        msgs.push(json!({ "role": "user", "content": blocks }));
                    }
                }
            }
            let mut b = json!({
                "model": model, "system": system, "messages": msgs,
                "max_tokens": 8192, "stream": true,
            });
            if !tools.is_empty() {
                b["tools"] = tools
                    .iter()
                    .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.parameters }))
                    .collect::<Vec<_>>()
                    .into();
            }
            b
        }
    }
}

/// 单条 SSE 事件的解析产物;一条事件可能携带多个增量(如 Completions 一帧多个 tool_call 分片)
#[derive(Debug, PartialEq)]
pub enum Delta {
    Text(String),
    /// 工具调用开始:Completions 首片带 id/name;Responses/Anthropic 的 start 事件
    ToolCallStart {
        index: usize,
        id: String,
        name: String,
    },
    /// 工具调用参数分片,按 index 拼接
    ToolCallArgs {
        index: usize,
        args: String,
    },
    /// 工具调用整体完成(仅 Responses output_item.done):携带权威全量参数,整体覆盖
    ToolCallDone {
        index: usize,
        id: String,
        name: String,
        args: String,
    },
    Err(String),
}

/// 按协议从 SSE 事件 JSON 里取增量(文本/工具调用/错误;纯函数,单测友好)。空 Vec = 无增量
pub fn extract_deltas(protocol: Protocol, event: &Value) -> Vec<Delta> {
    let ty = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let str_of = |v: Option<&Value>| v.and_then(|x| x.as_str()).unwrap_or("").to_string();
    match protocol {
        Protocol::OpenAiResponses => match ty {
            "response.output_text.delta" => event
                .get("delta")
                .and_then(|v| v.as_str())
                .map(|d| vec![Delta::Text(d.into())])
                .unwrap_or_default(),
            // 函数调用条目出现:取 call_id(回传 function_call_output 认它,不是 item.id)与函数名
            "response.output_item.added" | "response.output_item.done" => {
                let item = event.get("item");
                if item.and_then(|i| i.get("type")).and_then(|v| v.as_str())
                    != Some("function_call")
                {
                    return vec![];
                }
                let index = event
                    .get("output_index")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let id = str_of(item.and_then(|i| i.get("call_id")));
                let name = str_of(item.and_then(|i| i.get("name")));
                if ty == "response.output_item.added" {
                    vec![Delta::ToolCallStart { index, id, name }]
                } else {
                    // done 携带权威全量参数:有的网关不发分片,以此为准整体覆盖
                    let args = str_of(item.and_then(|i| i.get("arguments")));
                    vec![Delta::ToolCallDone {
                        index,
                        id,
                        name,
                        args,
                    }]
                }
            }
            "response.function_call_arguments.delta" => {
                let index = event
                    .get("output_index")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                event
                    .get("delta")
                    .and_then(|v| v.as_str())
                    .filter(|d| !d.is_empty())
                    .map(|d| {
                        vec![Delta::ToolCallArgs {
                            index,
                            args: d.into(),
                        }]
                    })
                    .unwrap_or_default()
            }
            "response.failed" | "error" => vec![Delta::Err(
                event
                    .pointer("/response/error/message")
                    .or_else(|| event.pointer("/error/message"))
                    .or_else(|| event.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误")
                    .into(),
            )],
            _ => vec![],
        },
        Protocol::OpenAiCompletions => {
            if let Some(msg) = event.pointer("/error/message").and_then(|v| v.as_str()) {
                return vec![Delta::Err(msg.into())];
            }
            let mut out = Vec::new();
            if let Some(d) = event
                .pointer("/choices/0/delta/content")
                .and_then(|v| v.as_str())
                .filter(|d| !d.is_empty())
            {
                out.push(Delta::Text(d.into()));
            }
            // tool_calls 分片:首片带 id/name,后续片按 index 拼 arguments
            if let Some(tcs) = event
                .pointer("/choices/0/delta/tool_calls")
                .and_then(|v| v.as_array())
            {
                for (i, tc) in tcs.iter().enumerate() {
                    let index = tc
                        .get("index")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as usize)
                        .unwrap_or(i);
                    let id = str_of(tc.get("id"));
                    let name = str_of(tc.pointer("/function/name"));
                    if !id.is_empty() || !name.is_empty() {
                        out.push(Delta::ToolCallStart { index, id, name });
                    }
                    if let Some(args) = tc
                        .pointer("/function/arguments")
                        .and_then(|v| v.as_str())
                        .filter(|a| !a.is_empty())
                    {
                        out.push(Delta::ToolCallArgs {
                            index,
                            args: args.into(),
                        });
                    }
                }
            }
            out
        }
        Protocol::AnthropicMessages => match ty {
            "content_block_start" => {
                let cb = event.get("content_block");
                if cb.and_then(|c| c.get("type")).and_then(|v| v.as_str()) != Some("tool_use") {
                    return vec![];
                }
                let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                vec![Delta::ToolCallStart {
                    index,
                    id: str_of(cb.and_then(|c| c.get("id"))),
                    name: str_of(cb.and_then(|c| c.get("name"))),
                }]
            }
            "content_block_delta" => {
                let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                if let Some(t) = event.pointer("/delta/text").and_then(|v| v.as_str()) {
                    vec![Delta::Text(t.into())]
                } else if let Some(pj) = event
                    .pointer("/delta/partial_json")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    vec![Delta::ToolCallArgs {
                        index,
                        args: pj.into(),
                    }]
                } else {
                    vec![]
                }
            }
            "error" => vec![Delta::Err(
                event
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误")
                    .into(),
            )],
            _ => vec![],
        },
    }
}

/// 一次请求的用量(SSE 终局事件解析)。字段 None = 供应商没返回,展示层显示"—",不许推算成零。
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    /// 缓存命中读取(OpenAI cached_tokens / Anthropic cache_read_input_tokens)
    pub cache_read_tokens: Option<u64>,
    /// 缓存写入(仅 Anthropic cache_creation_input_tokens)
    pub cache_write_tokens: Option<u64>,
}

impl Usage {
    /// 后到的非空字段覆盖(Anthropic 的 message_delta 输出是累计值,覆盖语义正确)
    fn merge(&mut self, other: Usage) {
        if other.input_tokens.is_some() {
            self.input_tokens = other.input_tokens;
        }
        if other.output_tokens.is_some() {
            self.output_tokens = other.output_tokens;
        }
        if other.cache_read_tokens.is_some() {
            self.cache_read_tokens = other.cache_read_tokens;
        }
        if other.cache_write_tokens.is_some() {
            self.cache_write_tokens = other.cache_write_tokens;
        }
    }
}

/// 按协议从 SSE 事件里取用量(纯函数,单测友好)。
/// Responses 在 response.completed;Completions 在带 usage 的终局 chunk(需请求带
/// stream_options.include_usage);Anthropic 分散在 message_start(输入/缓存)与 message_delta(输出累计)。
pub fn extract_usage(protocol: Protocol, event: &Value) -> Option<Usage> {
    let ty = event.get("type").and_then(|v| v.as_str());
    let n = |v: Option<&Value>| v.and_then(|x| x.as_u64());
    match protocol {
        Protocol::OpenAiResponses => {
            if ty != Some("response.completed") {
                return None;
            }
            let u = event.pointer("/response/usage")?;
            Some(Usage {
                input_tokens: n(u.get("input_tokens")),
                output_tokens: n(u.get("output_tokens")),
                cache_read_tokens: n(u.pointer("/input_tokens_details/cached_tokens")),
                cache_write_tokens: None,
            })
        }
        Protocol::OpenAiCompletions => {
            let u = event.get("usage").filter(|u| !u.is_null())?;
            Some(Usage {
                input_tokens: n(u.get("prompt_tokens")),
                output_tokens: n(u.get("completion_tokens")),
                cache_read_tokens: n(u.pointer("/prompt_tokens_details/cached_tokens")),
                cache_write_tokens: None,
            })
        }
        Protocol::AnthropicMessages => match ty {
            Some("message_start") => {
                let u = event.pointer("/message/usage")?;
                Some(Usage {
                    input_tokens: n(u.get("input_tokens")),
                    output_tokens: None,
                    cache_read_tokens: n(u.get("cache_read_input_tokens")),
                    cache_write_tokens: n(u.get("cache_creation_input_tokens")),
                })
            }
            Some("message_delta") => {
                let out = n(event.pointer("/usage/output_tokens"))?;
                Some(Usage {
                    output_tokens: Some(out),
                    ..Default::default()
                })
            }
            _ => None,
        },
    }
}

/// SSE 主循环:POST → 逐行取 data: {...} → 逐个增量回调;cancel 置位即中止(协议无关)。
/// 返回流中解析到的用量(供应商没发就是 None,调用方不许推算)
async fn run_stream(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    body: &Value,
    cancel: Option<&AtomicBool>,
    on_delta: &mut (dyn FnMut(Delta) + Send),
) -> Result<Option<Usage>> {
    if cfg.api_key.is_empty() {
        bail!("缺少 LLM API Key");
    }
    let url = format!(
        "{}{}",
        cfg.base_url.trim_end_matches('/'),
        cfg.protocol.path()
    );
    let mut req = client.post(&url).bearer_auth(&cfg.api_key).json(body);
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
        bail!(
            "LLM 请求失败 {status}: {}",
            body.chars().take(300).collect::<String>()
        );
    }

    let mut buf = String::new();
    let mut usage: Option<Usage> = None;
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.map(|c| c.load(Ordering::Relaxed)).unwrap_or(false) {
            bail!("已取消");
        }
        let chunk = chunk.context("LLM 流读取失败")?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(u) = extract_usage(cfg.protocol, &event) {
                usage.get_or_insert_with(Usage::default).merge(u);
            }
            for d in extract_deltas(cfg.protocol, &event) {
                on_delta(d);
            }
        }
    }
    Ok(usage)
}

/// 流式聊天:返回完整文本,增量经 on_delta 回调(进度显示用)
pub async fn stream_chat(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    system: &str,
    messages: &[ChatMessage],
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<String> {
    stream_chat_full(client, cfg, system, messages, None, None, on_delta)
        .await
        .map(|(text, _)| text)
}

/// 全功能版流式聊天:可取消 + 返回用量 + 可选请求体改写(注入 store/cache_control 等按需字段)。
/// 存量调用方走上面的 stream_chat 包装,行为不变;QA 等新入口用这个。
pub async fn stream_chat_full(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    system: &str,
    messages: &[ChatMessage],
    cancel: Option<&AtomicBool>,
    patch_body: Option<&(dyn Fn(&mut Value) + Send + Sync)>,
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<(String, Option<Usage>)> {
    let mut body = request_body(cfg.protocol, &cfg.model, system, messages);
    if let Some(patch) = patch_body {
        patch(&mut body);
    }
    let mut out = String::new();
    let mut err_msg: Option<String> = None;
    let usage = run_stream(client, cfg, &body, cancel, &mut |d| match d {
        Delta::Text(t) => {
            out.push_str(&t);
            on_delta(&t);
        }
        Delta::Err(msg) => err_msg = Some(msg),
        _ => {} // 纯文本对话不带 tools,工具增量不会出现
    })
    .await?;
    if let Some(msg) = err_msg {
        bail!("LLM 请求失败: {msg}");
    }
    if out.trim().is_empty() {
        bail!("LLM 没有返回任何内容——检查网关地址、模型名、协议和 key 是否正确");
    }
    Ok((out, usage))
}

/// agent 单轮产出:叙述文本 + 本轮请求的工具调用(为空即终局轮)
#[derive(Debug, Default)]
pub struct StepOut {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

/// 流式增量累加器(纯逻辑,单测友好):文本拼接 + 工具调用分片按 index 拼装
#[derive(Default)]
pub struct StepAccum {
    text: String,
    calls: BTreeMap<usize, ToolCall>,
    err: Option<String>,
}

impl StepAccum {
    /// 吃进一个增量;返回需要向外转发的文本增量(进度显示用)
    pub fn push(&mut self, d: Delta) -> Option<String> {
        let blank = || ToolCall {
            id: String::new(),
            name: String::new(),
            arguments: String::new(),
        };
        match d {
            Delta::Text(t) => {
                self.text.push_str(&t);
                return Some(t);
            }
            Delta::ToolCallStart { index, id, name } => {
                let slot = self.calls.entry(index).or_insert_with(blank);
                if !id.is_empty() {
                    slot.id = id;
                }
                if !name.is_empty() {
                    slot.name = name;
                }
            }
            Delta::ToolCallArgs { index, args } => {
                self.calls
                    .entry(index)
                    .or_insert_with(blank)
                    .arguments
                    .push_str(&args);
            }
            Delta::ToolCallDone {
                index,
                id,
                name,
                args,
            } => {
                // 权威全量,整体覆盖分片拼接结果
                self.calls.insert(
                    index,
                    ToolCall {
                        id,
                        name,
                        arguments: args,
                    },
                );
            }
            Delta::Err(msg) => self.err = Some(msg),
        }
        None
    }

    /// 收尾:错误优先;无名工具调用(分片残缺)丢弃;文本与工具都空视为无返回
    pub fn finish(self) -> Result<StepOut> {
        if let Some(msg) = self.err {
            bail!("LLM 请求失败: {msg}");
        }
        let tool_calls: Vec<ToolCall> = self
            .calls
            .into_values()
            .filter(|c| !c.name.is_empty())
            .collect();
        if self.text.trim().is_empty() && tool_calls.is_empty() {
            bail!("LLM 没有返回任何内容——检查网关地址、模型名、协议和 key 是否正确");
        }
        Ok(StepOut {
            text: self.text,
            tool_calls,
        })
    }
}

/// agent 单轮流式请求(带工具):流结束后按"是否累积到工具调用"区分工具轮/终局轮,
/// 不依赖 finish_reason(更抗网关差异);cancel 置位时在 chunk 粒度中止
pub async fn stream_step(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    system: &str,
    messages: &[AgentMsg],
    tools: &[ToolDef],
    cancel: Option<&AtomicBool>,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<StepOut> {
    let body = request_body_tools(cfg.protocol, &cfg.model, system, messages, tools);
    let mut acc = StepAccum::default();
    run_stream(client, cfg, &body, cancel, &mut |d| {
        if let Some(t) = acc.push(d) {
            on_text(&t);
        }
    })
    .await?;
    acc.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs() -> Vec<ChatMessage> {
        vec![user_message("你好")]
    }

    #[test]
    fn protocol_from_id_with_fallback() {
        assert_eq!(
            Protocol::from_id("openai-responses"),
            Protocol::OpenAiResponses
        );
        assert_eq!(
            Protocol::from_id("openai-completions"),
            Protocol::OpenAiCompletions
        );
        assert_eq!(
            Protocol::from_id("anthropic-messages"),
            Protocol::AnthropicMessages
        );
        assert_eq!(
            Protocol::from_id("something-else"),
            Protocol::OpenAiResponses
        );
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
    fn extracts_usage_responses_completed() {
        let ev = json!({
            "type": "response.completed",
            "response": { "usage": {
                "input_tokens": 42180, "output_tokens": 816,
                "input_tokens_details": { "cached_tokens": 37940 }
            }}
        });
        let u = extract_usage(Protocol::OpenAiResponses, &ev).unwrap();
        assert_eq!(u.input_tokens, Some(42180));
        assert_eq!(u.output_tokens, Some(816));
        assert_eq!(u.cache_read_tokens, Some(37940));
        assert_eq!(u.cache_write_tokens, None);
        // 非终局事件不出用量
        assert!(extract_usage(
            Protocol::OpenAiResponses,
            &json!({"type": "response.output_text.delta"})
        )
        .is_none());
    }

    #[test]
    fn extracts_usage_completions_final_chunk() {
        // 中途 chunk 的 usage 为 null(include_usage 模式),不许当成零
        assert!(extract_usage(
            Protocol::OpenAiCompletions,
            &json!({"choices": [], "usage": null})
        )
        .is_none());
        let ev = json!({ "choices": [], "usage": {
            "prompt_tokens": 100, "completion_tokens": 20,
            "prompt_tokens_details": { "cached_tokens": 80 }
        }});
        let u = extract_usage(Protocol::OpenAiCompletions, &ev).unwrap();
        assert_eq!(u.input_tokens, Some(100));
        assert_eq!(u.output_tokens, Some(20));
        assert_eq!(u.cache_read_tokens, Some(80));
    }

    #[test]
    fn extracts_usage_anthropic_start_plus_delta_merge() {
        let start = json!({ "type": "message_start", "message": { "usage": {
            "input_tokens": 12, "cache_read_input_tokens": 30000, "cache_creation_input_tokens": 500
        }}});
        let delta = json!({ "type": "message_delta", "usage": { "output_tokens": 640 }});
        let mut u = extract_usage(Protocol::AnthropicMessages, &start).unwrap();
        u.merge(extract_usage(Protocol::AnthropicMessages, &delta).unwrap());
        assert_eq!(u.input_tokens, Some(12));
        assert_eq!(u.output_tokens, Some(640));
        assert_eq!(u.cache_read_tokens, Some(30000));
        assert_eq!(u.cache_write_tokens, Some(500));
    }

    #[test]
    fn extracts_responses_delta_and_error() {
        let p = Protocol::OpenAiResponses;
        let ev: Value =
            serde_json::from_str(r#"{"type":"response.output_text.delta","delta":"abc"}"#).unwrap();
        assert_eq!(extract_deltas(p, &ev), vec![Delta::Text("abc".into())]);
        let err: Value = serde_json::from_str(
            r#"{"type":"response.failed","response":{"error":{"message":"配额不足"}}}"#,
        )
        .unwrap();
        assert_eq!(extract_deltas(p, &err), vec![Delta::Err("配额不足".into())]);
        let other: Value = serde_json::from_str(r#"{"type":"response.completed"}"#).unwrap();
        assert!(extract_deltas(p, &other).is_empty());
    }

    #[test]
    fn extracts_completions_delta_and_error() {
        let p = Protocol::OpenAiCompletions;
        let ev: Value = serde_json::from_str(
            r#"{"id":"x","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(extract_deltas(p, &ev), vec![Delta::Text("你好".into())]);
        // 首帧只有 role、尾帧 delta 为空对象:都不产出文本
        let role_only: Value = serde_json::from_str(
            r#"{"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert!(extract_deltas(p, &role_only).is_empty());
        let err: Value =
            serde_json::from_str(r#"{"error":{"message":"model not found","type":"invalid"}}"#)
                .unwrap();
        assert_eq!(
            extract_deltas(p, &err),
            vec![Delta::Err("model not found".into())]
        );
    }

    #[test]
    fn extracts_anthropic_delta_and_error() {
        let p = Protocol::AnthropicMessages;
        let ev: Value = serde_json::from_str(
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"世界"}}"#,
        )
        .unwrap();
        assert_eq!(extract_deltas(p, &ev), vec![Delta::Text("世界".into())]);
        let err: Value = serde_json::from_str(
            r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &err),
            vec![Delta::Err("Overloaded".into())]
        );
        let other: Value =
            serde_json::from_str(r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#)
                .unwrap();
        assert!(extract_deltas(p, &other).is_empty());
    }

    // ===== tool-calling:三协议增量解析 =====

    #[test]
    fn extracts_completions_tool_call_fragments() {
        let p = Protocol::OpenAiCompletions;
        // 首片:id + name + 空 arguments → 只产 Start
        let first: Value = serde_json::from_str(
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &first),
            vec![Delta::ToolCallStart {
                index: 0,
                id: "call_abc".into(),
                name: "search".into()
            }]
        );
        // 后续片:只有 arguments 分片
        let frag: Value = serde_json::from_str(
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"qu"}}]},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &frag),
            vec![Delta::ToolCallArgs {
                index: 0,
                args: "{\"qu".into()
            }]
        );
        // 首片同时带参数分片 → Start + Args 两个增量
        let both: Value = serde_json::from_str(
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_x","function":{"name":"search","arguments":"{"}}]},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &both),
            vec![
                Delta::ToolCallStart {
                    index: 1,
                    id: "call_x".into(),
                    name: "search".into()
                },
                Delta::ToolCallArgs {
                    index: 1,
                    args: "{".into()
                },
            ]
        );
    }

    #[test]
    fn extracts_responses_tool_call_events() {
        let p = Protocol::OpenAiResponses;
        let added: Value = serde_json::from_str(
            r#"{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_r1","name":"search","arguments":""}}"#,
        )
        .unwrap();
        // call_id 优先于 item.id(回传 function_call_output 认 call_id)
        assert_eq!(
            extract_deltas(p, &added),
            vec![Delta::ToolCallStart {
                index: 0,
                id: "call_r1".into(),
                name: "search".into()
            }]
        );
        let frag: Value = serde_json::from_str(
            r#"{"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\"query\":"}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &frag),
            vec![Delta::ToolCallArgs {
                index: 0,
                args: "{\"query\":".into()
            }]
        );
        let done: Value = serde_json::from_str(
            r#"{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_r1","name":"search","arguments":"{\"query\":\"No Priors\"}"}}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &done),
            vec![Delta::ToolCallDone {
                index: 0,
                id: "call_r1".into(),
                name: "search".into(),
                args: "{\"query\":\"No Priors\"}".into(),
            }]
        );
        // 非 function_call 条目(如 message)不产工具增量
        let msg_item: Value = serde_json::from_str(
            r#"{"type":"response.output_item.added","output_index":0,"item":{"type":"message"}}"#,
        )
        .unwrap();
        assert!(extract_deltas(p, &msg_item).is_empty());
    }

    #[test]
    fn extracts_anthropic_tool_use_events() {
        let p = Protocol::AnthropicMessages;
        let start: Value = serde_json::from_str(
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search","input":{}}}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &start),
            vec![Delta::ToolCallStart {
                index: 1,
                id: "toolu_1".into(),
                name: "search".into()
            }]
        );
        let frag: Value = serde_json::from_str(
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\""}}"#,
        )
        .unwrap();
        assert_eq!(
            extract_deltas(p, &frag),
            vec![Delta::ToolCallArgs {
                index: 1,
                args: "{\"query\"".into()
            }]
        );
        // 文本块的 start 不产工具增量
        let text_start: Value = serde_json::from_str(
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
        )
        .unwrap();
        assert!(extract_deltas(p, &text_start).is_empty());
    }

    // ===== tool-calling:累加器拼装 =====

    #[test]
    fn step_accum_assembles_fragments() {
        let mut acc = StepAccum::default();
        assert_eq!(acc.push(Delta::Text("查证".into())), Some("查证".into()));
        acc.push(Delta::ToolCallStart {
            index: 0,
            id: "c1".into(),
            name: "search".into(),
        });
        acc.push(Delta::ToolCallArgs {
            index: 0,
            args: "{\"query\":\"No".into(),
        });
        acc.push(Delta::ToolCallArgs {
            index: 0,
            args: " Priors\"}".into(),
        });
        // 第二个调用乱序到达也按 index 归位
        acc.push(Delta::ToolCallStart {
            index: 1,
            id: "c2".into(),
            name: "search".into(),
        });
        acc.push(Delta::ToolCallArgs {
            index: 1,
            args: "{}".into(),
        });
        let out = acc.finish().unwrap();
        assert_eq!(out.text, "查证");
        assert_eq!(out.tool_calls.len(), 2);
        assert_eq!(out.tool_calls[0].id, "c1");
        assert_eq!(out.tool_calls[0].arguments, "{\"query\":\"No Priors\"}");
        assert_eq!(out.tool_calls[1].id, "c2");
    }

    #[test]
    fn step_accum_done_overwrites_and_drops_nameless() {
        let mut acc = StepAccum::default();
        acc.push(Delta::ToolCallStart {
            index: 0,
            id: "c1".into(),
            name: "search".into(),
        });
        acc.push(Delta::ToolCallArgs {
            index: 0,
            args: "{\"partial".into(),
        });
        // done 权威覆盖分片
        acc.push(Delta::ToolCallDone {
            index: 0,
            id: "c1".into(),
            name: "search".into(),
            args: "{\"query\":\"ok\"}".into(),
        });
        // 无名残片(只有 args 没等到 Start)丢弃
        acc.push(Delta::ToolCallArgs {
            index: 9,
            args: "{}".into(),
        });
        let out = acc.finish().unwrap();
        assert_eq!(out.tool_calls.len(), 1);
        assert_eq!(out.tool_calls[0].arguments, "{\"query\":\"ok\"}");
    }

    #[test]
    fn step_accum_err_wins_and_empty_fails() {
        let mut acc = StepAccum::default();
        acc.push(Delta::Text("部分输出".into()));
        acc.push(Delta::Err("配额不足".into()));
        assert!(acc.finish().unwrap_err().to_string().contains("配额不足"));
        assert!(StepAccum::default().finish().is_err()); // 全空 = 无返回
    }

    // ===== tool-calling:三协议请求体(完整工具轮往返) =====

    fn tool_round_msgs() -> (Vec<AgentMsg>, Vec<ToolDef>) {
        let msgs = vec![
            agent_user("核查这些块"),
            AgentMsg::Assistant {
                text: "我先搜索".into(),
                tool_calls: vec![ToolCall {
                    id: "c1".into(),
                    name: "search".into(),
                    arguments: "{\"query\":\"No Priors\"}".into(),
                }],
            },
            AgentMsg::ToolResults(vec![ToolResult {
                call_id: "c1".into(),
                content: "命中若干".into(),
            }]),
        ];
        let tools = vec![ToolDef {
            name: "search".into(),
            description: "网络搜索".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"],
            }),
        }];
        (msgs, tools)
    }

    #[test]
    fn builds_completions_tool_round() {
        let (msgs, tools) = tool_round_msgs();
        let b = request_body_tools(Protocol::OpenAiCompletions, "m1", "sys", &msgs, &tools);
        assert_eq!(b["tools"][0]["type"], "function");
        assert_eq!(b["tools"][0]["function"]["name"], "search");
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][2]["role"], "assistant");
        assert_eq!(b["messages"][2]["tool_calls"][0]["id"], "c1");
        assert_eq!(
            b["messages"][2]["tool_calls"][0]["function"]["arguments"],
            "{\"query\":\"No Priors\"}"
        );
        assert_eq!(b["messages"][3]["role"], "tool");
        assert_eq!(b["messages"][3]["tool_call_id"], "c1");
        // 纯工具轮 content 为 null
        let pure = vec![AgentMsg::Assistant {
            text: String::new(),
            tool_calls: vec![ToolCall {
                id: "c".into(),
                name: "search".into(),
                arguments: "{}".into(),
            }],
        }];
        let b2 = request_body_tools(Protocol::OpenAiCompletions, "m1", "sys", &pure, &tools);
        assert!(b2["messages"][1]["content"].is_null());
    }

    #[test]
    fn builds_responses_tool_round() {
        let (msgs, tools) = tool_round_msgs();
        let b = request_body_tools(Protocol::OpenAiResponses, "m1", "sys", &msgs, &tools);
        // Responses 工具定义是扁平结构
        assert_eq!(b["tools"][0]["name"], "search");
        assert!(b["tools"][0].get("function").is_none());
        // assistant 文本与函数调用拆成两个 input item
        assert_eq!(b["input"][1]["role"], "assistant");
        assert_eq!(b["input"][2]["type"], "function_call");
        assert_eq!(b["input"][2]["call_id"], "c1");
        assert_eq!(b["input"][3]["type"], "function_call_output");
        assert_eq!(b["input"][3]["output"], "命中若干");
    }

    #[test]
    fn builds_anthropic_tool_round() {
        let (msgs, tools) = tool_round_msgs();
        let b = request_body_tools(Protocol::AnthropicMessages, "m1", "sys", &msgs, &tools);
        assert_eq!(b["tools"][0]["input_schema"]["type"], "object");
        // assistant = text 块 + tool_use 块(input 已解析为对象)
        assert_eq!(b["messages"][1]["content"][0]["type"], "text");
        assert_eq!(b["messages"][1]["content"][1]["type"], "tool_use");
        assert_eq!(
            b["messages"][1]["content"][1]["input"]["query"],
            "No Priors"
        );
        // 工具结果放 user 消息的 tool_result 块
        assert_eq!(b["messages"][2]["role"], "user");
        assert_eq!(b["messages"][2]["content"][0]["type"], "tool_result");
        assert_eq!(b["messages"][2]["content"][0]["tool_use_id"], "c1");
    }

    #[test]
    fn tools_omitted_when_empty() {
        let msgs = vec![agent_user("你好")];
        for p in [
            Protocol::OpenAiResponses,
            Protocol::OpenAiCompletions,
            Protocol::AnthropicMessages,
        ] {
            let b = request_body_tools(p, "m1", "sys", &msgs, &[]);
            assert!(b.get("tools").is_none());
        }
    }
}
