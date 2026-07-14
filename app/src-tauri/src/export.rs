// export — 笔记库外部导出(Obsidian 友好):manifest 记账,新建自动写、更新受保护
// 铁律:检测到用户改过导出文件,永不覆盖——写 .podnote-new.md 冲突副本并通知;
// 用户删掉的文件不擅自重建。manifest 与导出文件都走临时文件 + rename 原子落盘。
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::library::Library;
use crate::pipeline::note::{self, Note};
use crate::pipeline::resolve::EpisodeMeta;

/// fnv1a-64:跨进程稳定的内容指纹(变更检测,非安全场景;std 的 DefaultHasher 每进程随机化,不能用)
pub fn fnv1a(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    path: String,
    /// 上次由 Podnote 写入的内容指纹;磁盘不等于它 = 用户改过
    hash: String,
}

/// 导出动作的结果,调用方据此决定是否通知用户
#[derive(Debug)]
pub enum Outcome {
    /// 正常写入/迁移(含首次认领同内容文件)
    Written(PathBuf),
    /// 目标被用户改过:新版写在这个冲突副本里,原文件未动
    Conflict(PathBuf),
    /// manifest 记录的文件不见了(多半是用户删的):未重建
    MissingOriginal(PathBuf),
}

fn manifest_path(lib: &Library) -> PathBuf {
    lib.root.join("export-manifest.json")
}

fn load_manifest(lib: &Library) -> HashMap<String, Entry> {
    fs::read_to_string(manifest_path(lib))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 临时文件 + rename:断电/磁盘满不留半截产物(qa 日志等其他落盘也复用)
/// Windows 下 rename 到已存在目标同样是替换语义;若目标被杀毒/索引器锁住会失败,
/// 此时清掉临时文件、把目标路径带进错误信息(显式失败优于伪稳定重试)
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("非法导出路径: {}", path.display()))?;
    let tmp = path.with_file_name(format!("{file_name}.podnote-tmp"));
    fs::write(&tmp, content).map_err(|e| format!("写入 {} 失败: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("落盘 {} 失败: {e}", path.display())
    })
}

fn save_manifest(lib: &Library, m: &HashMap<String, Entry>) -> Result<(), String> {
    write_atomic(
        &manifest_path(lib),
        &serde_json::to_string_pretty(m).map_err(|e| e.to_string())?,
    )
}

/// Windows 保留设备名(按第一个 '.' 前的 stem、大小写不敏感判定,CON.txt 同样非法);
/// 微软还把上标 ¹²³ 变体列为保留,一并处理
fn is_reserved_stem(stem: &str) -> bool {
    let up = stem.to_ascii_uppercase();
    matches!(up.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((up.starts_with("COM") || up.starts_with("LPT"))
            && up.chars().count() == 4
            && matches!(up.chars().nth(3), Some('1'..='9') | Some('¹') | Some('²') | Some('³')))
}

/// 文件名部件净化:去控制字符与跨平台非法字符,去首部点(隐藏文件/..),限长,
/// 截断后再去尾部点/空格(Windows 非法),保留设备名加 '_' 前缀,空回落
pub fn sanitize_component(name: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let joined = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = joined.trim_start_matches('.').trim();
    let cut: String = trimmed.chars().take(60).collect();
    // 截断可能恰好把 '.' 或空格留在末尾,必须在截断之后再清一次
    let out = cut.trim_end_matches(['.', ' ']).trim().to_string();
    if out.is_empty() {
        return "untitled".into();
    }
    let stem = out.split('.').next().unwrap_or(&out);
    if is_reserved_stem(stem) { format!("_{out}") } else { out }
}

/// YAML 双引号字符串(frontmatter 用):标题里的冒号/引号/换行不许破坏结构
fn yaml_str(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ").replace('\r', " ")
    )
}

