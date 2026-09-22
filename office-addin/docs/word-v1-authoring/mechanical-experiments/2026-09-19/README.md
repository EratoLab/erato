# Word v1: OOXML editing and independent recovery experiments

19 September 2026. Real Office.js execution in **Word for Mac 16.113.1**, with Office diagnostics reporting `16.113.917.1`. Track Changes was off. These are deterministic mechanics experiments; no LLM generated the proposed documents, and no production application code was changed.

**The document-level DOCX import route is mechanically viable for the tested content. The existing application Revert needs changes before it can support that route reliably.** Body-level OOXML replacement is insufficient for the full scope tested here.

Follow-up: [real Erato backend, GPT-5.2 and native Word validation](backend-e2e/README.md) exercises the proposed OOXML interface with live model output, independent recovery, deterministic failure cases and a complete-XML versus XML-patch comparison.

## XML and OOXML

XML is a syntax. OOXML is the Office document standard, including Word's WordprocessingML, relationships, styles and other parts. A `.docx` packages these XML parts and binary resources in a ZIP file. Flat OPC packages the parts in a single XML representation, with binary resources encoded as base64.

The proposed model interface edits **Word's OOXML parts**. There is no need to invent another document XML vocabulary. Producing a DOCX file or a Flat OPC string is a packaging decision. Importing the package into the live Word document is a separate operation, with different behavior for different APIs.

## Evidence and result overview

