// AI answers for "How do I…?" - a thin client for the `nimbus-ask` Worker
// (ask/ in this repo). Optional in every way: no internet, out of today's free
// budget, switched off - all of it just means the keyword search keeps working.
//
// Sends ONLY the question and Nimbus's own help text. Never a flow, a file or
// prep: that is the privacy promise, and it is why `helpContext` is built from
// HOWTOS and nothing else.

import { auth } from "../model/auth.svelte";
import { ACTION_LABELS, combosLabel, type Combo } from "../model/keymap";
import type { ActionId } from "../model/keymap";
import { HOWTOS } from "./howdoi";

const ASK_URL = "https://ask.nimbusdebate.com";
/** Tester override (localStorage), e.g. http://localhost:8788 for wrangler dev. */
const ASK_URL_KEY = "nimbus.askUrl";

function askUrl(): string {
  try {
    const o = globalThis.localStorage?.getItem(ASK_URL_KEY);
    if (o) return o;
  } catch {
    // No storage - the default stands.
  }
  return ASK_URL;
}

export type AskResult =
  | { ok: true; answer: string; ids: string[] }
  | { ok: false; why: "daily" | "user" | "off" | "offline" | "signin" | "error" };

/**
 * Every help entry as compact text, with the user's OWN shortcuts filled in,
 * so the model quotes the keys this person actually presses.
 */
export function helpContext(km: Record<ActionId, Combo[]>, mac: boolean): Array<{ id: string; text: string }> {
  return HOWTOS.map((h) => {
    const keys = (h.keys ?? []).map((a) => `${ACTION_LABELS[a]}: ${combosLabel(km[a], mac)}`);
    if (h.fixedKey) keys.push(h.fixedKey);
    const parts = [`${h.title}. ${h.body}`];
    if (h.steps?.length) parts.push(`Steps: ${h.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`);
    if (keys.length) parts.push(`Keys: ${keys.join("; ")}`);
    return { id: h.id, text: parts.join(" ") };
  });
}

export async function askAi(
  question: string,
  context: Array<{ id: string; text: string }>,
): Promise<AskResult> {
  const token = await auth.freshAccessToken().catch(() => "");
  if (!token) return { ok: false, why: "signin" };
  let r: Response;
  try {
    r = await fetch(`${askUrl()}/v1/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ question, context }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, why: "offline" };
  }
  let body: { answer?: string; ids?: string[]; fallback?: string } = {};
  try {
    body = await r.json();
  } catch {
    // fall through to the status checks
  }
  if (r.ok && body.answer) return { ok: true, answer: body.answer, ids: body.ids ?? [] };
  if (r.status === 401) return { ok: false, why: "signin" };
  if (body.fallback === "daily" || body.fallback === "user" || body.fallback === "off") {
    return { ok: false, why: body.fallback };
  }
  return { ok: false, why: "error" };
}
