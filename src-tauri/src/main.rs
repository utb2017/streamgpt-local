#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod bridge;
mod controller;
mod lg;
mod mcp;
mod model;
mod network;
mod roku;
mod vault;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
type Shared = Arc<Mutex<controller::Controller>>;
#[tauri::command]
async fn controller(
    state: tauri::State<'_, Shared>,
    input: model::Input,
) -> Result<serde_json::Value, String> {
    state.lock().await.dispatch(input).await
}
fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    if std::env::args().any(|a| a == "--mcp") {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        if let Err(e) = rt.block_on(mcp::run()) {
            eprintln!("{e}");
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let vault = vault::Vault::open().map_err(std::io::Error::other)?;
            let controller = Arc::new(Mutex::new(
                controller::Controller::new(vault).map_err(std::io::Error::other)?,
            ));
            app.manage(controller.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bridge::start(controller).await {
                    eprintln!("{e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![controller])
        .run(tauri::generate_context!())
        .expect("Could not start StreamGPT Local");
}
