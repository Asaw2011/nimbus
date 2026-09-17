// Recursive file walker for the Doc Search library.
// Called from the frontend whenever the user's library roots change or the
// app regains focus. No caching here — the frontend owns the cache.

use serde::Serialize;
use std::collections::HashSet;
use std::time::UNIX_EPOCH;
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
    /// True when the file is a cloud PLACEHOLDER whose contents are not on this
    /// disk — Dropbox Smart Sync / OneDrive Files On-Demand.
    ///
    /// ⚠ Reading one of these DOWNLOADS it. The name and size come from the
    /// placeholder for free, but opening the bytes blocks on the network and
    /// then keeps the file locally forever. A content index that reads every
    /// library file therefore quietly hydrates the entire folder: measured on a
    /// real library, one click on "By content" pulled down 219 MB across 1,076
    /// documents and took six minutes.
    ///
    /// Reported as a flag rather than acted on here, because the scan must stay
    /// a pure listing — the frontend decides what to do with it.
    #[serde(default)]
    pub offline: bool,
}

/// Whether a file's contents live somewhere other than this disk.
///
/// Windows marks cloud placeholders with attribute bits: `OFFLINE`,
/// `RECALL_ON_OPEN` (a full dehydration) and `RECALL_ON_DATA_ACCESS` (the
/// per-file "online only" state Dropbox and OneDrive use). Any of the three
/// means reading it costs a download.
#[cfg(windows)]
fn is_offline(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    let a = meta.file_attributes();
    a & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0
}

/// macOS and Linux expose no equivalent attribute, so nothing is skipped there
/// and behaviour is exactly what it was before this flag existed.
#[cfg(not(windows))]
fn is_offline(_meta: &std::fs::Metadata) -> bool {
    false
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
    // ⚠ The same file can be reached more than once, and the UI keys its result
    // lists on the path — a repeat is a duplicate key, which is a FATAL Svelte
    // render error, so Doc Search simply refuses to open. Two ways it happens:
    // overlapping library roots (adding a folder and something inside it walks
    // the inner tree twice, yielding byte-identical paths), and `follow_links`
    // below, which we need for Dropbox on macOS but which lets a symlink lead
    // back into a tree already being walked. Reported by a Mac user whose
    // roots overlapped; other people's did not, so it looked machine-specific.
    let mut seen: HashSet<String> = HashSet::new();

    'outer: for root in &roots {
        let walker = WalkDir::new(root)
            .max_depth(MAX_DEPTH)
            .follow_links(true) // Dropbox on macOS is a symlink — must follow it
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

            let path_str = path.to_string_lossy().to_string();
            // First sighting wins; a repeat is the same file reached twice.
            if !seen.insert(path_str.clone()) {
                continue;
            }

            files.push(LibFile {
                path: path_str,
                name,
                ext,
                mtime,
                size: meta.len(),
                offline: is_offline(&meta),
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
