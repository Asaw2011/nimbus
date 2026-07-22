// Minimal .docx exporter for the speech doc. Walks the CardMirror-schema
// ProseMirror document and emits Verbatim-style OOXML: pocket/hat/block/tag
// paragraph styles, with runs carrying highlight / underline / bold / size —
// so the exported file re-imports cleanly and reads like a normal debate doc.

import { zipSync, strToU8 } from "fflate";
import type { Node as PMNode } from "prosemirror-model";

const P_STYLE: Record<string, string> = {
  pocket: "Heading1",
  hat: "Heading2",
  block: "Heading3",
  tag: "Heading4",
  analytic: "Heading4",
  cite_paragraph: "Normal",
  card_body: "Normal",
  undertag: "Normal",
  paragraph: "Normal",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function runXml(node: PMNode): string {
  const marks = node.marks;
  let rPr = "";
  const has = (n: string) => marks.some((m) => m.type.name === n);
  const hl = marks.find((m) => m.type.name === "highlight");
  const fs = marks.find((m) => m.type.name === "font_size");
  if (has("bold") || has("emphasis_mark") || has("cite_mark")) rPr += "<w:b/>";
  if (has("italic")) rPr += "<w:i/>";
  if (has("underline_mark") || has("underline_direct")) rPr += '<w:u w:val="single"/>';
  if (has("strikethrough")) rPr += "<w:strike/>";
  if (hl) rPr += `<w:highlight w:val="${esc(String(hl.attrs.color ?? "yellow"))}"/>`;
  if (fs) {
    const hp = Number(fs.attrs.halfPoints) || 22;
    rPr += `<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`;
  }
  const rPrTag = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
  return `<w:r>${rPrTag}<w:t xml:space="preserve">${esc(node.text ?? "")}</w:t></w:r>`;
}

function paraXml(node: PMNode, styleName: string): string {
  let runs = "";
  node.forEach((child) => {
    if (child.isText) runs += runXml(child);
  });
  const pPr = styleName !== "Normal" ? `<w:pPr><w:pStyle w:val="${styleName}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

function walk(node: PMNode, out: string[]): void {
  const name = node.type.name;
  // Analytics are your own in-round analysis — omitted from the sent .docx
  // (matches CardMirror's stripAnalytics on export). Drop the whole unit and
  // any in-card analytic heading.
  if (name === "analytic_unit" || name === "analytic") return;
  const style = P_STYLE[name];
  if (style && node.inlineContent) {
    out.push(paraXml(node, style));
    return;
  }
  // Container (doc, card) — recurse into children.
  node.forEach((child) => walk(child, out));
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Pocket"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Hat"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Block"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:u w:val="single"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="Tag"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

export function buildDocxBytes(doc: PMNode): Uint8Array {
  const body: string[] = [];
  walk(doc, body);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join("")}<w:sectPr/></w:body></w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8(STYLES_XML),
    "word/_rels/document.xml.rels": strToU8(DOC_RELS),
  });
}

/** Build the .docx and let the user choose where to save it. */
export async function exportSpeechDocx(doc: PMNode, defaultName: string): Promise<void> {
  const bytes = buildDocxBytes(doc);
  if ("__TAURI_INTERNALS__" in window) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: `${defaultName}.docx`,
      filters: [{ name: "Word Document", extensions: ["docx"] }],
    });
    if (!path) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
  } else {
    // Browser fallback: download.
    const blob = new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${defaultName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
