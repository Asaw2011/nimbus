// Full-fidelity "send to CardMirror": serialize flow ops into CardMirror's OWN
// rich clipboard HTML, so a plain ⌘V into CardMirror reconstructs the card WITH
// highlight / cite / body / structure — via its matching schema's parseDOM.
//
// This is the only lossless path to the real CardMirror: the bridge /insert is
// text+role and drops all formatting. We reuse the vendored CardMirror schema
// (src/lib/cardmirror/schema) and the docx→CM adapter, the same nodes the
// built-in speech doc renders, so what you paste matches what you flowed.

import { DOMSerializer, Fragment, type Node as PMNode } from "prosemirror-model";
import { schema } from "$lib/cardmirror/schema/index";
import { nodesFromDocNode } from "$lib/cardmirror/adapter";
import type { DocNode } from "$lib/docx/parse";

/** Same shape as FlowView's DocOp: a verbatim CardMirror node, or a text adapter. */
export type CmDocOp = { cm: unknown } | { node: DocNode };

/** Turn ops into top-level CardMirror ProseMirror nodes (bad ops are skipped). */
function opsToNodes(ops: CmDocOp[]): PMNode[] {
  const out: PMNode[] = [];
  for (const op of ops) {
    try {
      if ("cm" in op) {
        const n = schema.nodeFromJSON(op.cm);
        // A stored `doc` wrapper → take its block children; otherwise the node itself.
        if (n.type === schema.topNodeType) n.forEach((c) => out.push(c));
        else out.push(n);
      } else {
        out.push(...nodesFromDocNode(op.node));
      }
    } catch (e) {
      console.warn("cmClipboard: skipped an op", e);
    }
  }
  return out;
}

/** Serialize ops to CardMirror-native HTML (+ a plain-text fallback). */
export function opsToCmClipboard(ops: CmDocOp[]): { html: string; text: string } {
  const nodes = opsToNodes(ops);
  const frag = Fragment.fromArray(nodes);
  const serializer = DOMSerializer.fromSchema(schema);
  const container = document.createElement("div");
  container.appendChild(serializer.serializeFragment(frag));
  const text = nodes.map((n) => n.textContent).join("\n");
  return { html: container.innerHTML, text };
}

/** Put rich HTML (+ plain text) on the system clipboard. Async Clipboard API
 *  first (keeps both flavors); falls back to a hidden contenteditable + execCommand,
 *  which is the reliable path inside the Tauri/WKWebView. */
export async function copyHtml(html: string, text: string): Promise<boolean> {
  try {
    if (
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard &&
      "write" in navigator.clipboard
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.opacity = "0";
    el.innerHTML = html;
    document.body.appendChild(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand("copy");
    sel?.removeAllRanges();
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Serialize ops and copy them; returns whether the clipboard write succeeded. */
export async function copyOpsToClipboard(ops: CmDocOp[]): Promise<boolean> {
  const { html, text } = opsToCmClipboard(ops);
  if (!html) return false;
  return copyHtml(html, text);
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Queue the ops as rich HTML for the Nimbus CardMirror plugin to pull and paste
 *  (auto-insert). Also copies to the clipboard as a manual ⌘V fallback. Returns
 *  the serialized html (empty if nothing serialized). */
export async function sendOpsToCardMirror(ops: CmDocOp[]): Promise<string> {
  const { html, text } = opsToCmClipboard(ops);
  if (!html) return "";
  if (inTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("cm_queue_card", { html });
    } catch (e) {
      console.warn("cm_queue_card failed", e);
    }
  }
  // Manual fallback: the card is also on the clipboard for ⌘V.
  void copyHtml(html, text);
  return html;
}
