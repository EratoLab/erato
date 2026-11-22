# Word draft repair protocol

The Word host accepts complete plans and revision-bound repairs through the same
`submit_document_plan` executor. Deployment configuration supplies the matching
tool schema and behavioral instructions. The read contract advertises repair
capability; the plan envelope remains version 1.

A rejected host submission can include `submission_feedback.draft` containing an
opaque `id` and integer `revision`. A repair supplies the current `snapshot` and
`readToken`, that handle as `draft_id` and `revision`, and `patches`. Supported
patches are the RFC 6902 `add`, `replace` and `remove` operations. Paths address
the submitted proposal using JSON Pointer. Mutable roots are `scope`, `entries`,
`deleted`, `stories` and `sections`; identity fields are immutable. Limits are
32 operations, 512 characters per path and the existing
256 KiB complete-plan limit. Invalid patch batches leave the draft unchanged.

The host validates and compiles the materialized complete plan through the same
pipeline as a full submission. A changed rejected plan advances the revision.
An unchanged plan with unchanged diagnostics produces a terminal rejection;
object property order does not count as a change. Redelivery of the same tool
call returns its original result, including after an accepted repair, without
applying patches twice. Reusing a call ID with different arguments is rejected.

Drafts belong to the completed read's chat, assistant request and snapshot.
Clearing or replacing the read session clears correction state. A missing local
draft requires complete resubmission within the existing budget; it does not
authorize reading or changing a different capture. Backend schema failures occur
before host execution and therefore cannot create a host draft.

`submission_feedback` accompanies nonempty validation diagnostics. It is never
treated as a successful tool result. The backend preserves its bounded draft
reference and honors `terminal` only through the opt-in submission policy. Full
plans and repairs use the same per-tool attempt counter. Success ends generation
immediately; a terminal rejection ends it with `submission.status = failed`.

Accepted repair receipts include `result.plan`, the complete materialized plan,
so persisted review does not depend on local draft memory or replaying rejected
calls. Complete submissions retain their existing input-based review path.
Review still requires a valid receipt, and Apply retains live capture ownership,
validation, consent and recovery checks. Submission itself never writes to Word.

Later-turn receipt configuration must exclude `result.plan`. Current-turn model
history is not compacted by this change: repairs reduce new generated arguments
and subsequent context growth, without removing earlier full proposals.

Runtime and deployment configuration must be released together. Protocol tests
use synthetic plans; private deployment instructions remain outside this repo.

## Changes in parts

A large change can also arrive as a section plan, one part per rewritten row
and a finish (ERMAIN-1293). `plan_document_sections` needs the complete read's
final token and lists every body block exactly once, in output order, as
`keep`, `rewrite` or `delete` rows; row order moves blocks, and one rewrite row
with several ranges merges them. `write_document_section` replaces one rewrite
row's blocks by ops (`keep`, `replace` and `insert` with plain text, `delete`
with a reason) that use each block of the row exactly once. The plain-text
form and its conversion to typed blocks are in the frontend library
(`wordPlainText.ts`).

Each call is checked on arrival by the same pipeline as a full plan, on the
whole draft with its change put in; rewrite rows without a part keep their
blocks there. Diagnostics point into the call (`/rows/2/source`,
`/ops/1/text` with "Line 3: …"). A rejection changes nothing; each accepted
call advances the draft's revision. Sending the section plan again keeps the
parts of rewrite rows whose blocks are unchanged. Part calls run one at a time,
so each is checked on a draft that holds every part stored before it. They are
checked like a sparse change: where the whole-document import is `off` (Word
for the web by default), a section plan or part that needs it is refused on
arrival with `web-needs-whole-document`, not on the card after every part is
written. `title` on a keep row renames the heading the row starts with, which
then takes the built-in heading style of its level; a numbered heading takes
no title, since Word numbers it by its place.

`submit_document_plan` with `{snapshot, readToken, draft_id, revision,
finish:true}` assembles every part and runs the full pipeline. Its receipt
carries `result.plan`, as a repair's does, so review and Apply are unchanged,
plus `result.rows`. A finish with rows still unwritten, or with findings of the
code checks below, is refused once, in one refusal with the pipeline's own
errors. A later finish that would name only rows an earlier refusal named
accepts the change with those rows as they are in the document and names them
in `notInProposal`, so a row that has used its tries never costs the whole
change. A smaller plan accepted after a section plan names the parts the
section plan announced and it leaves out. A refused finish names the row to
send again; the same pipeline refusal twice at one revision ends the step. The section draft has the read session's lifetime, like the repair draft.
The read contract describes the part tools on every complete read, since the
pane does not know which tools a request offers.

