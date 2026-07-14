// subscriptions — 订阅登记表(subscriptions.json)+ 新单集甄别
// 基线策略:订阅时记下当时最新一集的 pubDate,只处理更晚的——不回灌旧集
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::pipeline::resolve::FeedEpisode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub pid: String,
    pub title: String,
    /// 已见基线(ISO 串):只处理 pubDate 晚于此的单集
    #[serde(default)]
    pub last_pub: String,
}

pub struct SubStore {
    pub root: PathBuf,
}

impl SubStore {
    fn path(&self) -> PathBuf {
        self.root.join("subscriptions.json")
    }

    pub fn list(&self) -> Vec<Subscription> {
        fs::read_to_string(self.path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_all(&self, subs: &[Subscription]) -> Result<()> {
        fs::write(self.path(), serde_json::to_string_pretty(subs)?).context("写入订阅登记表失败")
    }

    /// 新增追加到末尾;已存在则原位更新
    pub fn upsert(&self, sub: Subscription) -> Result<()> {
        let mut subs = self.list();
        match subs.iter_mut().find(|s| s.pid == sub.pid) {
            Some(slot) => *slot = sub,
            None => subs.push(sub),
        }
        self.save_all(&subs)
    }

    pub fn remove(&self, pid: &str) -> Result<()> {
        let subs: Vec<_> = self.list().into_iter().filter(|s| s.pid != pid).collect();
        self.save_all(&subs)
    }

    pub fn set_last_pub(&self, pid: &str, last_pub: &str) -> Result<()> {
        let mut subs = self.list();
        if let Some(s) = subs.iter_mut().find(|s| s.pid == pid) {
            s.last_pub = last_pub.into();
        }
        self.save_all(&subs)
    }
}

/// 甄别新单集:晚于基线、可播放、未在库中;按发布时间从旧到新返回
/// (ISO 串同格式,字典序即时间序)
pub fn pick_new(
    feed: &[FeedEpisode],
    last_pub: &str,
    in_library: impl Fn(&str) -> bool,
) -> Vec<FeedEpisode> {
    let mut fresh: Vec<_> = feed
        .iter()
        .filter(|e| e.pub_date.as_str() > last_pub)
        .filter(|e| e.playable)
        .filter(|e| !in_library(&e.eid))
        .cloned()
        .collect();
    fresh.sort_by(|a, b| a.pub_date.cmp(&b.pub_date));
    fresh
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(eid: &str, pub_date: &str, playable: bool) -> FeedEpisode {
        FeedEpisode {
            eid: eid.into(),
            title: format!("T-{eid}"),
            pub_date: pub_date.into(),
            duration: Some(100),
            playable,
        }
    }

    #[test]
    fn picks_only_fresh_playable_unknown() {
        let feed = vec![
            ep("new2", "2026-07-09T10:00:00.000Z", true),
            ep("new1", "2026-07-08T10:00:00.000Z", true),
            ep("paid", "2026-07-07T10:00:00.000Z", false),
            ep("seen", "2026-07-06T10:00:00.000Z", true),
            ep("old", "2026-06-01T10:00:00.000Z", true),
        ];
        let got = pick_new(&feed, "2026-06-30T00:00:00.000Z", |eid| eid == "seen");
        let ids: Vec<_> = got.iter().map(|e| e.eid.as_str()).collect();
        // 付费集与已入库的被跳过,剩余按从旧到新排
        assert_eq!(ids, vec!["new1", "new2"]);
    }

    #[test]
    fn store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("pn-subs-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = SubStore { root: dir.clone() };
        store
            .upsert(Subscription {
                pid: "p1".into(),
                title: "节目".into(),
                last_pub: "".into(),
            })
            .unwrap();
        assert_eq!(store.list().len(), 1);
        store
            .set_last_pub("p1", "2026-07-09T10:00:00.000Z")
            .unwrap();
        assert_eq!(store.list()[0].last_pub, "2026-07-09T10:00:00.000Z");
        store.remove("p1").unwrap();
        assert!(store.list().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
