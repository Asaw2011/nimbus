// CardMirror engine by Anthony Trufanov (github.com/ant981228/cardmirror).
//
// Required Notice: Copyright (c) 2026 Anthony Trufanov.
//
// Vendored under the PolyForm Noncommercial License 1.0.0
// (https://polyformproject.org/licenses/noncommercial/1.0.0/) — the full
// required notice is in THIRD-PARTY-NOTICES.md at the repo root.
//
// This is the actual importer, exporter and schema: Nimbus's speech doc IS
// CardMirror. Files are parsed with fromDocx and exported with toDocx, so
// styles/emphasis/cite/headers match exactly because it is the same code.
//
// All credit for this engine belongs to Anthony Trufanov.

export { schema } from "./schema/index";
export { fromDocx, fromDocxFull, importDoc } from "./import/index";
export { toDocx, exportDoc } from "./export/index";
