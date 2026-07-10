// pncli — Rust 管线的命令行验证入口(P1 验收用,与 Node CLI 产物对拍)
// 用法(在仓库根目录): cargo run --manifest-path app/src-tauri/Cargo.toml --bin pncli -- <小宇宙链接>
// 复用仓库根 data/<slug>.asr.json 缓存与 notes/ 输出约定
use anyhow::{Context, Result};
use app_lib::pipeline::{asr, note, resolve, summarize};
use std::fs;
use std::path::Path;

fn slugify(title: &str) -> String {
    // 注意:JS 的 \w 是 ASCII-only,Rust 的 \w 含 Unicode Join_Control(如 emoji 里的零宽连接符)
    // 为与 Node CLI 的 slug 保持一致,这里显式用 ASCII 类
    let re = regex::Regex::new(r"[^\p{Han}0-9A-Za-z_]+").unwrap();
    let s = re.replace_all(title, "-");
    s.trim_matches('-').chars().take(60).collect()
}

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::args().nth(1).context("用法: pncli <小宇宙单集链接>")?;
    let asr_key = std::env::var("BAILIAN_API_KEY")
        .or_else(|_| std::env::var("DASHSCOPE_API_KEY"))
        .unwrap_or_default();
    let llm = summarize::LlmConfig {
        base_url: std::env::var("PI_BASE_URL").unwrap_or_else(|_| "https://api.codexzh.com/v1".into()),
        api_key: std::env::var("PI_API_KEY")
            .or_else(|_| std::env::var("OPENAI_API_KEY"))
            .unwrap_or_default(),
        model: std::env::var("PI_MODEL").unwrap_or_else(|_| "grok-4.5".into()),
    };
    let client = reqwest::Client::new();

    println!("== 1/3 解析单集 ==");
    let meta = resolve::resolve_episode(&client, &url).await?;
    println!("   {} — {}", meta.podcast, meta.title);
    let slug = slugify(&meta.title);
    fs::create_dir_all("data")?;
    fs::create_dir_all("notes")?;

    println!("== 2/3 云端转写(含说话人分离) ==");
    let asr_path = format!("data/{slug}.asr.json");
    let asr_result: serde_json::Value = if Path::new(&asr_path).exists() {
        println!("[skip] 转写结果已存在: {asr_path}");
        serde_json::from_str(&fs::read_to_string(&asr_path)?)?
    } else {
        let host = std::env::var("BAILIAN_HOST").unwrap_or_else(|_| asr::DEFAULT_HOST.into());
        let r = asr::transcribe(&client, &host, &asr_key, &meta.audio_url, &|st, extra| {
            println!("[asr] {st} {extra}");
        })
        .await?;
        fs::write(&asr_path, serde_json::to_string(&r)?)?;
        println!("[asr] 转写结果已缓存: {asr_path}");
        r
    };

    println!("== 3/3 生成笔记 ==");
    let timed = asr::to_timed_text(&asr_result);
    let n = match summarize::summarize(&client, &llm, &meta, &timed, &|chars| {
        print!("\r[llm] {chars} chars   ");
    })
    .await
    {
        Ok(n) => n,
        Err(e) => {
            if let Some(raw) = note::raw_of(&e) {
                let raw_path = format!("notes/{slug}.raw.txt");
                fs::write(&raw_path, raw)?;
                eprintln!("\n{e}\n原始输出已存到 {raw_path}");
            }
            return Err(e);
        }
    };
    println!();

    let json_path = format!("notes/{slug}.rs.json");
    fs::write(
        &json_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "meta": {
                "url": meta.url, "podcast": meta.podcast, "title": meta.title,
                "durationSec": meta.duration,
            },
            "note": n,
        }))?,
    )?;
    let md_path = format!("notes/{slug}.rs.md");
    fs::write(&md_path, note::note_to_markdown(&meta, &n))?;
    println!("✅ 笔记已写入: {md_path}\n   数据文件: {json_path}");
    Ok(())
}
