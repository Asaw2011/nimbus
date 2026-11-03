// Starred and pinned library files - the same rules Falcon's file search uses,
// so the two apps behave alike:
//
// - starred: goes to the top of Doc Search (⌘K) whenever it matches what you type
// - pinned:  like starred, and it always shows, first, even with the box empty
// - either one hides its copies: the same path inside another library folder
//   (Dropbox/DA/x.docx and Team Dropbox/DA/x.docx), not just any file with the name
//
// Pure (no Svelte, no Tauri) so it can be checked on its own.

export interface MarkableFile {
  path: string;
  name: string;
  mtime: number;
}

export interface MarkedFile<F extends MarkableFile = MarkableFile> {
  file: F;
  starred: boolean;
  pinned: boolean;
  /** how many copies in other library folders this one hides */
  hidden: number;
}

const SEP = /[\\/]/;
const trim = (p: string) => p.replace(/[\\/]+$/, "");

/** The path below its library folder, lowercased with forward slashes ("da/impact.docx"), or null outside them. */
export function relPath(path: string, roots: readonly string[]): string | null {
  // longest root first, so a folder inside another library folder wins
  let best = "";
  for (const r0 of roots) {
    const r = trim(r0);
    if (r.length > best.length && path.startsWith(r) && SEP.test(path[r.length] ?? "")) best = r;
  }
  return best ? path.slice(best.length + 1).replace(/\\/g, "/").toLowerCase() : null;
}

/**
 * `ranked` is the list as Doc Search would show it (best match first). Starred
 * and pinned files move up and their copies drop out. With a query, a marked
 * file only shows if it matched (pinned ones are added back first only when the
 * box is empty).
 */
export function applyMarks<F extends MarkableFile>(
  ranked: readonly F[],
  all: readonly F[],
  roots: readonly string[],
  starred: readonly string[],
  pinned: readonly string[],
  query: string,
): MarkedFile<F>[] {
  const stars = new Set(starred), pins = new Set(pinned);
  const wrap = (f: F): MarkedFile<F> => ({ file: f, starred: stars.has(f.path), pinned: pins.has(f.path), hidden: 0 });
  if (!stars.size && !pins.size) return ranked.map(wrap);

  // every marked file in the library, by its place below its folder
  const marked = new Map<string, MarkedFile<F>>();
  const byRel = new Map<string, MarkedFile<F>>();
  for (const f of all) {
    if (!stars.has(f.path) && !pins.has(f.path)) continue;
    const m = wrap(f);
    marked.set(f.path, m);
    const k = relPath(f.path, roots);
    if (k && !byRel.has(k)) byRel.set(k, m);
  }
  // copies are counted across the whole library, so the number doesn't change as you type
  for (const f of all) {
    if (marked.has(f.path)) continue;
    const k = relPath(f.path, roots);
    const twin = k ? byRel.get(k) : undefined;
    if (twin) twin.hidden += 1;
  }

  const empty = !query.trim();
  const top: MarkedFile<F>[] = [], starredHits: MarkedFile<F>[] = [], rest: MarkedFile<F>[] = [];
  const shown = new Set<string>();
  if (empty) {
    for (const p of pinned) {
      const m = marked.get(p);
      if (m) { top.push(m); shown.add(p); }
    }
  }
  for (const f of ranked) {
    if (shown.has(f.path)) continue;
    const m = marked.get(f.path);
    if (m) {
      // with the box empty a star keeps its place, like Falcon; a search puts it on top
      (m.pinned ? top : empty ? rest : starredHits).push(m);
      shown.add(f.path);
      continue;
    }
    const k = relPath(f.path, roots);
    if (k && byRel.has(k)) continue; // a copy of a marked file
    rest.push(wrap(f));
  }
  return [...top, ...starredHits, ...rest];
}

/** Mark `path`, or unmark it. Returns a new list in the order things were marked. */
export const toggleIn = (list: readonly string[], path: string): string[] =>
  list.includes(path) ? list.filter((p) => p !== path) : [...list, path];

/** A library folder's files as nested folders, for picking files to star or pin. */
export interface LibDir<F extends MarkableFile = MarkableFile> {
  name: string;
  path: string;
  dirs: LibDir<F>[];
  files: F[];
  count: number;
}

export function buildLibTree<F extends MarkableFile>(root: string, files: readonly F[]): LibDir<F> {
  const r = trim(root);
  const top: LibDir<F> = { name: "", path: r, dirs: [], files: [], count: 0 };
  for (const f of files) {
    if (!f.path.startsWith(r) || !SEP.test(f.path[r.length] ?? "")) continue;
    const parts = f.path.slice(r.length).split(SEP).filter(Boolean);
    let d = top;
    d.count++;
    for (const name of parts.slice(0, -1)) {
      let next = d.dirs.find((x) => x.name === name);
      if (!next) { next = { name, path: `${d.path}/${name}`, dirs: [], files: [], count: 0 }; d.dirs.push(next); }
      d = next;
      d.count++;
    }
    d.files.push(f);
  }
  const sort = (d: LibDir<F>) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    d.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    d.dirs.forEach(sort);
  };
  sort(top);
  return top;
}
