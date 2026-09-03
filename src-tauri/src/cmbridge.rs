// CardMirror bridge client — lets Nimbus send structured content into the real
// CardMirror Desktop over its local loopback HTTP bridge.
//
// Discovery: CardMirror writes `<data_dir>/cardmirror-bridge/cardmirror.session.json`
// with `{ port, token }` each session. We read that, then POST to
// 127.0.0.1:<port> with `X-Bridge-Token` + `X-App-Id: nimbus` headers. We must
// NOT send Origin/Referer (the bridge rejects those). Contract is documented in
// the CardMirror repo `reference-docs/cardmirror-plugin-api.md` and verified live
// against v0.1.0-beta.27. Everything CardMirror-contract-specific lives HERE so a
// bridge change is a one-file update.

use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// How CardMirror knows who is inserting (used for the per-app consent prompt).
const APP_ID: &str = "nimbus";

/// `<os data dir>/cardmirror-bridge` — sibling of our own app-data dir, shared by
/// CardMirror and every flow app. `data_dir()` is the OS base (…/Application
/// Support on macOS, %APPDATA% on Windows, $XDG_DATA_HOME on Linux).
fn bridge_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .data_dir()
        .map_err(|e| e.to_string())?
        .join("cardmirror-bridge"))
}

#[derive(Deserialize)]
struct CmSession {
    port: u16,
    token: String,
}

/// Read CardMirror's current session (port + token). A missing file means
/// CardMirror isn't running — surfaced to the UI as "not-running".
fn read_cm_session(app: &tauri::AppHandle) -> Result<CmSession, String> {
    let path = bridge_dir(app)?.join("cardmirror.session.json");
    let txt = fs::read_to_string(&path).map_err(|_| "not-running".to_string())?;
    serde_json::from_str(&txt).map_err(|e| e.to_string())
}

/// One authenticated request to CardMirror. App-level problems (unauthorized,
/// consent pending, bad-request) come back as HTTP 200 JSON `{ ok, error|pending }`;
/// we pass those through so the frontend can react. Transport failures are Err.
fn cm_request(
    session: &CmSession,
    method: &str,
    route: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("http://127.0.0.1:{}{}", session.port, route);
    let req = match method {
        "GET" => ureq::get(&url),
        "POST" => ureq::post(&url),
        _ => return Err("bad-method".into()),
    }
    .set("X-Bridge-Token", &session.token)
    .set("X-App-Id", APP_ID);

    let resp = match body {
        Some(b) => req.send_json(b),
        None => req.call(),
    };
    match resp {
        Ok(r) => r.into_json::<Value>().map_err(|e| e.to_string()),
        // The bridge returns non-2xx only for transport/auth-layer rejections;
        // keep the JSON body if there is one so the UI can show the reason.
        Err(ureq::Error::Status(code, r)) => Ok(r
            .into_json::<Value>()
            .unwrap_or_else(|_| json!({ "ok": false, "error": format!("http-{code}") }))),
        Err(e) => Err(e.to_string()),
    }
}

/// One insert instruction: a line of text and the CardMirror role it becomes
/// (tag | analytic | card | body | cite | inline | pocket | hat | block).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertItem {
    text: String,
    role: String,
    #[serde(default = "default_true")]
    new_paragraph: bool,
}
fn default_true() -> bool {
    true
}

/// Liveness + capability probe. `{ ok:true, appVersion, schema, hasActiveDoc }`.
#[tauri::command]
pub async fn cm_ping(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let s = read_cm_session(&app)?;
        cm_request(&s, "GET", "/ping", None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open documents, so the UI can pick a target (prefer the designated speech doc).
#[tauri::command]
pub async fn cm_list_docs(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let s = read_cm_session(&app)?;
        cm_request(&s, "GET", "/docs", None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Insert ONE card into `target` as CardMirror-native HTML — the targeted-insert
/// route added in CardMirror 1.5.0 (sections 4-5 of the plugin API reference,
/// which Truf has frozen). This is the route that makes the Nimbus plugin
/// unnecessary.
///
/// Why this and not `cm_insert` below: that one is text+role, one HTTP round trip
/// per line, and it drops highlight, cite and structure. The plugin existed to
/// work around exactly that, by pushing the same rich HTML through a synthetic
/// paste — which inserts at wherever the caret happens to be and steals focus.
/// A targeted insert lands in the named doc without taking focus and picks the
/// right pane in a multi-pane layout.
///
/// ⚠ `target` is REQUIRED and deliberately not `Option`. Probed against a live
/// CardMirror 1.6.0 on 2026-09-03: a body with NO `target` still inserts into
/// the focused document (`{ok:true, inserted:true}`) — the untargeted fallback
/// was NOT removed in 1.5.0, it is simply not what we use. That fallback is the
/// "card landed in the wrong doc" bug the uid addressing exists to kill, and an
/// `Option` here puts it one `None` away. Callers with no target must not send
/// at all; the clipboard fallback covers that case.
///
/// A target naming a doc that has since closed answers
/// `{ok:false, error:"target-not-found"}` — verified in the same probe. It does
/// NOT redirect to another document, so a stale target is safe: it fails loudly
/// rather than landing somewhere wrong.
///
/// ⚠ Targets are SESSION-SCOPED and do not survive a CardMirror restart. Always
/// pass one obtained from `cm_list_docs` in the same send, never a cached one.
///
/// `html` is the CardMirror clipboard HTML we already build for the queue;
/// `text` is the plain-text fallback older CardMirrors use.
#[tauri::command]
pub async fn cm_insert_html(
    app: tauri::AppHandle,
    target: String,
    html: String,
    text: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let s = read_cm_session(&app)?;
        cm_request(
            &s,
            "POST",
            "/insert",
            Some(json!({ "target": target, "html": html, "text": text })),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Insert a sequence of items into `target` (or the focused doc if `None`).
/// Stops early and returns the response if CardMirror asks for consent or errors,
/// so the caller can prompt the user exactly once.
///
/// ⚠ Superseded by `cm_insert_html` for card sends. Kept because it is the only
/// route that works against a pre-1.5.0 CardMirror.
#[tauri::command]
pub async fn cm_insert(
    app: tauri::AppHandle,
    items: Vec<InsertItem>,
    target: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let s = read_cm_session(&app)?;
        let mut last = json!({ "ok": true, "inserted": false });
        for it in &items {
            let mut body = json!({
                "text": it.text,
                "role": it.role,
                "newParagraph": it.new_paragraph,
            });
            if let Some(t) = &target {
                body["target"] = json!(t);
            }
            let r = cm_request(&s, "POST", "/insert", Some(body))?;
            let pending = r.get("pending").and_then(|p| p.as_str()) == Some("consent");
            let failed = r.get("ok").and_then(|b| b.as_bool()) == Some(false);
            if pending || failed {
                return Ok(r);
            }
            last = r;
        }
        Ok(last)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reverse-search: scroll CardMirror to the card an inserted/extracted item came
/// from. `source` is the opaque provenance token (starts `cmsrc1…`), stored
/// verbatim on the flow cell.
#[tauri::command]
pub async fn cm_jump(app: tauri::AppHandle, source: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let s = read_cm_session(&app)?;
        cm_request(&s, "POST", "/jump", Some(json!({ "source": source })))
    })
    .await
    .map_err(|e| e.to_string())?
}
