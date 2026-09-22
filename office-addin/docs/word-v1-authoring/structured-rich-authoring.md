# Structured rich authoring in Word v1

Implementation contract and validation record · 20 September 2026

This extension keeps the structured document plan and expands its content vocabulary. The model describes document content, layout and object changes using typed JSON. The host compiles the proposal into Word content, presents a review, saves the original and applies the approved plan. The parked `feature/word-ooxml-experiment` remains a separate experiment; no raw-XML authoring facet is restored.

The implementation and automated tests described below are in the current checkout. Native tests on Word for Mac 16.113.1 have now applied a mixed rewrite containing new tables, a reused image, a native drawing, bookmarks, a content control, a field, headers/footers, footnotes/endnotes, comments and changed sections, then restored the original. A separate fresh-document case creates these families from a source with no existing story or numbering parts, including a supplied PNG, Heading 9 and a new multilevel list. Recorded native packages also cover direct typography, existing-object edits and complete clearing. These are fixture-specific results on the tested host; the [earlier native structured-editing evidence](mechanical-experiments/2026-09-20/structured/README.md) remains the paragraph/list and retained-content baseline.

## Content contract

| Content                             | Added structured intent                                                                                                                                       | Preservation behavior                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraphs, headings, lists         | Font, size, color, emphasis, spacing, indents, alignment, borders, shading, page-break and keep options                                                       | `keep` retains native source; explicit formatting changes are compiled from typed values. Existing paragraph styles remain available by `styleRef`.                                                                             |
| Tables                              | Create tables; replace or retain individual cells; add, delete and reorder rows/columns; spans; table, row and cell formatting                                | `sourceRef` selects an existing table. A source row/cell index plus omitted `blocks` retains the cell's native contents. Explicit `blocks` replaces them; `[]` clears the cell.                                                 |
| Images and drawings                 | Insert supplied images; copy, replace, resize, crop, rotate, border and wrap existing images; create supported native shapes; edit or remove existing objects | Image `assetRef` resolves only to an attachment captured for the request. Existing objects use immutable `sourceRef` values; their relationships are rebound when moved between stories. The model does not invent image bytes. |
| Headers and footers                 | Create, replace, clear and connect default, first-page and even-page variants to sections                                                                     | Omitted stories remain unchanged. An explicitly removed header/footer is represented by a blank native story where necessary to stop accidental inheritance.                                                                    |
| Footnotes, endnotes, comments       | Create, replace, remove or move anchors; comments also carry author/initials and text ranges                                                                  | Existing anchors remain unless moved. A removed body span removes annotations that were anchored to that span. Pre-existing unanchored story bodies are retained.                                                               |
| Fields, bookmarks, content controls | Create wrappers; update, unwrap or remove existing structures; replace associated content; change control presentation/locks                                  | `native-edit` targets named structures within a retained source block. Unwrap preserves their contents; delete removes contents too. Mapped control contents require an explicit binding decision.                              |
| Sections and page layout            | Create or merge boundaries, reorder sections with their contents, change page dimensions, margins, columns and numbering                                      | An explicit `sections` array defines the complete resulting boundary sequence. `source` clones native section properties before requested overrides. Omission preserves the original boundary order.                            |

This is a bounded structured vocabulary. It is not a promise that every OOXML element can be generated from scratch. Unknown native content can remain intact through `keep` and supported source-based operations. Host document protection, unsupported native objects and failed native verification remain observable failures rather than silently flattened content.

The authoritative model-facing description is [wordAuthoringContract.ts](../../src/word/utils/wordAuthoringContract.ts). The parser and source validation are in [wordDocumentPlan.ts](../../src/word/utils/wordDocumentPlan.ts); object-specific schemas live beside it.

## Source ownership and scopes

`read_document_blocks` delivers one immutable snapshot in sequential, bounded pages. The final page returns its read token. Body sources, story records and the section inventory all count toward complete delivery for a full-document capture. Rich object metadata may span `structureJson` fragments; concatenate them in `structurePart` order before parsing.

- Body references such as `b1` are consumed exactly once by `keep`, `replace` or `deleted`. Output order defines the new document, independent of source order.
- All new block IDs, including nested table cells and story content, are unique. They also cannot collide with a kept body reference.
- A story's native source alias is `story_` plus its returned ID. The source XML and binary data remain on the host. A body-only fallback cannot reuse an undelivered story source by guessing this alias.
- `scope: "body"` has no story or section edits. `scope: "document"` requires a complete file capture with `fullDocument: true`.
- Notes and comments anchor to output body block IDs or kept body references. New comments use UTF-16 text offsets; a note anchors at one position. Story content cannot become a body annotation target.
- A section's `after` reference names a top-level body output. Boundaries follow output order; the final section omits `after`. Header/footer bindings must identify the matching existing or newly created story type.
- Section inventory includes `afterBlock`, the usable body source reference for its existing boundary. `afterParagraph` is descriptive source position metadata; it is not an output anchor.

