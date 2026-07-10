// resolve — 小宇宙单集页面 → 音频地址 + 元信息(移植自 src/resolve.mjs)
// og:audio meta + __NEXT_DATA__ 双路兜底;页面没有官方 API,改版需跟着修
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeMeta {
    pub url: String,
    pub audio_url: String,
    pub title: String,
    pub podcast: String,
    pub shownotes: String,
    /// 秒;页面拿不到时为 None
    pub duration: Option<u64>,
    /// 发布日期(ISO 串),磁带编号用;页面拿不到时为 None
    #[serde(default)]
    pub pub_date: Option<String>,
}

pub async fn fetch_html(client: &reqwest::Client, url: &str) -> Result<String> {
    let res = client
        .get(url)
        .header("User-Agent", UA)
        .send()
        .await
        .context("页面请求失败")?;
    if !res.status().is_success() {
        bail!("页面请求失败: {}", res.status());
    }
    Ok(res.text().await?)
}

pub async fn resolve_episode(client: &reqwest::Client, url: &str) -> Result<EpisodeMeta> {
    let html = fetch_html(client, url).await?;
    parse_episode_html(url, &html)
}

/// 与网络分离,便于单测
pub fn parse_episode_html(url: &str, html: &str) -> Result<EpisodeMeta> {
    let re_og_audio =
        regex::Regex::new(r#"<meta[^>]+property="og:audio"[^>]+content="([^"]+)""#).unwrap();
    let re_og_title =
        regex::Regex::new(r#"<meta[^>]+property="og:title"[^>]+content="([^"]+)""#).unwrap();
    let re_next =
        regex::Regex::new(r#"(?s)<script id="__NEXT_DATA__"[^>]*>(.*?)</script>"#).unwrap();
    let re_media =
        regex::Regex::new(r#"https://media\.xyzcdn\.net/[^"'\s]+\.(?:m4a|mp3)"#).unwrap();

    // 路线 2 数据先解出来(标题/时长/shownotes 也从这里拿)
    let episode: Option<serde_json::Value> = re_next
        .captures(html)
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c.get(1).unwrap().as_str()).ok())
        .and_then(|next| {
            let props = next.pointer("/props/pageProps")?.clone();
            props
                .get("episode")
                .or_else(|| props.get("data"))
                .cloned()
        });

    // 音频地址:og:audio → __NEXT_DATA__ enclosure/media → 裸 CDN 链接兜底
    let audio_url = re_og_audio
        .captures(html)
        .map(|c| c[1].to_string())
        .or_else(|| {
            episode.as_ref().and_then(|e| {
                e.pointer("/enclosure/url")
                    .or_else(|| e.pointer("/media/source/url"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
        })
        .or_else(|| re_media.find(html).map(|m| m.as_str().to_string()));
    let Some(audio_url) = audio_url else {
        bail!("没解析出音频地址——小宇宙页面结构可能变了");
    };

    let title = episode
        .as_ref()
        .and_then(|e| e.get("title").and_then(|v| v.as_str()))
        .map(String::from)
        .or_else(|| re_og_title.captures(html).map(|c| c[1].to_string()))
        .unwrap_or_else(|| "untitled".into());

    let podcast = episode
        .as_ref()
        .and_then(|e| e.pointer("/podcast/title").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    let shownotes = episode
        .as_ref()
        .and_then(|e| {
            e.get("shownotes")
                .or_else(|| e.get("description"))
                .and_then(|v| v.as_str())
        })
        .map(strip_html)
        .unwrap_or_default();

    let duration = episode
        .as_ref()
        .and_then(|e| e.get("duration").and_then(|v| v.as_u64()));

    let pub_date = episode
        .as_ref()
        .and_then(|e| e.get("pubDate").and_then(|v| v.as_str()))
        .map(String::from);

    Ok(EpisodeMeta {
        url: url.to_string(),
        audio_url,
        title,
        podcast,
        shownotes,
        duration,
        pub_date,
    })
}

// ===== 节目页(订阅轮询用):/podcast/<pid> 的 __NEXT_DATA__ 自带最新单集列表 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedEpisode {
    pub eid: String,
    pub title: String,
    /// ISO 串,来自 pubDate
    pub pub_date: String,
    pub duration: Option<u64>,
    /// 付费/私有单集拿不到音频,轮询时跳过
    pub playable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastFeed {
    pub pid: String,
    pub title: String,
    pub episodes: Vec<FeedEpisode>,
}

fn next_data(html: &str) -> Option<serde_json::Value> {
    let re_next =
        regex::Regex::new(r#"(?s)<script id="__NEXT_DATA__"[^>]*>(.*?)</script>"#).unwrap();
    re_next
        .captures(html)
        .and_then(|c| serde_json::from_str(c.get(1).unwrap().as_str()).ok())
}

pub async fn resolve_podcast(client: &reqwest::Client, pid: &str) -> Result<PodcastFeed> {
    let url = format!("https://www.xiaoyuzhoufm.com/podcast/{pid}");
    let html = fetch_html(client, &url).await?;
    parse_podcast_html(pid, &html)
}

/// 与网络分离,便于单测
pub fn parse_podcast_html(pid: &str, html: &str) -> Result<PodcastFeed> {
    let podcast = next_data(html)
        .and_then(|d| d.pointer("/props/pageProps/podcast").cloned())
        .context("没解析出节目信息——小宇宙页面结构可能变了")?;
    let title = podcast
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let episodes = podcast
        .get("episodes")
        .and_then(|v| v.as_array())
        .context("没解析出单集列表——小宇宙页面结构可能变了")?
        .iter()
        .filter_map(|e| {
            Some(FeedEpisode {
                eid: e.get("eid")?.as_str()?.to_string(),
                title: e.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                pub_date: e.get("pubDate").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                duration: e.get("duration").and_then(|v| v.as_u64()),
                playable: e
                    .pointer("/enclosure/url")
                    .or_else(|| e.pointer("/media/source/url"))
                    .and_then(|v| v.as_str())
                    .is_some(),
            })
        })
        .collect();
    Ok(PodcastFeed { pid: pid.to_string(), title, episodes })
}

/// 节目页 URL → pid
pub fn podcast_pid_from_url(url: &str) -> Option<String> {
    let path = url.split('?').next()?;
    let seg = path.trim_end_matches('/').rsplit('/').next()?;
    (path.contains("/podcast/") && seg.len() >= 8 && seg.chars().all(|c| c.is_ascii_alphanumeric()))
        .then(|| seg.to_string())
}

/// 单集页 HTML → 所属节目 pid(贴单集链接添加订阅用)
pub fn podcast_pid_in_episode_html(html: &str) -> Option<String> {
    let d = next_data(html)?;
    let props = d.pointer("/props/pageProps")?;
    props
        .pointer("/episode/podcast/pid")
        .or_else(|| props.pointer("/data/podcast/pid"))?
        .as_str()
        .map(String::from)
}

fn strip_html(s: &str) -> String {
    let no_tags = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(s, "\n");
    regex::Regex::new(r"\n{3,}")
        .unwrap()
        .replace_all(&no_tags, "\n\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_og_audio_and_title() {
        let html = r#"<html><head>
          <meta property="og:audio" content="https://media.xyzcdn.net/abc/x.m4a" />
          <meta property="og:title" content="测试单集" />
        </head></html>"#;
        let m = parse_episode_html("https://x/e/1", html).unwrap();
        assert_eq!(m.audio_url, "https://media.xyzcdn.net/abc/x.m4a");
        assert_eq!(m.title, "测试单集");
    }

    #[test]
    fn parses_next_data_fallback() {
        let html = r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"episode":{"title":"ND单集","duration":4432,"podcast":{"title":"某节目"},"shownotes":"<p>a</p><p>b</p>","enclosure":{"url":"https://media.xyzcdn.net/y.mp3"}}}}}</script>"#;
        let m = parse_episode_html("https://x/e/2", html).unwrap();
        assert_eq!(m.audio_url, "https://media.xyzcdn.net/y.mp3");
        assert_eq!(m.title, "ND单集");
        assert_eq!(m.podcast, "某节目");
        assert_eq!(m.duration, Some(4432));
        assert_eq!(m.shownotes, "a\n\nb");
    }

    #[test]
    fn fails_without_audio() {
        assert!(parse_episode_html("https://x/e/3", "<html></html>").is_err());
    }

    #[test]
    fn parses_podcast_feed() {
        let html = r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"podcast":{"pid":"p1","title":"某节目","episodes":[
          {"eid":"e1","title":"新集","pubDate":"2026-07-09T10:00:00.000Z","duration":3600,"enclosure":{"url":"https://media.xyzcdn.net/a.m4a"}},
          {"eid":"e2","title":"付费集","pubDate":"2026-07-08T10:00:00.000Z","duration":100}
        ]}}}}</script>"#;
        let feed = parse_podcast_html("p1", html).unwrap();
        assert_eq!(feed.title, "某节目");
        assert_eq!(feed.episodes.len(), 2);
        assert!(feed.episodes[0].playable);
        assert!(!feed.episodes[1].playable);
        assert_eq!(feed.episodes[0].pub_date, "2026-07-09T10:00:00.000Z");
    }

    #[test]
    fn extracts_podcast_pid() {
        assert_eq!(
            podcast_pid_from_url("https://www.xiaoyuzhoufm.com/podcast/640ee2438be5d40013fe4a87"),
            Some("640ee2438be5d40013fe4a87".into())
        );
        assert_eq!(
            podcast_pid_from_url("https://www.xiaoyuzhoufm.com/episode/69e669001e94ae6921be04dc"),
            None
        );
        let html = r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"episode":{"podcast":{"pid":"640ee2438be5d40013fe4a87"}}}}}</script>"#;
        assert_eq!(
            podcast_pid_in_episode_html(html),
            Some("640ee2438be5d40013fe4a87".into())
        );
    }
}
