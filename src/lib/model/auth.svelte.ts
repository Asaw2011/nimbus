// Access to Nimbus is tied to a nimbusdebate.com account (Supabase, email +
// password — that project has no OAuth providers enabled, so there is no
// redirect/deep-link dance to do here).
//
// Constraints that matter MORE than the gate itself:
//
//   * Debaters flow at tournaments on bad wifi. After ONE successful login the
//     session is cached on disk and the app opens offline indefinitely. Losing
//     the network must never lock somebody out of their own local flow files.
//   * This code runs on the LAUNCH PATH. Every failure mode here fails OPEN
//     whenever a session already exists — a thrown error in this file would
//     otherwise brick the whole app, which is strictly worse than an ungated
//     one.
//
// It is deliberately a soft gate: everything Nimbus does is local, so this
// deters casual sharing and pushes people through the signup funnel. It is not
// licensing enforcement and cannot be.

import { saveBlob, loadBlob, loadBlobCached } from "./blobs";

const SUPABASE_URL = "https://oovgzakdweswenhohgwh.supabase.co";
/** Supabase "publishable" key. Designed to ship inside client apps — it is the
 *  same key nimbusdebate.com serves in its own page source, and it grants only
 *  what the project's RLS policies allow. Not a secret, not a leak. */
const SUPABASE_KEY = "sb_publishable_4xgCsUBklrsJUOspF4a6VA_maYxtlHg";

const BLOB = "auth-session";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** ms epoch when the access token lapses (refresh handles this silently). */
  expiresAt: number;
  email: string;
  userId: string;
  /** ms epoch of the last successful contact with the server. */
  verifiedAt: number;
}

/** Shape the token endpoint returns; only the fields we actually use. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

function toSession(data: TokenResponse, fallbackEmail: string): AuthSession {
  const expiresIn = Number(data.expires_in) || 3600;
  return {
    accessToken: data.access_token ?? "",
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + expiresIn * 1000,
    email: data.user?.email ?? fallbackEmail,
    userId: data.user?.id ?? "",
    verifiedAt: Date.now(),
  };
}

/** GoTrue has used several error shapes over the years; check all of them. */
function messageFor(status: number, data: Record<string, unknown>): string {
  const raw = String(data?.msg ?? data?.error_description ?? data?.error ?? "");
  if (/email not confirmed/i.test(raw)) {
    return "Confirm your email first — check your inbox for the link.";
  }
  if (/invalid login credentials/i.test(raw) || status === 400) {
    return "That email and password don't match an account. You can make one at nimbusdebate.com.";
  }
  if (status === 422) return "That doesn't look like a valid email address.";
  if (status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (status >= 500) return "nimbusdebate.com is having trouble right now. Try again in a moment.";
  return raw || `Sign-in failed (${status}).`;
}

class AuthStore {
  /** Seeded synchronously from the localStorage mirror so a returning user
   *  never sees the login screen flash before the disk copy loads. */
  session = $state<AuthSession | null>(loadBlobCached<AuthSession>(BLOB));
  busy = $state(false);
  error = $state("");

  get signedIn(): boolean {
    return this.session !== null && !!this.session.refreshToken;
  }

  get email(): string {
    return this.session?.email ?? "";
  }

  /**
   * Load the durable copy and re-verify in the background.
   *
   * Never throws and never blocks first paint: the app is already rendering off
   * the cached session by the time this resolves.
   */
  async init(): Promise<void> {
    try {
      const disk = await loadBlob<AuthSession>(BLOB);
      // Disk is authoritative — the localStorage mirror can be wiped by the
      // webview, and can also be STALER than disk after a refresh on a previous
      // run wrote a rotated token.
      if (disk && (!this.session || disk.verifiedAt >= this.session.verifiedAt)) {
        this.session = disk;
      }
    } catch {
      // Cache-only is fine; a missing/corrupt blob just means "log in".
    }
    void this.revalidate();
  }

  /**
   * Refresh the token, which doubles as "does this account still exist?".
   *
   * Supabase rotates refresh tokens, so the new one is persisted immediately —
   * dropping it would strand the session on the next launch.
   */
  private async revalidate(): Promise<void> {
    const s = this.session;
    if (!s?.refreshToken) return;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refreshToken }),
      });
      if (r.ok) {
        const data = (await r.json()) as TokenResponse;
        this.session = toSession(data, s.email);
        await saveBlob(BLOB, $state.snapshot(this.session));
        return;
      }
      // Only a DEFINITIVE rejection signs somebody out — the account was
      // deleted, or the refresh token was revoked. A 5xx or a network failure
      // must not, or a server hiccup locks people out of their own local flows
      // mid-round. This is the one lever that can revoke access remotely.
      if (r.status === 400 || r.status === 401) {
        await this.signOut();
      }
    } catch {
      // Offline. By design this KEEPS the cached session and the app opens.
    }
  }

  /** Returns true on success; on failure `error` holds a message to show. */
  async signIn(email: string, password: string): Promise<boolean> {
    const mail = email.trim();
    this.error = "";
    if (!mail || !password) {
      this.error = "Enter your email and password.";
      return false;
    }
    this.busy = true;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail, password }),
      });
      const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        this.error = messageFor(r.status, data);
        return false;
      }
      this.session = toSession(data as TokenResponse, mail);
      await saveBlob(BLOB, $state.snapshot(this.session));
      return true;
    } catch {
      this.error =
        "Couldn't reach nimbusdebate.com. Check your internet — you only need to sign in once.";
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Local sign-out. Deliberately does NOT call the server: signing out must
   *  work offline, and there is nothing server-side to clean up. */
  async signOut(): Promise<void> {
    this.session = null;
    this.error = "";
    await saveBlob(BLOB, null);
  }
}

export const auth = new AuthStore();
