// Export/import of all user configuration as one JSON bundle: settings,
// keybinds, macros, snippets, folders. Lets debaters move their setup between
// machines and keep a backup that survives anything.

import type { Persisted } from "./settings.svelte";
import { settings } from "./settings.svelte";
import { loadSnippets, saveSnippets } from "./snippets";
import { exportToDownloads, loadBlobCached, saveBlob } from "./blobs";

interface Bundle {
  app: "flow";
  bundleVersion: 1;
  exportedAt: string;
  settings: Persisted;
  snippets: Record<string, string>;
  folders: string[];
}

export async function exportSettings(): Promise<string> {
  const bundle: Bundle = {
    app: "flow",
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: settings.buildPersisted(),
    snippets: loadSnippets(),
    folders: loadBlobCached<string[]>("folders") ?? [],
  };
  const date = new Date().toISOString().slice(0, 10);
  return exportToDownloads(`flow-settings-${date}.json`, bundle);
}

/** Apply an imported bundle. Returns an error message or null on success. */
export function importSettings(raw: string): string | null {
  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return "That file isn't valid JSON.";
  }
  if (bundle.app !== "flow" || !bundle.settings) {
    return "That doesn't look like a Flow settings export.";
  }
  settings.applyPersisted(bundle.settings);
  settings.save();
  if (bundle.snippets) saveSnippets(bundle.snippets);
  if (Array.isArray(bundle.folders)) saveBlob("folders", bundle.folders);
  return null;
}
