// Native persistence: rounds saved as JSON files in the app data dir.
// Filenames are the round id; contents are the full Round object.

mod file_index;
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
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

/// List the .nimbus/.xlsx flows inside a folder (newest first).
#[tauri::command]
fn list_flows(path: String) -> Result<Vec<FlowFile>, String> {
    let mut out = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
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
            out.push(FlowFile {
                name,
                path: p.to_string_lossy().to_string(),
                ext,
                modified,
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
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
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Remember a .nimbus file passed on the command line (Windows/Linux).
        .manage(PendingFile(Mutex::new(file_from_args())))
        .setup(|app| {
            migrate_old_data(app.handle());
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
            scan_library_roots
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
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
