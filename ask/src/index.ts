// Nimbus "How do I…?" AI help - one Worker, one Durable Object.
//
// POST /v1/ask   Authorization: Bearer <Nimbus (Supabase) access token>
//   { "question": "…", "context": [{ "id": "send", "text": "…" }, …] }
// → 200 { "answer": "…", "ids": ["send", …] }
// → 429 { "fallback": "daily" | "user" }   out of today's free budget
// → 503 { "fallback": "off" | "ai" }       switched off / model unavailable
// → 401 { "error": "…" }                   not a signed-in Nimbus user
// GET /v1/health → { ok, mode }
//
// The app sends ONLY the question and excerpts of Nimbus's own help - never a
// flow, a file or prep. The model answers from those excerpts and nothing else.
//
// ⚠ COST: Adam's rule is that this costs NOTHING, ever. Cloudflare gives 10,000
// neurons per day per account free and bills the rest automatically on the paid
// plan, so the Budget object reserves a worst-case amount BEFORE every model
// call and refuses once the day's cap (DAILY_NEURON_CAP, 8,000) would be passed.
// The app then falls back to its own keyword search.

export interface Env {
  AI: Ai;
  BUDGET: DurableObjectNamespace<Budget>;
  ASK_MODE: string;
  DAILY_NEURON_CAP: string;
  PER_USER_DAILY: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  /** LOCAL TESTING ONLY (`wrangler dev --var DEV_FAKE_TOKENS:yes-local-only`):
   *  accepts `dev.<email>` tokens. Refused outright anywhere but localhost. */
  DEV_FAKE_TOKENS?: string;
}

const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
/** Workers AI pricing for MODEL (developers.cloudflare.com/workers-ai/platform/pricing,
 *  checked 2026-10-06): neurons per token. */
const NEURONS_PER_IN = 24545 / 1e6;
const NEURONS_PER_OUT = 77273 / 1e6;
const MAX_OUT_TOKENS = 400;
const MAX_QUESTION_CHARS = 400;
const MAX_CONTEXT_CHARS = 18_000;
/**
 * Reserved before each call, settled to the real figure after. It must cover
 * the WORST case, or the cap could be overshot: ~20k chars of prompt at a
 * pessimistic 3 chars/token ≈ 6,700 tokens in (≈165 neurons) + 400 out (≈31).
 */
const RESERVE = 220;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

