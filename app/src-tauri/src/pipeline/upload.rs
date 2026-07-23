// upload — DashScope 临时文件上传(getPolicy → OSS 表单直传),本地会议录音喂 fun-asr 用
// 文件只进用户自己的百炼账号临时空间,48 小时自动删除;返回 oss:// 地址,
// 转写请求须带 X-DashScope-OssResourceResolve: enable(asr.rs 按 oss:// 前缀自动加)
// 实测(2026-07):policy 有效期 300 秒,拿到即传;单文件上限以 policy 的 max_file_size_mb 为准(当前 1024MB)
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::path::Path;

pub async fn upload_for_transcribe(
    client: &reqwest::Client,
    host: &str,
    key: &str,
    file: &Path,
) -> Result<String> {
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .context("音频路径不完整")?;
    let size = tokio::fs::metadata(file)
        .await
        .with_context(|| format!("读取音频文件失败: {}", file.display()))?
        .len();

    let policy: Value = client
        .get(format!("{host}/api/v1/uploads"))
        .query(&[("action", "getPolicy"), ("model", "fun-asr")])
        .bearer_auth(key)
        .send()
        .await
        .context("获取上传凭证失败")?
        .error_for_status()
        .context("获取上传凭证被拒")?
        .json()
        .await?;
    let data = policy
        .get("data")
        .with_context(|| format!("上传凭证格式不对: {policy}"))?;
    let field = |k: &str| -> Result<String> {
        data.get(k)
            .and_then(|v| v.as_str())
            .map(String::from)
            .with_context(|| format!("上传凭证缺少 {k}"))
    };
    // 官方文档里 max_file_size_mb 是字符串,兼容数值以防接口变化;缺失或非法就交给 OSS 兜底
    let max_mb = data.get("max_file_size_mb").and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
    });
    if let Some(max_mb) = max_mb {
        if size > max_mb.saturating_mul(1024 * 1024) {
            bail!("音频超过百炼临时上传上限({max_mb}MB),请压缩后再试");
        }
    }

    // 流式上传:录音可达 GB 级,不整读进内存;带 length 让 reqwest 算出 Content-Length
    // (OSS 表单上传不接受 chunked 编码)
    let body = reqwest::Body::from(
        tokio::fs::File::open(file)
            .await
            .with_context(|| format!("读取音频文件失败: {}", file.display()))?,
    );
    let object_key = format!("{}/{name}", field("upload_dir")?);
    let form = reqwest::multipart::Form::new()
        .text("OSSAccessKeyId", field("oss_access_key_id")?)
        .text("Signature", field("signature")?)
        .text("policy", field("policy")?)
        .text("x-oss-object-acl", field("x_oss_object_acl")?)
        .text("x-oss-forbid-overwrite", field("x_oss_forbid_overwrite")?)
        .text("key", object_key.clone())
        .text("success_action_status", "200")
        .part(
            "file",
            reqwest::multipart::Part::stream_with_length(body, size).file_name(name),
        );
    let res = client
        .post(field("upload_host")?)
        .multipart(form)
        .send()
        .await
        .context("上传音频失败")?;
    if !res.status().is_success() {
        bail!("上传音频被拒: {}", res.status());
    }
    Ok(format!("oss://{object_key}"))
}