- [Machine-readable results](results.json): 57 Office.js commands, including reads and mutations, and 23 final semantic comparisons. Commands are not counted as 57 independent test cases.
- [Read-only fingerprint differences](read-only-fingerprint-differences.json): metadata changes observed between consecutive reads with no intervening edit.
- The [local evidence archive](../README.md#local-archive) retains `2026-09-19/experiment-harness.zip`: the exact harness, fixture generator, production recovery bundle and compact execution logs. Extract this nested ZIP to reproduce the experiment.
- The original run used `/private/tmp/erato-word-mechanics-20260919` for full captures and generated fixtures. Temporary files outside the retained archive are not guaranteed to remain available.

| Experiment                                                                                                                                                                                | Observed result                                                                        | Evidence IDs           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------- |
| Full DOCX rewrite: reorder content, add a heading, edit a table cell, add a row, resize an image, edit a content control, comments, footnote, headers and footers, change section margins | Passed the prepared-document comparison                                                | 11–13                  |
| Native Undo after body OOXML replacement                                                                                                                                                  | Restored the preceding state; a second Undo restored the earlier edit too              | 2–6                    |
| Native Undo after full DOCX replacement                                                                                                                                                   | Restored the preceding state; earlier history remained available                       | 11–15                  |
| Independent full-DOCX snapshot recovery after clearing Word's native undo history                                                                                                         | Restored the tested original content and formatting                                    | 19–20 compared with 11 |
| Save and reopen the independently restored document                                                                                                                                       | Passed                                                                                 | 21 compared with 11    |
| Existing body-only snapshot restoration after a document-level rewrite                                                                                                                    | Failed full recovery: section/header/footer state was incomplete                       | 18 compared with 11    |
| Existing production Revert, invoked immediately after a body rewrite                                                                                                                      | Incorrectly returned `stale`, even without an intervening DOCX export                  | 45–47                  |
| Two consecutive body OOXML reads                                                                                                                                                          | Same tested document semantics, different production fingerprints                      | 41–42                  |
| Native table cell edit plus row insertion                                                                                                                                                 | Worked; one native Undo restored the original fixture                                  | 22–24                  |
| Native clear of a body containing mixed objects                                                                                                                                           | Removed body content, table, image, field, control and annotations                     | 25–26                  |
| Clear complete content through DOCX import, then recover from the original snapshot                                                                                                       | Content removed, including headers and footers; recovery passed                        | 28–29 compared with 25 |
| Long document: rewrite and reverse 300 of 320 numbered passages, explicitly remove 20                                                                                                     | Both insertion routes matched the prepared result; other mixed content remained intact | 30–34                  |
| Long-document snapshot recovery and native Undo                                                                                                                                           | Passed semantic comparisons, accounting for Word splitting equally formatted text runs | 30–34                  |
| 5.42 MB DOCX with an incompressible PNG                                                                                                                                                   | Full DOCX rewrite and independent recovery passed on this Mac                          | 35–39                  |
| Body OOXML rewrite of the same image-heavy document                                                                                                                                       | Body changes succeeded; full-document section changes did not match the proposal       | 36                     |
| Genuine edit after a proposal                                                                                                                                                             | Existing Revert refused to write; the later text remained                              | 52–54                  |

The genuine-later-edit refusal does **not** establish a correct guard by itself: the same implementation also refuses unchanged content. Both positive and negative cases are needed.

## What was actually exercised

The isolated task pane loaded Microsoft's production Office.js library and executed:

- `body.getOoxml()` and `Office.context.document.getFileAsync(Compressed)` for capture;
- `body.insertOoxml(..., "Replace")` for body replacement;
- `document.insertFileFromBase64(..., "Replace", options)` for document-level import;
- native table methods and `body.clear()`;
- the **existing production** `revertWordDocumentPlan` function, bundled without changing its source.

The document-level options were `importStyles`, `importTheme`, `importParagraphSpacing`, `importPageColor` and `importDifferentOddEvenPages`. Native Undo and native undo-history clearing were invoked through Word's AppleScript commands, targeting only the synthetic document by name. This exercised Word's native history; it was not a mocked undo result or a call to a desktop-only Office.js undo API.

Synthetic documents contained two sections; headings and custom paragraph styles; a numbered list; a table; an image; a locked merge-field instruction/result; an unlocked, unbound content control; a bookmark spanning paragraphs; a hyperlink; a comment; a footnote; headers and footers. The long case added 320 individually numbered passages, for 339 paragraphs in the source and 319 after the 20 removals. Its source body text was 89,569 characters. The large case used a valid 5.4 MB PNG whose data was intentionally incompressible.

Comparisons checked paragraph text and formatting boundaries, paragraph styles, native list formats, table values, image data hashes and dimensions, per-section headers/footers/page margins, field instructions, bookmark names, hyperlinks, controls, comments, notes and internal relationship targets. Used definitions for Normal, Heading1, Heading2 and EratoBody also matched in the recovery comparisons. This is not a pixel-level page-layout comparison or exhaustive validation of the OOXML standard.

Word splits text into multiple equally formatted runs during serialization. The final semantic comparator coalesces those runs. Initial strict comparisons in `phase3.json` therefore show two long-document failures; the final comparisons establish that the differences were run segmentation, with unchanged text and formatting. The initial small fixture also omitted `xml:space` on a trailing space; that fixture was corrected before the full-DOCX and long/large comparisons. The large-body comparison provides the clean evidence for the section-scope failure.

## Two implementation blockers identified

**1. The production fingerprint includes unstable serialization metadata.**

`wordDocumentFingerprint` currently compares all XML attributes except namespace declarations, and excludes only document-property parts. Consecutive `getOoxml()` calls in this Word build produced 75 differences in the rich fixture, including `w:rsidR`, `w:rsidRDefault`, `w:rsidSect`, some paragraph IDs and metadata values. No content edit occurred. Full content profiles before and after the reads matched.

The current Revert compares that fingerprint before writing. It returned `stale` immediately after replacement, after native Undo clearing, and even when supplied a freshly captured fingerprint. This issue is relevant to any application preflight that relies on the same function. It is not evidence that the user or another editor actually changed the document.

The correction needs a stable comparison of meaningful document state, with tests that both accept serializer-only changes and reject real changes. Ignoring every ID or every XML difference would be incorrect: relationships, annotation anchors, content and formatting still matter.

**2. Recovery must cover the same scope as the approved rewrite.**

The existing Revert writes `body.insertOoxml(before, "Replace")`. A direct experiment bypassing only the stale guard confirmed that this does not restore the entire document after section/header/footer changes. Full-DOCX snapshot restoration recovered the tested original, including these changes, after native Undo history was deliberately cleared. The saved and reopened result also passed.

The successful full-DOCX restore was an **experimental direct API call**, not an implemented replacement for the production Revert. A production path still needs document/proposal ownership, a stable post-state check, handling of later edits and interrupted operations, and the agreed snapshot lifetime. It restores the document content; it does not reconstruct Word's earlier native undo history.

## Empty-document behavior and size limits

Importing a DOCX containing an empty paragraph removed the requested content, but Word inserted a single space in that paragraph. This happened both with an empty text run and with a bare paragraph. A subsequent native `body.clear()` removed that placeholder. Full snapshot recovery after this sequence passed (55–57). The final empty document still contains Word's required paragraph.

Microsoft documents a **4 MB maximum** for document-level `insertFileFromBase64`, and states that document settings are not preserved by insertion. The 5.42 MB fixture succeeded on this Mac build; that observation does not establish portable support or invalidate the documented limit. File import is not a byte-for-byte replacement of every package part. [Document import API](<https://learn.microsoft.com/en-us/javascript/api/word/word.document?view=word-js-preview#word-word-document-insertfilefrombase64-member(1)>)

Native Undo worked in the tested cases. Independent recovery remains necessary: Microsoft describes Office API Undo support as incomplete. [Microsoft's Undo guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model#undo-support)

## Decision supported by these experiments

Use editing of OOXML parts to prepare a complete proposed document, and prefer the **document-level DOCX import** for the tested full-document scope. Keep a complete original DOCX snapshot for our own Revert. Repair the metadata-sensitive guard and make recovery cover the full approved scope before calling the implementation ready.

The current paragraph authoring schema and detailed diff UI are not prerequisites for the mechanics demonstrated here. This does not yet validate a new LLM authoring contract.

Windows, Word on the web, LTSC, tracking-on writes, existing revisions, coauthor races, protected controls, SmartArt/charts/OLE, arbitrary templates and recovery across add-in loss were not certified. Repeat the relevant tests in those environments before extending release claims. The archived runner uses a deliberately narrow Mac fixture-path guard and native Undo driver; adapt those explicitly for another host.

Production files were left unchanged. The temporary test add-in and HTTPS server are removed/stopped after the run; the test inputs, results and harness remain available for review.
