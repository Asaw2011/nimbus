// Multiple speech docs — each an independent document with its own content,
// switchable via tabs. The list (id/name/active) persists in one blob; each
// doc's content lives in its own blob so large docs (images) don't bloat the
// index. Migrates the old single "speech-doc-json" doc on first run.

import { saveBlob, loadBlob } from "$lib/model/blobs";
import { uid } from "$lib/model/types";

export interface DocEntry {
  id: string;
  name: string;
}

// The doc list is scoped PER ROUND so each flow has its own speech docs; doc
// content blobs are keyed by their (globally-unique) id, so they never collide.
const listBlob = (roundId: string) => `docs-list:${roundId}`;
const contentBlob = (id: string) => `doc:${id}`;

class DocsStore {
  docs = $state<DocEntry[]>([]);
  activeId = $state<string | null>(null);
  // The doc that receives ` / ~ "send to speech" sends — your speech in progress.
  // CardMirror/Verbatim call this "the speech"; here it's marked with a ★ on its tab.
  speechDocId = $state<string | null>(null);
  /** Which round's docs are currently loaded. */
  private roundId: string | null = null;

  /** Load (or create) the doc list belonging to a specific round/flow. Switching
   *  rounds swaps to that round's own docs so they never bleed across flows. */
  async initFor(roundId: string): Promise<void> {
    if (this.roundId === roundId) return;
    if (this.roundId) this.persist(); // save the outgoing round's list first
    this.roundId = roundId;
    const saved = await loadBlob<{ docs: DocEntry[]; activeId: string | null; speechDocId?: string | null }>(listBlob(roundId));
    if (saved?.docs?.length) {
      this.docs = saved.docs;
      const has = (id: string | null | undefined) => !!id && saved.docs.some((d) => d.id === id);
      const fallback = saved.docs[0].id;
      this.activeId = has(saved.activeId) ? saved.activeId! : fallback;
      this.speechDocId = has(saved.speechDocId) ? saved.speechDocId! : fallback;
      if (!has(saved.activeId) || !has(saved.speechDocId)) this.persist();
      return;
    }
    // First time this round's docs are opened → start with one blank Speech doc.
    const id = uid();
    this.docs = [{ id, name: "Speech" }];
    this.activeId = id;
    this.speechDocId = id;
    this.persist();
  }

  /** Mark a doc as THE speech doc (the ` / ~ send target). One at a time. */
  setSpeechDoc(id: string): void {
    if (!this.docs.some((d) => d.id === id)) return;
    this.speechDocId = id;
    this.persist();
  }

  newDoc(name = "Untitled"): string {
    const id = uid();
    this.docs = [...this.docs, { id, name: this.uniqueName(name) }];
    this.activeId = id;
    saveBlob(contentBlob(id), null);
    this.persist();
    return id;
  }

  /** New doc seeded with content (e.g. an imported .docx). */
  addFromContent(name: string, content: unknown): string {
    const id = uid();
    this.docs = [...this.docs, { id, name: this.uniqueName(name) }];
    this.activeId = id;
    saveBlob(contentBlob(id), content ?? null);
    this.persist();
    return id;
  }

  close(id: string): void {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return;
    this.docs = this.docs.filter((d) => d.id !== id);
    saveBlob(contentBlob(id), null);
    if (this.docs.length === 0) {
      this.newDoc("Speech");
      return;
    }
    if (this.activeId === id) this.activeId = this.docs[Math.max(0, idx - 1)].id;
    // Closing the speech doc hands the ★ to the neighbour so a target always exists.
    if (this.speechDocId === id) this.speechDocId = this.docs[Math.max(0, idx - 1)].id;
    this.persist();
  }

  rename(id: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.docs = this.docs.map((d) => (d.id === id ? { ...d, name: clean } : d));
    this.persist();
  }

  setActive(id: string): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.persist();
  }

  async loadContent(id: string | null): Promise<unknown> {
    if (!id) return null;
    return (await loadBlob<unknown>(contentBlob(id))) ?? null;
  }

  saveContent(id: string | null, json: unknown): void {
    if (!id) return;
    saveBlob(contentBlob(id), json ?? null);
  }

  private uniqueName(base: string): string {
    const names = new Set(this.docs.map((d) => d.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  private persist(): void {
    if (!this.roundId) return;
    saveBlob(listBlob(this.roundId), { docs: $state.snapshot(this.docs), activeId: this.activeId, speechDocId: this.speechDocId });
  }
}

export const docsStore = new DocsStore();
