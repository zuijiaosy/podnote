// pncli — Rust 管线的命令行验证入口(自测用,不开 GUI 直接实测各功能)
// 用法(在仓库根目录,cargo run --manifest-path app/src-tauri/Cargo.toml --bin pncli --):
//   pncli <小宇宙单集链接>          完整管线:解析 → 转写 → 笔记
//   pncli feed <节目链接|pid>       节目页解析:列出最新单集(订阅轮询的数据源)
//   pncli tts <note.json> [voice]   朗读合成:分段调 qwen3-tts-flash,产物写 ./tts-out/
// 复用仓库根 data/<slug>.asr.json 缓存与 notes/ 输出约定
use anyhow::{bail, Context, Result};
use app_lib::pipeline::{agent, asr, correct, note, resolve, summarize, tts, vocab};
use std::fs;
use std::path::Path;

/// LLM 配置(与主流程同一套 env:PI_BASE_URL / PI_API_KEY / PI_MODEL / PI_API)
fn llm_from_env() -> summarize::LlmConfig {
    summarize::LlmConfig {
        base_url: std::env::var("PI_BASE_URL").unwrap_or_else(|_| "https://api.codexzh.com/v1".into()),
        api_key: std::env::var("PI_API_KEY")
            .or_else(|_| std::env::var("OPENAI_API_KEY"))
            .unwrap_or_default(),
        model: std::env::var("PI_MODEL").unwrap_or_else(|_| "grok-4.5".into()),
        // 与 Node CLI 的 PI_API 同名同义:openai-responses | openai-completions | anthropic-messages
        protocol: app_lib::pipeline::llm::Protocol::from_id(
            &std::env::var("PI_API").unwrap_or_default(),
        ),
    }
}

fn asr_env() -> (String, String) {
    let key = std::env::var("BAILIAN_API_KEY")
        .or_else(|_| std::env::var("DASHSCOPE_API_KEY"))
        .unwrap_or_default();
    let host = std::env::var("BAILIAN_HOST").unwrap_or_else(|_| asr::DEFAULT_HOST.into());
    (key, host)
}

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

/// pncli vocab <单集链接> — 实测热词链路:提实体 → 建临时词表 → 删除(不转写)
async fn cmd_vocab(arg: Option<&String>) -> Result<()> {
    let url = arg.context("用法: pncli vocab <单集链接>")?;
    let (asr_key, host) = asr_env();
    if asr_key.is_empty() {
        bail!("需要 BAILIAN_API_KEY");
    }
    let client = reqwest::Client::new();
    let meta = resolve::resolve_episode(&client, url).await?;
    println!("节目: {} — {}", meta.podcast, meta.title);
    println!("shownotes {} 字", meta.shownotes.chars().count());
    let llm = llm_from_env();
    let entities = vocab::extract_entities(&client, &llm, &meta.podcast, &meta.title, &meta.shownotes).await;
    println!("提取实体 {} 个: {entities:?}", entities.len());
    let terms = vocab::build_terms(entities, &[]);
    if terms.is_empty() {
        bail!("没有可用热词(shownotes 为空或提取失败)");
    }
    let vid = vocab::create_vocabulary(&client, &host, &asr_key, &terms).await?;
    println!("✅ 词表已创建: {vid} ({} 词)", terms.len());
    vocab::delete_vocabulary(&client, &host, &asr_key, &vid).await?;
    println!("✅ 词表已删除");
    let rest = vocab::list_podnote_vocabularies(&client, &host, &asr_key).await?;
    println!("剩余 podnote 前缀词表: {}", rest.len());
    Ok(())
}

