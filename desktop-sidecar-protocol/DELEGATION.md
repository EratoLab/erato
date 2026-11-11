# Strict mode and the job envelope

Status: package 0.1.49. Transport protocol remains 1.0. This document is the
shared design record. It does not certify a security implementation.

## Trust model

The frontend (the web app and the Office add-in) is trusted to relay faithfully;
hardening against a malicious frontend is out of scope. The perimeter is the
sidecar process: content the user has not approved never reaches the frontend
or the backend. Under strict mode, content RPCs are denied and the job envelope
is the only content path; the review window starts with an empty selection and
no RPC can approve it; the tool enumeration is closed; and the mode comes only
from the installed bootstrap. The Origin allowlist is the single trust
anchor: bootstrap `allowed_origins` admits only canonical `http` or `https`
origins without userinfo, path, query, fragment or default port, and the
`--allow-origin` opt-in stays development-only. A strict sidecar refuses to
start when its native review is unavailable and never falls back to normal
mode. A relayed desktop UI package (`sidecar.install_ui_package.v1`) comes from
the frontend of the Origin that offered it and is verified like a downloaded
one; this relies on the same trust in the frontend. The review window renders
the deployment's own code under that trust; see
[Review window code](#review-window-code).

## Job envelope

The six `desktop/*` client tools (`list_sidecar_mailboxes`,
`get_sidecar_folder_hierarchy`, `get_sidecar_search_fields`,
`search_sidecar_index`, `get_sidecar_document`, `read_sidecar_conversation`) are
the tool catalogue in both modes. Strict mode changes how the desktop app runs
them, never which tools exist or their arguments, results and errors. One
result is strict-only, and the client gives it: when the person's "Never allow"
upload setting blocks a file they shared in the review, the call reports
`FILE_BLOCKED_AFTER_REVIEW`, an error that names that setting, instead of a
declined upload.

`jobs.start.v1` takes a batch of independent calls, each `{server, name,
arguments}`. `server: "sidecar"` is reserved for the six built-ins; other ids are
reserved for local MCP servers. The sidecar maps a call to internal read-only
operations, never by re-entering its RPC dispatcher, through the closed table in
[`providers/sidecar.json`](providers/sidecar.json) (exported as
`SIDECAR_PROVIDER`), which lists the RPC methods whose work each tool composes.
Administrative and operational methods are human-only and never tools:
`sidecar.configure.v1`, `indexing.*` control and benchmarks,
`sidecar.restart.v1`, `sidecar.request_permission.v1`,
`sidecar.open_data_directory.v1`, `sidecar.status.v1`,
`sidecar.install_ui_package.v1`, diagnostics and `sidecar.progress.v1`.
`outlook.list_emails.v1` and `outlook.search_emails.v1`
are RPCs, not tools. Opening an item in Outlook stays a human-initiated action.

States: `queued -> running -> completed -> read -> acked`. Under strict, a job
that calls a content tool (one with a selection, below) waits in
`ready_for_review` after running and becomes `approved` when the user approves
in the native review; an effectful tool will wait in the reserved
`awaiting_approval` before running. `declined`, `cancelled`, `expired` and
`failed` are terminal; `failed` is a failure of the job itself and carries no
results. A response that reports `completed` or `approved` carries `results`,
one entry per call in call order, and the job is `read` from then on;
`jobs.read.v1` returns them again until `jobs.ack.v1` discards them, and answers
InvalidParams for a job without results. `jobs.cancel.v1` ends a job that has
not ended and is idempotent. `jobs.start.v1` is idempotent for an identical
pending call: the sidecar returns the existing job instead of starting another,
so a client that resumes a call after a reload finds the same job and review.
A sidecar built before this rule starts a second job, and under strict mode a
second review, for the resumed call; the resumed call then ends within the
sidecar's job lifetime (one hour) with that review's outcome or `expired`, and
a decision in the first window reaches no client.
`jobs.review.v1` opens or focuses the native review of a job in
`ready_for_review` and reports the job's state; for any other job it only
reports the state. An unknown handle, or one issued to another Origin, reports
`expired`.

`jobs.start.v1` and `jobs.status.v1` take `wait_ms`: the sidecar holds the
response while the job is queued or running, or, for `jobs.status.v1`, while it
stays in the pending state it was in when the request arrived, and answers as
soon as that changes, up to discovery's `jobs.maxWaitMs`. A normal-mode call
keeps one round trip, and a status long-poll replaces polling quantization;
adaptive polling remains the fallback. A call gets an `error`, a JSON-RPC error
object, in place of its result when it does not run (a tool outside the
provider table, arguments the tool does not accept) or when its result exceeds
the budget; the other calls are unaffected. The sidecar keeps a job's
serialized results within the client's response cap
([TRANSPORT.md](TRANSPORT.md)): a call whose result would exceed the remaining
budget gets the error an oversized direct export returns, `sidecar_internal`
with `sourceError: "export_too_large"`. Same-turn sidecar calls may be
coalesced into one job, with one review under strict. See
[the example exchange](examples/jobs.json).

Direct content RPCs stay served in normal mode for clients that are not a model
(the add-in's message fetcher, the settings pane, the CLI). A client runs tools
as jobs when discovery reports `jobs`, a `sidecar` provider with
`available: true`, and enabled `jobs.start.v1` and `jobs.status.v1`; otherwise
it keeps its direct-RPC mapping until the supported sidecar floor allows
removing it. Under strict, mailboxes and search fields run without review: the
refusals under "Settings under strict mode" apply to the direct RPCs, not to the
executor's internal operations, and a composed `sources.list.v1` or
`outlook.list_mailboxes.v1` takes the account-level form listed there.

## Results and selection

A call's result is the MCP `CallToolResult` for every provider: `content`
blocks (text, image, audio, embedded resource, resource link) with
`annotations {audience, priority, lastModified}` and `_meta`, and
`structuredContent`, `isError` and `_meta`. `_meta` keys are reverse-DNS
namespaced; MCP reserves its own prefixes such as `modelcontextprotocol.io/`, and
Erato uses `ai.erato/`.

The sidecar composes and the client shapes. For a built-in tool,
`structuredContent` is a
[`SidecarStructuredContent`](schemas/jobs/sidecar-structured-content.schema.json):
under the name of each RPC method the tool ran, that method's outcome as its
direct request would have answered, `{"result": …}` or the JSON-RPC
`{"error": …}`. Which methods run, and with which parameters, is the sidecar's
closed composition. A client shapes these outcomes for the model exactly as it
shapes the direct RPCs' results, so a tool's result is the same on either path.

File bytes travel in `content`, not in the outcomes: each file is an embedded
`resource {uri, mimeType, blob}` block, and its `_meta["ai.erato/item"]` is the
JSON pointer of the object the bytes were taken from, the
`sources.get_document.v1` result's `contentBase64` or an attachment's
`contentBytes` in `outlook.get_conversation.v1`. Putting the bytes back there
restores the direct result. A file's `_meta["ai.erato/outlookProvenance"]` is
its version 1 `OutlookFileProvenance`, built by the mapping rules of
[SPEC section 20.2](SPEC.md#202-persisted-outlook-file-provenance) from the
item's identifiers and its mailbox: an email's own reference as `document`, an
attachment's containing message as `topLevelParent`. It is a navigation hint for
opening the original, never a grant; a file without a usable identity carries
none.

Each built-in declares its selection in the provider table: `items`, a JSON
pointer to an array in `structuredContent`, or `content` for the result's
content blocks, `resultMetadata`, pointers to result-level, account-level
metadata, and optionally `itemMetadata`, arrays whose entries each concern the
whole result or one item. `search_sidecar_index` selects the search hits,
`read_sidecar_conversation` the messages, `get_sidecar_folder_hierarchy` the
folder nodes and `get_sidecar_document` its file; mailboxes and search fields
select nothing (account-level). Item-level metadata travels only with its item:
a block whose `ai.erato/item` lies within an item belongs to that item, and a
`content` item brings the object its `ai.erato/item` names. Another provider's
result `_meta` crosses only through an organization allowlist of keys. Job-level
metadata is the sidecar's own, apart from the tool's `_meta`; policy findings
stay native.

## Strict review

Under strict, a job that calls a content tool freezes its calls' results as the
job's snapshot when they have run: later source changes cannot change what the
user reviews or what is exported. `jobs.review.v1` opens the sidecar's review
window. It lists the items each call's selection names, with their item
metadata and any text the result already holds (message bodies, text blocks) as
plain text, and shows no remote resources or document scripts. The selection
starts empty.
The strict review runs an upload-policy check while a model is available to
decide a policy: today the one behind the decision endpoint the policy's
metadata names; an on-device model is to follow as a second source. The
endpoint comes from the organization configuration a client relays through
`sidecar.configure.v1` (and the sidecar's persisted copy of it), so it is
trusted like the client and, through it, the deployment's server, and the
selected items' text reaches it before the user approves. The check is
advisory: approval waits until the checks of exactly the selection completed,
then goes through whatever they reported. A policy that names no endpoint is
left out, so while no model is available selecting an item sends its text
nowhere and approval needs only a selection. The decision is made only
in the window: no RPC submits it, repeated `jobs.review.v1` calls focus the open
window, and closing a pane neither cancels the job nor decides it. A review has
no client-side deadline: a client polls the job until the user decides or the
job ends.

`jobs.review.v1` may carry `client` (package 0.1.48): `platform`, the client's
`X-Erato-Platform` value (`web`, `outlook`, ...), and `locale`, its active
language as a BCP-47 tag. This is display data the sidecar does not check. The
window names the client and uses its language, and falls back to a generic name
and the operating system's language; a value the sidecar cannot use is dropped,
not refused. The window never names the Origin, because the web app and the
add-ins share it. When several callers share a job, the window names the one
that opened it: a repeated request only focuses the window. From package 0.1.49
`client` also carries `theme_mode` and `text_size`, and the window follows the
person's colour mode and text size the same way, falling back to the operating
system's colour mode and the default size. Erato's clients send the colour they
are showing, so a person on the system setting in an add-in gets the colour the
add-in takes from its Office host.

Approval exports each call filtered to its approved items: the array at `items`
keeps only the approved items, the values at `resultMetadata` are kept, an
`itemMetadata` array (the conversation's warnings) keeps its entries without the
`itemKey` field and those whose `itemKey` value matches an approved item's, each
as its `code` and that key with a fixed message for the code, and nothing else
in `structuredContent` crosses. A resource block crosses only with its item, and
item pointers in the export refer to the filtered result. A method's `error`
outcome crosses as its `code` and `data` with a fixed message, and a tool's
`isError` text as a code with a fixed message. Account-level calls in the same
job, and calls that did not run, are exported unchanged. `priority` orders
review, `audience` is honored on export, and a `resource_link` exports as a
reference only. `declined`, `cancelled` and `expired` carry no results; a client
reports them to the model as errors that a retry cannot fix, shaped like the
existing "do not retry" errors. An expired review of the user's own call, on
which the server parked the turn, is the exception: the call stays open, and
the person can ask again, which runs the call once more with a new review. A
task's call, or a call the server did not park, is still answered with the
error. A client remembers the job behind a call's review, so a re-run first
asks `jobs.status.v1` about that job: a decision made while no page was polling
is delivered, and an undecided review opens again, instead of a second job
starting.

Not implemented yet: snapshots that hold search metadata only and extract text
when the user opens an item; pinning a digest at approval and re-reading the
source at export; attachment-stripping rules for `.eml` exports; batched
loading for select-all; shaping the decision model's input; and the
`awaiting_approval` state for effectful tools.

### Review window code

From package 0.1.48 the review window renders the deployment's desktop UI
package ([section 8 of DISTRIBUTION.md](DISTRIBUTION.md#8-desktop-ui-package)):
the app, the deployment's theme, catalogs and translation overrides, and its
component kits. A sidecar with no installed package, and one built before
0.1.48, renders the seed compiled into its binary.

This code renders the items under review, so it sees content the user has not
approved, and it could post the window's actions itself. It comes from the
deployment, like the frontend, and carries the same trust: the page is not a
boundary against the deployment's own code. What the sidecar enforces for every
package:

- The window reaches nothing outside the package. Its content security policy
  admits only the package's own paths and inline data, so the page makes no
  network requests and loads no remote resources. Navigation away, new windows,
  downloads, permission requests and developer tools are refused.
- The decision stays in the sidecar process. No RPC approves a review. The
  window's approve action names items, and the sidecar accepts only items of
  the job's frozen snapshot, and only once the checks for exactly that
  selection completed. While no policy names a decision endpoint, they complete
  at once.
- A package cannot take the review away. A package whose review window does not
  speak the sidecar's message contract, or whose page does not report ready in
  time, is replaced by the seed.

## Versioning

A client reads the protocol package version and the discovery capabilities
`strict`, `jobs` and `providers` (`{id, tools, readOnly, egress, available}`).
Strict mode is installed by the bootstrap's
`mode: "strict" | "standard"`; `sidecar.configure.v1` never sets or relaxes it.
Binaries before package 0.1.44 ignore `mode`
([DISTRIBUTION.md](DISTRIBUTION.md#6-organization-bootstrap-personalization)).

## Local MCP servers (reserved)

Not implemented. A `server` other than `sidecar` names a local MCP server the
organization declares; the device adds none to the catalogue on its own. Under
strict, an effectful tool (one without `readOnlyHint`) waits in
`awaiting_approval` before it runs, and an open-world server is refused unless
the organization marks its egress trusted. Its results are `content` blocks, the
general case of the built-ins' items. Package 0.1.44 reserves `server`,
`providers` and `awaiting_approval` only.

## Settings under strict mode

Settings stay available through their fixed methods, behind the same Origin
allowlist: `sidecar.configure.v1`, `indexing.status.v1`, `indexing.reset.v1`,
`sources.list.v1`, `outlook.list_mailboxes.v1`, `sidecar.status.v1`,
`sidecar.request_permission.v1`, `sidecar.open_data_directory.v1` and
`sidecar.install_ui_package.v1`, whose result carries codes only. A strict
sidecar marks exactly these and `jobs.*` enabled in its live catalogue. Clients
gate each settings view on that availability.

Their results carry account-level data only: account and store names and
addresses, Teams tenant and user identities, on/off, priority, indexing progress,
coverage counts and dates, permission status and codes, and the desktop UI
package's digest, state codes and attempt time. Message subjects,
senders, bodies, folder names, search results, documents and conversations never
appear. Local paths and free-text errors stay native: `indexing.status.v1` omits
`indexingDirectory` and returns only the documented discovery fields;
`sources.list.v1` returns the source ID as `sourceKey`, a null `discoveryCursor`
and a locator reduced to `mailboxId`, `tenantId` and `userId`;
`outlook.list_mailboxes.v1` reports an unreadable data file with a fixed message
and no path.

Configuration cannot relax strict mode. Allowed origins, TLS and the mode come
only from the installed bootstrap; a strict sidecar drops these keys from
submitted configuration rather than persisting them. `signed_in_user` still
selects the work-account defaults. `search.*`, `sources.get_document.v1`,
`sources.get_folder_hierarchy.v1`, `outlook.get_conversation.v1`,
`outlook.list_emails.v1`, `outlook.search_emails.v1`, `sidecar.progress.v1`,
`indexing.benchmark.*` and `diagnostics.echo.v1` remain refused, as do the
unused `indexing.start.v1`, `indexing.stop.v1`, `sidecar.restart.v1` and
`erato.cancel`. The RPC boundary refuses them before running them.
