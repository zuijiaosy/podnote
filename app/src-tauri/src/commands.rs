// commands — Tauri 命令层 + 管线运行器 + 事件
// 事件: "pipeline-progress" { id, stage, status, detail } — AddFlow 五灯与磁带架同源消费
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::export;
use crate::library::{ensure_dir, episode_id, short_date, EpisodeRecord, Library};
use crate::pipeline::{agent, asr, correct, glossary, llm, note, resolve, summarize, tavily, tts, vocab};
use crate::subscriptions::{pick_new, SubStore, Subscription};

/// 密钥内存缓存:启动时读一次,运行期零钥匙串访问
/// (钥匙串弹窗会阻塞主线程;dev 构建每次重编译签名变化还会反复弹窗)
#[derive(Debug, Clone, Default)]
pub struct Keys {
    pub asr: String,
    pub llm: String,
    pub tavily: String,
}

pub struct AppState {
    pub lib: Mutex<Library>,
    pub client: reqwest::Client,
    pub keys: Mutex<Keys>,
    /// 订阅检查进行中(定时轮询与手动检查互斥,防重复入库)
    pub checking_subs: AtomicBool,
    /// 进行中的块级核查:reqId → 取消标志(关抽屉/切集时置位中止 agent)
    pub research_cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 进行中的问答:episode id → 中止信号;单集同时只允许一个活跃提问
    pub asking: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

// ===== 设置(非敏感项存 settings.json;key 存 macOS 钥匙串) =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub asr_host: String,
    pub llm_base_url: String,
    /// LLM 协议:openai-responses | openai-completions | anthropic-messages
    pub llm_api: String,
    pub llm_model: String,
    /// 额外导出目录(如个人笔记库);None 则只写 app 数据目录
    pub notes_dir: Option<String>,
    /// 订阅自动处理总开关:开着才定时轮询
    pub sub_auto: bool,
    /// 朗读音色(qwen3-tts-flash 的 voice 参数)
    pub tts_voice: String,
    /// 朗读倍速(独立于播客原声倍速)
    pub tts_rate: f64,
    /// 导出的资源条目渲染成 [[wikilink]](Obsidian 图谱);默认关,不替用户往 vault 里造节点
    pub export_wikilinks: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            asr_host: asr::DEFAULT_HOST.into(),
            // 网关与模型无默认:key 会随请求发往网关,默认指向任何第三方都是替用户做安全决定
            llm_base_url: String::new(),
            llm_api: "openai-responses".into(),
            llm_model: String::new(),
            notes_dir: None,
            sub_auto: true,
            tts_voice: tts::DEFAULT_VOICE.into(),
            tts_rate: 1.5,
            export_wikilinks: false,
        }
    }
}

/// 导出结果 → 系统通知(冲突/文件消失/失败才打扰;正常写入静默)
fn notify_export(app: &AppHandle, res: Result<export::Outcome, String>) {
    let body = match res {
        Ok(export::Outcome::Written(_)) => None,
        Ok(export::Outcome::Conflict(p)) => Some(format!(
            "导出文件被你改动过,原文件未动;新版本在 {}",
            p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
        )),
        Ok(export::Outcome::MissingOriginal(p)) => Some(format!(
            "导出文件已不存在({}),未自动重建",
            p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
        )),
        Err(e) => Some(format!("笔记导出失败: {e}")),
    };
    if let Some(b) = body {
        let _ = app.notification().builder().title("Podnote 导出").body(b).show();
    }
}

