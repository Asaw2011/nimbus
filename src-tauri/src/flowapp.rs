// Nimbus as a CardMirror "flow app": a tiny loopback HTTP server + a queue of
// pending cards. Nimbus advertises itself in the shared `cardmirror-bridge`
// directory (nimbus.json + nimbus.session.json) exactly like CardMirror does, so
// the Nimbus CardMirror plugin can discover us (flowApps) and pull queued cards
// (flowPost → GET /pending), then paste them into the doc with full fidelity.
//
// Security mirrors CardMirror's bridge: bind 127.0.0.1 only, per-session random
// token (checked on content routes), reject requests carrying Origin/Referer,
// files 0600 / dir 0700.

use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// One queued card: the CardMirror-native HTML plus, optionally, the doc it is
/// addressed to — CardMirror's own doc **uid** (the `target` field of its
/// `GET /docs`), never a title.
///
/// Addressing matters because CardMirror runs ONE PLUGIN INSTANCE PER WINDOW and
/// every instance polls this queue. Without a target the first window to poll
/// wins and the card lands in whatever doc that happens to be — which is exactly
/// the "it goes to the wrong doc" problem in a round with several docs open.
///
/// ⚠ This matched on the window TITLE first, which silently failed for an
/// UNSAVED doc: `GET /docs` reports its title as "Untitled" while the window's
/// `document.title` carries no filename at all, so nothing ever matched and
/// every card sat here forever. The plugin now reports the uids of the docs in
/// its own window (`electronAPI.listDocs()` → entries with `isOwnWindow`), which
/// is exact and works before a doc has ever been saved.
#[derive(Clone)]
pub struct QueuedCard {
    /// Doc filename this card is for; `None` = deliver to whoever asks first.
    pub target: Option<String>,
    pub html: String,
}

/// Pending rich-HTML cards waiting for the plugin to pull them. Tauri-managed.
pub struct FlowQueue(pub Arc<Mutex<Vec<QueuedCard>>>);

fn bridge_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(app.path().data_dir().ok()?.join("cardmirror-bridge"))
}

fn gen_token() -> String {
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("getrandom failed");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Atomic-ish write with 0600 perms (best effort on non-unix).
fn write_secure(path: &PathBuf, contents: &str) {
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, contents).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    let _ = fs::rename(&tmp, path);
}

/// Path to our session file, so lib.rs can delete it on quit.
pub fn session_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(bridge_dir(app)?.join("nimbus.session.json"))
}

/// Remove the session file on quit — but ONLY if it still describes THIS
/// process.
///
/// ⚠ This used to delete unconditionally, which loses a race that actually
/// happens: quit Nimbus and start it again quickly (or let an installer restart
/// it) and the OLD process's exit handler runs *after* the new one has already
/// registered, deleting the LIVE session file. The server keeps listening and
/// `nimbus.json` stays put, so everything looks healthy — but CardMirror reads
/// the session file to learn the port and token, so the plugin can no longer
/// reach Nimbus and every send silently queues forever. Observed on 2026-08-12.
pub fn remove_session_if_ours(app: &tauri::AppHandle) {
    let Some(path) = session_file(app) else { return };
    let ours = fs::read_to_string(&path)
        .ok()
        .and_then(|txt| serde_json::from_str::<serde_json::Value>(&txt).ok())
        .and_then(|v| v.get("pid").and_then(|p| p.as_u64()))
        .map(|pid| pid == u64::from(std::process::id()))
        // An unreadable/corrupt file has no owner we can trust — clean it up.
        .unwrap_or(true);
    if ours {
        let _ = fs::remove_file(path);
    }
}

fn header<'a>(req: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

fn respond_json(req: tiny_http::Request, body: serde_json::Value) {
    let data = body.to_string();
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header");
    let _ = req.respond(tiny_http::Response::from_string(data).with_header(header));
}

/// Start the flow-app server and register Nimbus in the bridge directory.
/// Best-effort: any failure just means the plugin path is unavailable (sends
/// still work via the clipboard fallback).
pub fn start(app: tauri::AppHandle, queue: Arc<Mutex<Vec<QueuedCard>>>) {
    let server = match tiny_http::Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("nimbus flow server failed to bind: {e}");
            return;
        }
    };
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .unwrap_or(0);
    let token = gen_token();

    if let Some(dir) = bridge_dir(&app) {
        let _ = fs::create_dir_all(&dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        let version = app.package_info().version.to_string();
        write_secure(
            &dir.join("nimbus.json"),
            &json!({ "schema": 1, "app": "nimbus", "appVersion": version, "kind": "flow" })
                .to_string(),
        );
        write_secure(
            &dir.join("nimbus.session.json"),
            &json!({ "port": port, "token": token, "pid": std::process::id() }).to_string(),
        );
    }

    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            // DNS-rebinding guard: a real companion never sends these.
            if header(&req, "Origin").is_some() || header(&req, "Referer").is_some() {
                respond_json(req, json!({ "ok": false, "error": "forbidden" }));
                continue;
            }
            let url = req.url().to_string();
            let path = url.split('?').next().unwrap_or("").to_string();
            match path.as_str() {
                // Liveness/discovery — identity-free, content-free.
                "/ping" => respond_json(
                    req,
                    json!({ "ok": true, "app": "nimbus", "schema": 1 }),
                ),
                // Drain queued cards. Token-gated (content route).
                "/pending" => {
                    if header(&req, "X-Bridge-Token") != Some(token.as_str()) {
                        respond_json(req, json!({ "ok": false, "error": "unauthorized" }));
                        continue;
                    }
                    // The poller identifies its window by the uids of the docs it
                    // owns: { "uids": ["doc-1", ...] }. Exact ids, so this works for
                    // unsaved docs and for duplicate filenames alike.
                    let mut body = String::new();
                    let _ = req.as_reader().read_to_string(&mut body);
                    let uids: Vec<String> = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| {
                            v.get("uids").and_then(|u| u.as_array()).map(|a| {
                                a.iter()
                                    .filter_map(|x| x.as_str().map(str::to_owned))
                                    .collect()
                            })
                        })
                        .unwrap_or_default();

                    // Take only what this window should receive; leave everything
                    // else queued so a card addressed to a doc that isn't open yet
                    // waits instead of being delivered to the wrong window.
                    let cards: Vec<String> = {
                        let mut q = queue.lock().unwrap();
                        let mut mine = Vec::new();
                        let mut keep = Vec::new();
                        for c in q.drain(..) {
                            let wanted = match &c.target {
                                None => true,
                                Some(t) => uids.iter().any(|u| u == t),
                            };
                            if wanted { mine.push(c.html) } else { keep.push(c) }
                        }
                        *q = keep;
                        mine
                    };
                    respond_json(req, json!({ "ok": true, "cards": cards }));
                }
                _ => respond_json(req, json!({ "ok": false, "error": "not-found" })),
            }
        }
    });
}

/// Queue a rich-HTML card for the plugin to pull and paste into CardMirror.
/// `target` is the doc filename it should land in (normally CardMirror's
/// designated speech doc); `None` delivers to whichever window polls first.
#[tauri::command]
pub fn cm_queue_card(html: String, target: Option<String>, queue: tauri::State<FlowQueue>) {
    let mut q = queue.0.lock().unwrap();
    q.push(QueuedCard {
        target: target.filter(|t| !t.trim().is_empty()),
        html,
    });
    // Guard against an unbounded backlog if the plugin isn't running.
    if q.len() > 200 {
        let overflow = q.len() - 200;
        q.drain(0..overflow);
    }
}
