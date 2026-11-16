// Nimbus anonymous usage stats - one Worker, one D1 database.
//
// POST /v1/batch  { id, v, os, tallies: [{ day, e, p, n }] }   (no auth: anonymous)
//   → 200 { ok, kept }      every tally re-checked against events.ts; off-list = dropped
//   → 429 { full: true }     today's write cap reached (the app keeps its counts)
//   → 503 { off: true }      switched off
// GET /v1/health → { ok, mode, writesToday, cap }
// GET /dash      → Adam's dashboard page (asks for the key, holds it in the tab)
// GET /v1/stats  Authorization: Bearer <DASH_KEY> → the dashboard's numbers
//
// ⛔ Nothing but fixed event words + counts is ever stored: cleanBatch() keeps
// only what events.ts lists. The request's IP is never written anywhere.

import { cleanBatch, MAX_TALLIES } from "../../src/lib/telemetry/events";
import { DASH_HTML } from "./dash";

export interface Env {
  DB: D1Database;
  STATS_MODE: string;
  DAILY_WRITE_CAP: string;
  /** Set by Adam with `wrangler secret put DASH_KEY`. Unset = dashboard locked. */
  DASH_KEY?: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MAX_BODY = 64 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/v1/health") {
        const row = await env.DB.prepare("SELECT writes FROM daily WHERE day = ?").bind(dayOf(Date.now())).first<{ writes: number }>();
        return json({ ok: true, mode: env.STATS_MODE, writesToday: row?.writes ?? 0, cap: Number(env.DAILY_WRITE_CAP) });
      }
      if (url.pathname === "/v1/batch" && req.method === "POST") return await batch(req, env);
      if (url.pathname === "/dash" && req.method === "GET") {
        return new Response(DASH_HTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-robots-tag": "noindex",
            "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
          },
        });
      }
      if (url.pathname === "/v1/stats" && req.method === "GET") return await stats(req, env);
    } catch {
      return json({ error: "server" }, 500);
    }
    return json({ error: "not_found" }, 404);
  },

  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const cutoff = dayOf(Date.now() - 400 * 864e5);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tallies WHERE day < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM daily WHERE day < ?").bind(cutoff),
    ]);
  },
};

async function batch(req: Request, env: Env): Promise<Response> {
  if (env.STATS_MODE !== "on") return json({ off: true }, 503);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_big" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const b = cleanBatch(raw);
  if (!b) return json({ error: "bad_batch" }, 400);
  // Only the last 31 days, never the future (a wrong clock can be a day ahead).
  const now = Date.now();
  const lo = dayOf(now - 31 * 864e5);
  const hi = dayOf(now + 864e5);
  const tallies = b.tallies.filter((t) => t.day >= lo && t.day <= hi).slice(0, MAX_TALLIES);
  if (!tallies.length) return json({ ok: true, kept: 0 });

  const today = dayOf(now);
  const cap = Number(env.DAILY_WRITE_CAP) || 0;
  // Reserve the writes first; refuse if that would pass today's cap.
  const used = await env.DB.prepare(
    "INSERT INTO daily (day, writes) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET writes = writes + ?2 RETURNING writes",
  )
    .bind(today, tallies.length)
    .first<{ writes: number }>();
  if (!used || used.writes > cap) return json({ full: true }, 429);

  const up = env.DB.prepare(
    `INSERT INTO tallies (day, install, ver, os, ev, props, n) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, install, ev, props) DO UPDATE SET n = MIN(n + excluded.n, 1000000), ver = excluded.ver, os = excluded.os`,
  );
  await env.DB.batch(tallies.map((t) => up.bind(t.day, b.id, b.v, b.os, t.e, JSON.stringify(t.p), t.n)));
  return json({ ok: true, kept: tallies.length });
}

/** Constant-time-ish compare, so the key can't be guessed byte by byte. */
function sameKey(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function stats(req: Request, env: Env): Promise<Response> {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.DASH_KEY) return json({ error: "no_key_set" }, 503);
  if (!sameKey(key, env.DASH_KEY)) return json({ error: "wrong_key" }, 401);
  const now = Date.now();
  const d = (n: number) => dayOf(now - n * 864e5);
  const db = env.DB;
  const [daily, fresh, active, versions, oses, events, retention] = await db.batch([
    db.prepare(
      `SELECT day, COUNT(DISTINCT install) AS users,
              SUM(CASE WHEN ev = 'flow_open' THEN n ELSE 0 END) AS flows
       FROM tallies WHERE day >= ? GROUP BY day ORDER BY day`,
    ).bind(d(29)),
    db.prepare(
      `SELECT first AS day, COUNT(*) AS installs FROM
         (SELECT install, MIN(day) AS first FROM tallies GROUP BY install)
       WHERE first >= ? GROUP BY first ORDER BY first`,
    ).bind(d(29)),
    db.prepare(
      `SELECT
         (SELECT COUNT(DISTINCT install) FROM tallies WHERE day >= ?1) AS dau,
         (SELECT COUNT(DISTINCT install) FROM tallies WHERE day >= ?2) AS wau,
         (SELECT COUNT(DISTINCT install) FROM tallies WHERE day >= ?3) AS mau,
         (SELECT COUNT(DISTINCT install) FROM tallies) AS ever`,
    ).bind(d(0), d(6), d(29)),
    db.prepare(
      `SELECT ver AS k, COUNT(DISTINCT install) AS users FROM tallies WHERE day >= ? GROUP BY ver ORDER BY users DESC`,
    ).bind(d(6)),
    db.prepare(
      `SELECT os AS k, COUNT(DISTINCT install) AS users FROM tallies WHERE day >= ? GROUP BY os ORDER BY users DESC`,
    ).bind(d(29)),
    db.prepare(
      `SELECT ev, props, SUM(n) AS uses, COUNT(DISTINCT install) AS users
       FROM tallies WHERE day >= ? AND ev <> 'app_open' GROUP BY ev, props ORDER BY ev, uses DESC`,
    ).bind(d(29)),
    // Week-1 retention: installs first seen 8-14 days ago, and how many of
    // them were back in the last 7 days.
    db.prepare(
      `WITH c AS (SELECT install FROM tallies GROUP BY install HAVING MIN(day) BETWEEN ?1 AND ?2)
       SELECT (SELECT COUNT(*) FROM c) AS cohort,
              (SELECT COUNT(DISTINCT t.install) FROM tallies t JOIN c ON c.install = t.install WHERE t.day >= ?3) AS back`,
    ).bind(d(14), d(8), d(6)),
  ]);
  return json({
    daily: daily.results,
    fresh: fresh.results,
    active: active.results[0],
    versions: versions.results,
    oses: oses.results,
    events: events.results,
    retention: retention.results[0],
  });
}