/// 启动时读一次密钥。存 app 数据目录 keys.json(明文)——自用取舍:
/// 无签名证书时钥匙串授权随每次打包失效,启动反复弹密码框不可用
pub fn keys_load(lib: &Library) -> Keys {
    let v: Option<serde_json::Value> = fs::read_to_string(lib.root.join("keys.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let get = |k: &str| {
        v.as_ref()
            .and_then(|v| v.get(k).and_then(|x| x.as_str()))
            .unwrap_or("")
            .to_string()
    };
    Keys { asr: get("asrKey"), llm: get("llmKey"), tavily: get("tavilyKey") }
}

fn keys_save(lib: &Library, keys: &Keys) -> Result<(), String> {
    fs::write(
        lib.root.join("keys.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "asrKey": keys.asr, "llmKey": keys.llm, "tavilyKey": keys.tavily,
        }))
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn settings_path(lib: &Library) -> std::path::PathBuf {
    lib.root.join("settings.json")
}
fn load_settings(lib: &Library) -> Settings {
    fs::read_to_string(settings_path(lib))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    pub settings: Settings,
    pub asr_key_set: bool,
    pub llm_key_set: bool,
    pub tavily_key_set: bool,
    pub asr_key_hint: String,
    pub llm_key_hint: String,
    pub tavily_key_hint: String,
}

/// key 后四位:让"已保存"可辨认(存的是哪把),但不可还原
fn key_hint(k: &str) -> String {
    let n = k.chars().count();
    k.chars().skip(n.saturating_sub(4)).collect()
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> SettingsView {
    let lib = state.lib.lock().unwrap();
    let keys = state.keys.lock().unwrap();
    SettingsView {
        settings: load_settings(&lib),
        asr_key_set: !keys.asr.is_empty(),
        llm_key_set: !keys.llm.is_empty(),
        tavily_key_set: !keys.tavily.is_empty(),
        asr_key_hint: key_hint(&keys.asr),
        llm_key_hint: key_hint(&keys.llm),
        tavily_key_hint: key_hint(&keys.tavily),
    }
}

#[tauri::command]
pub fn set_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let lib = state.lib.lock().unwrap();
    fs::write(
        settings_path(&lib),
        serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_keys(
    state: State<'_, AppState>,
    asr_key: Option<String>,
    llm_key: Option<String>,
    tavily_key: Option<String>,
) -> Result<(), String> {
    let snapshot = {
        let mut keys = state.keys.lock().unwrap();
        if let Some(k) = asr_key {
            keys.asr = k;
        }
        if let Some(k) = llm_key {
            keys.llm = k;
        }
        if let Some(k) = tavily_key {
            keys.tavily = k;
        }
        keys.clone()
    };
    let lib = state.lib.lock().unwrap();
    keys_save(&lib, &snapshot)
}

// ===== 连接自检:各发一个最小真实请求,验证"钥匙能开门"而不只是"钥匙存在" =====

#[tauri::command]
pub async fn test_asr_key(state: State<'_, AppState>) -> Result<(), String> {
    let (client, host, key) = {
        let lib = state.lib.lock().unwrap();
        let keys = state.keys.lock().unwrap();
        (state.client.clone(), load_settings(&lib).asr_host, keys.asr.clone())
    };
    if key.is_empty() {
        return Err("还没填百炼 API Key".into());
    }
    // 列热词表:免费、幂等,能同时验证 key 与 API 地址
    vocab::list_podnote_vocabularies(&client, &host, &key)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_llm(state: State<'_, AppState>) -> Result<(), String> {
    let (client, cfg) = {
        let lib = state.lib.lock().unwrap();
        let keys = state.keys.lock().unwrap();
        let settings = load_settings(&lib);
        if settings.llm_base_url.is_empty() {
            return Err("还没填 LLM 网关地址".into());
        }
        if settings.llm_model.is_empty() {
            return Err("还没填笔记模型".into());
        }
        (
            state.client.clone(),
            llm::LlmConfig {
                base_url: settings.llm_base_url,
                api_key: keys.llm.clone(),
                model: settings.llm_model,
                protocol: llm::Protocol::from_id(&settings.llm_api),
            },
        )
    };
    // 最小对话:一次验证 key + 网关 + 协议 + 模型名的完整组合
    llm::stream_chat(&client, &cfg, "这是连通性自检,只回答 OK。", &[llm::user_message("OK?")], &|_| {})
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_tavily(state: State<'_, AppState>) -> Result<(), String> {
    let (client, key) = {
        let keys = state.keys.lock().unwrap();
        (state.client.clone(), keys.tavily.clone())
    };
    if key.is_empty() {
        return Err("还没填 Tavily API Key".into());
    }
    tavily::search(&client, &key, "podnote")
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ===== 库 =====

#[tauri::command]
pub fn get_library(state: State<AppState>) -> Vec<EpisodeRecord> {
    state.lib.lock().unwrap().list()
}

#[tauri::command]
pub fn get_note(state: State<AppState>, id: String) -> Option<serde_json::Value> {
    let path = state.lib.lock().unwrap().note_json_path(&id);
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
pub fn get_note_markdown(state: State<AppState>, id: String) -> Option<String> {
    let path = state.lib.lock().unwrap().note_md_path(&id);
    fs::read_to_string(path).ok()
}

#[tauri::command]
pub fn delete_episode(state: State<AppState>, id: String) -> Result<(), String> {
    let lib = state.lib.lock().unwrap();
    export::forget(&lib, &id); // 外部导出文件是用户的,留下;只销记账
    lib.remove(&id).map_err(|e| e.to_string())
}

/// 归档/取消归档(消费状态,与管线状态正交)
#[tauri::command]
pub fn set_read(state: State<AppState>, id: String, read: bool) -> Result<(), String> {
    let ts = read.then(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    });
    state
        .lib
        .lock()
        .unwrap()
        .update(&id, |r| r.read_at = ts)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ===== 朗读(TTS):一段一 WAV 渐进落盘,首段就绪即可开播 =====
// 事件: "tts-progress"
//   { id, status: "processing", done, total }          — 正在合成第 done 段
//   { id, status: "segment", seq, key, total, path }   — 第 seq 段落盘,可播
//   { id, status: "ready" | "error", done, total, detail }

fn tts_dir(lib: &Library, id: &str) -> std::path::PathBuf {
    lib.root.join("tts").join(id)
}
fn tts_seg_path(lib: &Library, id: &str, seq: usize) -> std::path::PathBuf {
    tts_dir(lib, id).join(format!("{seq:03}.wav"))
}
fn tts_manifest_path(lib: &Library, id: &str) -> std::path::PathBuf {
    tts_dir(lib, id).join("manifest.json")
}
fn tts_invalidate(lib: &Library, id: &str) {
    let _ = fs::remove_dir_all(tts_dir(lib, id));
    // 单文件方案的旧产物一并清掉
    let _ = fs::remove_file(lib.root.join("audio").join(format!("tts-{id}.wav")));
    let _ = fs::remove_file(lib.root.join("tts").join(format!("{id}.json")));
}

/// 朗读缓存现状:{ voice, complete, segments: [{seq, key, path|null}] };没合成过则 None
/// path 为 null 的段还没落盘(合成中断),前端播到时等 segment 事件续播
#[tauri::command]
pub fn get_tts(state: State<AppState>, id: String) -> Option<serde_json::Value> {
    let lib = state.lib.lock().unwrap();
    let m: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(tts_manifest_path(&lib, &id)).ok()?).ok()?;
    let segments: Vec<serde_json::Value> = m
        .get("segments")?
        .as_array()?
        .iter()
        .enumerate()
        .map(|(seq, s)| {
            let p = tts_seg_path(&lib, &id, seq);
            serde_json::json!({
                "seq": seq,
                "key": s.get("key"),
                "path": p.exists().then(|| p.to_string_lossy().into_owned()),
            })
        })
        .collect();
    Some(serde_json::json!({
        "voice": m.get("voice"),
        "complete": m.get("complete").and_then(|v| v.as_bool()).unwrap_or(false),
        "segments": segments,
    }))
}

#[tauri::command]
pub fn generate_tts(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn(run_tts(app, id));
    Ok(())
}

fn emit_tts(app: &AppHandle, id: &str, status: &str, done: usize, total: usize, detail: &str) {
    let _ = app.emit(
        "tts-progress",
        serde_json::json!({ "id": id, "status": status, "done": done, "total": total, "detail": detail }),
    );
}

async fn run_tts(app: AppHandle, id: String) {
    let (client, note_path, voice, asr_key) = {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        let keys = state.keys.lock().unwrap();
        (
            state.client.clone(),
            lib.note_json_path(&id),
            load_settings(&lib).tts_voice,
            keys.asr.clone(),
        )
    };
    if asr_key.is_empty() {
        return emit_tts(&app, &id, "error", 0, 0, "还没配置百炼 API Key");
    }
    let note_json: serde_json::Value = match fs::read_to_string(&note_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(v) => v,
        None => return emit_tts(&app, &id, "error", 0, 0, "笔记还没生成"),
    };
    let segs = tts::note_segments(note_json.get("note").unwrap_or(&serde_json::Value::Null));
    if segs.is_empty() {
        return emit_tts(&app, &id, "error", 0, 0, "笔记里没有可朗读的内容");
    }
    let total = segs.len();

    // 音色变了就整体作废;否则已落盘的段直接跳过(断点续传)
    let manifest_path = {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        let path = tts_manifest_path(&lib, &id);
        let old_voice = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|m| m.get("voice").and_then(|v| v.as_str()).map(String::from));
        if old_voice.as_deref().is_some_and(|v| v != voice) {
            tts_invalidate(&lib, &id);
        }
        path
    };
    let seg_meta: Vec<serde_json::Value> = segs
        .iter()
        .map(|(key, _)| serde_json::json!({ "key": key }))
        .collect();
    let write_manifest = |complete: bool| {
        let m = serde_json::json!({ "voice": voice, "complete": complete, "segments": seg_meta });
        let _ = ensure_dir(&manifest_path);
        let _ = fs::write(&manifest_path, serde_json::to_string(&m).unwrap_or_default());
    };
    write_manifest(false);

    for (seq, (key, text)) in segs.iter().enumerate() {
        let seg_path = {
            let state = app.state::<AppState>();
            let lib = state.lib.lock().unwrap();
            tts_seg_path(&lib, &id, seq)
        };
        if !seg_path.exists() {
            emit_tts(&app, &id, "processing", seq, total, "");
            // 段内超长再按句切块,块 PCM 拼成这一段的单个 WAV
            let mut pcm: Vec<u8> = Vec::new();
            let mut fmt: Option<(u32, u16, u16)> = None;
            for chunk in tts::split_text(text) {
                let wav_bytes = match tts::synth(&client, &asr_key, &voice, &chunk).await {
                    Ok(b) => b,
                    Err(e) => return emit_tts(&app, &id, "error", seq, total, &e.to_string()),
                };
                let parsed = match tts::parse_wav(&wav_bytes) {
                    Ok(p) => p,
                    Err(e) => return emit_tts(&app, &id, "error", seq, total, &e.to_string()),
                };
                let this_fmt = (parsed.sample_rate, parsed.channels, parsed.bits);
                if *fmt.get_or_insert(this_fmt) != this_fmt {
                    return emit_tts(&app, &id, "error", seq, total, "TTS 返回的音频格式不一致");
                }
                pcm.extend_from_slice(&parsed.data);
            }
            let (sr, ch, bits) = fmt.unwrap();
            if let Err(e) = fs::write(&seg_path, tts::write_wav(sr, ch, bits, &pcm)) {
                return emit_tts(&app, &id, "error", seq, total, &e.to_string());
            }
        }
        let _ = app.emit(
            "tts-progress",
            serde_json::json!({
                "id": id, "status": "segment", "seq": seq, "key": key,
                "total": total, "path": seg_path.to_string_lossy(),
            }),
        );
    }
    write_manifest(true);
    emit_tts(&app, &id, "ready", total, total, "");
}

#[tauri::command]
pub fn reveal_note(state: State<AppState>, id: String) -> Result<(), String> {
    let path = state.lib.lock().unwrap().note_md_path(&id);
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// 逐句转写(字幕视图用):[{t 秒, end 秒, spk "S1", text}]
#[tauri::command]
pub fn get_transcript(state: State<AppState>, id: String) -> Option<Vec<serde_json::Value>> {
    let path = state.lib.lock().unwrap().asr_path(&id);
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let sents = v.pointer("/transcripts/0/sentences")?.as_array()?;
    Some(
        sents
            .iter()
            .map(|s| {
                serde_json::json!({
                    "t": s.get("begin_time").and_then(|x| x.as_u64()).unwrap_or(0) as f64 / 1000.0,
                    "end": s.get("end_time").and_then(|x| x.as_u64()).unwrap_or(0) as f64 / 1000.0,
                    "spk": s.get("speaker_id").and_then(|x| x.as_u64()).map(|i| format!("S{}", i + 1)),
                    "text": s.get("text").and_then(|x| x.as_str()).unwrap_or("").trim(),
                })
            })
            .collect(),
    )
}

/// 波形峰值缓存:读(无则 None)
#[tauri::command]
pub fn get_peaks(state: State<AppState>, id: String) -> Option<Vec<f32>> {
    let path = state.lib.lock().unwrap().peaks_path(&id);
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// 波形峰值缓存:写(前端首次解码后持久化,重启秒显真波形)
#[tauri::command]
pub fn save_peaks(state: State<AppState>, id: String, peaks: Vec<f32>) -> Result<(), String> {
    let path = state.lib.lock().unwrap().peaks_path(&id);
    let json = serde_json::to_string(&peaks).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// 已下载音频的本地路径(未下载返回 None)
#[tauri::command]
pub fn get_audio_path(state: State<AppState>, id: String) -> Option<String> {
    state
        .lib
        .lock()
        .unwrap()
        .find_audio(&id)
        .map(|p| p.to_string_lossy().into_owned())
}

/// 下载音频到 app 数据目录(播放器用),进度经 "audio-progress" 事件推送
#[tauri::command]
pub async fn download_audio(app: AppHandle, id: String) -> Result<String, String> {
    let (client, meta_path, existing, lib_root) = {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        (
            state.client.clone(),
            lib.root.join("meta").join(format!("{id}.json")),
            lib.find_audio(&id),
            lib.root.clone(),
        )
    };
    if let Some(p) = existing {
        return Ok(p.to_string_lossy().into_owned());
    }
    let meta: resolve::EpisodeMeta = fs::read_to_string(&meta_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or("找不到剧集元信息,请先重试解析")?;

    let ext = meta
        .audio_url
        .split('?')
        .next()
        .and_then(|p| p.rsplit('.').next())
        .filter(|e| ["m4a", "mp3", "aac", "wav"].contains(e))
        .unwrap_or("m4a")
        .to_string();
    let dest = lib_root.join("audio").join(format!("{id}.{ext}"));
    let tmp = lib_root.join("audio").join(format!("{id}.{ext}.part"));

    let res = client
        .get(&meta.audio_url)
        .send()
        .await
        .map_err(|e| format!("音频下载失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("音频下载被拒: {e}"))?;
    let total = res.content_length().unwrap_or(0);

    use futures_util::StreamExt;
    use std::io::Write;
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut stream = res.bytes_stream();
    let mut got: u64 = 0;
    let mut last_pct: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("音频下载中断: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if total > 0 {
            let pct = got * 100 / total;
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    "audio-progress",
                    serde_json::json!({ "id": id, "pct": pct }),
                );
            }
        }
    }
    drop(file);
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    let _ = app.emit("audio-progress", serde_json::json!({ "id": id, "pct": 100 }));
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn add_episode(app: AppHandle, state: State<AppState>, url: String) -> Result<EpisodeRecord, String> {
    let id = episode_id(&url).ok_or("这不是有效的小宇宙单集链接")?;
    let rec = EpisodeRecord {
        id: id.clone(),
        url: url.clone(),
        show: String::new(),
        title: url.clone(), // 解析前先用链接占位
        date: String::new(),
        duration_sec: 0,
        status: "queued".into(),
        err_stage: None,
        err_message: None,
        read_at: None,
    };
    state.lib.lock().unwrap().upsert(rec.clone()).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(run_pipeline(app, id, false));
    Ok(rec)
}

#[tauri::command]
pub fn retry_episode(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state
        .lib
        .lock()
        .unwrap()
        .update(&id, |r| {
            r.status = "queued".into();
            r.err_stage = None;
            r.err_message = None;
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(run_pipeline(app, id, false));
    Ok(())
}

/// 重新生成笔记:复用转写缓存,只重跑 LLM(换模型/调 prompt 的高频动作)
#[tauri::command]
pub fn regenerate_note(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state
        .lib
        .lock()
        .unwrap()
        .update(&id, |r| {
            r.status = "queued".into();
            r.err_stage = None;
            r.err_message = None;
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(run_pipeline(app, id, true));
    Ok(())
}

/// 重新转写:删转写缓存全量重跑(级联重新生成笔记;换转写配置后用)
#[tauri::command]
pub fn regenerate_transcript(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    {
        let lib = state.lib.lock().unwrap();
        let _ = fs::remove_file(lib.asr_path(&id)); // 缓存没了,TRANSCRIBE 必然重跑
        tts_invalidate(&lib, &id); // 旧朗读立即作废(笔记落盘处还会再调,双保险)
        lib.update(&id, |r| {
            r.status = "queued".into();
            r.err_stage = None;
            r.err_message = None;
        })
        .map_err(|e| e.to_string())?;
    }
    tauri::async_runtime::spawn(run_pipeline(app, id, false));
    Ok(())
}

// ===== 划词纠正:查证(LLM+Tavily)→ 应用(笔记+字幕全文替换)→ 沉淀频道词表 =====

#[tauri::command]
pub async fn research_term(
    state: State<'_, AppState>,
    id: String,
    term: String,
    context: String,
) -> Result<correct::TermVerdict, String> {
    let (client, keys, settings, show) = {
        let lib = state.lib.lock().unwrap();
        let keys = state.keys.lock().unwrap().clone();
        let show = lib.get(&id).map(|r| r.show).unwrap_or_default();
        (state.client.clone(), keys, load_settings(&lib), show)
    };
    if keys.tavily.is_empty() {
        return Err("还没配置 Tavily API Key".into());
    }
    if keys.llm.is_empty() {
        return Err("还没配置 LLM API Key".into());
    }
    let llm = summarize::LlmConfig {
        base_url: settings.llm_base_url.clone(),
        api_key: keys.llm,
        model: settings.llm_model.clone(),
        protocol: crate::pipeline::llm::Protocol::from_id(&settings.llm_api),
    };
    correct::research_term(&client, &llm, &keys.tavily, &show, &term, &context)
        .await
        .map_err(|e| e.to_string())
}

/// 应用纠正:笔记全字段 + 字幕逐句替换,双产物与导出副本重写,记入单集纠正与频道词表;
/// 返回笔记里的替换处数
#[tauri::command]
pub fn apply_correction(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    original: String,
    corrected: String,
    evidence_url: Option<String>,
    confidence: String,
) -> Result<usize, String> {
    let original = original.trim().to_string();
    let corrected = corrected.trim().to_string();
    if original.is_empty() || corrected.is_empty() || original == corrected {
        return Err("原词与正词不能为空或相同".into());
    }
    let lib = state.lib.lock().unwrap();

    // 1. 笔记:结构化字段遍历替换(绝不碰 JSON 原文),{meta, note} 包裹保持
    let note_path = lib.note_json_path(&id);
    let mut doc: serde_json::Value = fs::read_to_string(&note_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or("笔记还没生成")?;
    let mut parsed: note::Note =
        serde_json::from_value(doc.get("note").cloned().unwrap_or_default())
            .map_err(|e| format!("笔记数据损坏: {e}"))?;
    let count = note::replace_term(&mut parsed, &original, &corrected);
    doc["note"] = serde_json::to_value(&parsed).map_err(|e| e.to_string())?;
    fs::write(&note_path, serde_json::to_string_pretty(&doc).unwrap_or_default())
        .map_err(|e| e.to_string())?;

    // md 重渲:meta 优先读全量 meta/<id>.json,缺了从 note.json 的 meta 摘要重建
    let meta: resolve::EpisodeMeta = fs::read_to_string(lib.root.join("meta").join(format!("{id}.json")))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| resolve::EpisodeMeta {
            url: doc.pointer("/meta/url").and_then(|v| v.as_str()).unwrap_or("").into(),
            audio_url: String::new(),
            title: doc.pointer("/meta/title").and_then(|v| v.as_str()).unwrap_or("").into(),
            podcast: doc.pointer("/meta/podcast").and_then(|v| v.as_str()).unwrap_or("").into(),
            shownotes: String::new(),
            duration: doc.pointer("/meta/durationSec").and_then(|v| v.as_u64()),
            pub_date: None,
        });
    let md = note::note_to_markdown(&meta, &parsed);
    let _ = fs::write(lib.note_md_path(&id), &md);
    let settings = load_settings(&lib);
    if let Some(dir) = settings.notes_dir.as_deref().filter(|d| !d.is_empty()) {
        let content = export::render(&meta, &parsed, settings.export_wikilinks);
        notify_export(&app, export::export_note(&lib, dir, &id, &meta, &content, false));
    }

    // 2. 字幕同步(用户决策:笔记+字幕都改)
    let asr_path = lib.asr_path(&id);
    if let Some(mut asr_doc) = fs::read_to_string(&asr_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    {
        if correct::replace_in_transcript(&mut asr_doc, &original, &corrected) > 0 {
            let _ = fs::write(&asr_path, serde_json::to_string(&asr_doc).unwrap_or_default());
        }
    }

    // 3. 笔记与字幕都变了,旧朗读作废
    tts_invalidate(&lib, &id);

    // 4. 记录:单集纠正(下划线标记 + 重生成兜底)+ 频道词表(prompt 注入 + 热词)
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = correct::append_correction(
        &lib.corrections_path(&id),
        correct::CorrectionRecord {
            original: original.clone(),
            corrected: corrected.clone(),
            evidence_url: evidence_url.clone(),
            confidence: confidence.clone(),
            ts,
        },
    );
    let show = lib.get(&id).map(|r| r.show).filter(|s| !s.is_empty()).unwrap_or_else(|| meta.podcast.clone());
    let _ = glossary::append(
        &lib.root,
        glossary::GlossaryEntry { show, original, corrected, evidence_url, confidence, ts },
    );
    Ok(count)
}

/// 读取单集的 {meta, note} 双产物,拼出导出正文(显式导出共用)
fn render_export(lib: &Library, id: &str, settings: &Settings) -> Result<(resolve::EpisodeMeta, String), String> {
    let doc: serde_json::Value = fs::read_to_string(lib.note_json_path(id))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or("这一集还没有生成笔记")?;
    let parsed: note::Note = serde_json::from_value(doc.get("note").cloned().unwrap_or_default())
        .map_err(|e| format!("笔记数据损坏: {e}"))?;
    let meta: resolve::EpisodeMeta =
        fs::read_to_string(lib.root.join("meta").join(format!("{id}.json")))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| resolve::EpisodeMeta {
                url: doc.pointer("/meta/url").and_then(|v| v.as_str()).unwrap_or("").into(),
                audio_url: String::new(),
                title: doc.pointer("/meta/title").and_then(|v| v.as_str()).unwrap_or("").into(),
                podcast: doc.pointer("/meta/podcast").and_then(|v| v.as_str()).unwrap_or("").into(),
                shownotes: String::new(),
                duration: doc.pointer("/meta/durationSec").and_then(|v| v.as_u64()),
                pub_date: doc.pointer("/meta/pubDate").and_then(|v| v.as_str()).map(String::from),
            });
    let content = export::render(&meta, &parsed, settings.export_wikilinks);
    Ok((meta, content))
}

fn file_name_of(p: &std::path::Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 显式导出单集(磁带架右键):返回回执文案给菜单原位展示,同时发系统通知
#[tauri::command]
pub fn export_episode(app: AppHandle, state: State<AppState>, id: String) -> Result<String, String> {
    let lib = state.lib.lock().unwrap();
    let settings = load_settings(&lib);
    let Some(dir) = settings.notes_dir.clone().filter(|d| !d.is_empty()) else {
        return Err("先在设置里选择「笔记导出目录」".into());
    };
    let (meta, content) = render_export(&lib, &id, &settings)?;
    let body = match export::export_note(&lib, &dir, &id, &meta, &content, true)? {
        export::Outcome::Written(p) => format!("已导出: {}", file_name_of(&p)),
        export::Outcome::Conflict(p) => {
            format!("文件被你改动过,原文件未动;新版在 {}", file_name_of(&p))
        }
        export::Outcome::MissingOriginal(p) => format!("导出文件已不存在({})", file_name_of(&p)),
    };
    let _ = app.notification().builder().title("Podnote 导出").body(body.clone()).show();
    Ok(body)
}

/// 显式导出某频道全部已完成单集(频道条右键):返回真实汇总回执;全部失败按错误返回
#[tauri::command]
pub fn export_show(app: AppHandle, state: State<AppState>, show: String) -> Result<String, String> {
    let lib = state.lib.lock().unwrap();
    let settings = load_settings(&lib);
    let Some(dir) = settings.notes_dir.clone().filter(|d| !d.is_empty()) else {
        return Err("先在设置里选择「笔记导出目录」".into());
    };
    let ids: Vec<String> = lib
        .list()
        .into_iter()
        .filter(|r| r.show == show && r.status == "ready")
        .map(|r| r.id)
        .collect();
    if ids.is_empty() {
        return Err("这个频道还没有已完成的单集".into());
    }
    let (mut written, mut conflicts, mut failed) = (0usize, 0usize, 0usize);
    for id in &ids {
        match render_export(&lib, id, &settings)
            .and_then(|(meta, content)| export::export_note(&lib, &dir, id, &meta, &content, true))
        {
            Ok(export::Outcome::Written(_)) => written += 1,
            Ok(export::Outcome::Conflict(_)) => conflicts += 1,
            Ok(export::Outcome::MissingOriginal(_)) => failed += 1,
            Err(_) => failed += 1,
        }
    }
    if written == 0 && conflicts == 0 {
        return Err(format!("导出失败({failed} 集都没写成)"));
    }
    let mut body = format!("已导出 {written} 集");
    if conflicts > 0 {
        body.push_str(&format!(",{conflicts} 集有你的改动(新版在 .podnote-new.md)"));
    }
    if failed > 0 {
        body.push_str(&format!(",{failed} 集失败"));
    }
    let _ = app
        .notification()
        .builder()
        .title("Podnote 导出")
        .body(format!("「{show}」{body}"))
        .show();
    Ok(body)
}

#[tauri::command]
pub fn get_corrections(state: State<AppState>, id: String) -> Vec<correct::CorrectionRecord> {
    let path = state.lib.lock().unwrap().corrections_path(&id);
    correct::load_corrections(&path)
}

// ===== 单集问答:转写稿全文 + 多轮历史,流式回答,时间戳吸附,revision 盖戳日志 =====

const QA_PROMPT: &str = include_str!("../../../prompts/qa.md");
const QA_PROMPT_VERSION: &str = "qa-1";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum QaEvent {
    /// 流式文本增量
    Delta { text: String },
    /// 终局:完整一轮(含吸附后的可点引用、用量、revision)
    Done { round: QaRound },
}

/// 内容版本指纹:转写稿/笔记变了,旧回答标"基于旧版内容"且不再续入上下文;
/// model/protocol 只作审计,不触发过期
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaRevision {
    pub transcript_hash: String,
    pub note_hash: String,
    pub prompt_version: String,
    pub model: String,
    pub protocol: String,
}

/// 吸附成功的时间戳引用:ts 是回答里的原样文本,sec 是最近句首的真实秒数
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaRef {
    pub ts: String,
    pub sec: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaRound {
    pub q: String,
    pub a: String,
    pub refs: Vec<QaRef>,
    #[serde(default)]
    pub usage: Option<llm::Usage>,
    pub revision: QaRevision,
    pub created_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaHistoryItem {
    pub q: String,
    pub a: String,
}

fn qa_path(lib: &Library, id: &str) -> std::path::PathBuf {
    lib.root.join("qa").join(format!("{id}.json"))
}

fn load_qa(lib: &Library, id: &str) -> Vec<QaRound> {
    fs::read_to_string(qa_path(lib, id))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn current_revision(lib: &Library, id: &str, settings: &Settings) -> QaRevision {
    let hash_of = |p: std::path::PathBuf| {
        fs::read(p).map(|b| export::fnv1a(&b)).unwrap_or_else(|_| "none".into())
    };
    QaRevision {
        transcript_hash: hash_of(lib.asr_path(id)),
        note_hash: hash_of(lib.note_json_path(id)),
        prompt_version: QA_PROMPT_VERSION.into(),
        model: settings.llm_model.clone(),
        protocol: settings.llm_api.clone(),
    }
}

/// 从回答提取 [h:mm:ss]/[mm:ss] 引用,吸附到 ±15s 内最近的转写句首(并列取较早句)。
/// 这是定位规范化,不是真实性证明——真实性靠用户点击回听;吸不上的不进表,前端渲染为纯文本。
fn snap_refs(answer: &str, sent_secs: &[f64]) -> Vec<QaRef> {
    let re = regex::Regex::new(r"\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]").expect("字面量正则必然合法");
    let mut out: Vec<QaRef> = Vec::new();
    for m in re.find_iter(answer) {
        let ts = m.as_str().trim_start_matches('[').trim_end_matches(']');
        if out.iter().any(|r| r.ts == ts) {
            continue;
        }
        let sec = crate::pipeline::note::ts_to_seconds(ts) as f64;
        let mut best: Option<f64> = None;
        for &s in sent_secs {
            // 严格小于:等距时保留先遇到的较早句,避免提前剧透
            if best.map(|b| (s - sec).abs() < (b - sec).abs()).unwrap_or(true) {
                best = Some(s);
            }
        }
        if let Some(b) = best {
            if (b - sec).abs() <= 15.0 {
                out.push(QaRef { ts: ts.to_string(), sec: b });
            }
        }
    }
    out
}

/// 问答记录 + 当前内容版本(前端据此画"内容已更新"分隔线并截断上下文)+ 输入量粗估
#[tauri::command]
pub fn get_qa(state: State<AppState>, id: String) -> serde_json::Value {
    let lib = state.lib.lock().unwrap();
    let settings = load_settings(&lib);
    let timed = fs::read_to_string(lib.asr_path(&id))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .map(|v| asr::to_timed_text(&v))
        .unwrap_or_default();
    serde_json::json!({
        "rounds": load_qa(&lib, &id),
        "current": current_revision(&lib, &id, &settings),
        // 粗估(中文约 2 字符/token):只标"约",不声称判断过模型窗口
        "estInputTokens": timed.chars().count() / 2,
    })
}

#[tauri::command]
pub async fn ask_episode(
    state: State<'_, AppState>,
    id: String,
    question: String,
    history: Vec<QaHistoryItem>,
    channel: tauri::ipc::Channel<QaEvent>,
) -> Result<(), String> {
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err("问题不能为空".into());
    }

    // 锁内快照,不跨 await 持锁
    let (client, cfg, meta, timed, sent_secs, revision) = {
        let lib = state.lib.lock().unwrap();
        let keys = state.keys.lock().unwrap();
        let settings = load_settings(&lib);
        if keys.llm.is_empty() {
            return Err("还没配置 LLM API Key".into());
        }
        if settings.llm_base_url.is_empty() || settings.llm_model.is_empty() {
            return Err("还没配置 LLM 网关地址或模型".into());
        }
        let asr_raw =
            fs::read_to_string(lib.asr_path(&id)).map_err(|_| "这一集还没有转写稿".to_string())?;
        let v: serde_json::Value = serde_json::from_str(&asr_raw).map_err(|e| e.to_string())?;
        let timed = asr::to_timed_text(&v);
        let sent_secs: Vec<f64> = v
            .pointer("/transcripts/0/sentences")
            .and_then(|s| s.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.get("begin_time").and_then(|x| x.as_u64()))
                    .map(|ms| ms as f64 / 1000.0)
                    .collect()
            })
            .unwrap_or_default();
        let meta: resolve::EpisodeMeta =
            fs::read_to_string(lib.root.join("meta").join(format!("{id}.json")))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .ok_or("找不到单集元信息")?;
        let revision = current_revision(&lib, &id, &settings);
        let cfg = llm::LlmConfig {
            base_url: settings.llm_base_url.clone(),
            api_key: keys.llm.clone(),
            model: settings.llm_model.clone(),
            protocol: llm::Protocol::from_id(&settings.llm_api),
        };
        (state.client.clone(), cfg, meta, timed, sent_secs, revision)
    };

    let system = QA_PROMPT
        .replace("{{podcast}}", &meta.podcast)
        .replace("{{title}}", &meta.title)
        .replace("{{transcript}}", &timed);
    let mut messages: Vec<llm::ChatMessage> = Vec::new();
    for h in &history {
        messages.push(llm::ChatMessage { role: "user".into(), content: h.q.clone() });
        messages.push(llm::ChatMessage { role: "assistant".into(), content: h.a.clone() });
    }
    messages.push(llm::user_message(question.clone()));

    // 单集单活跃请求:原子登记,占用即拒
    let cancel = Arc::new(tokio::sync::Notify::new());
    {
        let mut asking = state.asking.lock().unwrap();
        if asking.contains_key(&id) {
            return Err("这一集已有进行中的提问".into());
        }
        asking.insert(id.clone(), cancel.clone());
    }

    // 请求体按协议补差:Responses 不留存对话 + 缓存键;Completions 显式要 usage;
    // Anthropic 给稳定前缀(system=转写稿)打缓存标——命中与否以返回的 usage 为准
    let cache_key = format!("podnote-qa-{id}");
    let sys_for_patch = system.clone();
    let protocol = cfg.protocol;
    let patch = move |body: &mut serde_json::Value| match protocol {
        llm::Protocol::OpenAiResponses => {
            body["store"] = serde_json::json!(false);
            body["prompt_cache_key"] = serde_json::json!(cache_key);
        }
        llm::Protocol::OpenAiCompletions => {
            body["stream_options"] = serde_json::json!({ "include_usage": true });
        }
        llm::Protocol::AnthropicMessages => {
            body["system"] = serde_json::json!([{
                "type": "text", "text": sys_for_patch, "cache_control": { "type": "ephemeral" }
            }]);
        }
    };

    let ch = channel.clone();
    let on_delta = move |t: &str| {
        let _ = ch.send(QaEvent::Delta { text: t.to_string() });
    };
    let stream = llm::stream_chat_full(&client, &cfg, &system, &messages, None, Some(&patch), &on_delta);
    // select 掉线即弃:取消发生在连接/首 token 阶段同样立刻生效(future 被 drop,连接随之断开)
    let result = tokio::select! {
        _ = cancel.notified() => Err("已取消".to_string()),
        r = stream => r.map_err(|e| e.to_string()),
    };

    // 条件注销:仍是本次的信号才移除,防止清掉后续请求的登记
    {
        let mut asking = state.asking.lock().unwrap();
        if asking.get(&id).map(|n| Arc::ptr_eq(n, &cancel)).unwrap_or(false) {
            asking.remove(&id);
        }
    }

    let (answer, usage) = result?;
    let round = QaRound {
        q: question,
        a: answer.clone(),
        refs: snap_refs(&answer, &sent_secs),
        usage,
        revision,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    // append-only 日志,原子落盘;取消/失败不会走到这里,不留半截回答
    {
        let lib = state.lib.lock().unwrap();
        let mut rounds = load_qa(&lib, &id);
        rounds.push(round.clone());
        let path = qa_path(&lib, &id);
        let _ = ensure_dir(&path);
        export::write_atomic(&path, &serde_json::to_string_pretty(&rounds).unwrap_or_default())?;
    }
    let _ = channel.send(QaEvent::Done { round });
    Ok(())
}

/// 中止进行中的提问(关抽屉/切集/手动停止)
#[tauri::command]
pub fn cancel_ask(state: State<AppState>, id: String) {
    if let Some(n) = state.asking.lock().unwrap().get(&id) {
        n.notify_one();
    }
}

// ===== 块级批量核查:agent(LLM tool-calling + Tavily)全过程经 Channel 流式推送 =====

/// 终局修正表也在 final 事件里;应用仍由前端逐行调 apply_correction,这里不落盘
#[tauri::command]
pub async fn research_blocks(
    state: State<'_, AppState>,
    id: String,
    req_id: String,
    blocks: Vec<agent::BlockInput>,
    channel: tauri::ipc::Channel<agent::AgentEvent>,
) -> Result<(), String> {
    let (client, keys, settings, show) = {
        let lib = state.lib.lock().unwrap();
        let keys = state.keys.lock().unwrap().clone();
        let show = lib.get(&id).map(|r| r.show).unwrap_or_default();
        (state.client.clone(), keys, load_settings(&lib), show)
    };
    if keys.tavily.is_empty() {
        return Err("还没配置 Tavily API Key".into());
    }
    if keys.llm.is_empty() {
        return Err("还没配置 LLM API Key".into());
    }
    let llm = summarize::LlmConfig {
        base_url: settings.llm_base_url.clone(),
        api_key: keys.llm,
        model: settings.llm_model.clone(),
        protocol: crate::pipeline::llm::Protocol::from_id(&settings.llm_api),
    };
    // 注册取消标志;结束(含出错)时移除,防 map 泄漏
    let cancel = Arc::new(AtomicBool::new(false));
    state.research_cancel.lock().unwrap().insert(req_id.clone(), cancel.clone());
    let on_event = |ev: agent::AgentEvent| {
        let _ = channel.send(ev);
    };
    let out =
        agent::research_blocks(&client, &llm, &keys.tavily, &show, &blocks, &cancel, &on_event)
            .await;
    state.research_cancel.lock().unwrap().remove(&req_id);
    match out {
        Ok(_) => Ok(()),
        Err(e) => {
            // 错误也走事件(抽屉里可读);invoke 的 reject 同步返回给调用方
            let msg = e.to_string();
            let _ = channel.send(agent::AgentEvent::Error { message: msg.clone() });
            Err(msg)
        }
    }
}

/// 中止核查:置取消标志(agent 在轮次间/工具间/SSE chunk 粒度检查,很快生效)
#[tauri::command]
pub fn cancel_research(state: State<AppState>, req_id: String) {
    if let Some(flag) = state.research_cancel.lock().unwrap().get(&req_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

// ===== 管线运行器 =====

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    id: String,
    stage: String,  // RESOLVE | TRANSCRIBE | SUMMARIZE | READY
    status: String, // processing | ready | error
    detail: String,
}

fn emit(app: &AppHandle, id: &str, stage: &str, status: &str, detail: &str) {
    let _ = app.emit(
        "pipeline-progress",
        ProgressPayload {
            id: id.into(),
            stage: stage.into(),
            status: status.into(),
            detail: detail.into(),
        },
    );
}

fn set_status(app: &AppHandle, id: &str, status: &str) {
    let state = app.state::<AppState>();
    let lib = state.lib.lock().unwrap();
    let _ = lib.update(id, |r| r.status = status.into());
}

fn fail(app: &AppHandle, id: &str, stage: &str, message: &str) {
    let state = app.state::<AppState>();
    {
        let lib = state.lib.lock().unwrap();
        let _ = lib.update(id, |r| {
            r.status = "error".into();
            r.err_stage = Some(stage.into());
            r.err_message = Some(message.into());
        });
    }
    emit(app, id, stage, "error", message);
}

fn fmt_elapsed(start: Instant) -> String {
    let s = start.elapsed().as_secs();
    format!("{:02}:{:02}", s / 60, s % 60)
}

/// 建临时热词表:失败先清扫本应用前缀的残表再试一次(大概率配额满,上限 10 表),
/// 仍失败返回 None 降级为无热词转写,不阻断管线
async fn create_vocab_with_cleanup(
    client: &reqwest::Client,
    host: &str,
    key: &str,
    terms: &[String],
) -> Option<String> {
    if terms.is_empty() {
        return None;
    }
    match vocab::create_vocabulary(client, host, key, terms).await {
        Ok(id) => Some(id),
        Err(_) => {
            if let Ok(ids) = vocab::list_podnote_vocabularies(client, host, key).await {
                for vid in ids {
                    let _ = vocab::delete_vocabulary(client, host, key, &vid).await;
                }
            }
            vocab::create_vocabulary(client, host, key, terms).await.ok()
        }
    }
}

async fn run_pipeline(app: AppHandle, id: String, force_note: bool) {
    let (client, meta_path, asr_path) = {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        (
            state.client.clone(),
            lib.root.join("meta").join(format!("{id}.json")),
            lib.asr_path(&id),
        )
    };
    let url = {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        match lib.get(&id) {
            Some(r) => r.url,
            None => return,
        }
    };
    let settings = {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        load_settings(&lib)
    };

    // --- KEY 自检:缺 key 直接指向设置页,不空跑(读内存缓存,零钥匙串访问) ---
    let keys = {
        let state = app.state::<AppState>();
        let keys = state.keys.lock().unwrap();
        keys.clone()
    };
    let (asr_key, llm_key) = (keys.asr, keys.llm);
    if llm_key.is_empty() {
        fail(&app, &id, "KEY", "还没配置 LLM API Key");
        return;
    }
    if settings.llm_base_url.is_empty() || settings.llm_model.is_empty() {
        fail(&app, &id, "KEY", "还没配置 LLM 网关地址或模型,请到设置页填写");
        return;
    }
    if asr_key.is_empty() && !asr_path.exists() {
        fail(&app, &id, "KEY", "还没配置百炼 API Key");
        return;
    }

    // --- RESOLVE(重新生成时用缓存的 meta) ---
    set_status(&app, &id, "resolving");
    emit(&app, &id, "RESOLVE", "processing", "");
    let meta: resolve::EpisodeMeta = if force_note && meta_path.exists() {
        match fs::read_to_string(&meta_path).ok().and_then(|s| serde_json::from_str(&s).ok()) {
            Some(m) => m,
            None => match resolve::resolve_episode(&client, &url).await {
                Ok(m) => m,
                Err(e) => return fail(&app, &id, "RESOLVE", &e.to_string()),
            },
        }
    } else {
        match resolve::resolve_episode(&client, &url).await {
            Ok(m) => m,
            Err(e) => return fail(&app, &id, "RESOLVE", &e.to_string()),
        }
    };
    let _ = ensure_dir(&meta_path);
    let _ = fs::write(&meta_path, serde_json::to_string(&meta).unwrap_or_default());
    {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        let _ = lib.update(&id, |r| {
            r.show = meta.podcast.clone();
            r.title = meta.title.clone();
            r.date = meta.pub_date.as_deref().map(short_date).unwrap_or_default();
            r.duration_sec = meta.duration.unwrap_or(0);
        });
    }
    emit(&app, &id, "RESOLVE", "ready", &meta.title);

    // LLM 配置提早构建:热词实体提取与 SUMMARIZE 共用
    let llm = summarize::LlmConfig {
        base_url: settings.llm_base_url.clone(),
        api_key: llm_key,
        model: settings.llm_model.clone(),
        protocol: crate::pipeline::llm::Protocol::from_id(&settings.llm_api),
    };

    // --- TRANSCRIBE(缓存命中即跳过) ---
    let asr_result: serde_json::Value = if asr_path.exists() {
        emit(&app, &id, "TRANSCRIBE", "ready", "缓存命中");
        match fs::read_to_string(&asr_path).ok().and_then(|s| serde_json::from_str(&s).ok()) {
            Some(v) => v,
            None => return fail(&app, &id, "TRANSCRIBE", "转写缓存损坏,请删除后重试"),
        }
    } else {
        set_status(&app, &id, "transcribing");
        // 热词:shownotes 实体(LLM 提取)+ 频道纠正词 → 临时词表;任何失败降级为无热词转写
        emit(&app, &id, "TRANSCRIBE", "processing", "准备热词");
        let terms = {
            let root = {
                let state = app.state::<AppState>();
                let lib = state.lib.lock().unwrap();
                lib.root.clone()
            };
            let entries = glossary::load(&root);
            let entities =
                vocab::extract_entities(&client, &llm, &meta.podcast, &meta.title, &meta.shownotes).await;
            vocab::build_terms(entities, &glossary::for_show(&entries, &meta.podcast))
        };
        let vocab_id = create_vocab_with_cleanup(&client, &settings.asr_host, &asr_key, &terms).await;

        let start = Instant::now();
        let app2 = app.clone();
        let id2 = id.clone();
        let progress = move |_st: &str, _extra: &str| {
            emit(&app2, &id2, "TRANSCRIBE", "processing", &fmt_elapsed(start));
        };
        emit(&app, &id, "TRANSCRIBE", "processing", "00:00");
        let outcome =
            asr::transcribe(&client, &settings.asr_host, &asr_key, &meta.audio_url, vocab_id.as_deref(), &progress)
                .await;
        // 临时词表转写完即删,成功失败都删(每账号配额只有 10 个)
        if let Some(vid) = vocab_id.as_deref() {
            let _ = vocab::delete_vocabulary(&client, &settings.asr_host, &asr_key, vid).await;
        }
        match outcome {
            Ok(v) => {
                let _ = fs::write(&asr_path, serde_json::to_string(&v).unwrap_or_default());
                emit(&app, &id, "TRANSCRIBE", "ready", &fmt_elapsed(start));
                v
            }
            Err(e) => return fail(&app, &id, "TRANSCRIBE", &e.to_string()),
        }
    };

    // --- SUMMARIZE ---
    set_status(&app, &id, "summarizing");
    emit(&app, &id, "SUMMARIZE", "processing", "");
    let timed = asr::to_timed_text(&asr_result);
    // 频道纠正词表注入 prompt:历史划词纠正过的词,笔记直出正词
    let glossary_text = {
        let state = app.state::<AppState>();
        let root = state.lib.lock().unwrap().root.clone();
        let entries = glossary::load(&root);
        glossary::render_for_prompt(&glossary::for_show(&entries, &meta.podcast))
    };
    let app3 = app.clone();
    let id3 = id.clone();
    let progress = move |chars: usize| {
        emit(&app3, &id3, "SUMMARIZE", "processing", &format!("{chars} 字"));
    };
    let parsed = match summarize::summarize(&client, &llm, &meta, &timed, &glossary_text, &progress).await {
        Ok(n) => n,
        Err(e) => {
            // 解析失败把原始输出落盘,便于调 prompt
            if let Some(raw) = note::raw_of(&e) {
                let state = app.state::<AppState>();
                let lib = state.lib.lock().unwrap();
                let _ = fs::write(lib.root.join("notes").join(format!("{id}.raw.txt")), raw);
            }
            return fail(&app, &id, "SUMMARIZE", &e.to_string());
        }
    };

    // 历史纠正兜底重放:glossary 已注入 prompt,LLM 若仍输出错词在此修正(幂等)
    let mut parsed = parsed;
    {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        for c in correct::load_corrections(&lib.corrections_path(&id)) {
            note::replace_term(&mut parsed, &c.original, &c.corrected);
        }
    }

    // --- 落盘双产物 + 可选导出 ---
    let note_json = serde_json::json!({
        "meta": {
            "url": meta.url, "podcast": meta.podcast, "title": meta.title,
            "durationSec": meta.duration, "pubDate": meta.pub_date,
        },
        "note": parsed,
    });
    let md = note::note_to_markdown(&meta, &parsed);
    {
        let state = app.state::<AppState>();
        let lib = state.lib.lock().unwrap();
        let _ = fs::write(lib.note_json_path(&id), serde_json::to_string_pretty(&note_json).unwrap_or_default());
        let _ = fs::write(lib.note_md_path(&id), &md);
        tts_invalidate(&lib, &id); // 笔记内容变了,旧朗读作废
        let _ = lib.update(&id, |r| r.status = "ready".into());
    }
    if let Some(dir) = settings.notes_dir.as_deref().filter(|d| !d.is_empty()) {
        let content = export::render(&meta, &parsed, settings.export_wikilinks);
        let res = {
            let state = app.state::<AppState>();
            let lib = state.lib.lock().unwrap();
            export::export_note(&lib, dir, &id, &meta, &content, false)
        };
        notify_export(&app, res);
    }
    emit(&app, &id, "READY", "ready", "");
}

// ===== 订阅:节目更新自动转写 =====
// 事件: "subscriptions-changed" — 订阅表或自动入库有变化,前端刷新库与订阅列表

fn sub_store(app: &AppHandle) -> SubStore {
    let state = app.state::<AppState>();
    let root = state.lib.lock().unwrap().root.clone();
    SubStore { root }
}

#[tauri::command]
pub fn get_subscriptions(state: State<AppState>) -> Vec<Subscription> {
    let root = state.lib.lock().unwrap().root.clone();
    SubStore { root }.list()
}

/// 接受节目页或单集页链接;单集链接先抓页面反查所属节目
#[tauri::command]
pub async fn add_subscription(app: AppHandle, url: String) -> Result<Subscription, String> {
    let client = app.state::<AppState>().client.clone();
    let pid = if let Some(pid) = resolve::podcast_pid_from_url(&url) {
        pid
    } else if episode_id(&url).is_some() && url.contains("/episode/") {
        let html = resolve::fetch_html(&client, &url).await.map_err(|e| e.to_string())?;
        resolve::podcast_pid_in_episode_html(&html)
            .ok_or("没从单集页解析出节目 pid——小宇宙页面结构可能变了")?
    } else {
        return Err("请粘贴小宇宙节目页或单集页链接".into());
    };
    let feed = resolve::resolve_podcast(&client, &pid).await.map_err(|e| e.to_string())?;
    // 基线 = 当前最新一集:订阅只管未来,不回灌旧集
    let last_pub = feed
        .episodes
        .iter()
        .map(|e| e.pub_date.clone())
        .max()
        .unwrap_or_default();
    let sub = Subscription { pid: feed.pid, title: feed.title, last_pub };
    sub_store(&app).upsert(sub.clone()).map_err(|e| e.to_string())?;
    let _ = app.emit("subscriptions-changed", ());
    Ok(sub)
}

#[tauri::command]
pub fn remove_subscription(app: AppHandle, pid: String) -> Result<(), String> {
    sub_store(&app).remove(&pid).map_err(|e| e.to_string())?;
    let _ = app.emit("subscriptions-changed", ());
    Ok(())
}

/// 手动"立即检查";返回新增单集数
#[tauri::command]
pub async fn check_subscriptions(app: AppHandle) -> Result<u32, String> {
    check_all_subscriptions(&app).await
}

async fn check_all_subscriptions(app: &AppHandle) -> Result<u32, String> {
    if app.state::<AppState>().checking_subs.swap(true, Ordering::SeqCst) {
        return Err("上一轮检查还在进行中".into());
    }
    let result = do_check_subscriptions(app).await;
    app.state::<AppState>().checking_subs.store(false, Ordering::SeqCst);
    result
}

async fn do_check_subscriptions(app: &AppHandle) -> Result<u32, String> {
    let client = app.state::<AppState>().client.clone();
    let store = sub_store(app);
    let mut added: u32 = 0;
    let mut errs: Vec<String> = Vec::new();
    for sub in store.list() {
        let feed = match resolve::resolve_podcast(&client, &sub.pid).await {
            Ok(f) => f,
            Err(e) => {
                errs.push(format!("{}: {}", sub.title, e));
                continue;
            }
        };
        let fresh = {
            let state = app.state::<AppState>();
            let lib = state.lib.lock().unwrap();
            pick_new(&feed.episodes, &sub.last_pub, |eid| lib.get(eid).is_some())
        };
        // 无论管线成败都推进基线:失败的单集在架上手动重试,不反复重发
        if let Some(max_pub) = feed.episodes.iter().map(|e| e.pub_date.as_str()).max() {
            if max_pub > sub.last_pub.as_str() {
                let _ = store.set_last_pub(&sub.pid, max_pub);
            }
        }
        for e in fresh {
            let rec = EpisodeRecord {
                id: e.eid.clone(),
                url: format!("https://www.xiaoyuzhoufm.com/episode/{}", e.eid),
                show: feed.title.clone(),
                title: e.title.clone(),
                date: short_date(&e.pub_date),
                duration_sec: e.duration.unwrap_or(0),
                status: "queued".into(),
                err_stage: None,
                err_message: None,
                read_at: None,
            };
            {
                let state = app.state::<AppState>();
                let lib = state.lib.lock().unwrap();
                if lib.upsert(rec).is_err() {
                    continue;
                }
            }
            let _ = app.emit("subscriptions-changed", ());
            // 串行跑管线:转写有并发上限,也避免多集同时占用带宽
            run_pipeline(app.clone(), e.eid.clone(), false).await;
            added += 1;
            let status = {
                let state = app.state::<AppState>();
                let lib = state.lib.lock().unwrap();
                lib.get(&e.eid).map(|r| r.status)
            };
            let body = match status.as_deref() {
                Some("ready") => format!("笔记已就绪:{}", e.title),
                _ => format!("处理失败,可在磁带架重试:{}", e.title),
            };
            let _ = app
                .notification()
                .builder()
                .title(format!("{} 更新了", feed.title))
                .body(body)
                .show();
        }
    }
    let _ = app.emit("subscriptions-changed", ());
    if added == 0 && !errs.is_empty() {
        return Err(errs.join("\n"));
    }
    Ok(added)
}

/// 订阅轮询:启动 15 秒后查一次,此后每 30 分钟一次;设置里可关
pub fn start_sub_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            let auto = {
                let state = app.state::<AppState>();
                let lib = state.lib.lock().unwrap();
                load_settings(&lib).sub_auto
            };
            if auto {
                let _ = check_all_subscriptions(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(30 * 60)).await;
        }
    });
}
