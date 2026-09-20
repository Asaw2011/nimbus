<script lang="ts">
  import { settings, TAB_SIZES } from "$lib/model/settings.svelte";
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

  // Sheet-tab size. Same mechanism as the grid geometry below — a custom
  // property on the root — so the tab bar restyles without remounting the grid
  // or touching the flow's own layout.
  $effect(() => {
    const root = document.documentElement.style;
    const size = TAB_SIZES.find((t) => t.id === settings.tabSize) ?? TAB_SIZES[1];
    root.setProperty("--tab-pad", size.pad);
    root.setProperty("--tab-font", size.font);
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