const SYSTEM = `You are the help assistant inside Nimbus, a desktop app for flowing competitive debate rounds (Policy, LD, PF).
Answer the user's question about USING NIMBUS, using ONLY the help entries provided. Each entry starts with its [id].
Rules:
- If the entries don't cover it, say you're not sure and suggest the Manual. Never invent buttons, menus, settings or shortcuts, and never suggest a setting unless an entry says that setting does it.
- When something is going wrong, give the fix an entry describes, not generic advice.
- Quote shortcuts exactly as written in the entries.
- Never put entry ids or [brackets] in the answer text - ids go only in the "ids" list.
- Read the whole entry before answering: a parenthetical side note is not the main answer.
- Be brief: at most 4 short sentences, or a few numbered steps. Plain words, no markdown headings.
- You only help with the app. Never write debate arguments, blocks, cards, answers to opponents, or speeches - politely say that's not something you do.
Reply with JSON only, exactly: {"answer": "<your answer>", "ids": ["<id of each entry you used, most relevant first, at most 3>"]}`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (env.DEV_FAKE_TOKENS && !local) return json({ error: "misconfigured" }, 500);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/v1/health") {
      // Today's spend, so anyone can check the free cap is holding.
      const spent = await env.BUDGET.get(env.BUDGET.idFromName("global")).spentToday();
      return json({ ok: true, mode: env.ASK_MODE, neuronsToday: spent, cap: Number(env.DAILY_NEURON_CAP) });
    }
    if (url.pathname !== "/v1/ask" || req.method !== "POST") return json({ error: "not_found" }, 404);
    if (env.ASK_MODE !== "on") return json({ fallback: "off" }, 503);

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const who = await verifyToken(token, env, !!env.DEV_FAKE_TOKENS && local);
    if (!who.ok) return json({ error: who.code }, 401);

    let body: { question?: unknown; context?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad_json" }, 400);
    }
    const question = String(body.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) return json({ error: "no_question" }, 400);
    const context: Array<{ id: string; text: string }> = [];
    let used = 0;
    for (const c of Array.isArray(body.context) ? body.context : []) {
      const id = String((c as { id?: unknown }).id ?? "").slice(0, 40);
      const text = String((c as { text?: unknown }).text ?? "");
      if (!id || !text || used + text.length > MAX_CONTEXT_CHARS) continue;
      context.push({ id, text });
      used += text.length;
    }

    const budget = env.BUDGET.get(env.BUDGET.idFromName("global"));
    const cap = Math.min(Number(env.DAILY_NEURON_CAP) || 0, 9_000);
    const perUser = Number(env.PER_USER_DAILY) || 0;
    const r = await budget.reserve(who.sub, RESERVE, cap, perUser);
    if (!r.ok) return json({ fallback: r.why }, 429);

    const entries = context.map((c) => `[${c.id}] ${c.text}`).join("\n\n");
    let out: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      out = (await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `HELP ENTRIES:\n${entries}\n\nQUESTION: ${question}` },
        ],
        max_tokens: MAX_OUT_TOKENS,
        temperature: 0.2,
      })) as typeof out;
    } catch {
      // Nothing was generated; give the reservation back.
      await budget.settle(RESERVE, 0);
      return json({ fallback: "ai" }, 503);
    }
    // Settle to what it really cost. With no usage figures, keep the
    // (worst-case) reservation - erring high is the safe direction.
    const pin = out.usage?.prompt_tokens;
    const pout = out.usage?.completion_tokens;
    const actual =
      typeof pin === "number" && typeof pout === "number"
        ? Math.ceil(pin * NEURONS_PER_IN + pout * NEURONS_PER_OUT)
        : RESERVE;
    await budget.settle(RESERVE, actual);

    const parsed = parseReply(out.response, new Set(context.map((c) => c.id)));
    if (!parsed.answer) return json({ fallback: "ai" }, 503);
    return json(parsed);
  },
};

/** The model's JSON, leniently: tolerate code fences or stray text around it. */
function parseReply(raw: unknown, known: Set<string>): { answer: string; ids: string[] } {
  if (raw && typeof raw === "object") {
    const o = raw as { answer?: unknown; ids?: unknown };
    return clean(String(o.answer ?? ""), o.ids, known);
  }
  const s = String(raw ?? "");
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { answer?: unknown; ids?: unknown };
      return clean(String(o.answer ?? ""), o.ids, known);
    } catch {
      /* fall through */
    }
  }
  return clean(s, [], known);
}

function clean(answer: string, ids: unknown, known: Set<string>): { answer: string; ids: string[] } {
  const list = Array.isArray(ids) ? ids.map(String).filter((i) => known.has(i)).slice(0, 3) : [];
  // A leaked entry id ("see [lanes]") means nothing to a user - drop it.
  const text = answer
    .replace(/\s*(?:see\s+)?\[([a-z0-9-]+)\]/gi, (m, id: string) => (known.has(id) ? "" : m))
    .replace(/\s+([.,])/g, "$1")
    .trim();
  return { answer: text.slice(0, 1200), ids: [...new Set(list)] };
}

// ---- the budget -------------------------------------------------------------
//
// One object for the whole Worker, so every request sees one running total.
// A Durable Object handles one call at a time, so reserve-then-check can't race.
// Days are UTC, matching when Cloudflare resets the free allowance.

import { DurableObject } from "cloudflare:workers";

export class Budget extends DurableObject<Env> {
  async reserve(
    sub: string,
    amount: number,
    cap: number,
    perUser: number,
  ): Promise<{ ok: true } | { ok: false; why: "daily" | "user" }> {
    const day = new Date().toISOString().slice(0, 10);
    const s = this.ctx.storage;
    if ((await s.get<string>("day")) !== day) {
      await s.deleteAll();
      await s.put("day", day);
    }
    const spent = (await s.get<number>("spent")) ?? 0;
    if (spent + amount > cap) return { ok: false, why: "daily" };
    const key = `u:${sub}`;
    const mine = (await s.get<number>(key)) ?? 0;
    if (mine >= perUser) return { ok: false, why: "user" };
    await s.put("spent", spent + amount);
    await s.put(key, mine + 1);
    return { ok: true };
  }

