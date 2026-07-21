// Native persistence: rounds saved as JSON files in the app data dir.
// Filenames are the round id; contents are the full Round object.

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
            take_pending_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS delivers "open with" as an Opened event (app cold or warm).
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let p = path.to_string_lossy().to_string();
                        if let Some(state) = app_handle.try_state::<PendingFile>() {
                            *state.0.lock().unwrap() = Some(p.clone());
                        }
                        // If the webview is already up, tell it to load now.
                        let _ = app_handle.emit("open-file", p);
                    }
                }
            }
        });
}
