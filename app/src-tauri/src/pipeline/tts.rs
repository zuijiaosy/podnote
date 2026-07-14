// tts — qwen3-tts-flash 分段合成(朗读笔记用)
// 单次请求上限 512 token,长段按句切;非流式返回音频 URL。
// 一段一个 WAV 文件渐进落盘:首段合成完即可开播,前端按段号跟随高亮
use anyhow::{bail, Context, Result};

pub const TTS_URL: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
pub const TTS_MODEL: &str = "qwen3-tts-flash";
pub const DEFAULT_VOICE: &str = "Cherry";
/// 单次请求文本上限(字符,留足 512 token 余量)
const MAX_CHARS: usize = 380;

/// 笔记 JSON → 朗读文本段(与 Reader 渲染顺序一致;资源/问题不朗读)
/// key 与阅读井渲染块对应:tldr | point-<i> | quote-<i>
pub fn note_segments(note: &serde_json::Value) -> Vec<(String, String)> {
    let mut segs = Vec::new();
    if let Some(t) = note.get("tldr").and_then(|v| v.as_str()) {
        if !t.trim().is_empty() {
            segs.push(("tldr".to_string(), t.trim().to_string()));
        }
    }
    if let Some(points) = note.get("points").and_then(|v| v.as_array()) {
        for (i, p) in points.iter().enumerate() {
            let h = p.get("h").and_then(|v| v.as_str()).unwrap_or("").trim();
            let body = p.get("body").and_then(|v| v.as_str()).unwrap_or("").trim();
            let text = if h.is_empty() {
                body.to_string()
            } else if body.is_empty() {
                h.to_string()
            } else {
                format!("{h}。{body}")
            };
            if !text.is_empty() {
                segs.push((format!("point-{i}"), text));
            }
        }
    }
    if let Some(quotes) = note.get("quotes").and_then(|v| v.as_array()) {
        for (i, q) in quotes.iter().enumerate() {
            let text = q.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
            if !text.is_empty() {
                segs.push((format!("quote-{i}"), text.to_string()));
            }
        }
    }
    segs
}

/// 超长段按句号/问号/叹号切成 ≤ MAX_CHARS 的块(按字符数,不切断 UTF-8)
pub fn split_text(text: &str) -> Vec<String> {
    if text.chars().count() <= MAX_CHARS {
        return vec![text.to_string()];
    }
    let mut chunks = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0usize;
    for sent in text.split_inclusive(['。', '！', '？', '!', '?', '\n', ';', ';']) {
        let n = sent.chars().count();
        if cur_len + n > MAX_CHARS && !cur.is_empty() {
            chunks.push(std::mem::take(&mut cur));
            cur_len = 0;
        }
        // 单句仍超限时硬切
        if n > MAX_CHARS {
            let cs: Vec<char> = sent.chars().collect();
            for piece in cs.chunks(MAX_CHARS) {
                chunks.push(piece.iter().collect());
            }
        } else {
            cur.push_str(sent);
            cur_len += n;
        }
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

/// 单块合成:非流式调用,优先取音频 URL 下载,兜底 base64
pub async fn synth(
    client: &reqwest::Client,
    api_key: &str,
    voice: &str,
    text: &str,
) -> Result<Vec<u8>> {
    let body = serde_json::json!({
        "model": TTS_MODEL,
        "input": { "text": text, "voice": voice },
    });
    let res = client
        .post(TTS_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .context("TTS 请求失败")?;
    let status = res.status();
    let v: serde_json::Value = res.json().await.context("TTS 响应解析失败")?;
    if !status.is_success() {
        bail!(
            "TTS 请求被拒 {status}: {}",
            v.get("message").and_then(|m| m.as_str()).unwrap_or("")
        );
    }
    if let Some(url) = v.pointer("/output/audio/url").and_then(|x| x.as_str()) {
        let audio = client
            .get(url)
            .send()
            .await
            .context("TTS 音频下载失败")?
            .error_for_status()
            .context("TTS 音频下载被拒")?
            .bytes()
            .await?;
        return Ok(audio.to_vec());
    }
    if let Some(b64) = v.pointer("/output/audio/data").and_then(|x| x.as_str()) {
        return decode_base64(b64).context("TTS base64 音频解码失败");
    }
    bail!("TTS 响应里没有音频地址——qwen-tts 响应结构可能变了");
}

/// 标准库无 base64,自带一个够用的解码器(只处理标准字母表,忽略空白与填充)
fn decode_base64(s: &str) -> Result<Vec<u8>> {
    fn val(c: u8) -> Result<u32> {
        Ok(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => bail!("非法 base64 字符"),
        })
    }
    let bytes: Vec<u8> = s
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut acc: u32 = 0;
        for (i, &b) in chunk.iter().enumerate() {
            acc |= val(b)? << (18 - 6 * i);
        }
        let n = chunk.len();
        if n >= 2 {
            out.push((acc >> 16) as u8);
        }
        if n >= 3 {
            out.push((acc >> 8) as u8);
        }
        if n == 4 {
            out.push(acc as u8);
        }
    }
    Ok(out)
}

// ===== WAV 解析与拼接 =====

pub struct WavPcm {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits: u16,
    pub data: Vec<u8>,
}

impl WavPcm {
    pub fn duration_secs(&self) -> f64 {
        let bytes_per_sec =
            self.sample_rate as f64 * self.channels as f64 * (self.bits as f64 / 8.0);
        if bytes_per_sec == 0.0 {
            0.0
        } else {
            self.data.len() as f64 / bytes_per_sec
        }
    }
}

/// RIFF 块遍历,取 fmt + data(容忍 LIST 等附加块)
pub fn parse_wav(bytes: &[u8]) -> Result<WavPcm> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("不是 WAV 文件");
    }
    let mut pos = 12usize;
    let mut fmt: Option<(u32, u16, u16)> = None;
    let mut data: Option<Vec<u8>> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body_end = (pos + 8 + size).min(bytes.len());
        if id == b"fmt " && size >= 16 {
            let b = &bytes[pos + 8..body_end];
            let channels = u16::from_le_bytes(b[2..4].try_into().unwrap());
            let sample_rate = u32::from_le_bytes(b[4..8].try_into().unwrap());
            let bits = u16::from_le_bytes(b[14..16].try_into().unwrap());
            fmt = Some((sample_rate, channels, bits));
        } else if id == b"data" {
            data = Some(bytes[pos + 8..body_end].to_vec());
        }
        pos += 8 + size + (size & 1); // 块按 2 字节对齐
    }
    let (sample_rate, channels, bits) = fmt.context("WAV 里没有 fmt 块")?;
    Ok(WavPcm {
        sample_rate,
        channels,
        bits,
        data: data.context("WAV 里没有 data 块")?,
    })
}

