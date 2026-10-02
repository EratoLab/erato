# Scoped document editing

Structured authoring starts with document identity, snapshot identity and counts.
Source content stays in the host until explicitly read. Application/customer
instructions, action permissions and configured tools keep their existing paths.

`read_document_blocks` supports three modes:

- `table_cell`: the existing concise, uniform-text cell operation.
- `target`: bounded discovery and complete reads of selected objects/ranges.
- No target selector: complete, sequential document pagination.

Target searches use `kind`, `text` and adjacent-body `nearbyText`. Multiple
matches return at most five candidates and no authorization. Select exact `ref`
or `refs`, or `ref`/`throughRef` for a contiguous body passage. A ready read
contains at most 16 selected targets and 24 KiB for the complete result,
including identifying context, guidance and metadata. Oversized targets grant no scope and
require a narrower selection or complete reading. Repeated unsuccessful searches
are identified without inventing candidates. Source text is untrusted data.

## Coverage

| Family                     | Scoped operations                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Paragraphs/headings        | Replace text/formatting, insert, delete, move, contiguous ranges                                                           |
| Lists                      | Item/range changes and insertion using captured list identity and level                                                    |
| Tables                     | Existing concise cell operation; typed replacement of a bounded table for rich cells, rows, columns, merges and formatting |
| Images/drawings            | Native object update/delete; insertion through typed blocks and captured assets                                            |
| Fields                     | Native update/unwrap/delete; insertion of supported fields                                                                 |
| Bookmarks/content controls | Native update/unwrap/delete, properties/bindings, typed insertion                                                          |
| Headers/footers            | Replace/delete selected stories; create with a read section association                                                    |
| Footnotes/endnotes         | Replace/delete stories, create or relocate with read body anchors                                                          |
| Comments                   | Replace/delete comments; create or relocate with read text-range anchors                                                   |
| Sections/layout            | Sparse property changes, reassociation, boundary changes, splits and merges                                                |

Object selectors identify native objects inside a source fragment; a native
object update preserves that fragment's other content. Rich/nested table edits
use their containing block/story as the authorized boundary. Reading a large
object is not automatically permission to claim whole-document coverage.
Read each destination or insertion anchor explicitly. Removing a section
boundary requires both affected sections. Context neighbors are read-only.
The existing typed compiler still determines which structures are supported;
this protocol does not make every Word feature editable.

`submit_document_plan` accepts `{snapshot,readToken,scoped_edit}`. The change set
contains optional `body`, `objects`, `stories` and `sections` collections, each
limited to 16 entries and 24 KiB total submission size. The host materializes
all unchanged keeps and untouched sections. Overlapping writes and reuse of
unread source references are rejected. Scope capabilities bind document identity,
snapshot fingerprint and request ownership. Review and Apply accept only the
exact normalized plans materialized through that capability. Full plans/repairs
still require complete read coverage. Submission attempt limits are unchanged.

Scope-aware model-budget preflight reserves bounded read/proposal context.
Complete reading runs its separate full-rewrite budget check on demand. Failed
complete-read budgeting does not revoke otherwise valid scoped reads. Existing
host capture, file-size, block-count and source-size limits remain.

The UI presents selected changes first, with the complete document preview in
a disclosure. Existing permission checks, stale-document rejection, backups,
revert guards, compilation, Word application and post-write verification remain.
The separate paragraph-review route remains for compatibility, including its
different handling of Word's tracking setting. How Apply writes, verifies and
undoes a plan, including under Track Changes, is described in "Applying a plan".

Discovery, scopes and sparse materialization use only the immutable snapshot and
host-independent editing types. They neither call Office.js nor require a server.
The current Office.js adapter continues to apply the materialized plan.

## Choosing an efficient read

| Task                                           | Read path                  | Why                                                                                                            |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| One supported plain-text cell update           | `table_cell`               | Reads one cell and accepts a concise submission.                                                               |
| One identified passage or object               | `target`                   | Reads the complete preservation boundary and retains the rest internally.                                      |
| Several sources, destinations or dependencies  | `target: {queries: [...]}` | Resolves all selectors into one scope without separate discovery and rereading.                                |
| New structure or different style               | Target read plus `include` | Requests the required vocabulary and metadata based on intended output, even when the source has another kind. |
| Broad rewrite or whole-document coverage claim | Complete sequential reads  | Establishes coverage for everything the model must consider.                                                   |

