// asr — 百炼 fun-asr 异步转写,自带说话人分离(移植自 src/asr.mjs)
// 音频不落地:公网音频 URL 直传;dashscope 标准异步 API(专属 host)
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

pub const DEFAULT_HOST: &str = "https://llm-xy8sn8964kplkx1s.cn-beijing.maas.aliyuncs.com";
const POLL_INTERVAL: Duration = Duration::from_secs(15);

/// 阶段进度回调:(状态词, 附加信息)
pub type Progress<'a> = &'a (dyn Fn(&str, &str) + Send + Sync);

pub async fn transcribe(
    client: &reqwest::Client,
    host: &str,
    key: &str,
    audio_url: &str,
    progress: Progress<'_>,
) -> Result<Value> {
    if key.is_empty() {
        bail!("缺少百炼 API Key");
    }

    let submitted: Value = client
        .post(format!("{host}/api/v1/services/audio/asr/transcription"))
        .bearer_auth(key)
        .header("X-DashScope-Async", "enable")
        .json(&json!({
            "model": "fun-asr",
            "input": { "file_urls": [audio_url] },
            "parameters": { "diarization_enabled": true, "language_hints": ["zh"] },
        }))
        .send()
        .await
        .context("提交转写任务失败")?
        .error_for_status()
        .context("提交转写任务被拒")?
        .json()
        .await?;

    let task_id = submitted
        .pointer("/output/task_id")
        .and_then(|v| v.as_str())
        .with_context(|| format!("提交转写任务失败: {submitted}"))?
        .to_string();
    progress("SUBMITTED", &task_id);

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let data: Value = client
            .get(format!("{host}/api/v1/tasks/{task_id}"))
            .bearer_auth(key)
            .send()
            .await
            .context("查询转写任务失败")?
            .json()
            .await?;
        let status = data
            .pointer("/output/task_status")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN");
        progress(status, "");

        match status {
            "SUCCEEDED" => {
                let url = data
                    .pointer("/output/results/0/transcription_url")
                    .and_then(|v| v.as_str())
                    .with_context(|| format!("任务成功但没有结果地址: {data}"))?;
                let result: Value = client
                    .get(url)
                    .send()
                    .await
                    .context("下载转写结果失败")?
                    .json()
                    .await?;
                return Ok(result);
            }
            "FAILED" | "UNKNOWN" => {
                let msg = data
                    .pointer("/output/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知原因");
                bail!("转写任务失败: {msg}");
            }
            _ => {} // PENDING / RUNNING → 继续轮询
        }
    }
}

/// 转写结果 → 带时间戳和说话人标签的文本行(与 prompts/note.md 约定一致)
/// speaker_id 0/1/2 → S1/S2/S3
pub fn to_timed_text(result: &Value) -> String {
    let sents = result
        .pointer("/transcripts/0/sentences")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut lines = Vec::with_capacity(sents.len());
    for s in &sents {
        let begin_ms = s.get("begin_time").and_then(|v| v.as_u64()).unwrap_or(0);
        let t = begin_ms / 1000;
        let (h, m, sec) = (t / 3600, (t % 3600) / 60, t % 60);
        let ts = if h > 0 {
            format!("{h}:{m:02}:{sec:02}")
        } else {
            format!("{m:02}:{sec:02}")
        };
        let spk = s
            .get("speaker_id")
            .and_then(|v| v.as_u64())
            .map(|id| format!("S{}", id + 1))
            .unwrap_or_else(|| "S?".into());
        let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
        lines.push(format!("[{ts}] {spk}: {text}"));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timed_text_formats_speakers_and_ts() {
        let result = serde_json::json!({
            "transcripts": [{ "sentences": [
                { "begin_time": 4520, "end_time": 8120, "text": " 大家好。", "speaker_id": 0 },
                { "begin_time": 3_723_000, "end_time": 3_725_000, "text": "结尾", "speaker_id": 2 },
            ]}]
        });
        let text = to_timed_text(&result);
        assert_eq!(text, "[00:04] S1: 大家好。\n[1:02:03] S3: 结尾");
    }
}
