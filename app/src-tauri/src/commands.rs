// commands — Tauri 命令层 + 管线运行器 + 事件
// 事件: "pipeline-progress" { id, stage, status, detail } — AddFlow 五灯与磁带架同源消费
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library::{ensure_dir, episode_id, short_date, EpisodeRecord, Library};
use crate::pipeline::{asr, note, resolve, summarize};

pub struct AppState {
    pub lib: Mutex<Library>,
    pub client: reqwest::Client,
    /// (asr_key, llm_key) 内存缓存:启动时读一次,运行期零钥匙串访问
    /// (钥匙串弹窗会阻塞主线程;dev 构建每次重编译签名变化还会反复弹窗)
    pub keys: Mutex<(String, String)>,
}

// ===== 设置(非敏感项存 settings.json;key 存 macOS 钥匙串) =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub asr_host: String,
    pub llm_base_url: String,
    pub llm_model: String,
    /// 额外导出目录(如个人笔记库);None 则只写 app 数据目录
    pub notes_dir: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            asr_host: asr::DEFAULT_HOST.into(),
            llm_base_url: "https://api.codexzh.com/v1".into(),
            llm_model: "grok-4.5".into(),
            notes_dir: None,
        }
    }
}

#[cfg(not(debug_assertions))]
const KEYCHAIN_SERVICE: &str = "Podnote";
#[cfg(not(debug_assertions))]
const KEY_ASR: &str = "bailian-api-key";
#[cfg(not(debug_assertions))]
const KEY_LLM: &str = "llm-api-key";

#[cfg(not(debug_assertions))]
fn keychain_get(user: &str) -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, user)
        .ok()?
        .get_password()
        .ok()
        .filter(|s| !s.is_empty())
}
#[cfg(not(debug_assertions))]
fn keychain_set(user: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, user).map_err(|e| e.to_string())?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        Ok(())
    } else {
        entry.set_password(value).map_err(|e| e.to_string())
    }
}

/// 启动时读一次密钥。release 走钥匙串;debug 走数据目录 keys.json
/// (dev 二进制每次重编译签名都变,钥匙串会每次弹授权框,开发体验不可用)
pub fn keys_load(lib: &Library) -> (String, String) {
    #[cfg(debug_assertions)]
    {
        let v: Option<serde_json::Value> = fs::read_to_string(lib.root.join("keys.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        let get = |k: &str| {
            v.as_ref()
                .and_then(|v| v.get(k).and_then(|x| x.as_str()))
                .unwrap_or("")
                .to_string()
        };
        (get("asrKey"), get("llmKey"))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = lib;
        (
            keychain_get(KEY_ASR).unwrap_or_default(),
            keychain_get(KEY_LLM).unwrap_or_default(),
        )
    }
}

fn keys_save(lib: &Library, asr: &str, llm: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        fs::write(
            lib.root.join("keys.json"),
            serde_json::to_string_pretty(&serde_json::json!({ "asrKey": asr, "llmKey": llm }))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = lib;
        keychain_set(KEY_ASR, asr)?;
        keychain_set(KEY_LLM, llm)
    }
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
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> SettingsView {
    let lib = state.lib.lock().unwrap();
    let keys = state.keys.lock().unwrap();
    SettingsView {
        settings: load_settings(&lib),
        asr_key_set: !keys.0.is_empty(),
        llm_key_set: !keys.1.is_empty(),
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
) -> Result<(), String> {
    let (asr, llm) = {
        let mut keys = state.keys.lock().unwrap();
        if let Some(k) = asr_key {
            keys.0 = k;
        }
        if let Some(k) = llm_key {
            keys.1 = k;
        }
        keys.clone()
    };
    let lib = state.lib.lock().unwrap();
    keys_save(&lib, &asr, &llm)
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
    state.lib.lock().unwrap().remove(&id).map_err(|e| e.to_string())
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

/// 重新生成笔记:复用转写缓存,只重跑 LLM(调 prompt 的高频动作)
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
    let (asr_key, llm_key) = {
        let state = app.state::<AppState>();
        let keys = state.keys.lock().unwrap();
        keys.clone()
    };
    if llm_key.is_empty() {
        fail(&app, &id, "KEY", "还没配置 LLM API Key");
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

    // --- TRANSCRIBE(缓存命中即跳过) ---
    let asr_result: serde_json::Value = if asr_path.exists() {
        emit(&app, &id, "TRANSCRIBE", "ready", "缓存命中");
        match fs::read_to_string(&asr_path).ok().and_then(|s| serde_json::from_str(&s).ok()) {
            Some(v) => v,
            None => return fail(&app, &id, "TRANSCRIBE", "转写缓存损坏,请删除后重试"),
        }
    } else {
        set_status(&app, &id, "transcribing");
        let start = Instant::now();
        let app2 = app.clone();
        let id2 = id.clone();
        let progress = move |_st: &str, _extra: &str| {
            emit(&app2, &id2, "TRANSCRIBE", "processing", &fmt_elapsed(start));
        };
        emit(&app, &id, "TRANSCRIBE", "processing", "00:00");
        match asr::transcribe(&client, &settings.asr_host, &asr_key, &meta.audio_url, &progress).await {
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
    let llm = summarize::LlmConfig {
        base_url: settings.llm_base_url.clone(),
        api_key: llm_key,
        model: settings.llm_model.clone(),
    };
    let timed = asr::to_timed_text(&asr_result);
    let app3 = app.clone();
    let id3 = id.clone();
    let progress = move |chars: usize| {
        emit(&app3, &id3, "SUMMARIZE", "processing", &format!("{chars} 字"));
    };
    let parsed = match summarize::summarize(&client, &llm, &meta, &timed, &progress).await {
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
        let _ = lib.update(&id, |r| r.status = "ready".into());
    }
    if let Some(dir) = settings.notes_dir.as_deref().filter(|d| !d.is_empty()) {
        let base = std::path::Path::new(dir);
        if fs::create_dir_all(base).is_ok() {
            let _ = fs::write(base.join(format!("{}.md", meta.title.replace('/', "-"))), &md);
        }
    }
    emit(&app, &id, "READY", "ready", "");
}