fn frontmatter(meta: &EpisodeMeta) -> String {
    let mut l = vec!["---".to_string()];
    l.push(format!("title: {}", yaml_str(&meta.title)));
    l.push(format!("podcast: {}", yaml_str(&meta.podcast)));
    if let Some(d) = pub_date_ymd(meta) {
        l.push(format!("date: {d}"));
    }
    if !meta.url.is_empty() {
        l.push(format!("source: {}", yaml_str(&meta.url)));
    }
    if let Some(sec) = meta.duration {
        l.push(format!("duration: {sec}"));
    }
    l.push("---".into());
    l.push(String::new());
    l.join("\n")
}

/// 发布日期 → YYYY-MM-DD,逐位严格校验——它来自外部元数据且会进路径拼接,
/// 只查长度会放过 "../../xxxx" 这类恰好十字符的穿越载荷
fn pub_date_ymd(meta: &EpisodeMeta) -> Option<String> {
    let d: String = meta.pub_date.as_deref()?.chars().take(10).collect();
    let b = d.as_bytes();
    let ok = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        });
    ok.then_some(d)
}

/// 外部导出正文:frontmatter + Markdown(wikilinks 开启时资源名转 [[]])
pub fn render(meta: &EpisodeMeta, parsed: &Note, wikilinks: bool) -> String {
    format!("{}{}", frontmatter(meta), note::note_to_markdown_opts(meta, parsed, wikilinks))
}

/// 冲突副本路径:xxx.md → xxx.podnote-new.md
fn conflict_path(p: &Path) -> PathBuf {
    p.with_extension("podnote-new.md")
}

/// 写冲突副本:副本本身也可能被用户编辑过,同样不许覆盖——
/// 同内容直接复用;异内容换不重复的编号路径(.podnote-new-2.md …)
fn write_conflict(primary: &Path, content: &str) -> Result<PathBuf, String> {
    let new_hash = fnv1a(content.as_bytes());
    let mut cand = conflict_path(primary);
    for n in 2..=20usize {
        if !cand.exists() {
            write_atomic(&cand, content)?;
            return Ok(cand);
        }
        let disk = fs::read_to_string(&cand).unwrap_or_default();
        if fnv1a(disk.as_bytes()) == new_hash {
            return Ok(cand); // 同内容,复用现有副本
        }
        cand = primary.with_extension(format!("podnote-new-{n}.md"));
    }
    Err("冲突副本过多,请先清理导出目录里的 .podnote-new 文件".into())
}

fn write_and_record(
    manifest: &mut HashMap<String, Entry>,
    id: &str,
    path: &Path,
    content: &str,
    hash: String,
) -> Result<Outcome, String> {
    write_atomic(path, content)?;
    manifest.insert(id.to_string(), Entry { path: path.to_string_lossy().into_owned(), hash });
    Ok(Outcome::Written(path.to_path_buf()))
}

