/**
 * Import public API: .docx bytes → schema doc.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Docx } from '../ooxml/docx';
import { repairDoc } from '../doc-repair';
import { importDoc, type MediaPart, type MediaPartsMap } from './importer';
import { importComments } from './comments';
import { importNotes } from './footnotes';
import type { Thread } from '../editor/comments-plugin';

export { importDoc } from './importer';
export type { MediaPart, MediaPartsMap } from './importer';
export { importComments } from './comments';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  // Windows metafile formats — common in Word docs (vector graphics
  // pasted from Excel, PowerPoint, etc.).
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
};

function inferContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Read a .docx byte buffer and return a ProseMirror doc. Media parts
 * (images under word/media/) are extracted upfront and passed to the
 * importer so inline pictures round-trip with their bytes embedded as
 * base64 in the resulting `image` nodes.
 */
export async function fromDocx(
  bytes: Uint8Array | ArrayBuffer,
  /** When provided, is filled with `headingId → srcPara` for every heading —
   *  the provenance the `.docx` source-anchor injector needs. Omitted on the
   *  normal import path (zero extra cost). */
  provenanceOut?: Map<string, number>,
): Promise<PMNode> {
  const docx = await Docx.load(bytes);
  const documentXml = await docx.readText('word/document.xml');
  if (!documentXml) throw new Error('docx is missing word/document.xml');
  const relsXml = await docx.readText('word/_rels/document.xml.rels');
  const stylesXml = await docx.readText('word/styles.xml');

  const mediaParts: MediaPartsMap = new Map();
  for (const path of docx.paths()) {
    if (!path.startsWith('word/media/')) continue;
    const partBytes = await docx.readBinary(path);
    if (!partBytes) continue;
    const part: MediaPart = {
      bytes: partBytes,
      contentType: inferContentType(path),
    };
    mediaParts.set(path, part);
  }

  const footnotesXml = await docx.readText('word/footnotes.xml');
  const endnotesXml = await docx.readText('word/endnotes.xml');
  const footnotesRelsXml = await docx.readText('word/_rels/footnotes.xml.rels');
  const endnotesRelsXml = await docx.readText('word/_rels/endnotes.xml.rels');
  // Word tolerates ragged tables (rows with differing cell counts); the
  // editor's table plumbing assumes rectangular ones. Repair on the way in.
  return repairDoc(
    importDoc(
      documentXml,
      relsXml,
      mediaParts,
      stylesXml,
      {
        footnotes: importNotes(footnotesXml, footnotesRelsXml, 'w:footnotes', 'w:footnote'),
        endnotes: importNotes(endnotesXml, endnotesRelsXml, 'w:endnotes', 'w:endnote'),
      },
      provenanceOut,
    ),
  );
}

/** Like `fromDocx` but also returns the parsed comment threads.
 *  The editor calls this; tests/CLI/benchmarks that only care
 *  about the doc structure can keep using `fromDocx`. */
export async function fromDocxFull(
  bytes: Uint8Array | ArrayBuffer,
): Promise<{ doc: PMNode; threads: Thread[]; docId: string | null }> {
  const docx = await Docx.load(bytes);
  const documentXml = await docx.readText('word/document.xml');
  if (!documentXml) throw new Error('docx is missing word/document.xml');
  const relsXml = await docx.readText('word/_rels/document.xml.rels');
  const stylesXml = await docx.readText('word/styles.xml');

  const mediaParts: MediaPartsMap = new Map();
  for (const path of docx.paths()) {
    if (!path.startsWith('word/media/')) continue;
    const partBytes = await docx.readBinary(path);
    if (!partBytes) continue;
    const part: MediaPart = {
      bytes: partBytes,
      contentType: inferContentType(path),
    };
    mediaParts.set(path, part);
  }

  const footnotesXml = await docx.readText('word/footnotes.xml');
  const endnotesXml = await docx.readText('word/endnotes.xml');
  const footnotesRelsXml = await docx.readText('word/_rels/footnotes.xml.rels');
  const endnotesRelsXml = await docx.readText('word/_rels/endnotes.xml.rels');
  // Same rectangularity repair as `fromDocx`.
  const doc = repairDoc(
    importDoc(documentXml, relsXml, mediaParts, stylesXml, {
      footnotes: importNotes(footnotesXml, footnotesRelsXml, 'w:footnotes', 'w:footnote'),
      endnotes: importNotes(endnotesXml, endnotesRelsXml, 'w:endnotes', 'w:endnote'),
    }),
  );
  const commentsXml = await docx.readText('word/comments.xml');
  const commentsExtendedXml = await docx.readText('word/commentsExtended.xml');
  const threads = importComments(commentsXml, commentsExtendedXml);
  const docId = await docx.readDocId();
  return { doc, threads, docId };
}
