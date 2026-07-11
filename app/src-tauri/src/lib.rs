pub mod commands;
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
            commands::get_subscriptions,
            commands::add_subscription,
            commands::remove_subscription,
            commands::check_subscriptions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
