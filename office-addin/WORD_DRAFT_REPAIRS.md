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
parts of rewrite rows whose blocks are unchanged.

`submit_document_plan` with `{snapshot, readToken, draft_id, revision,
finish:true}` assembles every part and runs the full pipeline. Its receipt
carries `result.plan`, as a repair's does, so review and Apply are unchanged,
plus `result.rows`. A finish with rows still unwritten is refused once; a
second finish at the same revision accepts the change with those rows kept and
names them in `notInProposal`. A refused finish names the row to send again;
the same refusal twice at one revision ends the step. The section draft has the
read session's lifetime, like the repair draft.
