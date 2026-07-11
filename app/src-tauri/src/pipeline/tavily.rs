// tavily — 网络搜索(划词纠正的证据来源)
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub content: String,
}

pub async fn search(client: &reqwest::Client, key: &str, query: &str) -> Result<Vec<SearchHit>> {
    if key.is_empty() {
        bail!("还没配置 Tavily API Key");
    }
    let res = client
        .post("https://api.tavily.com/search")
        .bearer_auth(key)
        .timeout(Duration::from_secs(20))
        .json(&json!({ "query": query, "max_results": 5 }))
        .send()
        .await
        .context("Tavily 请求失败")?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        bail!("Tavily 出错 ({status}): {body}");
    }
    let text_of = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    Ok(body
        .get("results")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|r| SearchHit {
                    title: text_of(r, "title"),
                    url: text_of(r, "url"),
                    content: text_of(r, "content"),
                })
                .collect()
        })
        .unwrap_or_default())
}
