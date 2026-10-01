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
different handling of Word's tracking setting. Structured application still
requires Track Changes to be off; native revision suggestions are separate work.

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
