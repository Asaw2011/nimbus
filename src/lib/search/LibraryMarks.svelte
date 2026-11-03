<script lang="ts">
  // Settings → Search Library: star and pin library files, the way Falcon does it
  // in Settings → File search. Find a file by name, or open a library folder and
  // mark files inside it. ⌘K only shows the marks.
  import { settings } from "$lib/model/settings.svelte";
  import { fileIndex, type LibFile } from "./file-index.svelte";
  import { buildLibTree, relPath, type LibDir } from "./file-marks";
  import MarkIcon from "./MarkIcon.svelte";

  let find = $state("");
  let openDirs = $state<string[]>([]);

  const roots = $derived(settings.libraryRoots.filter((r) => r.enabled));
  const rootPaths = $derived(roots.map((r) => r.path));
  const byPath = $derived(new Map(fileIndex.files.map((f) => [f.path, f])));
  const found = $derived(find.trim() ? fileIndex.search(find, 8) : []);
  // pinned first, then starred, each in the order marked
  const marked = $derived([
    ...settings.pinnedFiles.map((p) => ({ path: p, pin: true })),
    ...settings.starredFiles.filter((p) => !settings.pinnedFiles.includes(p)).map((p) => ({ path: p, pin: false })),
  ]);
  const trees = $derived(roots.map((r) => ({ root: r, tree: buildLibTree(r.path, fileIndex.files) })));

  const nameOf = (p: string) => byPath.get(p)?.name ?? p.split(/[\\/]/).pop()!.replace(/\.(docx|cmir|nimbus)$/i, "");
  // which library folder (and subfolder) a file is in, for telling same-named files apart
  function whereOf(p: string): string {
    const r = roots.find((x) => p.startsWith(x.path.replace(/[\\/]+$/, "")));
    if (!r) return byPath.has(p) ? "" : "Not found";
    const rel = relPath(p, rootPaths) ?? "";
    const dir = rel.split("/").slice(0, -1).pop();
    const label = r.label || r.path.split(/[\\/]/).filter(Boolean).pop() || r.path;
    return dir ? `${label} › ${p.split(/[\\/]/).slice(-2, -1)[0]}` : label;
  }
  const isOpen = (k: string) => openDirs.includes(k);
  const flip = (k: string) => (openDirs = isOpen(k) ? openDirs.filter((x) => x !== k) : [...openDirs, k]);
  const starsIn = (d: LibDir<LibFile>): number =>
    d.files.filter((f) => settings.starredFiles.includes(f.path) || settings.pinnedFiles.includes(f.path)).length + d.dirs.reduce((n, x) => n + starsIn(x), 0);
</script>

{#snippet marks(path: string, name: string)}
  {@const s = settings.starredFiles.includes(path)}
  {@const p = settings.pinnedFiles.includes(path)}
  <button class="mk" class:on={s} aria-pressed={s} aria-label="{s ? 'Unstar' : 'Star'} {name}"
    title={s ? "Unstar" : "Star: first in Doc Search (⌘K) when it matches"}
    onclick={() => settings.toggleFileMark("star", path)}><MarkIcon kind="star" filled={s} /></button>
  <button class="mk" class:on={p} aria-pressed={p} aria-label="{p ? 'Unpin' : 'Pin'} {name}"
    title={p ? "Unpin" : "Pin: always first in Doc Search (⌘K), even before you type"}
    onclick={() => settings.toggleFileMark("pin", path)}><MarkIcon kind="pin" filled={p} /></button>
{/snippet}

{#snippet level(d: LibDir<LibFile>, depth: number)}
  {#each d.dirs as x (x.path)}
    {@const n = starsIn(x)}
    <button class="tr dir" style="padding-left: {depth * 16 + 4}px" aria-expanded={isOpen(x.path)} onclick={() => flip(x.path)}>
      <span class="chev" class:open={isOpen(x.path)}>▸</span>
      <span class="nm">{x.name}</span>
      {#if n}<span class="cnt-mk" title="{n} marked inside">★ {n}</span>{/if}
      <span class="cnt">{x.count}</span>
    </button>
    {#if isOpen(x.path)}{@render level(x, depth + 1)}{/if}
  {/each}
  {#each d.files as f (f.path)}
    <div class="tr file" style="padding-left: {depth * 16 + 22}px" title={f.path}>
      <span class="nm">{f.name}</span>
      {@render marks(f.path, f.name)}
    </div>
  {/each}
{/snippet}

<div class="lm">
  <h4>Starred and pinned files</h4>
  <p class="hint">
    Starred files go to the top of Doc Search (⌘K) when they match. Pinned ones are always listed first, even before you type.
    Both hide their copies in your other library folders.
  </p>
  <input class="find" placeholder="Find a file to star or pin…" spellcheck="false" bind:value={find}
    onkeydown={(e) => { if (e.key === "Escape" && find) { e.preventDefault(); e.stopPropagation(); find = ""; } }} />
  {#if find.trim()}
    {#each found as f (f.path)}
      <div class="tr file"><span class="nm">{f.name}</span><span class="where">{whereOf(f.path)}</span>{@render marks(f.path, f.name)}</div>
    {:else}
      <p class="hint">No files match “{find.trim()}”.</p>
    {/each}
  {:else if marked.length}
    {#each marked as m (m.path)}
      <div class="tr file"><span class="nm">{nameOf(m.path)}</span><span class="where">{whereOf(m.path)}</span>{@render marks(m.path, nameOf(m.path))}</div>
    {/each}
  {:else}
    <p class="hint">Nothing starred or pinned yet. Find a file above, or open a folder below.</p>
  {/if}

  {#each trees as { root, tree } (root.id)}
    {#if tree.count}
      <button class="tr dir rootdir" aria-expanded={isOpen(root.id)} onclick={() => flip(root.id)}>
        <span class="chev" class:open={isOpen(root.id)}>▸</span>
        <span class="nm">{root.label || root.path}</span>
        {#if starsIn(tree)}<span class="cnt-mk">★ {starsIn(tree)}</span>{/if}
        <span class="cnt">{tree.count}</span>
      </button>
      {#if isOpen(root.id)}<div class="tree">{@render level(tree, 1)}</div>{/if}
    {/if}
  {/each}
</div>

<style>
  .lm { margin-top: 14px; }
  .lm h4 { margin: 0 0 4px; font-size: 13px; }
  .hint { font-size: 12px; color: var(--text-dim); margin: 0 0 8px; }
  .tr, .find { font-size: 13px; }
  .find { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 6px 10px; border-radius: 7px; border: 1px solid var(--border); background: var(--panel); color: var(--text); font-family: inherit; }
  .tree { max-height: 340px; overflow: auto; }
  .tr { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 28px; padding: 0 4px; border-radius: 6px; box-sizing: border-box; }
  .tr:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
  .dir { background: none; border: 0; color: var(--text); font-family: inherit; text-align: left; cursor: pointer; }
  .rootdir { margin-top: 6px; font-weight: 600; }
  .chev { width: 12px; color: var(--text-dim); transition: transform 120ms ease-out; }
  .chev.open { transform: rotate(90deg); }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where, .cnt { font-size: 12px; color: var(--text-dim); white-space: nowrap; }
  .cnt-mk { font-size: 11px; color: #e2b33c; }
  .mk { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: var(--text-dim); cursor: pointer; }
  .mk:hover { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); }
  .mk.on { color: #e2b33c; }
</style>
