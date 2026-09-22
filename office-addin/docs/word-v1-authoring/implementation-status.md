# Word v1 implementation status

Current structured implementation · native validation recorded 20–21 September 2026

The active implementation uses the **structured authoring contract** for all six content families. The model returns typed JSON; the host compiles Word content. The raw model-OOXML experiment remains on `feature/word-ooxml-experiment` and its interface is not active.

## Current behavior

| Area                        | Current behavior                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraphs, headings, lists | Create, split, merge, reorder, remove, and apply run/paragraph formatting: fonts, colors, spacing, indentation, borders, shading and pagination options.                                                                                                                                                                    |
| Tables                      | Create tables; replace or retain cell contents; add, remove and reorder rows/columns; spans; table, row and cell formatting. Explicit column widths default to a fixed-width table.                                                                                                                                         |
| Images and drawings         | Insert captured image attachments; copy, replace, resize, crop, rotate and restyle existing images; create supported native Word shapes; modify/remove existing objects.                                                                                                                                                    |
| Document parts              | Create, edit, clear and remove headers, footers, footnotes, endnotes and comments; bind running content to sections and move annotation anchors.                                                                                                                                                                            |
| Native structures           | Create/update/unwrap/remove fields, bookmarks and content controls. Ordinary control locks can be changed within the approved operation; original locks are recoverable.                                                                                                                                                    |
| Sections and layout         | Create, remove and reorder section boundaries, change page size/orientation, margins, columns, numbering and first/odd/even-page running content.                                                                                                                                                                           |
| Review                      | Structure, full draft, source mapping and document parts. Rich previews include cells, media, object operations and page measurements. Shared frontend components provide controls and themed chrome. Completed operations collapse to receipts.                                                                            |
| Apply and recovery          | Full-document capture and native file import on supported hosts, strict source-state checks, semantic readback verification and an original DOCX saved before any mutation. Revert is independent of native Undo and refuses to overwrite later edits. An uncertain result retains the backup for guarded restore/download. |
| Configuration               | Matching structured authoring instructions in the private configuration package and ignored local backend configuration. The runtime read-tool contract is authoritative.                                                                                                                                                   |

The [structured rich authoring contract](structured-rich-authoring.md) details supported fields, examples and native transport. [Deployment notes](structured-rich-content-deployment.md) identify the exact configuration sections and local retest steps. Earlier design and audit pages are historical records; this page describes the active scope.

## Model interface and large documents

`read_document_blocks` pages an immutable body, story and section inventory. Complete delivery is required before issuing the read token. Source XML, relationship data and attachment bytes remain on the host. Paragraph-wide run formatting is represented once as `format.font`, avoiding duplicate source text. Mixed formatting keeps its exact run boundaries.

The complete ordered plan accounts for every body source once through keep, replace or delete. Nested IDs, style references, object selectors, annotation anchors and section bindings are validated before writing. Native source objects are no longer globally keep-only.

[Validated submissions](validated-plan-submissions.md) carry plans through `submit_document_plan` and return parser feedback before creating a review card. [Snapshot lifecycle and task integration](snapshot-lifecycle-and-tasks.md) explains request ownership, recovery of stale first-page reads within their request, and the requirement to capture fresh state after a write.

Read budgets remain bounded at 192 KiB of projected source and 12 pages; plan JSON is limited to 256 KiB and 2,000 output blocks. The selected model's available context is checked separately. These input budgets do not prevent verification or recovery of a valid expanded output.

## Host and recovery boundaries

Complete document editing requires WordApi 1.7 and compressed-file capture. The native file importer limits DOCX input to 4 MiB. Older hosts retain the body-only path and cannot acquire document-part editing by declaring a broader scope.

Track Changes must be off. Document protection, passwords and rights management are not removed. For ordinary content-control locks, the host saves the original first, unlocks outside-in, imports the reviewed structure and retains its requested locks. A rejected import attempts to restore surviving original locks in fresh native contexts.

Native Word may rename parts, reindex annotation IDs, add compatible drawing fallbacks and normalize inherited formatting. Readback verification compares the resulting content, references, formatting and active document parts. The stricter fingerprint still detects later changes before Apply or Revert. Unknown content is not flattened to make verification pass.

The complete original remains in pane memory until replaced by a later write or lost on pane reload. Failed application/restoration retains it; successful restoration clears the recovery slot. A failure-state download returns the original DOCX bytes. Body-only fallback recovery still uses the saved body XML.

## Validation

Native Word Mac validation for this expansion includes formatted text, table cell/row changes, existing-object updates, all content families together, document parts/layout, fresh-document creation, full clear, locked controls, many edits in a long document, interrupted writes and stale Apply/Revert checks. A 368-block result was restored after clearing native Undo. Independent Python DOCX profiles found no differences after eleven tested restorations, including native objects and annotation content.

The [rich-content evidence](mechanical-experiments/2026-09-21/structured-rich/README.md) records actual outcomes, independent checks and narrow-pane screenshots. The [validation index](mechanical-experiments/README.md) explains the compact tracked evidence and local archive of native packages and harnesses. The [earlier structured reliability evidence](mechanical-experiments/2026-09-20/structured/README.md) remains the prior baseline. Native Windows and Word web have not been exercised in this run; unit tests do not substitute for those host checks.

Final automated validation: 1,997 tests across 178 files passed, alongside formatting, strict ESLint, TypeScript, locale extraction and the production build. Existing missing translations outside this Word work and existing large-bundle warnings remain. The review was checked at 320/400 pixels in light/dark themes, including wide-table keyboard scrolling and exact recovery-download bytes.

### Follow-up: Responses context estimates

A manual GPT-5.2 test exposed a backend failure before token counting: reasoning replay bypassed the estimator's synthetic message repository and looked up its unsaved draft in the database. The Word gate previously reported both a failed lookup and an insufficient context estimate as `model-budget`. Replay now uses the supplied repository, and the add-in reports failed estimates separately as `budget-unavailable`, with distinct timeout text and fixed diagnostic codes. Neither case bypasses the budget check.

The endpoint regression covers new-chat, existing-chat and previous-message estimates with a Responses provider and persisted reasoning metadata, without calling a model or modifying message history. Word tests cover HTTP errors, malformed statistics, timeout, actual insufficient capacity and recovery on a new send. The updated add-in run passed 2,006 of 2,007 tests; the existing native-Apply verification test that hit its five-second timeout during backend compilation passed in a separate seven-test rerun. Formatting, strict ESLint, TypeScript, locale extraction and the production build also passed. This follow-up does not add native Word host evidence to the earlier recorded experiments.

Backend validation also passed: `just lint` across all three feature combinations, `just test` with 1,133 passing tests and four pre-existing skips, and `just generate_open_api_check`. The existing Clippy warning in `tests/integration_tests/config.rs` remains; no warning was introduced by the budget fix.

## Local retest

Use this existing checkout. Rebuild and restart the backend to load the code fix and targeted configuration change, run `just dev-linked` from `office-addin`, reload the Word pane, include the document and send a new request. The same chat can be reused; existing messages retain their old contracts and source tokens. A broad rewrite uses **Apply document rewrite** and the structure/draft/document-parts review; focused wording edits still use the paragraph review.
