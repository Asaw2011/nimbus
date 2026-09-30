// Runs CardMirror's fromDocx OFF the main thread. On a 3 MB 2AC file it is one
// solid ~3 s task - on the main thread that froze the whole window, which is
// not acceptable mid-round. Only the importer is loaded here (no editor/view
// code), and it touches no DOM.

import { fromDocx } from "$lib/cardmirror/import/index";

interface Req {
  id: number;
  buf: ArrayBuffer;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = async (e) => {
  const { id, buf } = e.data;
  try {
    const doc = await fromDocx(new Uint8Array(buf));
    ctx.postMessage({ id, json: doc.toJSON() });
  } catch (err) {
    ctx.postMessage({ id, error: String(err instanceof Error ? err.message : err) });
  }
};
