// Extract bankable arguments (cards + analytics) from a CardMirror speech-doc
// JSON, so uploading a .docx into the speech doc populates the argument bank
// (⌘J lookup + the Bank manager) — not just the flow.

import type { ArgRef } from "$lib/model/types";
import { normalizeAuthor } from "$lib/docx/parse";

interface CMNode {
  type?: string;
  text?: string;
  content?: CMNode[];
}

/** Concatenate all descendant text of an inline-bearing node. */
function inlineText(node: CMNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(inlineText).join("");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Walk a CardMirror doc JSON and collect one ArgRef per card / analytic.
 * - `card`   → its `tag` text (+ author derived from the `cite_paragraph`).
 * - `analytic` → its text, flagged analytic (no author).
 */
export function collectArgsFromCM(doc: unknown): ArgRef[] {
  const out: ArgRef[] = [];
  const walk = (n: CMNode) => {
    if (n.type === "card") {
      const kids = n.content ?? [];
      const tag = clean(inlineText(kids.find((c) => c.type === "tag")));
      const cite = clean(inlineText(kids.find((c) => c.type === "cite_paragraph")));
      const author = normalizeAuthor(cite);
      if (tag) out.push({ tag, author: author || undefined, cite: cite || undefined });
      return; // captured; cards don't nest
    }
    if (n.type === "analytic") {
      const tag = clean(inlineText(n));
      if (tag) out.push({ tag, analytic: true });
      return;
    }
    (n.content ?? []).forEach(walk);
  };
  const root = doc as CMNode | null;
  (root?.content ?? []).forEach(walk);
  return out;
}
