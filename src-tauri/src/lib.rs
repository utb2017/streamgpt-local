#[cfg(desktop)]
mod bridge;
mod cloud;
mod controller;
mod lg;
#[cfg(desktop)]
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
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    #[cfg(desktop)]
    if std::env::args().any(|a| a == "--mcp") {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        if let Err(e) = rt.block_on(mcp::run()) {
            eprintln!("{e}");
        }
        return;
    }
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    builder
        .setup(|app| {
            let vault = vault::Vault::open().map_err(std::io::Error::other)?;
            let controller = Arc::new(Mutex::new(
                controller::Controller::new(vault).map_err(std::io::Error::other)?,
            ));
            app.manage(controller.clone());
            let cloud = cloud::Cloud::new(controller.clone()).map_err(std::io::Error::other)?;
            app.manage(cloud.clone());
            tauri::async_runtime::spawn(cloud.run());
            #[cfg(desktop)]
            install_tray(app)?;
            #[cfg(desktop)]
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bridge::start(controller).await {
                    eprintln!("{e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![controller, cloud_command])
        .run(tauri::generate_context!())
        .expect("Could not start StreamGPT Local");
}

#[tauri::command]
async fn cloud_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<cloud::Cloud>>,
    input: cloud::CloudInput,
) -> Result<serde_json::Value, String> {
    state.command(app, input).await
}
#[cfg(desktop)]
fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let open = MenuItem::with_id(app, "open", "Open StreamGPT", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit (disconnect helper)", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("StreamGPT home helper")
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" {
                app.exit(0);
            }
            if event.id.as_ref() == "open" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    if let Some(window) = app.get_webview_window("main") {
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = handle.hide();
                api.prevent_close();
            }
        });
    }
    Ok(())
}