/// 导出状态机(与 Codex 对抗审查收敛的七态):
/// 无记录+目标不存在→新建;无记录+目标存在→同内容认领,异内容冲突副本;
/// 有记录+未被改→覆盖(路径变了先迁移);有记录+被改→冲突副本;
/// 有记录+文件消失→自动导出不重建只通知(可能是用户主动删的),
/// 显式导出(recreate_missing)则重建——用户亲手点了导出,意图明确。
pub fn export_note(
    lib: &Library,
    notes_dir: &str,
    id: &str,
    meta: &EpisodeMeta,
    content: &str,
    recreate_missing: bool,
) -> Result<Outcome, String> {
    let dir = Path::new(notes_dir).join(sanitize_component(&meta.podcast));
    let date = pub_date_ymd(meta).unwrap_or_else(|| "undated".into());
    let mut manifest = load_manifest(lib);

    let mut desired = dir.join(format!("{} {}.md", date, sanitize_component(&meta.title)));
    // 同名占用(别的单集已认领这个路径;macOS 大小写不敏感,按小写比):文件名追加 id 前缀
    let desired_key = desired.to_string_lossy().to_lowercase();
    if manifest.iter().any(|(k, e)| k != id && e.path.to_lowercase() == desired_key) {
        let idp: String = id.chars().take(8).collect();
        desired = dir.join(format!("{} {} [{}].md", date, sanitize_component(&meta.title), idp));
    }

    let new_hash = fnv1a(content.as_bytes());
    let outcome = match manifest.get(id).cloned() {
        None => {
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            if !desired.exists() {
                write_and_record(&mut manifest, id, &desired, content, new_hash)?
            } else {
                let disk = fs::read_to_string(&desired).unwrap_or_default();
                if fnv1a(disk.as_bytes()) == new_hash {
                    // 内容一模一样(如换机重装后重跑):直接认领,不动文件
                    manifest.insert(
                        id.to_string(),
                        Entry { path: desired.to_string_lossy().into_owned(), hash: new_hash },
                    );
                    Outcome::Written(desired)
                } else {
                    let cp = write_conflict(&desired, content)?;
                    Outcome::Conflict(cp)
                }
            }
        }
        Some(entry) => {
            let mut current = PathBuf::from(&entry.path);
            // 标题/节目/日期变了 → 路径迁移,但只在旧文件未被用户改过时才敢 rename
            if current != desired && current.exists() {
                let disk = fs::read_to_string(&current).unwrap_or_default();
                if fnv1a(disk.as_bytes()) == entry.hash {
                    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    if !desired.exists() && fs::rename(&current, &desired).is_ok() {
                        current = desired.clone();
                    }
                }
            }
            if !current.exists() {
                if recreate_missing {
                    // 重建也必须过"目标被占用"检查:desired 处可能有一份非 Podnote 管理的文件
                    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    if !desired.exists() {
                        write_and_record(&mut manifest, id, &desired, content, new_hash)?
                    } else {
                        let disk = fs::read_to_string(&desired).unwrap_or_default();
                        if fnv1a(disk.as_bytes()) == new_hash {
                            manifest.insert(
                                id.to_string(),
                                Entry { path: desired.to_string_lossy().into_owned(), hash: new_hash },
                            );
                            Outcome::Written(desired)
                        } else {
                            let cp = write_conflict(&desired, content)?;
                            Outcome::Conflict(cp)
                        }
                    }
                } else {
                    Outcome::MissingOriginal(current)
                }
            } else {
                let disk = fs::read_to_string(&current).unwrap_or_default();
                if fnv1a(disk.as_bytes()) == entry.hash {
                    write_and_record(&mut manifest, id, &current, content, new_hash)?
                } else {
                    let cp = write_conflict(&current, content)?;
                    Outcome::Conflict(cp)
                }
            }
        }
    };
    save_manifest(lib, &manifest)?;
    Ok(outcome)
}

