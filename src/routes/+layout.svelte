<script lang="ts">
  import { settings } from "$lib/model/settings.svelte";
  import { initSnippets } from "$lib/model/snippets";
  import { onMount } from "svelte";

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
  });
</script>

<svelte:head>
  <title>Flow</title>
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
