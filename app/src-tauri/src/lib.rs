pub mod commands;
pub mod export;
pub mod library;
pub mod pipeline;
pub mod subscriptions;

use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let lib = library::Library::new(root)?;
            let keys = commands::keys_load(&lib); // 启动读一次,此后零钥匙串访问
            app.manage(commands::AppState {
                lib: Mutex::new(lib),
                client: reqwest::Client::new(),
                keys: Mutex::new(keys),
                checking_subs: AtomicBool::new(false),
                research_cancel: Mutex::new(std::collections::HashMap::new()),
                asking: Mutex::new(std::collections::HashMap::new()),
            });
            commands::start_sub_poller(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library,
            commands::get_note,
            commands::get_note_markdown,
            commands::get_transcript,
            commands::add_episode,
            commands::add_file_episode,
            commands::probe_media_file,
            commands::retry_episode,
            commands::regenerate_note,
            commands::regenerate_transcript,
            commands::delete_episode,
            commands::set_read,
            commands::reveal_note,
            commands::get_audio_path,
            commands::download_audio,
            commands::get_peaks,
            commands::save_peaks,
            commands::get_tts,
            commands::generate_tts,
            commands::get_settings,
            commands::set_settings,
            commands::set_keys,
            commands::test_asr_key,
            commands::test_llm,
            commands::test_tavily,
            commands::export_episode,
            commands::export_show,
            commands::ask_episode,
            commands::cancel_ask,
            commands::get_qa,
            commands::research_term,
            commands::apply_correction,
            commands::get_corrections,
            commands::research_blocks,
            commands::cancel_research,
            commands::get_subscriptions,
            commands::add_subscription,
            commands::remove_subscription,
            commands::check_subscriptions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
