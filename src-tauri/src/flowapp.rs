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

/// Pending rich-HTML cards waiting for the plugin to pull them. Tauri-managed.
pub struct FlowQueue(pub Arc<Mutex<Vec<String>>>);

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
pub fn start(app: tauri::AppHandle, queue: Arc<Mutex<Vec<String>>>) {
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
                    // Consume the request body (flowPost sends one) before replying.
                    let mut sink = String::new();
                    let _ = req.as_reader().read_to_string(&mut sink);
                    let cards: Vec<String> = {
                        let mut q = queue.lock().unwrap();
                        std::mem::take(&mut *q)
                    };
                    respond_json(req, json!({ "ok": true, "cards": cards }));
                }
                _ => respond_json(req, json!({ "ok": false, "error": "not-found" })),
            }
        }
    });
}

/// Queue a rich-HTML card for the plugin to pull and paste into CardMirror.
#[tauri::command]
pub fn cm_queue_card(html: String, queue: tauri::State<FlowQueue>) {
    let mut q = queue.0.lock().unwrap();
    q.push(html);
    // Guard against an unbounded backlog if the plugin isn't running.
    if q.len() > 200 {
        let overflow = q.len() - 200;
        q.drain(0..overflow);
    }
}