Validation covers source ownership, style references, media/attachment references, native selectors, section bindings, duplicate IDs and read coverage before any native mutation. Compilation then checks the resulting package and exact annotation/layout mechanics. A successful parser result alone is not authorization to mutate Word.

### Table reference dependencies

Rows and cells take their output positions from array order. A `sourceIndex` identifies an original row or cell in the captured inventory; reordering does not change that index. Each source row can appear once per table, and each source cell once within its row.

| Table content                    | Table `sourceRef`        | Row `sourceIndex`  | Cell `sourceIndex`  | Cell `blocks`                                                   |
| -------------------------------- | ------------------------ | ------------------ | ------------------- | --------------------------------------------------------------- |
| New table                        | Absent                   | Absent             | Absent              | Required; `[]` is an empty cell.                                |
| Existing cell in an existing row | Captured table reference | Original row index | Original cell index | Omitted retains contents; `[]` clears; supplied blocks replace. |
| New row in an existing table     | Captured table reference | Absent             | Absent              | Required for every cell.                                        |
| New cell in an existing row      | Captured table reference | Original row index | Absent              | Required.                                                       |

The parser requires the complete table → row → cell reference chain for a source cell. Row/cell indexes on a table without `sourceRef` are invalid even if cell contents are provided. A source table with `sourcePatchSupported: false` supports intact retention or replacement by a new typed table without source references.

## Typed example

This example assumes `b1` and `b2` are the complete body inventory, `section-1` is the captured final section, and the actual snapshot/read tokens replace the placeholders. It creates a heading and table, preserves a source paragraph, adds a header and a footnote, then changes page layout. The table cell IDs and story block IDs belong to the same unique output namespace.

```json
{
  "version": 1,
  "snapshot": "snapshot-token",
  "readToken": "complete-read-token",
  "scope": "document",
  "entries": [
    {
      "kind": "replace",
      "source": ["b1"],
      "blocks": [
        {
          "id": "title",
          "type": "heading",
          "level": 1,
          "text": "Decision brief"
        },
        {
          "id": "comparison",
          "type": "table",
          "columns": [220, 220],
          "format": { "firstRow": true, "bandedRows": true },
          "rows": [
            {
              "format": { "repeatHeader": true },
              "cells": [
                {
                  "blocks": [
                    { "id": "cell-topic", "type": "paragraph", "text": "Topic" }
                  ]
                },
                {
                  "blocks": [
                    {
                      "id": "cell-decision",
                      "type": "paragraph",
                      "text": "Decision"
                    }
                  ]
                }
              ]
            },
            {
              "cells": [
                {
                  "blocks": [
                    {
                      "id": "cell-timing",
                      "type": "paragraph",
                      "text": "Timing"
                    }
                  ]
                },
                {
                  "blocks": [
                    {
                      "id": "cell-pilot",
                      "type": "paragraph",
                      "text": "Start the pilot in October"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    { "kind": "keep", "source": ["b2"] }
  ],
  "deleted": [],
  "stories": [
    {
      "kind": "upsert",
      "type": "header",
      "id": "brief-header",
      "blocks": [
        {
          "id": "header-label",
          "type": "paragraph",
          "text": "Decision brief · Internal"
        }
      ]
    },
    {
      "kind": "upsert",
      "type": "footnote",
      "id": "pilot-note",
      "blocks": [
        {
          "id": "note-detail",
          "type": "paragraph",
          "text": "Timing is subject to the final pilot approval."
        }
      ],
      "anchor": { "block": "cell-pilot" }
    }
  ],
  "sections": [
    {
      "id": "brief-layout",
      "source": "section-1",
      "layout": {
        "orientation": "portrait",
        "margins": { "left": 54, "right": 54 }
      },
      "headers": { "default": "brief-header" }
    }
  ]
}
```

Paragraph and table dimensions use points. Media properties explicitly use names such as `widthPt`. Image crop requires all four edges (`left`, `top`, `right`, `bottom`) as percentages from 0 through 99; opposite edges must total less than 100. For example, `{ "left": 10, "top": 0, "right": 0, "bottom": 0 }` removes 10% from the left edge. The compiler converts these units to Word's native representations. Paragraph text uses separate blocks rather than embedded newlines.

For a complete clear, use document scope, no entries, explicit deletion of every body source, deletion of every returned story and one final section. Word still needs one empty paragraph and a final section. Clearing content does not require generating a series of empty replacements or preserving native objects the user explicitly asked to remove.

## Native transport and independent recovery

