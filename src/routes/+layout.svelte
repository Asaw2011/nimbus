<script lang="ts">
  import { settings } from "$lib/model/settings.svelte";
  import { initSnippets } from "$lib/model/snippets";
  import { onMount } from "svelte";
  import "$lib/theme.css"; // the two themes (Dark/Light) + base body styles
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
