// library — 剧集登记表 + 文件布局(app_data_dir)
// episodes.json 登记表 / asr/<id>.json 转写缓存 / notes/<id>.{json,md} 双产物 / audio/<id>.m4a
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeRecord {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub show: String,
    #[serde(default)]
    pub title: String,
    /// MM-DD,磁带编号(发布日期)
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub duration_sec: u64,
    /// queued | resolving | transcribing | summarizing | ready | error
    pub status: String,
    #[serde(default)]
    pub err_stage: Option<String>,
    #[serde(default)]
    pub err_message: Option<String>,
    /// 消费状态(与管线状态正交):归档时刻的 epoch 秒;None = 未读
    #[serde(default)]
    pub read_at: Option<u64>,
}

pub struct Library {
    pub root: PathBuf,
}

impl Library {
    pub fn new(root: PathBuf) -> Result<Self> {
        for sub in ["asr", "notes", "audio"] {
            fs::create_dir_all(root.join(sub))?;
        }
        Ok(Self { root })
    }

    fn registry_path(&self) -> PathBuf {
        self.root.join("episodes.json")
    }
    pub fn asr_path(&self, id: &str) -> PathBuf {
        self.root.join("asr").join(format!("{id}.json"))
    }
    pub fn note_json_path(&self, id: &str) -> PathBuf {
        self.root.join("notes").join(format!("{id}.json"))
    }
    pub fn note_md_path(&self, id: &str) -> PathBuf {
        self.root.join("notes").join(format!("{id}.md"))
    }
    /// 音频文件保留原始扩展名(m4a/mp3),按 id 前缀查找
    pub fn audio_file(&self, id: &str, ext: &str) -> PathBuf {
        self.root.join("audio").join(format!("{id}.{ext}"))
    }
    pub fn find_audio(&self, id: &str) -> Option<PathBuf> {
        let dir = self.root.join("audio");
        let prefix = format!("{id}.");
        fs::read_dir(dir).ok()?.flatten().find_map(|e| {
            let p = e.path();
            p.file_name()?.to_str()?.starts_with(&prefix).then_some(p)
        })
    }

    pub fn list(&self) -> Vec<EpisodeRecord> {
        fs::read_to_string(self.registry_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_all(&self, eps: &[EpisodeRecord]) -> Result<()> {
        fs::write(self.registry_path(), serde_json::to_string_pretty(eps)?)
            .context("写入登记表失败")
    }

    /// 新增置顶;已存在则原位更新
    pub fn upsert(&self, rec: EpisodeRecord) -> Result<()> {
        let mut eps = self.list();
        match eps.iter_mut().find(|e| e.id == rec.id) {
            Some(slot) => *slot = rec,
            None => eps.insert(0, rec),
        }
        self.save_all(&eps)
    }

    pub fn get(&self, id: &str) -> Option<EpisodeRecord> {
        self.list().into_iter().find(|e| e.id == id)
    }

    pub fn update<F: FnOnce(&mut EpisodeRecord)>(&self, id: &str, f: F) -> Result<Option<EpisodeRecord>> {
        let mut eps = self.list();
        let rec = match eps.iter_mut().find(|e| e.id == id) {
            Some(r) => { f(r); Some(r.clone()) }
            None => None,
        };
        self.save_all(&eps)?;
        Ok(rec)
    }

    /// 删除登记项与全部关联文件
    pub fn remove(&self, id: &str) -> Result<()> {
        let eps: Vec<_> = self.list().into_iter().filter(|e| e.id != id).collect();
        self.save_all(&eps)?;
        for p in [self.asr_path(id), self.note_json_path(id), self.note_md_path(id)] {
            let _ = fs::remove_file(p);
        }
        if let Some(p) = self.find_audio(id) {
            let _ = fs::remove_file(p);
        }
        let _ = fs::remove_file(self.root.join("meta").join(format!("{id}.json")));
        Ok(())
    }
}

/// 小宇宙 URL → 稳定 id(路径末段的 episode hex id)
pub fn episode_id(url: &str) -> Option<String> {
    let path = url.split('?').next()?;
    let seg = path.trim_end_matches('/').rsplit('/').next()?;
    (!seg.is_empty() && seg.len() >= 8 && seg.chars().all(|c| c.is_ascii_alphanumeric()))
        .then(|| seg.to_string())
}

/// ISO 日期串 → MM-DD
pub fn short_date(iso: &str) -> String {
    // "2026-07-08T..." → "07-08"
    iso.get(5..10).unwrap_or("").replace('T', "")
}

pub fn ensure_dir(p: &Path) -> Result<()> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_episode_id() {
        assert_eq!(
            episode_id("https://www.xiaoyuzhoufm.com/episode/69e669001e94ae6921be04dc"),
            Some("69e669001e94ae6921be04dc".into())
        );
        assert_eq!(
            episode_id("https://www.xiaoyuzhoufm.com/episode/6a50373aa75176d020dcbdb3?s=x"),
            Some("6a50373aa75176d020dcbdb3".into())
        );
        assert_eq!(episode_id("https://x.com/"), None);
    }

    #[test]
    fn short_date_from_iso() {
        assert_eq!(short_date("2026-07-08T10:00:00Z"), "07-08");
        assert_eq!(short_date(""), "");
    }

    #[test]
    fn registry_roundtrip() {
        let dir = std::env::temp_dir().join(format!("pn-test-{}", std::process::id()));
        let lib = Library::new(dir.clone()).unwrap();
        let rec = EpisodeRecord {
            id: "abc12345".into(), url: "https://x".into(),
            show: "S".into(), title: "T".into(), date: "07-10".into(),
            duration_sec: 100, status: "queued".into(),
            err_stage: None, err_message: None, read_at: None,
        };
        lib.upsert(rec.clone()).unwrap();
        assert_eq!(lib.list().len(), 1);
        lib.update("abc12345", |r| r.status = "ready".into()).unwrap();
        assert_eq!(lib.get("abc12345").unwrap().status, "ready");
        lib.remove("abc12345").unwrap();
        assert!(lib.list().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