These choices follow task scope, not a document-length threshold. Ambiguity is a
reason to disambiguate or clarify, never a reason to authorize a guessed target.
A bounded selection can still be too large; narrow it or use complete reading.

Batches contain 1–16 selectors, each using the existing search/ref/range syntax.
Every selector must uniquely resolve or explicitly select refs/a range. Results
identify refs by query index. An ambiguous or missing selector prevents **all**
authorization in that batch, including unique matches. At most five candidate
snippets are returned across a batch; unresolved selectors can be paged alone,
then all dependencies selected together. Overlapping reads are deduplicated;
they do not permit overlapping writes. The limits apply to the combined result,
not separately per selector. A ready batch issues exactly one capability.

Scoped reads automatically return guidance for selected and nested object kinds.
Optional `include` groups are `text`, `formatting`, `table`, `media`, `structures`,
`stories` and `sections`. For example, replacing a paragraph with a table requests
`include:["table"]`; inserting an attachment requests `include:["media"]`.
Only referenced styles are returned by default; `formatting` requests the style
catalogue and `media` requests captured attachment metadata. All metadata remains
bounded. A caller can reread the same refs with different guidance. Includes do
not grant source access or change the host's supported operations or validators.
Complete reads retain the full authoring contract. Model-budget estimates remain
conservative; no validation budget or complete-read gate has been relaxed.

## Applying a plan

Every scoped edit still becomes a complete keep/replace/insert plan. Apply first
compiles it and requires the strict dry-run check, exactly as before. It then
routes the whole plan one way; it never mixes routes in one Apply:

- **In place**: the plan's changes are written through the Word object model on
  the live paragraphs. Nothing else in the document is touched.
- **Import**: the complete .docx is replaced with `insertFileFromBase64`. This is
  the fallback for anything the in-place writer cannot do or undo exactly.
- **Body**: a capture without the complete package replaces the body as before.

The card shows the expected route before Apply ("Edits N passages in place" or
"Replaces the whole document because …"). Apply decides again with the live
host state, and the result reports the route that actually ran.

### Routing

`routeWordDocumentPlan` (`wordInPlaceRoute.ts`) is pure and shared by the
preview and Apply. In-place writing needs WordApi 1.6, package support, no kill
switch, no Compatibility mode and no session latch; otherwise the reason is
`disabled`, `setting`, `latched`, `host-sets` or `no-package`. The classifier
then admits only changes with an exact object-model inverse; the first failing
rule sends the plan to the import with a fixed code. A `sections` entry that
compiles to the same document as the plan without it only restates the captured
sections and does not count as a change. A replace entry with N sources and M
blocks is written pairwise: the first min(N, M) blocks rewrite their sources,
extra blocks are inserted after the last pair and extra sources deleted:

| Group       | Codes                                                                                          | Preview says it changes…              |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| Sections    | `sections`                                                                                     | sections or page layout               |
| Stories     | `stories`, `story-text`                                                                        | headers, footers, notes or comments   |
| Moves       | `moved`                                                                                        | moves content                         |
| Objects     | `native-target`, `rich-block`                                                                  | tables, images or other objects       |
| Formatting  | `format`, `run-format`, `inherited-format`, `restyle`                                          | formatting or styles                  |
| Lists       | `list`, `new-list`                                                                             | lists                                 |
| Paragraphs  | `insert`, `delete`, `split`                                                                    | adds, removes or splits paragraphs    |
| Setting     | `setting`                                                                                      | compatibility mode is on              |
| Unavailable | `disabled`, `latched`, `host-sets`, `no-package`, `host-error`                                 | none; in-place editing is off         |
| Other       | `source-shape`, `empty-text`, `boundary`, `not-invertible`, `too-many-ops`, `program-mismatch` | this change can't be written in place |

`alignment` and `host-error` come from the live read just before writing, while
nothing has been saved or written; the plan then takes the import. Once the
backup is saved there is no fallback and no retry.

Each mechanism is switched on per platform in `WORD_IN_PLACE_MECHANISMS`
(`wordInPlaceCapabilities.ts`) only after its native probe passed there. `text`
and `cell` are on everywhere. Word PC 16.0.20326 also passed `marks` (P4),
`insert` and `split` (P5), `restyle` (P7) and `delete` (P8), with Track Changes
off:

