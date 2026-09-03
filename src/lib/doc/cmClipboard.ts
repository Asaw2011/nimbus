// Full-fidelity "send to CardMirror": serialize flow ops into CardMirror's OWN
// rich clipboard HTML, so a plain ⌘V into CardMirror reconstructs the card WITH
// highlight / cite / body / structure — via its matching schema's parseDOM.
//
// This same HTML is what we hand CardMirror's targeted /insert (>= 1.5.0), so
// the bridge path and a manual ⌘V reconstruct the identical card. The OLD
// /insert was text+role and dropped all formatting, which is why this file used
// to exist purely to feed a clipboard and a plugin; that is no longer true.
// We reuse the vendored CardMirror schema (src/lib/cardmirror/schema) and the
// docx→CM adapter, the same nodes the built-in speech doc renders, so what you
// paste matches what you flowed.

import { DOMSerializer, Fragment, type Node as PMNode } from "prosemirror-model";
import { schema } from "$lib/cardmirror/schema/index";
import { nodesFromDocNode } from "$lib/cardmirror/adapter";
import type { DocNode } from "$lib/docx/parse";
import { cardmirror, type CmInsertResp } from "$lib/doc/cardmirror.svelte";

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

/** Serialize ops to CardMirror-native HTML (+ a plain-text fallback).
 *
 * The wrapper's `data-pm-slice="0 0 []"` is ProseMirror's own clipboard
 * protocol, and it is what makes every send start on its own line.
 *
 * Without it the pasted slice comes back from the parser with `openStart: 1`,
 * which tells ProseMirror to MERGE the first pasted block into whatever
 * textblock the caret is sitting in. After a send the caret is left at the end
 * of the last card, so a second send with no Enter in between fused its first
 * header into the previous block — "Perm do both" + "AT: Warming DA" became one
 * analytic, header formatting and all. `openStart: 0` inserts the blocks whole.
 *
 * Measured against ProseMirror's real `parseFromClipboard` on this schema: end
 * of an analytic, end of a block, and a caret on an empty line all come out
 * correct, and — unlike prefixing an empty `<p>` — nothing leaves a stray blank
 * paragraph behind.
 */
export function opsToCmClipboard(ops: CmDocOp[]): { html: string; text: string } {
  const nodes = opsToNodes(ops);
  const frag = Fragment.fromArray(nodes);
  const serializer = DOMSerializer.fromSchema(schema);
  const container = document.createElement("div");
  container.setAttribute("data-pm-slice", "0 0 []");
  container.appendChild(serializer.serializeFragment(frag));
  const text = nodes.map((n) => n.textContent).join("\n");
  return { html: container.outerHTML, text };
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

/** What a send actually did, so the caller can say something true about it. */
export interface CmSendResult {
  /** The serialized clipboard HTML; `""` when nothing serialized. */
  html: string;
  /** CardMirror's answer, or `null` when no push was attempted (no target, or
   *  we're outside Tauri). `null` is not a failure — it means clipboard only. */
  resp: CmInsertResp | null;
}

/** Push the ops into CardMirror as rich HTML, and also leave them on the
 *  clipboard as a manual ⌘V fallback.
 *
 *  `target` is the CardMirror doc UID (the `target` field of its GET /docs),
 *  never a filename — a title is ambiguous across duplicates and undefined for a
 *  doc that has never been saved. It must come from a `refreshDocs()` in this
 *  same send: targets are session-scoped and do not survive a CardMirror restart.
 *
 *  ⚠ Was: queue the HTML locally and let the Nimbus CardMirror plugin poll for it
 *  and synthetic-paste it. CardMirror 1.5.0 added a targeted insert, so Nimbus
 *  now pushes directly — no poller, no plugin to install or whitelist, and the
 *  insert no longer lands at wherever the caret happens to be or steals focus.
 *  `cm_queue_card` and the flow-app queue still exist and still work; nothing
 *  calls them any more.
 *
 *  ⚠ Behaviour change: with CardMirror closed, a card used to sit in the queue
 *  and land whenever CardMirror next opened. A direct push has nobody to receive
 *  it, so the send fails to the clipboard instead. Deliberate — Adam chose it
 *  over a local retry queue, on the grounds that a card silently arriving
 *  minutes later mid-round is its own surprise. */
export async function sendOpsToCardMirror(
  ops: CmDocOp[],
  target?: string | null,
): Promise<CmSendResult> {
  const { html, text } = opsToCmClipboard(ops);
  if (!html) return { html: "", resp: null };
  // Clipboard first, and unconditionally: it is the fallback for every failure
  // below, so it must be primed before any of them can happen.
  void copyHtml(html, text);
  if (!inTauri() || !target) return { html, resp: null };
  const resp = await cardmirror.insertHtml(html, text, target);
  return { html, resp };
}
