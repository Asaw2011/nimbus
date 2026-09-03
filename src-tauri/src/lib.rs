// Native persistence: rounds saved as JSON files in the app data dir.
// Filenames are the round id; contents are the full Round object.

mod cmbridge;
mod file_index;
mod flowapp;
use file_index::scan_library_roots;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Holds a `.nimbus` file the app was launched with (or asked to open) until
/// the frontend is ready to load it.
struct PendingFile(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Quit the whole app — reliable close that can't be blocked by the window's
/// close-request guard.
#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Windows/Linux pass the opened file as a CLI argument.
fn file_from_args() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".nimbus"))
}

/// Renaming the app changes its data dir. On first launch under a new
/// identifier, carry over rounds/config from a previous install so users never
/// "lose" their flows and settings across a rename.
fn migrate_old_data(app: &tauri::AppHandle) {
    let Ok(new_dir) = app.path().app_data_dir() else {
        return;
    };
    // If we already have data here, leave everything alone.
    if new_dir.join("rounds").exists() || new_dir.join("config").exists() {
        return;
    }
    let Some(parent) = new_dir.parent() else {
        return;
    };
    for old in ["com.avisawhney.debate-flow"] {
        let old_dir = parent.join(old);
        if old_dir.exists() && old_dir != new_dir {
            let _ = fs::create_dir_all(&new_dir);
            copy_dir(&old_dir, &new_dir);
            return;
        }
    }
}

fn copy_dir(from: &Path, to: &Path) {
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            let _ = fs::create_dir_all(&dst);
            copy_dir(&src, &dst);
        } else {
            let _ = fs::copy(&src, &dst);
        }
    }
}

