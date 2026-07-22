// CardMirror engine (vendored, PolyForm Noncommercial) — the actual importer,
// exporter, and schema. Nimbus's speech doc IS CardMirror: files are parsed
// with fromDocx and exported with toDocx, so styles/emphasis/cite/headers match
// exactly because it's the same code.

export { schema } from "./schema/index";
export { fromDocx, fromDocxFull, importDoc } from "./import/index";
export { toDocx, exportDoc } from "./export/index";
