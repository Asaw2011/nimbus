// ProseMirror schema for debate speech documents.
// Mirrors Verbatim's Pocket/Hat/Block/Tag hierarchy so docs round-trip
// cleanly to .docx when export is added in Phase 5.

import { Schema } from "prosemirror-model";

export const debateSchema = new Schema({
  nodes: {
    doc: { content: "block+" },

    // Debate heading hierarchy — each carries a stable UUID for future transclusion
    pocket: {
      content: "inline*",
      group: "block",
      attrs: { id: { default: "" } },
      parseDOM: [{ tag: "h1" }],
      toDOM: () => ["h1", { class: "pm-pocket" }, 0],
    },
    hat: {
      content: "inline*",
      group: "block",
      attrs: { id: { default: "" } },
      parseDOM: [{ tag: "h2" }],
      toDOM: () => ["h2", { class: "pm-hat" }, 0],
    },
    block: {
      content: "inline*",
      group: "block",
      attrs: { id: { default: "" } },
      parseDOM: [{ tag: "h3" }],
      toDOM: () => ["h3", { class: "pm-block" }, 0],
    },
    tag: {
      content: "inline*",
      group: "block",
      attrs: { id: { default: "" } },
      parseDOM: [{ tag: "h4" }],
      toDOM: () => ["h4", { class: "pm-tag" }, 0],
    },
    card_body: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p.pm-card-body" }],
      toDOM: () => ["p", { class: "pm-card-body" }, 0],
    },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    text: { group: "inline" },
  },

  marks: {
    bold: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }],
      toDOM: () => ["strong", 0],
    },
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: () => ["u", 0],
    },
  },
});

export type DebateSchema = typeof debateSchema;
