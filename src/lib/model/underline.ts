// Partial underline in a flow cell (Ctrl/⌘+U, like Word). The cell text stays
// plain; `Cell.underlines` holds [start, end) character ranges. The editor is
// the source while you type - the browser's own underline command makes <u>
// runs, and `readUnderlines` turns them back into ranges on every input.

export type Range = [number, number];

/** Underlined character ranges in an editor's DOM, merged and sorted. Counts
 *  characters exactly the way `.textContent` does (text nodes only). */
export function readUnderlines(root: HTMLElement): Range[] {
  const out: Range[] = [];
  let pos = 0;
  const walk = (n: Node, under: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.nodeValue?.length ?? 0;
      if (under && len) {
        const last = out[out.length - 1];
        if (last && last[1] === pos) last[1] += len;
        else out.push([pos, pos + len]);
      }
      pos += len;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const deco = `${el.style?.textDecoration ?? ""} ${el.style?.textDecorationLine ?? ""}`;
    const u = under || el.tagName === "U" || /underline/.test(deco);
    for (const c of Array.from(el.childNodes)) walk(c, u);
  };
  for (const c of Array.from(root.childNodes)) walk(c, false);
  return out;
}

/** Stored ranges made safe to draw: inside the text, non-empty, sorted, merged. */
export function cleanRanges(ranges: Range[] | undefined, len: number): Range[] {
  if (!ranges?.length) return [];
  const sorted = ranges
    .map(([a, b]): Range => [Math.max(0, Math.min(a, len)), Math.max(0, Math.min(b, len))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function sameRanges(a: Range[], b: Range[]): boolean {
  return a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
}

/** After a rewrite that ended at `at` and changed the length by `delta`:
 *  ranges past it move with the text. */
export function shiftRanges(ranges: Range[], at: number, delta: number, len: number): Range[] {
  return cleanRanges(
    ranges.map(([a, b]): Range => [a >= at ? a + delta : a, b >= at ? b + delta : b]),
    len,
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The cell's HTML: `bold` (the banked author, [start, end) or null) as
 *  <b class="author">, underlined ranges as <u>. Text is escaped. */
export function richHtml(text: string, bold: Range | null, underlines: Range[]): string {
  const cuts = new Set<number>([0, text.length]);
  if (bold) { cuts.add(bold[0]); cuts.add(bold[1]); }
  for (const [a, b] of underlines) { cuts.add(a); cuts.add(b); }
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((x, y) => x - y);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    let piece = esc(text.slice(a, b));
    if (underlines.some(([s, e]) => a >= s && b <= e)) piece = `<u>${piece}</u>`;
    if (bold && a >= bold[0] && b <= bold[1]) piece = `<b class="author">${piece}</b>`;
    html += piece;
  }
  return html;
}