/// 同格式 PCM 拼接为单个 WAV 文件字节
pub fn write_wav(sample_rate: u32, channels: u16, bits: u16, pcm: &[u8]) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * bits as u32 / 8;
    let block_align = channels * bits / 8;
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_follow_reader_order() {
        let note = serde_json::json!({
            "tldr": "一句话。",
            "points": [
                {"h": "标题A", "body": "正文A"},
                {"h": "", "body": "只有正文"},
                {"h": "只有标题", "body": ""}
            ],
            "quotes": [{"text": "金句一"}, {"text": ""}],
            "resources": [{"name": "不读"}],
            "questions": ["不读"]
        });
        let segs = note_segments(&note);
        let keys: Vec<_> = segs.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            keys,
            vec!["tldr", "point-0", "point-1", "point-2", "quote-0"]
        );
        assert_eq!(segs[1].1, "标题A。正文A");
        assert_eq!(segs[3].1, "只有标题");
    }

    #[test]
    fn splits_long_text_at_sentences() {
        let sent = "这是一句不短的话,用来填充长度测试的内容。";
        let long: String = sent.repeat(40); // 远超 MAX_CHARS
        let chunks = split_text(&long);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.chars().count() <= 380));
        assert_eq!(chunks.concat(), long); // 无丢字
        let short = "短句。";
        assert_eq!(split_text(short), vec![short.to_string()]);
    }

    #[test]
    fn wav_roundtrip_and_concat() {
        let pcm1: Vec<u8> = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let pcm2: Vec<u8> = vec![9, 10, 11, 12];
        let w1 = write_wav(24000, 1, 16, &pcm1);
        let w2 = write_wav(24000, 1, 16, &pcm2);
        let p1 = parse_wav(&w1).unwrap();
        let p2 = parse_wav(&w2).unwrap();
        assert_eq!(p1.sample_rate, 24000);
        assert_eq!(p1.data, pcm1);
        let mut all = p1.data.clone();
        all.extend_from_slice(&p2.data);
        let merged = parse_wav(&write_wav(24000, 1, 16, &all)).unwrap();
        assert_eq!(merged.data.len(), 12);
        // 时长:12 字节 / (24000*1*2) 秒
        assert!((merged.duration_secs() - 12.0 / 48000.0).abs() < 1e-9);
    }

    #[test]
    fn base64_decodes() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("UklGRg==").unwrap(), b"RIFF");
        assert!(decode_base64("!!").is_err());
    }
}
