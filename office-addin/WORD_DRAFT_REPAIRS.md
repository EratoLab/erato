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
