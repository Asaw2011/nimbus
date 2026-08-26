// Remote "minimum supported version" check.
//
// Builds already on people's machines can never be reached — they are compiled
// binaries with no update channel. This exists so that every build from HERE ON
// can be shut off later if it has to be.
//
// ⚠ It FAILS OPEN, always and on purpose. Offline, table missing, RLS denying
// the read, malformed row, server down — every one of those lets the app run.
// The check sits on the launch path, so a false positive would lock people out
// of their own local flows, which is far worse than an old build staying alive.
// It is inert until somebody actually publishes a row.

const SUPABASE_URL = "https://oovgzakdweswenhohgwh.supabase.co";
const SUPABASE_KEY = "sb_publishable_4xgCsUBklrsJUOspF4a6VA_maYxtlHg";

/** Table the check reads. See SETUP-min-version.sql for what to create. */
const TABLE = "nimbus_app";

declare const __APP_VERSION__: string;
/** `typeof` on an undeclared identifier is safe, so this survives a build where
 *  the Vite define didn't apply rather than throwing at import time. */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export interface VersionBlock {
  minVersion: string;
  message: string;
}

/** Numeric compare of dotted versions. Missing parts count as 0. */
function isOlder(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Returns a block when this build is too old to run, else null.
 *
 * Deliberately NOT cached: a cached "blocked" would follow somebody offline and
 * strand them. Being offline always means "allowed".
 */
export async function checkMinimumVersion(): Promise<VersionBlock | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?select=min_version,message&limit=1`,
      { headers: { apikey: SUPABASE_KEY } },
    );
    if (!r.ok) return null; // table missing, RLS denied, server unhappy — allow
    const rows = (await r.json()) as Array<{ min_version?: string; message?: string }>;
    const min = rows?.[0]?.min_version;
    if (typeof min !== "string" || !min.trim()) return null;
    if (!isOlder(APP_VERSION, min)) return null;
    return {
      minVersion: min,
      message:
        rows[0]?.message?.trim() ||
        "This version of Nimbus is no longer supported. Download the latest one from nimbusdebate.com.",
    };
  } catch {
    // Offline or DNS-blocked. Allow.
    return null;
  }
}