fn rounds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("rounds");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn round_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    // Guard against path traversal in ids.
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid round id".into());
    }
    Ok(rounds_dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
fn save_round(app: tauri::AppHandle, id: String, json: String) -> Result<(), String> {
    let path = round_path(&app, &id)?;

    // Keep ONE previous generation alongside the round.
    //
    // The temp-file dance below protects against a crash MID-write, but nothing
    // protected against a *successful* write of bad content — and that is the
    // failure that actually cost a flow: opening a stale .nimbus mirrored its
    // old content over a fully flowed round, with no way back. A single rolling
    // backup makes that recoverable.
    //
    // Rotated at most every 10 minutes: autosave runs on a 400ms debounce plus a
    // 5s heartbeat, so copying megabytes on every flush would be real overhead
    // on the flowing path. `.json.bak` is ignored by list_rounds, which only
    // picks up files whose extension is exactly "json".
    let bak = path.with_extension("json.bak");
    if path.exists() {
        let due = fs::metadata(&bak)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .map(|age| age.as_secs() >= 600)
            .unwrap_or(true);
        if due {
            let _ = fs::copy(&path, &bak); // best effort; never block a save
        }
    }

    // Write via temp file + rename so a crash mid-save can't corrupt a round.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_round(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let path = round_path(&app, &id)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_round(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = round_path(&app, &id)?;
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Write text to any path the user chose in a save dialog (save-to-location).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

/// Read text from a user-chosen path (open a flow file).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Binary read/write for .xlsx flow files.
#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| e.to_string())
}

// ---- tournament folders (real directories of flow files) ------------------

#[derive(serde::Serialize)]
struct FlowFile {
    name: String,
    path: String,
    ext: String,
    modified: u64,
    /// Sub-folder inside the tournament this flow sits in ("" when it's directly
    /// in the tournament folder). Adam files rounds into per-round subfolders
    /// ("04---Divya and Grace vs me and Akash"), and a non-recursive listing
    /// simply could not see them — the flow then matched nothing on the
    /// dashboard and showed up under "not in a tournament" as a phantom copy.
    rel: String,
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

/// List the .nimbus/.xlsx flows inside a folder (newest first).
#[tauri::command]
fn list_flows(path: String) -> Result<Vec<FlowFile>, String> {
    let root = std::path::Path::new(&path).to_path_buf();
    let mut out = Vec::new();
    // Depth-limited so a tournament folder that happens to sit near a huge tree
    // can't turn the dashboard into a full-disk scan.
    collect_flows(&root, &root, 0, &mut out)?;
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

const FLOW_SCAN_MAX_DEPTH: usize = 4;

fn collect_flows(
    dir: &std::path::Path,
    root: &std::path::Path,
    depth: usize,
    out: &mut Vec<FlowFile>,
) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        // A subfolder we can't read (permissions, a Dropbox placeholder that
        // won't hydrate) must not abort the whole listing.
        Err(e) if depth > 0 => {
            eprintln!("list_flows: skipping {}: {}", dir.display(), e);
            return Ok(());
        }
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            // Skip dot-folders and the usual sync/system noise.
            if name.starts_with('.') || name.eq_ignore_ascii_case("node_modules") {
                continue;
            }
            if depth < FLOW_SCAN_MAX_DEPTH {
                collect_flows(&p, root, depth + 1, out)?;
            }
            continue;
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext == "nimbus" || ext == "xlsx" {
            let name = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let modified = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let rel = p
                .parent()
                .and_then(|d| d.strip_prefix(root).ok())
                .map(|r| r.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(FlowFile {
                name,
                path: p.to_string_lossy().to_string(),
                ext,
                modified,
                rel,
            });
        }
    }
    Ok(())
}

/// Move (or rename) a file — used to move a flow between tournament folders.
#[tauri::command]
fn move_path(from: String, to: String) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Whether a folder still exists (a linked tournament may have been deleted).
#[tauri::command]
fn dir_exists(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// Is there already a file at this exact path? Used to stop a rename from
/// silently writing over a DIFFERENT flow that happens to share the new name —
/// both rename paths write-then-delete, so a collision destroyed the other file
/// outright with no error.
#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

/// Returns the raw JSON of every saved round; the frontend derives metadata.
#[tauri::command]
fn list_rounds(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = rounds_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(contents) = fs::read_to_string(&path) {
                out.push(contents);
            }
        }
    }
    Ok(out)
}

// ---- config blobs (settings, macros, snippets, folders) -------------------
// Stored as JSON files so user customization survives webview storage wipes.

fn config_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid blob name".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
fn save_blob(app: tauri::AppHandle, name: String, json: String) -> Result<(), String> {
    let path = config_path(&app, &name)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_blob(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let path = config_path(&app, &name)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write an export bundle into the user's Downloads folder; returns the path.
#[tauri::command]
fn export_to_downloads(
    app: tauri::AppHandle,
    filename: String,
    json: String,
) -> Result<String, String> {
    if !filename
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || filename.contains("..")
    {
        return Err("invalid filename".into());
    }
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// WebView2 handles zoom gestures itself and never forwards them to the page.
// There are TWO separate switches for that, and only one of them covers pinch:
//
//   IsZoomControlEnabled — Ctrl + mouse wheel.
//   IsPinchZoomEnabled   — touchpad / touchscreen pinch ("page scale" zoom).
//
// We only turned off the first, which is why Ctrl+scroll reached our handler but
// a touchpad pinch never did. Both go off so the page owns every zoom gesture.
#[cfg(windows)]
fn disable_webview_zoom_control(win: &tauri::Webview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows::core::Interface;

    let _ = win.with_webview(|webview| unsafe {
        if let Ok(core) = webview.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetIsZoomControlEnabled(false);
                // IsPinchZoomEnabled lives on the Settings5 interface, so it has
                // to be queried for; older runtimes simply won't have it.
                if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
                    let _ = s5.SetIsPinchZoomEnabled(false);
                }
            }
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Remember a .nimbus file passed on the command line (Windows/Linux).
        .manage(PendingFile(Mutex::new(file_from_args())))
        // Runs for EVERY webview, including the pop-out speech-doc windows that
        // are created later from JS — those never got the zoom settings at all,
        // since setup() only ever saw the main window.
        .on_page_load(|_webview, _payload| {
            #[cfg(windows)]
            disable_webview_zoom_control(_webview);
        })
        .setup(|app| {
            migrate_old_data(app.handle());
            // Register Nimbus as a CardMirror "flow app": a queue plus a loopback
            // server the Nimbus CardMirror plugin pulls cards from. Best effort —
            // if the bind fails, sends simply fall back to the clipboard, and the
            // built-in speech doc is unaffected either way.
            let queue =
                std::sync::Arc::new(std::sync::Mutex::new(Vec::<flowapp::QueuedCard>::new()));
            app.manage(flowapp::FlowQueue(queue.clone()));
            flowapp::start(app.handle().clone(), queue);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_round,
            load_round,
            delete_round,
            list_rounds,
            save_blob,
            load_blob,
            export_to_downloads,
            write_text_file,
            read_text_file,
            write_binary_file,
            read_binary_file,
            take_pending_file,
            force_quit,
            create_dir,
            list_flows,
            move_path,
            delete_path,
            dir_exists,
            file_exists,
            scan_library_roots,
            cmbridge::cm_ping,
            cmbridge::cm_list_docs,
            cmbridge::cm_insert,
            cmbridge::cm_insert_html,
            cmbridge::cm_jump,
            flowapp::cm_queue_card
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // On quit, remove our bridge session file so CardMirror stops seeing
            // Nimbus as running. The identity file (nimbus.json) is left in place
            // by design — it advertises that Nimbus exists, not that it's up.
            if let tauri::RunEvent::Exit = _event {
                // Ownership-checked: a quick restart would otherwise have the
                // OLD process delete the NEW one's session file (see flowapp).
                flowapp::remove_session_if_ours(_app_handle);
            }
            // macOS delivers "open with" as an Opened event (app cold or warm).
            // The Opened variant doesn't exist on Windows/Linux, so gate it.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let p = path.to_string_lossy().to_string();
                        if let Some(state) = _app_handle.try_state::<PendingFile>() {
                            *state.0.lock().unwrap() = Some(p.clone());
                        }
                        // If the webview is already up, tell it to load now.
                        let _ = _app_handle.emit("open-file", p);
                    }
                }
            }
        });
}