/// pncli research <词> "<上下文>" [节目名] — 冒烟整条查证链(需 TAVILY_API_KEY)
async fn cmd_research(args: &[String]) -> Result<()> {
    let term = args.first().context("用法: pncli research <词> \"<上下文>\" [节目名]")?;
    let context = args.get(1).cloned().unwrap_or_default();
    let podcast = args.get(2).cloned().unwrap_or_default();
    let tavily_key = std::env::var("TAVILY_API_KEY").context("需要 TAVILY_API_KEY")?;
    let llm = llm_from_env();
    if llm.api_key.is_empty() {
        bail!("需要 PI_API_KEY(LLM)");
    }
    let client = reqwest::Client::new();
    let started = std::time::Instant::now();
    let v = correct::research_term(&client, &llm, &tavily_key, &podcast, term, &context).await?;
    println!("{}", serde_json::to_string_pretty(&v)?);
    println!("耗时 {:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}

/// pncli research-blocks <note.json> <块:tldr,1,3> [节目名] — headless 跑块级核查 agent
/// 事件按 JSONL 打到 stdout(录前端 fixture 用),统计信息走 stderr
async fn cmd_research_blocks(args: &[String]) -> Result<()> {
    const USAGE: &str = "用法: pncli research-blocks <note.json> <块序号,如 tldr,1,3> [节目名]";
    let path = args.first().context(USAGE)?;
    let picks = args.get(1).context(USAGE)?;
    let doc: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let note_obj = doc.get("note").unwrap_or(&doc);
    let podcast = args.get(2).cloned().unwrap_or_else(|| {
        doc.pointer("/meta/podcast").and_then(|v| v.as_str()).unwrap_or("").to_string()
    });
    // 块选择:tldr 或 points 的 1 起序号(与阅读井里的块一一对应)
    let mut blocks = Vec::new();
    for tok in picks.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if tok == "tldr" {
            let text = note_obj.get("tldr").and_then(|v| v.as_str()).unwrap_or("").to_string();
            blocks.push(agent::BlockInput { text, who: String::new(), ts: String::new() });
        } else {
            let i: usize = tok.parse().with_context(|| format!("块序号不合法: {tok}"))?;
            let p = note_obj
                .pointer(&format!("/points/{}", i.saturating_sub(1)))
                .with_context(|| format!("没有第 {i} 个 point"))?;
            let s = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            blocks.push(agent::BlockInput {
                text: format!("{}。{}", s("h"), s("body")),
                who: s("who"),
                ts: s("ts"),
            });
        }
    }
    let tavily_key = std::env::var("TAVILY_API_KEY").context("需要 TAVILY_API_KEY")?;
    let llm = llm_from_env();
    if llm.api_key.is_empty() {
        bail!("需要 PI_API_KEY(LLM)");
    }
    let client = reqwest::Client::new();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let started = std::time::Instant::now();
    let items = agent::research_blocks(&client, &llm, &tavily_key, &podcast, &blocks, &cancel, &|ev| {
        println!("{}", serde_json::to_string(&ev).unwrap_or_default());
    })
    .await?;
    eprintln!("✅ {} 条建议,耗时 {:.1}s", items.len(), started.elapsed().as_secs_f64());
    Ok(())
}

/// pncli correct <note.json> <原词> <正词> — 离线测全文替换 + md 重渲,写 .corrected 副本不覆盖原文件
fn cmd_correct(args: &[String]) -> Result<()> {
    let (path, original, corrected) = match args {
        [p, o, c, ..] => (p, o, c),
        _ => bail!("用法: pncli correct <note.json> <原词> <正词>"),
    };
    let doc: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let mut n: note::Note = serde_json::from_value(doc.get("note").cloned().unwrap_or(doc.clone()))?;
    let count = note::replace_term(&mut n, original, corrected);
    println!("笔记替换 {count} 处");
    let meta = resolve::EpisodeMeta {
        url: doc.pointer("/meta/url").and_then(|v| v.as_str()).unwrap_or("").into(),
        audio_url: String::new(),
        title: doc.pointer("/meta/title").and_then(|v| v.as_str()).unwrap_or("无标题").into(),
        podcast: doc.pointer("/meta/podcast").and_then(|v| v.as_str()).unwrap_or("").into(),
        shownotes: String::new(),
        duration: doc.pointer("/meta/durationSec").and_then(|v| v.as_u64()),
        pub_date: None,
    };
    let out_json = format!("{path}.corrected.json");
    let out_md = format!("{path}.corrected.md");
    fs::write(&out_json, serde_json::to_string_pretty(&serde_json::json!({ "meta": doc.get("meta"), "note": n }))?)?;
    fs::write(&out_md, note::note_to_markdown(&meta, &n))?;
    println!("✅ 副本已写入: {out_json}\n           {out_md}");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("feed") => return cmd_feed(args.get(1)).await,
        Some("tts") => return cmd_tts(args.get(1), args.get(2)).await,
        Some("vocab") => return cmd_vocab(args.get(1)).await,
        Some("research") => return cmd_research(&args[1..]).await,
        Some("research-blocks") => return cmd_research_blocks(&args[1..]).await,
        Some("correct") => return cmd_correct(&args[1..]),
        _ => {}
    }
    let url = args.into_iter().next().context(
        "用法: pncli <单集链接> | feed <节目链接> | tts <note.json> | vocab <单集链接> | research <词> \"<上下文>\" | correct <note.json> <原词> <正词>",
    )?;
    let (asr_key, _) = asr_env();
    let llm = llm_from_env();
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
        let vocab_id = std::env::var("PN_VOCAB_ID").ok(); // 可选:已有词表 id 直接挂上
        let r = asr::transcribe(&client, &host, &asr_key, &meta.audio_url, vocab_id.as_deref(), &|st, extra| {
            println!("[asr] {st} {extra}");
        })
        .await?;
        fs::write(&asr_path, serde_json::to_string(&r)?)?;
        println!("[asr] 转写结果已缓存: {asr_path}");
        r
    };

    println!("== 3/3 生成笔记 ==");
    let timed = asr::to_timed_text(&asr_result);
    let n = match summarize::summarize(&client, &llm, &meta, &timed, "", &|chars| {
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
