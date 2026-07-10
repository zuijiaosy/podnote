// pncli — Rust 管线的命令行验证入口(自测用,不开 GUI 直接实测各功能)
// 用法(在仓库根目录,cargo run --manifest-path app/src-tauri/Cargo.toml --bin pncli --):
//   pncli <小宇宙单集链接>          完整管线:解析 → 转写 → 笔记
//   pncli feed <节目链接|pid>       节目页解析:列出最新单集(订阅轮询的数据源)
//   pncli tts <note.json> [voice]   朗读合成:分段调 qwen3-tts-flash,产物写 ./tts-out/
// 复用仓库根 data/<slug>.asr.json 缓存与 notes/ 输出约定
use anyhow::{bail, Context, Result};
use app_lib::pipeline::{asr, note, resolve, summarize, tts};
use std::fs;
use std::path::Path;

fn slugify(title: &str) -> String {
    // 注意:JS 的 \w 是 ASCII-only,Rust 的 \w 含 Unicode Join_Control(如 emoji 里的零宽连接符)
    // 为与 Node CLI 的 slug 保持一致,这里显式用 ASCII 类
    let re = regex::Regex::new(r"[^\p{Han}0-9A-Za-z_]+").unwrap();
    let s = re.replace_all(title, "-");
    s.trim_matches('-').chars().take(60).collect()
}

/// pncli feed <节目链接|pid> — 实测节目页解析(订阅轮询的脆弱点)
async fn cmd_feed(arg: Option<&String>) -> Result<()> {
    let arg = arg.context("用法: pncli feed <节目链接|pid>")?;
    let pid = resolve::podcast_pid_from_url(arg).unwrap_or_else(|| arg.clone());
    let client = reqwest::Client::new();
    let feed = resolve::resolve_podcast(&client, &pid).await?;
    println!("节目: {} (pid {})", feed.title, feed.pid);
    for e in &feed.episodes {
        println!(
            "  {} | {} | {} | {}",
            e.pub_date,
            if e.playable { "可播" } else { "跳过" },
            e.eid,
            e.title
        );
    }
    println!("共 {} 集", feed.episodes.len());
    Ok(())
}

/// pncli tts <note.json> [voice] — 实测朗读合成,分段 WAV 写 ./tts-out/
async fn cmd_tts(path: Option<&String>, voice: Option<&String>) -> Result<()> {
    let path = path.context("用法: pncli tts <note.json> [voice]")?;
    let api_key = std::env::var("BAILIAN_API_KEY")
        .or_else(|_| std::env::var("DASHSCOPE_API_KEY"))
        .context("需要 BAILIAN_API_KEY")?;
    let voice = voice.map(String::as_str).unwrap_or(tts::DEFAULT_VOICE);
    let doc: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    // 兼容 {meta, note} 包装和裸 note 两种形态
    let note_obj = doc.get("note").unwrap_or(&doc);
    let segs = tts::note_segments(note_obj);
    if segs.is_empty() {
        bail!("笔记里没有可朗读的内容");
    }
    fs::create_dir_all("tts-out")?;
    let client = reqwest::Client::new();
    let started = std::time::Instant::now();
    for (i, (key, text)) in segs.iter().enumerate() {
        let t0 = std::time::Instant::now();
        let mut pcm: Vec<u8> = Vec::new();
        let mut fmt = None;
        for chunk in tts::split_text(text) {
            let wav = tts::synth(&client, &api_key, voice, &chunk).await?;
            let p = tts::parse_wav(&wav)?;
            fmt.get_or_insert((p.sample_rate, p.channels, p.bits));
            pcm.extend_from_slice(&p.data);
        }
        let (sr, ch, bits) = fmt.unwrap();
        let out = format!("tts-out/{i:03}-{key}.wav");
        fs::write(&out, tts::write_wav(sr, ch, bits, &pcm))?;
        let dur = pcm.len() as f64 / (sr as f64 * ch as f64 * bits as f64 / 8.0);
        println!(
            "[{}/{}] {key} {} 字 → {dur:.1}s 音频,耗时 {:.1}s → {out}",
            i + 1,
            segs.len(),
            text.chars().count(),
            t0.elapsed().as_secs_f64()
        );
    }
    println!("✅ {} 段完成,总耗时 {:.1}s", segs.len(), started.elapsed().as_secs_f64());
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("feed") => return cmd_feed(args.get(1)).await,
        Some("tts") => return cmd_tts(args.get(1), args.get(2)).await,
        _ => {}
    }
    let url = args.into_iter().next().context("用法: pncli <单集链接> | feed <节目链接> | tts <note.json>")?;
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
