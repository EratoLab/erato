# Document snapshots across revisions and tasks

## Failure and recovery

The September 21, 2026 follow-up failure was a stale reference, not a timeout. The add-in captured the updated document and sent a new `document_snapshot`. The model reused the preceding turn's token from historical tool calls. Previously, `read_document_blocks` returned only “The document snapshot has expired.”

Each included-document send still captures Word afresh. A capture is now bound to the chat and assistant message from the server's `assistant_message_started` event, before any read tool executes. This uses the frontend library's synchronous streaming store so events arriving in one SSE chunk do not depend on an intervening React render. The binding is made once per send and follows that send's new-chat alias.

Within that bound request, a first-page read (`cursor` omitted, `null`, or `""`) with an outdated snapshot token returns the current captured first page. The response contains the authoritative `snapshot` and, when recovery occurred, `snapshotRecovery: { requestedSnapshot, restarted: true }`. This does not read Word again or switch versions mid-request. It needs no additional model call or deployment schema change.

Continuation cursors remain version-specific. A mismatched token or unknown/out-of-order cursor returns a diagnostic naming the current token and a first-page restart. No page or read coverage is granted for the failed continuation. Malformed arguments, request ownership failures, unavailable captures and used captures have distinct diagnostic codes.

Submissions and writes are never retargeted. They still require the returned snapshot, the completed read proof, complete source ownership, the original request and the live document fingerprint. Applying consumes the capture. The next editing request must capture the resulting document again. The existing original backup and Revert path remain in use.

## Task compatibility review

Reviewed the pending approvals stack through [ERMAIN-773 / PR #1208](https://github.com/EratoLab/erato/pull/1208), commit `a75c56d2a2007230f2d2697d6ba74cee46f68eff`, alongside this Word branch. These are observations about that revision, not a claim that the task stack is merged or that native Word task editing has been tested end to end.

| Workflow                                                              | Snapshot behavior                                                                                                            | Integration status                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Several read/planning/tool steps in the same assistant request        | Keep one immutable snapshot; paging, replay and read proof remain valid across tool calls.                                   | Covered by Word regression tests.                                                               |
| Approval pause followed by continuation of the same assistant message | Keep the request owner and snapshot while the pane remains open. Native apply still checks for intervening document changes. | Word session supports this; the backend continuation tool-offer gap below must be fixed.        |
| Delegated children in separate chats                                  | A child cannot bind, read, submit or inherit its parent's capture, even if it knows the token.                               | The reviewed backend intentionally withholds client tools from delegated runs.                  |
| Async task result delivered to the origin chat                        | The result does not itself capture Word. A later reaction has a distinct request and cannot adopt an earlier capture.        | A new document-aware editing step requires an explicit host capture handoff.                    |
| Another approved native write after the first one                     | Start from a new capture and read proof reflecting the preceding write.                                                      | Works through the next included-document user send; automatic task-step handoff is future work. |
| Pane reload, chat switch or document inclusion disabled               | Release the active read session. History does not restore an executable capture.                                             | A fresh document request is required.                                                           |

### Concrete backend continuation gap

In the reviewed task branch, `run_continuation` in `backend/erato/src/server/api/v1beta/message_streaming.rs` reconstructs `continuation_tools` from MCP tools and conditionally adds `delegate_task` and the wait tool. It then calls `stream_generate_chat_completion` with an empty client-tool dispatch map (`HashMap::new()`). Consequently, `read_document_blocks` and `submit_document_plan` disappear after approval even if they were offered to the original request. Resolving the facet allowlist for the task offer alone does not restore client tools.

Fix this generically when integrating the task stack: reuse normal client-tool selection for continuation, including the originating facet, currently registered client capabilities, current configuration/policies, tool-name collision handling, timeouts and submission settings. Restore the corresponding dispatch map as well as the model's tool definitions. Retain delegated-child restrictions. Resume the same assistant message; do not mint a new Word owner as a workaround.

Required integration regression: an origin turn reads a document, parks on task-plan or child approval, resumes under the same message ID, reads its next page, and submits a validated plan. Also cover withdrawn client capabilities, denied approval, replay, a closed pane and a child attempting the same tools. A successful submission must still reach host review before native application.

### Contract for later editing orchestration

Use one host coordinator for a document. Planning children can work on explicitly supplied content and return recommendations or draft blocks. The coordinator assembles and validates the complete document proposal against its current capture. Child text and task-result history are not executable snapshot grants.

For workflows that apply between steps, add an explicit host-to-task result carrying the apply outcome, followed by a fresh host capture bound to the next editing request. Take that capture only after the prior native write finishes. Keep each step's proposal, read proof and backup associated with that step, and serialize writes to the document. Scope grants must come from the host/server request lifecycle, never from a model-provided chat, task or snapshot ID. Do not relax the read tool into “whichever document is currently open.”

This patch creates the request binding boundary that such a coordinator can use. It does not grant background tasks access to the pane, implement automatic post-apply continuation, or move document XML into task metadata.

## Validation

The automated coverage includes stale first-page recovery, complete paging after a rejected old cursor, request/child/reaction isolation, synchronous send binding, new-chat alias routing, repeated tool-call replay, used/revoked captures, malformed arguments, and two full read/submit/apply revisions with both backups reverted. Native Word rendering and the pending task approval stack still require their own integration validation.