From the accepted section plan on, the message's card shows its rows
(ERMAIN-1297): a Structure row for moves, merges of blocks from different
places and renamed headings, then one row per rewrite or delete row, named by
the document's own titles. Rows go Waiting, Writing, Checking, Ready from the
stored calls (`wordPartsProgress` in the frontend library); a refused part
reads as Writing while the turn runs. After the finish the plan card shows the
same rows, with Apply on top. The pane rebuilds the draft from the stored calls
(`wordPartsFromContent`) and offers Leave out only when that draft assembles to
the accepted plan exactly: Apply then writes the plan with the left-out rows
kept as they were (`wordPartsWithout`). Leaving out the reordering also puts
the rows back in document order and leaves out the renames and the merges of
blocks apart, so the rest takes the in-place route where it qualifies. At
finish, a row the draft changes whose written blocks the user or a co-author
changed in Word since the capture (for a rename, its heading only) is left out
on its own, as `changed_in_word` in `result.rows` and named in
`notInProposal`, instead of refusing the whole change; changes elsewhere are
left to Apply's live check. The whole-document import and the body route
refuse after any change, so once the document changed a rest that would still
take them leaves out the reordering too (`result.reordering:
"changed_in_word"`, and a first sentence in `notInProposalNote`, which replay
keeps), and the finish is refused as before when even that cannot go in place. The check runs again after
preparation, and a section changed meanwhile is checked once more. A part's
ops use the row's blocks in the row's own order, so moves live in the section
plan only and the card's Structure row agrees with Apply's route. Rows and
Check first both read the review of the plan Apply writes; the assembler's
record of where each entry came from maps its review rows to section plan
rows (`wordPartsApplied`).

### Code checks

Each part is also compared with the capture (ERMAIN-1298, `wordPartChecks.ts`).
The rules come from the document itself, so they need no language tables, and
meaning is left to the review:

- `numbers`: the numbers and amounts of the replaced blocks, as a multiset,
  against the new text; clause markers, a heading's own number and references
  to the document's sections by their old or new numbers are left out, and the
  numbers of blocks the part deletes may reappear in its new text, as in a
  merge.
- `clause-numbering`: the clause markers such as "(1)" or "a)" of the replaced
  paragraphs, in order, against the new lines.
- `term`: a term of the section plan's `terms` that a replaced paragraph has
  and its new text lacks.
- `row-scope`: a new line that repeats its block word for word, as the same
  kind of block (a list item's list type and level included) with the same
  bold and italic spans as the read shows them (keep it by reference), or a
  part that keeps every block of its rewrite row.
- `kept-unchanged`: a part that leaves more than half of its row's body
  paragraphs (paragraphs and list items; headings and tables do not count)
  unchanged.

A part's `allow` waives `numbers`, `clause-numbering`, `term`,
`kept-unchanged` or `cross-reference` when its change is intended; the receipt
and the finish's `rows` list what a check found and the part allowed as
`allowed`, for the rows card (ERMAIN-1297) to show. A refused part names the
line and says the fix; the shipping pipeline's own errors come in the same
refusal.

The finish checks every written row again on the final section plan and then
`cross-reference`: new text that refers, by a heading's number such as "§ 10"
or "12.1", to a section whose heading the change deletes, or newly to a
section it moves, or by its old number to a section it renumbers. A reference
the replaced text already made counts as well, except for a move. Where an old
number now belongs to another section, it still means the old section as often
as the replaced text used it, unless the new text writes the old section's new
number or uses the other section's old number less. A section moved when some
shortest way to the new order moves it and its place among the sections
changed, top-level sections counting alike whatever their size: in a swap both
sides count, a section between them does not. A refusal names the row to send
again, or to finish again to leave it unchanged.

Section numbers come from heading text with a word or sign ("§ 10",
"Section 3", "Article 5") or dots ("10.1"); a bare "3." is too common in text
to tell a reference. A heading Word numbers itself has no number in its text,
so references to it are not checked, nor is text in keep rows. A section the
request names by number or by a full title of at least two words that no row
of the section plan changes, moves or renames gets one `fix_requests` entry on
the section plan's receipt, not a refusal, since a request may name a section
only for context.
