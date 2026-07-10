pub mod commands;
pub mod library;
pub mod pipeline;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let lib = library::Library::new(root)?;
            let keys = commands::keys_load(&lib); // 启动读一次,此后零钥匙串访问
            app.manage(commands::AppState {
                lib: Mutex::new(lib),
                client: reqwest::Client::new(),
                keys: Mutex::new(keys),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library,
            commands::get_note,
            commands::get_note_markdown,
            commands::add_episode,
            commands::retry_episode,
            commands::regenerate_note,
            commands::delete_episode,
            commands::reveal_note,
            commands::get_audio_path,
            commands::download_audio,
            commands::get_settings,
            commands::set_settings,
            commands::set_keys,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
