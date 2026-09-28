# Native local evidence on durable operations

Local evidence is the first production kind (`local_evidence.v1`, qualified tool
`erato/local_collect_evidence`) of the merged durable client-operation mechanism.
Both `client_tools.durable_operations_enabled` and
`desktop_sidecar.local_delegation.enabled` default off. Keep them off until the
paired native implementation and supported hosts pass consent/recovery qualification.
The sidecar task profile supports one backend replica. It reuses the generic
chat-generation lease; no separate sidecar scheduler or credential store exists.

## Authority and state

The authenticated shell establishes native challenge/context binding before it
advertises `local_collect_evidence` and `X-Erato-Executor`. The latter carries a
stable installation ID, desktop-sidecar realm and frontend origin. It is routing
metadata, not device attestation. A delegated child inherits that request context;
ordinary child client tools remain suppressed. The kind authorizes only an
explicitly selected, exclusive, asynchronous depth-one task leaf with frozen
client budget. Current policy is checked again on claim and upload.

The shared attempt owns discovery, claim leases, cancellation, expiry, continuation
and completed-call accounting. It parks the same assistant message with
`client_tool_pending`; continuation uses ordinary replay and the shared streaming
loop. No composed ChatRequest is stored. Cancellation/expiry/withdrawal withdraw
further local collection for this logical turn, while preserving model feedback.

Only the claimed device may obtain native job authorization. A narrow
`local_evidence_exports` row freezes the plan and signed binding: generic attempt
UUID maps to native `jobId`; the original generation UUID maps to native
`attemptId`; child chat UUID maps to `taskId`. Later generation leases do not
change these values. Protocol 0.1.28 needs no wire/schema change.

The frontend initiates review; only trusted native UI approves the exact frozen
selection. A public approval boolean, model text, or legacy always-allow preference
cannot authorize a native export. Installed native code, its private storage and
its review surface are trusted; OS egress confinement is outside this profile.
Approved plaintext becomes accessible to the frontend and normal backend/model
processing. Recipient enforcement after that point relies on the frontend.

## Approved upload and recovery

The native handler reads plaintext only after native approval. It uploads through
the authenticated export adapter; the adapter validates schema, hashes, size,
expiry and the frozen binding before staging immutable content-addressed blobs.
One logged transaction commits attachment records, the exact generic operation
result, the backend-signed native receipt and ready-to-continue state. The kind's
typed result validator requires that signed receipt and its exact approved package;
the generic result endpoint cannot bypass upload validation with arbitrary JSON.
This backend receipt attests durable acceptance, not an independent native-device
signature. Native consent is enforced by the trusted installed implementation.

Exact retries return the same receipt; payload replacement, stale claims and wrong
account/device/attempt are refused. Blob staging before SQL commit may leave an
unreferenced approved blob, handled by the storage provider's orphan policy.
The handler acknowledges only a durable receipt. A separate read-only receipt
inbox retains metadata for seven days after attempt expiry even after cloud
completion, so a different view can continue the task without stranding a lost
native acknowledgement. No native handles, declines, diagnostics or progress are
posted upstream; explicit user cancellation is an authenticated cloud intent.

The shared shell coordinator owns list pagination, capability routing, claims,
result retries and continuation. Each sweep starts pagination from the beginning.
The sidecar handler owns challenge/bind/start/status/review/read/upload/ack only.
Account disposal aborts outstanding work; pane closure leaves accepted native jobs
running. Another authenticated frontend may continue an accepted cloud result
without the original device. Native receipt delivery can wait for that device.

## Rebase delta

| Previous sidecar code | Current implementation |
| --- | --- |
| `message_streaming/local_jobs.rs` | Deleted; shared replay/continuation. |
| Private `Checkpoint` and `Consumption` | Deleted; message generation parameters and generic per-call charges. |
| `local_delegation_jobs`, migration 0051 | Replaced by narrow export extension, migration 0052 after generic 0051. |
| Local-job background recovery, liveness SQL and abort hooks | Removed; existing generic generation lifecycle. |
| Sidecar list/claim/cancel/resume routes | Generic client-operation APIs. |
| Native context/upload/receipt routes | Retained as the kind adapter, with transaction-generic result acceptance. |
| Hard-coded initial offer/dispatch | Compiled kind offer policy and inherited authenticated executor context. |
| `LocalTaskCoordinator` private cloud lifecycle | Generic coordinator plus `LocalEvidenceHandler`. |
| Native schemas and consent RPCs | Preserved at 0.1.28. |

Existing approval/compaction invariants remain: name-keyed
`generation_parameters.client_tools`, full replay of the current logical turn,
prior-turn receipt compaction, stable call charges and submission allowance.

Migration 0051 from the unmerged sidecar preview was never a production migration;
this branch replaces it with 0052, depending on the merged generic migration.
Do not apply an old preview database as though it were a released upgrade path.

Real-host Windows/macOS/Office qualification remains a release prerequisite.
Mocked protocol, backend and browser tests do not qualify those hosts.
