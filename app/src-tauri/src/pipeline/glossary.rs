// glossary — 纠正词表:划词纠正的沉淀,按频道(show)复用
// 回流两处:笔记 prompt 注入({{glossary}})+ 转写热词(vocab::build_terms)
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntry {
    pub show: String,
    pub original: String,
    pub corrected: String,
    #[serde(default)]
    pub evidence_url: Option<String>,
    /// confirmed | speculative
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub ts: u64,
}

fn path(root: &Path) -> std::path::PathBuf {
    root.join("glossary.json")
}

pub fn load(root: &Path) -> Vec<GlossaryEntry> {
    fs::read_to_string(path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 追加一条;同 show+original 已存在则原位覆盖(以最新纠正为准)
pub fn append(root: &Path, entry: GlossaryEntry) -> Result<()> {
    let mut entries = load(root);
    match entries
        .iter_mut()
        .find(|e| e.show == entry.show && e.original == entry.original)
    {
        Some(slot) => *slot = entry,
        None => entries.push(entry),
    }
    fs::write(path(root), serde_json::to_string_pretty(&entries)?)?;
    Ok(())
}

pub fn for_show<'a>(entries: &'a [GlossaryEntry], show: &str) -> Vec<&'a GlossaryEntry> {
    entries.iter().filter(|e| e.show == show).collect()
}

/// prompt 注入格式:每行「错词 → 正词」
pub fn render_for_prompt(entries: &[&GlossaryEntry]) -> String {
    entries
        .iter()
        .map(|e| format!("{} → {}", e.original, e.corrected))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(show: &str, original: &str, corrected: &str) -> GlossaryEntry {
        GlossaryEntry {
            show: show.into(),
            original: original.into(),
            corrected: corrected.into(),
            evidence_url: None,
            confidence: "confirmed".into(),
            ts: 0,
        }
    }

    #[test]
    fn roundtrip_and_dedupe() {
        let dir = std::env::temp_dir().join(format!("pn-glossary-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        append(&dir, entry("老钱日日谈", "面筋", "面基")).unwrap();
        append(&dir, entry("No Priors", "No Players", "No Priors")).unwrap();
        // 同 show+original 覆盖,不新增
        append(&dir, entry("老钱日日谈", "面筋", "面基面基")).unwrap();
        let all = load(&dir);
        assert_eq!(all.len(), 2);
        let mine = for_show(&all, "老钱日日谈");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].corrected, "面基面基");
        assert_eq!(render_for_prompt(&mine), "面筋 → 面基面基");
        let _ = fs::remove_dir_all(dir);
    }
}