/// 删除单集:外部文件是用户的,留下;只销 manifest 记录
pub fn forget(lib: &Library, id: &str) {
    let mut m = load_manifest(lib);
    if m.remove(id).is_some() {
        let _ = save_manifest(lib, &m);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(title: &str) -> EpisodeMeta {
        EpisodeMeta {
            url: "https://x.test/e/1".into(),
            audio_url: String::new(),
            title: title.into(),
            podcast: "测试节目".into(),
            shownotes: String::new(),
            duration: Some(3600),
            pub_date: Some("2026-07-14T10:00:00Z".into()),
        }
    }

    fn test_lib(tag: &str) -> Library {
        let root = std::env::temp_dir().join(format!("pn-export-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        Library::new(root).unwrap()
    }

    #[test]
    fn sanitize_strips_illegal_and_truncates() {
        assert_eq!(sanitize_component("a/b:c*d?e\"f<g>h|i"), "a b c d e f g h i");
        assert_eq!(sanitize_component("..hidden"), "hidden");
        assert_eq!(sanitize_component("  "), "untitled");
        assert_eq!(sanitize_component(&"长".repeat(100)).chars().count(), 60);
    }

    #[test]
    fn sanitize_windows_trailing_dots_and_reserved_names() {
        // 尾部点/空格在 Windows 非法,截断后也要再清一次
        assert_eq!(sanitize_component("foo."), "foo");
        assert_eq!(sanitize_component("Ep 5. 结尾是点. "), "Ep 5. 结尾是点");
        let mut long = "x".repeat(59);
        long.push('.');
        long.push_str("之后还有");
        assert_eq!(sanitize_component(&long), "x".repeat(59));
        // 保留设备名:按第一个 '.' 前的 stem、大小写不敏感,加 '_' 前缀
        assert_eq!(sanitize_component("CON"), "_CON");
        assert_eq!(sanitize_component("con.txt"), "_con.txt");
        assert_eq!(sanitize_component("COM1"), "_COM1");
        assert_eq!(sanitize_component("Lpt9.md"), "_Lpt9.md");
        assert_eq!(sanitize_component("COM¹"), "_COM¹");
        // 正常名不受影响(CONF 不是保留名,COM10 也不是)
        assert_eq!(sanitize_component("normal.md"), "normal.md");
        assert_eq!(sanitize_component("CONF"), "CONF");
        assert_eq!(sanitize_component("COM10"), "COM10");
    }

    #[test]
    fn yaml_escapes_quotes_and_newlines() {
        assert_eq!(yaml_str("a\"b\nc"), "\"a\\\"b c\"");
    }

    #[test]
    fn malformed_pub_date_cannot_escape_export_dir() {
        let lib = test_lib("esc");
        let vault = lib.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let mut m = meta("穿越测试");
        m.pub_date = Some("../../evil".into()); // 恰好十字符的穿越载荷
        let Outcome::Written(p) = export_note(&lib, &vault.to_string_lossy(), "ep1", &m, "x", false).unwrap()
        else { panic!() };
        assert!(p.starts_with(&vault), "产物必须落在导出根之内: {}", p.display());
        assert!(p.to_string_lossy().contains("undated"), "畸形日期应回落 undated");
        let _ = fs::remove_dir_all(&lib.root);
    }

    #[test]
    fn explicit_recreate_never_clobbers_occupied_target() {
        let lib = test_lib("clob");
        let vault = lib.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let dir = vault.to_string_lossy().into_owned();
        let Outcome::Written(p1) = export_note(&lib, &dir, "ep1", &meta("旧名"), "v1", false).unwrap()
        else { panic!() };
        fs::remove_file(&p1).unwrap(); // 用户删了导出文件
        // 标题变化后的新目标路径被一份用户自己的文件占着
        let occupied = vault.join("测试节目").join("2026-07-14 新名.md");
        fs::create_dir_all(occupied.parent().unwrap()).unwrap();
        fs::write(&occupied, "用户自己的文件").unwrap();
        let Outcome::Conflict(cp) = export_note(&lib, &dir, "ep1", &meta("新名"), "v2", true).unwrap()
        else { panic!("显式重建撞上被占目标必须走冲突,不许覆盖") };
        assert_eq!(fs::read_to_string(&occupied).unwrap(), "用户自己的文件");
        assert_eq!(fs::read_to_string(&cp).unwrap(), "v2");
        let _ = fs::remove_dir_all(&lib.root);
    }

    #[test]
    fn conflict_copy_itself_is_never_clobbered() {
        let lib = test_lib("cc");
        let vault = lib.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let dir = vault.to_string_lossy().into_owned();
        let m = meta("副本保护");

        let Outcome::Written(p) = export_note(&lib, &dir, "ep1", &m, "v1", false).unwrap()
        else { panic!() };
        fs::write(&p, "用户改了主文件").unwrap();
        // 第一次冲突:落在 .podnote-new.md
        let Outcome::Conflict(cp1) = export_note(&lib, &dir, "ep1", &m, "v2", false).unwrap()
        else { panic!() };
        // 用户又编辑了冲突副本
        fs::write(&cp1, "用户改了冲突副本").unwrap();
        // 第二次冲突:副本被占且内容不同 → 必须另起编号路径,两个现有文件都不许动
        let Outcome::Conflict(cp2) = export_note(&lib, &dir, "ep1", &m, "v3", false).unwrap()
        else { panic!() };
        assert_ne!(cp1, cp2);
        assert!(cp2.to_string_lossy().contains("podnote-new-2"));
        assert_eq!(fs::read_to_string(&p).unwrap(), "用户改了主文件");
        assert_eq!(fs::read_to_string(&cp1).unwrap(), "用户改了冲突副本");
        assert_eq!(fs::read_to_string(&cp2).unwrap(), "v3");
        // 同内容重导:复用现有副本,不再新增
        let Outcome::Conflict(cp3) = export_note(&lib, &dir, "ep1", &m, "v3", false).unwrap()
        else { panic!() };
        assert_eq!(cp2, cp3);
        let _ = fs::remove_dir_all(&lib.root);
    }

    #[test]
    fn fnv_is_stable() {
        assert_eq!(fnv1a(b"podnote"), fnv1a(b"podnote"));
        assert_ne!(fnv1a(b"podnote"), fnv1a(b"podnote2"));
    }

    #[test]
    fn state_machine_create_protect_and_conflict() {
        let lib = test_lib("sm");
        let vault = lib.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let dir = vault.to_string_lossy().into_owned();
        let m = meta("第一期:测试");

        // 新建自动写
        let out = export_note(&lib, &dir, "ep1", &m, "v1", false).unwrap();
        let Outcome::Written(p) = out else { panic!("首次导出应是 Written") };
        assert_eq!(fs::read_to_string(&p).unwrap(), "v1");

        // 未被改动 → 覆盖更新
        let Outcome::Written(p2) = export_note(&lib, &dir, "ep1", &m, "v2", false).unwrap() else {
            panic!("未改动应覆盖")
        };
        assert_eq!(fs::read_to_string(&p2).unwrap(), "v2");

        // 用户改过 → 原文件不动,写冲突副本
        fs::write(&p2, "用户的批注").unwrap();
        let Outcome::Conflict(cp) = export_note(&lib, &dir, "ep1", &m, "v3", false).unwrap() else {
            panic!("被改动应走冲突")
        };
        assert_eq!(fs::read_to_string(&p2).unwrap(), "用户的批注");
        assert_eq!(fs::read_to_string(&cp).unwrap(), "v3");
        assert!(cp.to_string_lossy().ends_with(".podnote-new.md"));

        // 用户删了 → 自动导出不重建
        fs::remove_file(&p2).unwrap();
        let Outcome::MissingOriginal(_) = export_note(&lib, &dir, "ep1", &m, "v4", false).unwrap() else {
            panic!("文件消失不许重建")
        };
        assert!(!p2.exists());
        // 显式导出 → 重建(用户亲手点了导出,意图明确)
        let Outcome::Written(p3) = export_note(&lib, &dir, "ep1", &m, "v5", true).unwrap() else {
            panic!("显式导出应重建")
        };
        assert_eq!(fs::read_to_string(&p3).unwrap(), "v5");
        let _ = fs::remove_dir_all(&lib.root);
    }

    #[test]
    fn title_change_migrates_untouched_file() {
        let lib = test_lib("mv");
        let vault = lib.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let dir = vault.to_string_lossy().into_owned();

        let Outcome::Written(p1) = export_note(&lib, &dir, "ep1", &meta("旧标题"), "v1", false).unwrap()
        else { panic!() };
        let Outcome::Written(p2) = export_note(&lib, &dir, "ep1", &meta("新标题"), "v2", false).unwrap()
        else { panic!() };
        assert!(!p1.exists(), "未被改动的旧文件应迁走");
        assert!(p2.to_string_lossy().contains("新标题"));
        let _ = fs::remove_dir_all(&lib.root);
    }

    #[test]
    fn same_name_from_other_episode_gets_id_suffix() {
        let lib = test_lib("dup");
        let vault = lib.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let dir = vault.to_string_lossy().into_owned();
        let m = meta("同名单集");
        let Outcome::Written(p1) = export_note(&lib, &dir, "ep1", &m, "a", false).unwrap() else { panic!() };
        let Outcome::Written(p2) = export_note(&lib, &dir, "ep2", &m, "b", false).unwrap() else { panic!() };
        assert_ne!(p1, p2);
        assert!(p2.to_string_lossy().contains("[ep2]"));
        let _ = fs::remove_dir_all(&lib.root);
    }
}
