<script lang="ts">
  import { settings } from "$lib/model/settings.svelte";
  import { initSnippets } from "$lib/model/snippets";
  import { onMount } from "svelte";
  import "$lib/fonts.css"; // bundled Lexend + Calibri(Carlito), offline
  import "$lib/cardmirror/cardmirror.css"; // doc rendering (also for the settings preview)
  import "$lib/doc/doc-style.css"; // configurable doc display toggles

  let { children } = $props();

  onMount(() => void initSnippets());

  $effect(() => {
    document.documentElement.dataset.theme = settings.theme;
  });

  // User overrides for the aff/neg accent colors (blue/red are just defaults).
  $effect(() => {
    const root = document.documentElement.style;
    if (settings.affColor) root.setProperty("--aff", settings.affColor);
    else root.removeProperty("--aff");
    if (settings.negColor) root.setProperty("--neg", settings.negColor);
    else root.removeProperty("--neg");
    if (settings.analyticColor) root.setProperty("--analytic", settings.analyticColor);
    else root.removeProperty("--analytic");
    if (settings.cardColor) root.setProperty("--card", settings.cardColor);
    else root.removeProperty("--card");
  });

  // Grid text + geometry defaults (font, size, row height).
  $effect(() => {
    const root = document.documentElement.style;
    if (settings.fontFamily) root.setProperty("--cell-font", settings.fontFamily);
    else root.removeProperty("--cell-font");
    root.setProperty("--cell-size", `${settings.fontSize}px`);
    root.setProperty("--row-h", `${settings.rowHeight}px`);
    // The default font also drives the speech doc; when unset it keeps the
    // traditional Calibri look debaters expect (now bundled, so it renders).
    root.setProperty(
      "--doc-font",
      settings.fontFamily || '"Calibri", "Segoe UI", Arial, sans-serif',
    );
  });
</script>

<svelte:head>
  <title>Nimbus</title>
</svelte:head>

{@render children()}

<style>
  :global(:root) {
    --bg: #141414;
    --panel: #1e1e1e;
    --cell-bg: #1a1a1a;
    --border: #3a3a3a;
    --grid-line: #262626;
    --text: #e8e8e8;
    --text-dim: #999;
    --accent: #4a9eff;
    --aff: #7fb5ff;
    --neg: #ff9a7f;
    --analytic: #5fd98a;
    --card: #c792ea;
    --active-cell-bg: #1f2733;
    --dropped-bg: #2a1b1b;
    --mark-dropped: #e05c5c;
    --mark-star: #e0b64c;
    --kbd-bg: #2a2a2a;
    --kbd-border: #444;
    color-scheme: dark;
  }
  /* ---- light themes (shared ink defaults, distinct backgrounds) ---- */
  :global(:root[data-theme="light"]) {
    --bg: #f6f5f1; /* legal-pad paper */
    --panel: #ffffff;
    --cell-bg: #fffefb;
    --border: #c9c7c0;
    --grid-line: #e2e0d8;
    --text: #1d1d1b;
    --text-dim: #6d6b64;
    --accent: #1a6fd4;
    --aff: #1a6fd4;
    --neg: #c8442a;
    --analytic: #1e8e4a;
    --card: #7c4dbe;
    --active-cell-bg: #e8f0fc;
    --dropped-bg: #fbe9e7;
    --mark-dropped: #c8442a;
    --mark-star: #b8860b;
    --kbd-bg: #eceae4;
    --kbd-border: #c9c7c0;
    color-scheme: light;
  }
  :global(:root[data-theme="snow"]) {
    --bg: #fbfcfd;
    --panel: #ffffff;
    --cell-bg: #ffffff;
    --border: #dde1e6;
    --grid-line: #eceff2;
    --text: #1a1d21;
    --text-dim: #6b7280;
    --accent: #2563eb;
    --aff: #2563eb;
    --neg: #d63d3d;
    --analytic: #1e8e4a;
    --card: #7c4dbe;
    --active-cell-bg: #e8f0fe;
    --dropped-bg: #fdeaea;
    --mark-dropped: #d63d3d;
    --mark-star: #b8860b;
    --kbd-bg: #eef1f4;
    --kbd-border: #dde1e6;
    color-scheme: light;
  }
  :global(:root[data-theme="cream"]) {
    --bg: #f7f2e9;
    --panel: #fffdf8;
    --cell-bg: #fffefb;
    --border: #e3d9c6;
    --grid-line: #efe7d6;
    --text: #2a2620;
    --text-dim: #7a715f;
    --accent: #2f6bd0;
    --aff: #2f6bd0;
    --neg: #c8442a;
    --analytic: #1e8e4a;
    --card: #7c4dbe;
    --active-cell-bg: #eef3fb;
    --dropped-bg: #f7e7e0;
    --mark-dropped: #c8442a;
    --mark-star: #a9791a;
    --kbd-bg: #efe7d6;
    --kbd-border: #e3d9c6;
    color-scheme: light;
  }
  :global(:root[data-theme="sky"]) {
    --bg: #eef4fb;
    --panel: #ffffff;
    --cell-bg: #f9fbfe;
    --border: #cfdff0;
    --grid-line: #e1ecf8;
    --text: #16202e;
    --text-dim: #5c6b7d;
    --accent: #1a6fd4;
    --aff: #1a6fd4;
    --neg: #d1442c;
    --analytic: #1e8e4a;
    --card: #7c4dbe;
    --active-cell-bg: #dceaf8;
    --dropped-bg: #f8e5e0;
    --mark-dropped: #d1442c;
    --mark-star: #b3801c;
    --kbd-bg: #e1ecf8;
    --kbd-border: #cfdff0;
    color-scheme: light;
  }
  :global(:root[data-theme="mist"]) {
    --bg: #f4f5f6;
    --panel: #ffffff;
    --cell-bg: #fcfcfd;
    --border: #d9dce0;
    --grid-line: #eaecee;
    --text: #1e2227;
    --text-dim: #6a7078;
    --accent: #3b6cc9;
    --aff: #2c62c4;
    --neg: #cf3f38;
    --analytic: #1e8e4a;
    --card: #7c4dbe;
    --active-cell-bg: #e9eef7;
    --dropped-bg: #f8e9e8;
    --mark-dropped: #cf3f38;
    --mark-star: #ab7d1a;
    --kbd-bg: #eaecee;
    --kbd-border: #d9dce0;
    color-scheme: light;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
</style>
