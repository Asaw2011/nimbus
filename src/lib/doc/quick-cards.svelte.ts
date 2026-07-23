// Quick Cards — a persistent, reusable library of rich-text snippets captured
// from the speech doc (CardMirror's Quick Cards). Save a selection with a name
// + tags, then drop it back into any doc later from the search palette.
// Persisted through the same disk-backed blob store as settings/snippets.

import { saveBlob, loadBlob } from "$lib/model/blobs";
import { uid } from "$lib/model/types";

/** A flow-cell representation of a quick card, so dropping one onto the grid
 *  builds the SAME structured cell (chip + expandable items) a real card does,
 *  instead of flat text. */
export interface QuickCardFlow {
  header: string;
  chip?: string;
  /** Full node (DocNode) for a single carded capture — sends to the doc. */
  card?: unknown;
  /** Sub-items for a header + cards/responses capture. */
  items?: { text: string; kind: "card" | "response"; chip?: string; card?: unknown }[];
}

export interface QuickCard {
  id: string;
  /** Shortcut/label — defaults to the smallest enclosing heading. */
  name: string;
  /** Organizing tags (display casing). */
  tags: string[];
  /** A ProseMirror Slice.toJSON() of the captured content. */
  contentJson: unknown;
  /** Plain text of the capture, for search + preview. */
  preview: string;
  /** Structured flow-cell form (for dragging onto the grid). */
  flow?: QuickCardFlow;
  createdAt: number;
}

const BLOB = "quick-cards";

class QuickCardStore {
  cards = $state<QuickCard[]>([]);
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.cards = (await loadBlob<QuickCard[]>(BLOB)) ?? [];
  }

  add(card: { name: string; tags: string[]; contentJson: unknown; preview: string; flow?: QuickCardFlow }): void {
    const c: QuickCard = { ...card, id: uid(), createdAt: Date.now() };
    this.cards = [c, ...this.cards];
    this.persist();
  }

  remove(id: string): void {
    this.cards = this.cards.filter((c) => c.id !== id);
    this.persist();
  }

  rename(id: string, name: string): void {
    this.cards = this.cards.map((c) => (c.id === id ? { ...c, name } : c));
    this.persist();
  }

  /** Cards matching a query by name, tag, or content text. Empty = all. */
  match(query: string): QuickCard[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.cards;
    return this.cards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  /** All distinct tags across the library (for suggestions). */
  get allTags(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of this.cards)
      for (const t of c.tags) {
        const k = t.trim().toLowerCase();
        if (k && !seen.has(k)) { seen.add(k); out.push(t.trim()); }
      }
    return out.sort();
  }

  private persist(): void {
    saveBlob(BLOB, $state.snapshot(this.cards));
  }
}

export const quickCards = new QuickCardStore();
