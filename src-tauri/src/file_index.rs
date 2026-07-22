// Recursive file walker for the Doc Search library.
// Called from the frontend whenever the user's library roots change or the
// app regains focus. No caching here — the frontend owns the cache.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct LibFile {
    pub path: String,
    /// File stem (no extension) — what's shown in search results.
    pub name: String,
    /// "docx" or "nimbus"
    pub ext: String,
    /// Milliseconds since Unix epoch (for sorting by recency).
    pub mtime: u64,
    pub size: u64,
}

/// Recursively walk every enabled root and return all .docx / .nimbus files,
/// sorted by mtime descending (most recent first).
///
/// Safety limits:
///   - Max depth 10 (prevents symlink loops)
///   - Max 50 000 files total (prevents runaway on enormous trees)
///   - Hidden directories (name starts with '.') are skipped
///   - Word lock files (~$*.docx) are skipped
///   - Permission errors per entry are silently skipped
#[tauri::command]
pub fn scan_library_roots(roots: Vec<String>) -> Vec<LibFile> {
    const MAX_DEPTH: usize = 10;
    const MAX_FILES: usize = 50_000;

    let mut files: Vec<LibFile> = Vec::new();

    'outer: for root in &roots {
        let walker = WalkDir::new(root)
            .max_depth(MAX_DEPTH)
            .follow_links(false) // don't follow symlinks to prevent loops
            .into_iter();

        for entry in walker.filter_entry(|e| {
            // Skip hidden directories (e.g. .git, .dropbox internals)
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                return !name.starts_with('.');
            }
            true
        }) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue, // permission denied or I/O error — skip
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let ext = match path.extension().and_then(|e| e.to_str()) {
                Some(e) => e.to_lowercase(),
                None => continue,
            };

            if ext != "docx" && ext != "nimbus" {
                continue;
            }

            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };

            // Skip Word lock files (~$filename.docx)
            if file_name.starts_with("~$") {
                continue;
            }

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            files.push(LibFile {
                path: path.to_string_lossy().to_string(),
                name,
                ext,
                mtime,
                size: meta.len(),
            });

            if files.len() >= MAX_FILES {
                eprintln!(
                    "[nimbus] file index hit {MAX_FILES} file cap — some files in {root} were not indexed"
                );
                break 'outer;
            }
        }
    }

    // Sort most-recently-modified first
    files.sort_unstable_by(|a, b| b.mtime.cmp(&a.mtime));
    files
}
