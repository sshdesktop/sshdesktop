use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use crate::AppState;

static SHUTDOWN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Returns true if the application has initiated shutdown
pub fn is_shutting_down() -> bool {
    SHUTDOWN_IN_PROGRESS.load(Ordering::SeqCst)
}

/// Centralized application shutdown manager:
/// 1. Idempotently sets the shutdown flag
/// 2. Gracefully drains and disconnects all active SSH sessions with a bounded timeout
/// 3. Clears connection and terminal registries
/// 4. Closes all auxiliary WebViews (e.g. browser windows)
/// 5. Closes the main window and exits the Tauri event loop cleanly
/// 6. Safeguards against hanging WebKitGTK / X11 surfaces on Linux via a bounded process exit
#[tauri::command]
pub async fn app_request_shutdown(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if SHUTDOWN_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        log::info!("SSH Desktop: Shutdown already in progress, ignoring duplicate call.");
        return Ok(());
    }

    log::info!("SSH Desktop: Initiating graceful application shutdown.");

    // 1. Drain and terminate active SSH sessions
    let sessions_drained = {
        let mut lock = state.sessions.lock().await;
        let drained: Vec<(String, Arc<crate::ssh::session::ClientHandle>)> = lock.drain().collect();
        drained
    };

    for (conn_id, handle) in sessions_drained {
        log::info!("SSH Desktop: Disconnecting SSH session '{}'", conn_id);
        tokio::spawn(async move {
            let _ = tokio::time::timeout(
                Duration::from_millis(1500),
                handle.disconnect(russh::Disconnect::ByApplication, "Application Quit", "en"),
            ).await;
        });
    }

    // 2. Clear state registries
    {
        let mut conns = state.connections.lock();
        conns.clear();
    }
    {
        let mut terms = state.terminals.lock();
        terms.clear();
    }

    // 3. Close auxiliary webview windows first (e.g. browser tabs)
    for (label, win) in app.webview_windows() {
        if label != "main" {
            let _ = win.close();
        }
    }

    // 4. Close main window and exit application
    let app_clone = app.clone();
    tokio::spawn(async move {
        // Brief pause to allow pending IPC messages to flush
        tokio::time::sleep(Duration::from_millis(100)).await;

        if let Some(main_win) = app_clone.get_webview_window("main") {
            let _ = main_win.close();
        }

        // Trigger Tauri application exit
        app_clone.exit(0);

        // Fallback safety guard for Linux WebKitGTK: force terminate process after 1.5s
        tokio::time::sleep(Duration::from_millis(1500)).await;
        std::process::exit(0);
    });

    Ok(())
}