- Word PC's bold/italic setters write no complex-script twin (P2), so the writer
  also sets the bidirectional setters (WordApiDesktop 1.3); without them `marks`
  stays off and such rewrites take the import as `run-format`.
- Word PC applies List Paragraph when attaching, clears the style when detaching
  and drops a list item's numbering when its style is set (P6). The writer
  therefore leaves a list, sets the style, then joins; list items in place must
  carry List Paragraph, and a list item's restyle needs `list`.

`list`, `span`, `tracked`, `trackedStructure` and `storyText` stay off until
their probe passes. `window.eratoWordInPlaceProbe()` runs the probes in
development builds, on an empty scratch document only; a failed probe reports
the step it reached.

### Verification tiers

- `strict`: the only check for the dry run and for submission, and always tried
  first. It accepts serialization noise only.
- `content`: import writes and restores, after strict failed. It also accepts
  list identity (`nsid`, renumbered list instances), and the first paragraph's
  spacing-before and page break before it when the plan kept that paragraph:
  Word merges the first imported paragraph into the one it replaces.
- `block`: in-place writes. Untouched blocks must keep their signature, and
  written paragraphs must have exactly the planned text, marks, style and list.

Adjustment codes form a closed list: `numbering-identity`,
`list-instance-renumbered`, `first-paragraph-page-break` (a break before the
document's first paragraph has no effect) and `style-redundant-spacing` (direct
spacing equal to what the paragraph's style chain already gives it) are not
visible, while `first-paragraph-spacing` is visible and disclosed on the card. Growth in
customXml items or custom document properties is always `package-growth`, a
failure. Diagnostics carry only routes, codes, counts and part paths, never
document text, paragraph IDs or Office error messages.

The card states the outcome: **Verified** (strict or block),
**Applied with Word adjustments** (content, with a content-free "Copy details"
report), **Unverified** ("N passages don't match the proposal", with Locate per
written passage that did not verify) and **Failed**, either with nothing written
or partly written ("Word stopped after k of n changes"). Word runs a rejected
batch's commands up to the rejection, so k and n count changes (ops, headers and
footers included), not regions; when every change was written before Word
stopped, the card shows the general interrupted text instead.

### Undo

An exact .docx backup is taken before every write and stays downloadable. Revert
follows the mechanism. "Undo these changes" rewrites only the touched
paragraphs and "Reject these tracked changes" rejects only this write's
revisions; both refuse, writing nothing, once a touched paragraph changed, keep
later edits elsewhere, and count only when every paragraph is signature-exact
again. "Restore original document" restores the backup by import and refuses
once anything in the document changed. Paragraph-edit batches
(`word.apply_edits`) record the body fingerprint after writing and are reverted
only while the body still matches and Track Changes is off. When tracking blocks
the Revert, the card advises from the mode at Apply: reject the changes in Word
for a tracked batch, otherwise turn off Track Changes and revert again.

### Track Changes

The add-in reads Word's tracking mode and never changes it. With tracked writing
enabled, a plan that can be written in place goes in as tracked changes under
the signed-in user's name. A plan that needs the import is blocked: the card
says so before Apply, and submission tells the model which codes need a full
rewrite.
Passages that already hold pending tracked changes are read as native
anchored-content: they stay as they are until the user accepts or rejects those
changes in Word, and the read contract says so while tracking is on.

### Switches

- **Kill switch**: `window.WORD_FORCE_IMPORT_APPLY = true`, injected by the
  backend or set from `VITE_WORD_FORCE_IMPORT_APPLY=true` at build time. Every
  plan takes the import, and tracked captures are refused as before.
- **Compatibility mode**: a per-device setting (localStorage
  `erato.word.forceImportApply`) with the same effect; unreadable storage means
  off.
- **Latch**: an in-place write that did not verify or was interrupted sends the
  rest of the session to the import, until the pane reloads.

Earlier in-place writes can still be undone in place while any of these is on.
The copyable report's host line shows `In-place: on` or the reason it is off.
Release builds keep the kill switch on until the native probes P1–P4 pass on
Word PC and Word for the web; each further mechanism is enabled only after its
own probe passes on that platform.
