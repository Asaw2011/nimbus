// Auto-update support. Only active inside Tauri; silently no-ops in the browser.
// Call checkForUpdate() on startup (after a short delay) or from the Settings panel.

export interface UpdateInfo {
  version: string;
  body: string | null;
  /** Call to download + install. Pass a progress callback (0–100). */
  install: (onProgress?: (pct: number) => void) => Promise<void>;
  /** Call after install to restart the app. */
  relaunch: () => Promise<void>;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update?.available) return null;
    return {
      version: update.version,
      body: update.body ?? null,
      install: async (onProgress) => {
        let downloaded = 0;
        let total = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            if (total > 0 && onProgress) onProgress(Math.round((downloaded / total) * 100));
          }
        });
      },
      relaunch: async () => {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (err) {
    // Never swallow this silently. A missing capability grant or a bad manifest
    // throws here and is otherwise indistinguishable from "you're up to date" —
    // which is exactly how a broken updater stays invisible for months.
    console.error("checkForUpdate failed", err);
    return null;
  }
}