  async spentToday(): Promise<number> {
    const s = this.ctx.storage;
    if ((await s.get<string>("day")) !== new Date().toISOString().slice(0, 10)) return 0;
    return (await s.get<number>("spent")) ?? 0;
  }

  /** Replace a reservation with the real cost (never below zero). */
  async settle(reserved: number, actual: number): Promise<void> {
    const s = this.ctx.storage;
    const spent = (await s.get<number>("spent")) ?? 0;
    await s.put("spent", Math.max(0, spent - reserved + actual));
  }
}

// ---- auth: verify a Supabase access token ----------------------------------
// Same check as the relay (relay/src/index.ts): the project's ES256 key is
// public, so tokens are verified locally; anything else is asked of Supabase.

type Verdict = { ok: true; sub: string; email: string } | { ok: false; code: string };

let jwks: { keys: Array<JsonWebKey & { kid?: string }>; at: number } | null = null;
let jwksFetchedAt = 0;
const cryptoKeys = new Map<string, CryptoKey>();
const JWKS_TTL_MS = 60 * 60_000;
const JWKS_MIN_REFETCH_MS = 30_000;
const LEEWAY_S = 60;

async function verifyToken(token: string, env: Env, devFake: boolean): Promise<Verdict> {
  if (devFake && token.startsWith("dev.")) {
    return { ok: true, sub: token, email: token.slice(4) };
  }
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, code: "no_token" };
  let header: { alg?: string; kid?: string };
  let claims: { sub?: string; email?: string; exp?: number; iss?: string; role?: string };
  try {
    header = JSON.parse(utf8(b64u(parts[0])));
    claims = JSON.parse(utf8(b64u(parts[1])));
  } catch {
    return { ok: false, code: "bad_token" };
  }
  const now = Date.now() / 1000;
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < now) return { ok: false, code: "expired" };
  if (claims.iss !== `${env.SUPABASE_URL}/auth/v1`) return { ok: false, code: "wrong_issuer" };
  if (claims.role !== "authenticated" || !claims.sub) return { ok: false, code: "not_signed_in" };

  if (header.alg === "ES256" && header.kid) {
    const key = await keyFor(header.kid, env);
    if (!key) return { ok: false, code: "unknown_key" };
    const good = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64u(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    return good ? { ok: true, sub: claims.sub, email: String(claims.email ?? "") } : { ok: false, code: "bad_signature" };
  }
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, code: "rejected_by_supabase" };
    const u = (await r.json()) as { id?: string; email?: string };
    return u.id ? { ok: true, sub: u.id, email: String(u.email ?? "") } : { ok: false, code: "rejected_by_supabase" };
  } catch {
    return { ok: false, code: "auth_unreachable" };
  }
}

async function keyFor(kid: string, env: Env): Promise<CryptoKey | null> {
  const cached = cryptoKeys.get(kid);
  if (cached && jwks && Date.now() - jwks.at < JWKS_TTL_MS) return cached;
  const stale = !jwks || Date.now() - jwks.at > JWKS_TTL_MS;
  const missing = !jwks?.keys.some((k) => k.kid === kid);
  if ((stale || missing) && Date.now() - jwksFetchedAt > JWKS_MIN_REFETCH_MS) {
    jwksFetchedAt = Date.now();
    try {
      const r = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
      if (r.ok) {
        const body = (await r.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
        jwks = { keys: body.keys ?? [], at: Date.now() };
        cryptoKeys.clear();
      }
    } catch {
      // Keep whatever we had.
    }
  }
  const jwk = jwks?.keys.find((k) => k.kid === kid);
  if (!jwk) return cached ?? null;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    cryptoKeys.set(kid, key);
    return key;
  } catch {
    return null;
  }
}

function b64u(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