The full-document path captures a compressed DOCX using `Office.context.document.getFileAsync`. It converts the package to an internal Flat OPC representation, preserving its parts and relationships for deterministic compilation. Microsoft distinguishes a Word body from the broader document stories; document-level `insertFileFromBase64(..., "Replace", options)` explicitly supports importing headers, footers and section properties. A body-level insertion cannot establish that those stories changed as requested. [Word Document API](https://learn.microsoft.com/en-au/javascript/api/word/word.document?view=word-js-1.7)

The current full-document path requires WordApi 1.7, enabling the import settings used for odd/even headers and custom XML. The import enables styles, theme, paragraph spacing, page color, odd/even header settings, custom properties and custom XML. It leaves Track Changes under user control and requires it to be off for this direct-write path. [InsertFileOptions](https://learn.microsoft.com/en-us/javascript/api/word/word.insertfileoptions?view=word-js-preview), [WordApi 1.7 release](https://devblogs.microsoft.com/microsoft365dev/word-javascript-api-1-7-requirement-set-now-available/)

Before writing, the host re-reads the complete file and compares the snapshot fingerprint, document URL and tracking state. It stores the exact original DOCX bytes in the existing recovery slot before queuing the import. One native import is followed by a fresh capture and semantic verification. An exception after `context.sync()` may still mean content changed; there is no automatic retry.

The saved original is independent of Word's Undo stack. Normal Revert imports that original only when the current complete-document state still matches the observed post-apply state and the document identity matches. Header/footer-only later changes are sufficient to make the old Revert stale. The saved backup bytes are exact; Word's imported restoration is verified semantically and is not promised to produce byte-identical package serialization. If the post-write capture fails, the original remains available, but automatic guarded restoration cannot claim that later edits are absent.

An omitted header/footer reference may inherit content from a preceding section. Explicit removal therefore uses a blank native story where necessary, rather than merely dropping the reference and accidentally showing a previous header. Section properties are emitted in the schema's defined order. [HeaderReference semantics](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.headerreference?view=openxml-3.0.1), [SectionProperties schema](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sectionproperties?view=openxml-3.0.1)

Post-write verification compares the complete active document graph. Word can renumber note/comment/bookmark IDs, reorder note records, and create separate copies of an identical header for different sections. The comparison resolves those IDs and relationships while preserving each anchor's position, story text, comment author, existing durable identity, reply/resolution metadata, image bytes, field code and section geometry. New classic comments may acquire default modern metadata; a changed resolved state or reply link still fails verification. Unreferenced old header/image copies can disappear during native import, while the saved original retains their bytes. Unreferenced notes/comments and unknown package parts remain strict. [Footnote reference semantics](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.footnotereference?view=openxml-3.0.1), [Comment reference semantics](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.commentreference?view=openxml-3.0.1)

Only demonstrated native normalization is permitted on disposable comparison copies: redundant inherited font sizes/outline levels, known media fallbacks/defaults, computed auto-fit table grids when all column widths are constrained by cells, additional font registrations, and pure VML ID-allocation records. Explicit fixed table widths, changed cells, actual shape defaults and unknown extensions remain observable. Snapshot fingerprints used before Apply and Revert never call these broader post-write normalizers. [Character-style inheritance](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.runstyle?view=openxml-3.0.1), [Shape ID allocation metadata](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.vml.office.shapeidmap?view=openxml-3.0.1)

Fresh-document testing also validates initialization, not just reuse: new heading styles include their linked character styles; new footnote/endnote parts include standard separator geometry and settings; new lists contain their complete level definitions. Word may register additional unused styles/list definitions and keep separator-only note parts after restoration. Verification permits those additional registrations only when they are unreachable from retained content/style references and do not change defaults, expected definitions or unknown extensions. It preserves list-instance IDs, continuation, nesting, start values and existing durable identities. A newly assigned optional numbering identity is tolerated only when the requested definition did not already have one. Latent heading gallery priority may reflect a newly registered unused heading, while locking and other latent properties remain strict. [Latent style behavior](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.latentstyles?view=openxml-3.0.1), [Numbering identity](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.nsid?view=openxml-3.0.1), [Section numbering restart](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/cbddeff8-01aa-4486-a48e-6a83dede4f13)

Repeated native imports exposed a narrower catalog repair: Word can add theme fonts, kerning and ligature settings to an unused character style from its mutually linked paragraph style's inherited typography. Comparison allows only those three measured additions when they equal the unchanged paragraph partner's effective values and were absent throughout the original character-style chain. A directly used or derived character style, changed partner, removed/changed original property, different added value or unknown extension still fails. This rule describes unused linked-style registration; it does not loosen typography checks on document content. [Linked paragraph/character styles](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.linkedstyle?view=openxml-3.0.1)

## Limits and host permissions

- **4 MB compressed DOCX import limit:** this is a documented limit of Word's native file import. It applies to the resulting document, not just generated text. Images and retained embedded parts count. [Word Document API](https://learn.microsoft.com/en-au/javascript/api/word/word.document?view=word-js-1.7)
- **File capture uses 64 KB slices:** all slices must arrive in order, with matching sizes, and the native file handle is closed on success or failure. The slice size is a transport choice and is distinct from the document import limit. [Office Document file capture](https://learn.microsoft.com/en-us/javascript/api/office/office.document?view=common-js)
- **Bounded model context:** the current plan limit is 256 KiB; readable source metadata/text is bounded to 192 KiB, with at most 12 read pages and 2,000 output blocks. These are implementation limits, not measured claims about the maximum document Word itself can edit.
- **Native document access:** Word on macOS may show its own file-access or Grant Access prompt when capturing the complete file. This is a Word/macOS permission, separate from approving the proposed client action. Denied capture cannot be treated as a complete-file snapshot. Local validation uses an explicitly disposable document, not access to unrelated user files.
- **Host constraints:** Microsoft documents that file import does not support inserted ActiveX controls. Ordinary content-control locks are temporarily released after saving the complete original because they can otherwise prevent replacement. The imported document retains the original locks unless the typed plan changes them; failures before import attempt to restore the captured locks in the same document. Actual document protection and API refusals remain host boundaries. [Document import restrictions](https://learn.microsoft.com/en-au/javascript/api/word/word.document?view=word-js-1.7), [ContentControl properties](https://learn.microsoft.com/en-us/javascript/api/word/word.contentcontrol?view=word-js-1.7)

The add-in review is a semantic preview. Word remains authoritative for pagination, floating-object positioning, field updates and final layout. A model-generated change count or successful JSON parse cannot certify those mechanics.

## Validation layers and acceptance matrix

Automated coverage includes [package/story unit tests](../../src/word/utils/__tests__/wordStories.test.ts), [complete package transport](../../src/word/utils/__tests__/wordDocumentPackage.test.ts), [production structured compilation](../../src/word/utils/__tests__/wordFullDocumentStructured.test.ts), [plan reference validation](../../src/word/utils/__tests__/wordRichDocumentPlanValidation.test.ts) and [full writer orchestration](../../src/word/utils/__tests__/wordApplyFullDocumentPlan.test.ts).

The [2026-09-21 native rich-authoring record](mechanical-experiments/2026-09-21/structured-rich/README.md) records the tested host and final Apply/Revert outcomes. In particular, cases 97–99 start from a fresh document with no existing note/comment/header/footer/numbering parts, apply all new families, and restore the original successfully. [Raw comparison fixtures](../../src/test/fixtures/word-rich-native/README.md) retain the source/readback packages and targeted negative tests independently of the interactive harness.

The writer tests use a recorded native Word package, the real DOCX codec and simulated Office transport. They check exact backup ordering, document-level API selection, out-of-body staleness, identity, failed native sync, tracking behavior and recovery without calling native Undo. A test-only explicit namespace declaration avoids a known jsdom serializer defect; this is not a production XML-repair fallback.

| Layer                                    | What it establishes                                                                                     | What it cannot establish                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Strict parser and reference validation   | The model's intent is well formed, bound to delivered sources and internally consistent                 | Word can render or import every requested native object   |
| Compiler and package tests               | Typed output, native relationship integrity, source preservation and clear/delete semantics             | Word's native import normalization or visual fidelity     |
| Simulated full writer with real packages | Correct preflight, backup-before-write, one import, failure classification and guarded Revert mechanics | Native host behavior, permissions or platform support     |
| Disposable native Word experiments       | Actual import, appearance, read-back verification and recovery on the tested host/build                 | Other host families, arbitrary documents or model quality |
| Backend/model end-to-end exercise        | The configured model receives and uses the structured tools and consent path                            | Universal model adherence or complete native fidelity     |

Native acceptance should cover: paragraph typography; new and reshaped tables with merged cells; supplied and retained images; supported shapes; each header/footer variant; footnote/endnote creation and removal; comment ranges and metadata; fields/bookmarks/controls; section merging/reordering; full clear; original restoration after native Undo is cleared; source changes before Apply and Revert; and an exception after an actual mutation. Locked controls, existing revisions and linked/custom parts need explicit cases. Record host name/build, source and post-state packages, exact typed plans, observations and failures. Do not turn a simulated pass into a native support claim.

## Later phases

This direct-authoring contract does not add tracked suggestions or attributed comparison. Selection-focused workflows, collaboration/comment exploration, native suggestion channels and more efficient partial writes can build on the same source references, typed content and action review. Moving those later features forward is a separate scope decision. This document records implementation details locally; it does not claim the private Linear project has been updated by this change.
