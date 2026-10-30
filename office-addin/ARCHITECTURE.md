# Office add-in architecture

One host-neutral core drives the whole add-in chat experience; each Microsoft
host (Outlook, Teams and Word today; Excel and PowerPoint later) is a thin
composition root that injects host behavior through a fixed set of seams.
Adding a host is meant to be mechanical: compose the core with host providers,
implement the seams listed below, and never modify the core itself.

## Layers

- `src/core` — host-neutral and self-contained. An eslint zones fence bans
  every import that escapes it (see Boundary enforcement). `core/auth` holds
  the neutral auth contract (`AuthSource.ts`: `AuthSource`, `BootstrapToken`,
  `InteractionRequiredError`) plus the oauth2-proxy session logic
  (`oauth2ProxySession.ts`). `core/clientActions` holds the host-neutral
  client-action primitives — the ask/always/never decision engine with its
  per-host store factory (`clientActionPolicy.ts`), the confirm-card state
  machine and auto-prompt one-shot (`useClientActionConfirmFlow.ts`), the
  settings rows (`ClientActionsSettings.tsx`), the facet lookup
  (`useAvailableActionFacets.ts`), the proposal validator
  (`proposedClientAction.ts`) and the fresh-completion tracker. They are
  generic over the action id (`TAction extends string`); each host keeps its
  own action registry and executors and binds them in (Outlook:
  `outlook/utils/outlookClientActions.ts` + the store in
  `outlook/utils/clientActionPolicy.ts`).
- `src/outlook` — the Outlook composition: `OutlookApp.tsx` (root),
  `OutlookAddinSessionController.tsx`, `OutlookAddinChat.tsx` (the Outlook
  chat host), `installOutlookComponentRegistrations.ts`, and all Outlook-only
  code in `components/`, `hooks/`, `providers/`, `utils/`, `sessionPolicy/`.
- `src/teams` — the Teams personal tab composition, a peer of `src/outlook`:
  `TeamsApp.tsx` (root, served at `/office-addin/teams`), `teamsSession.ts`,
  `providers/` (the TeamsJS lifecycle, theme and auth roots) and
  `auth/isTeamsNestedAppAuthSupported.ts`. `@microsoft/teams-js` is imported
  here and nowhere else.
- `src/word` — the Word task pane at `/office-addin/word`. `WordApp.tsx`
  composes the shared Office.js providers with Word auth, session, document
  capture, review and write components. Document protocols and OOXML
  compilation stay under `src/word/utils`; shared UI comes from the frontend library.
- The shared Office.js ring — stays in `src/providers`, `src/hooks`,
  `src/utils`: `OfficeProvider`, `OfficeThemeProvider`, `useOfficeTheme`,
  `utils/officeTheme/`, `officeAsync.ts`, the drag-drop broker
  (`officeDragAndDropBroker.ts` + `useOfficeDragAndDrop.ts`), and
  `detectExchangeOnPrem.ts`. This ring is office.js-generic and is planned to
  become `src/office`. Word also consumes this ring. The rename and injection
  of the mailbox-specific `detectExchangeOnPrem` remain separate work.
- `src/auth` — the MSAL/NAA auth sources (`entraAuthSource.ts`,
  `EntraNaaAuthSource.ts`, `isNestedAppAuthSupported.ts`,
  `UnsupportedAuthSource.ts`), consumed by host auth roots.

## Outlook manifest variants

`manifests/manifest.xml` is the shared source for Exchange Online and Exchange
Server/SE. `scripts/copy-runtime-manifest.mjs` stages it under both
`manifest.xml` and `manifest-exchange-server.xml`; the backend renders the
requirements and launch events according to the requested filename.
The nested V1.1 block repeats all three command surfaces and resources,
because nested overrides do not inherit them. Both declare pinning for message
read/compose, shared folders, and no-item-context activation for message read.
Online retains Mailbox 1.1 in the base manifest, 1.3 in V1.0, and 1.13 in V1.1.
SE requires Mailbox 1.5 at all three levels and excludes launch events and their
runtime resources.

The SE override options follow the experimental manifest attached to
[ERMAIN-1056](https://linear.app/erato-labs/issue/ERMAIN-1056).
Structural comparison with the staging distribution found the sample equivalent
to the Online manifest apart from deployed values and requirement levels. The
rendered SE variant preserves that structure and all three 1.5 requirements.
These declarations allow compatibility testing, but do not establish
client support: Microsoft documents [pinning at Mailbox 1.5](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/pinnable-taskpane),
[shared folders at 1.8/shared mailboxes at 1.13](https://learn.microsoft.com/en-us/javascript/api/manifest/supportssharedfolders),
and [no-item-context at 1.13](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/contextless).
Verify installation, pinning, and item changes on the target Exchange SE/Outlook
combination before enabling the on-prem pinning hint in `OfficeProvider`.
`pnpm run office:validate:rendered` includes both distribution variants.

## The six host seams

1. **Host component slot** — `AddinChatCore` (`src/core/AddinChatCore.tsx`)
   takes `Host?: ComponentType<AddinChatHostProps>`. The host component
   receives the full `AddinChatController` and typically renders
   `AddinChatCoreView` around host UI. Default: a built-in neutral host.
2. **Session controller strategy** — `AddinChatProviderCore`
   (`src/core/AddinChatProviderCore.tsx`) takes
   `SessionController?: ComponentType<AddinSessionControllerProps>`, which
   yields an `AddinSessionController`. The default
   `NeutralAddinSessionController` has no anchor policy and persists under
   isolated storage (`erato.addin.neutral.currentChat.v1`). Outlook supplies
   `OutlookAddinSessionController` (mail-item anchor + session policy); Teams
   supplies `createNeutralAddinSessionController` bound to
   `erato.addin.teams.currentChat.v1`; Word supplies
   `WordAddinSessionController` (one chat per document, see the Word host).
   Each host keeps an independent selection.
3. **Auth** — a host auth provider mounts `SessionAuthProvider`
   (`src/core/SessionAuthProvider.tsx`) with an `AuthSource`; `AuthGate` reads
   only the `SessionAuthCore` fields. The NAA source
   (`createEntraNaaAuthSource`) is host-portable: Outlook injects a
   mailbox-aware `LoginHintResolver`, other hosts inject a mailbox-less one.
4. **Settings contribution** — `AddinSettingsDialogCore`
   (`src/core/AddinSettingsDialogCore.tsx`) takes
   `hostContribution?: AddinSettingsHostContribution` (tab label, heading,
   description, content, optional system description, appearance notice and
   `serversToolsEntities` — the host's rows in the Servers & Tools pane, e.g.
   Outlook's actions entity wrapping the core `ClientActionsSettings`).
   A host tab requires `content`; Word contributes tool rows without a host tab.
5. **Component registry** — hosts assign `componentRegistry` overrides at
   host-module eval: `src/outlook/OutlookApp.tsx` calls
   `installOutlookComponentRegistrations()` at module scope, before React
   renders. The registry is a mutable global, so exactly one host per loaded
   document — contributions stay route-local because only the matched lazy
   route module is evaluated. `src/teams/TeamsApp.tsx` mirrors this with
   `installTeamsComponentRegistrations()`, which contributes only
   `ChatAddMenuExtraContent`: a transcript is a context chip, so a kit's
   `ChatInputAttachmentPreview` renders the tab's other files. Word registers its renderer in
   `HostCardCodeBlock`. Component-kit registrations are applied at the entry
   point via `applyComponentKitRegistrations()` in `src/main.tsx`, before any
   host route module is evaluated.
6. **Platform identifier** — stamped explicitly per host, never inferred from
   a host SDK: the `platform` prop on `AddinChatProviderCore` flows into
   messaging and is sent as the `X-Erato-Platform` request header. Values:
   `web` (shared-frontend default), `outlook`, `teams`, `word`, `addin-neutral`
   (`NeutralAddinChatPage` default), future `excel`.

## Boundary enforcement (`eslint.config.mjs`)

- Core fence — an `import/no-restricted-paths` zone: `src/core/**` may not
  import anything under `src/` outside `./core`. Backed by
  `no-restricted-globals` for `Office`/`OfficeRuntime` and a name-based
  `no-restricted-imports` denylist (`**/OfficeProvider`, `**/Outlook*`,
  `**/outlook/**`, `**/sessionPolicy/**`, `**/useOutlook*`, `**/Teams*`,
  `**/teams/**`, `@microsoft/teams-js`, `**/Word*`, `**/word/**`).
- Host peer fence — `src/outlook/**`, `src/teams/**` and `src/word/**` may not
  import each other: one host SDK and one set of registry overrides per document. The
  Teams block also carries the `Office`/`OfficeRuntime` global ban.
- Residue-ring guard — `src/hooks`, `src/providers`, `src/utils`, `src/auth`
  may not import `**/outlook/**`, `**/teams/**` or `**/word/**` (test mocks excepted):
  shared code must not depend on a host module; move it out or invert the
  dependency.
- Characterization tests —
  `src/core/__tests__/NeutralAddinChatPage.test.tsx` renders the full neutral
  page with the `Office` global deleted and asserts no office.js CDN script
  (`appsforoffice.microsoft.com`) is appended;
  `src/teams/__tests__/TeamsApp.test.tsx` makes the same assertions for the
  Teams route and pins its storage key, MSAL ordering and the exact registry
  contribution (the add-menu row, and no Outlook renderers);
  `src/core/__tests__/AddinSettingsDialogCore.test.tsx` asserts the settings
  core shows no host tab without a contribution.

## Feature config

`FeatureConfigProvider` nesting REPLACES: a nested provider rebuilds its
config from the environment and never reads the parent provider. Hosts that
need overrides must spread `SHARED_ADDIN_FEATURE_CONFIG` (exported from
`src/core/SharedAddinShell.tsx`) into their own provider — see
`OutlookFeatureConfig` in `src/outlook/OutlookApp.tsx`. Never add host- or
feature-specific overrides inline in `SharedAddinShell`.

## Conventions

- Storage keys — new keys use `erato.addin.<host>.*` (e.g.
  `erato.addin.neutral.currentChat.v1`). Existing `erato.outlookAddin.*` and
  `erato.officeAddin.*` keys stay as-is; renaming discards user state.
  Client-action decision stores are one key per host
  (`erato.addin.<host>.clientActionDecisions` for new hosts; Outlook keeps
  `erato.outlookAddin.clientActionDecisions`) — two hosts sharing a key would
  each drop the other's entries on read.
- Lingui ids — ids are stable contracts (translations and component kits key
  on them). When host copy diverges, split ids per host
  (`officeAddin.settings.appearance.system.description.neutral` vs
  `….outlook`) rather than mutating a shared id.

## Composer context

Host context (the Word document or selection, the Outlook draft or thread, a
Teams transcript) belongs in the composer's context lane: pass
`contextItems` and, where a host has one-off send prompts, `composerNotice`
through to `ChatInput`. Build each item's `state` from the same resolver the
send path calls (`previewWordSend()`, `previewOutlookSend()`), never from a
separate UI flag, so a chip cannot say "included" when nothing is sent.
`onRemove` and `onRestore` change the host's store and the resolver runs
again; the lane renders the state it gets back and announces that outcome.
Pass a memoized array and give the item that carries content an `estimate`:
the composer counts included items' estimates toward the token estimate, and
`virtualFiles` is deprecated. A facet's estimate is `actionFacetEstimate()` of
the facet the resolver built, so equal args keep one `File`. Mark an estimate
the send uploads as a file of its own (an email thread, a dropped email)
`estimateUpload`: the composer then checks it with the staged files against
the upload size and the per-message file count, and blocks Send as the server
would. The placeholder names an item over the size limit by its label, and the
lane draws that chip in the error tone with the limit leading its meta. List files a chip stands for in `claimsFileIds` so the file row does not
draw them twice. Claimed files hide only while their chip is included or
loading; a chip that stops being sent must unstage them in the same update,
or they show in the file row again, because they still send. Give items with
a quoted or long label a `spokenLabel` ("Selection", "Email thread") for
announcements. Locking is per item (`locked`, `lockReason`); the lane does
not inherit the composer's lock, except that a chip claiming files is locked
while the file row is.

Word feeds the selection and the document this way: `wordContextChips`
reads `previewWordSend()` and `useWordContextItems` turns the result into
items. The (x)/(+) choices live in `wordContextStore`, in memory only
(Office settings would save them into the DOCX), one entry per conversation
key, so two composers never write each other's choices.

Word's comments are one more chip, `word-comment`, from `previewWordSend()`
and its as-if twin (the same input with this message's "Send without
comments" and switch to the passage undone): `wordCommentChip` names the
thread that goes (at the cursor, the pick, the passage's under the setting),
the caret in several threads as a choice, or a pick that is gone, and turns
suggested when only the as-if preview carries it, so (+) brings back exactly
that. The id stays across variants and origins, and its `placement` stays
ambient, so a choice in the detail keeps focus on the chip and its place in
the lane. Passage threads and the comment map are no chip of their own:
`wordPassageComments` and `wordDocumentComments` put them on the selection and
the document; the map counts only where the facet the Send uses takes
comment_map (`wordCommentMapFacet`). "Open comments (N)"
(`wordOpenCommentsChip`) shows only while the document is off: included
whenever the Send carries them, even none, and without a document chip it is
the way to the picker when every comment is resolved. Quote, Show in Word, the
switches, "What is sent" and the picker live in the details; Show in Word
picks only a thread that goes because of the caret, and otherwise changes
nothing that is sent. The gestures stay in `wordCommentGestureStore`; while a
Send waits (a choice, a gone pick, comments Word did not hand over), the
chip's (x) and the notice's "Send without comments" answer that Send rather
than the next one, and comments the waiting Send could not read show as an
error on their chip.

The chip that carries the Send's facet (selection, document, comment or open
comments) gets that facet's estimate from `wordSendEstimateFacet()`, which runs
the Send's resolvers and its input preparation (`wordDocumentSendInput()`,
`wordDocumentFacetInput()`, `wordSelectionForFacets()`) on what render time
knows: the last capture (`useWordDocumentSource().lastBuild`, never a send's
copy) and the passage the chip shows. The comment envelopes in it are
stand-ins built from the listed threads; the Send reads them afresh.

The one-off send prompts (a Send waiting on a choice, a slow capture, comment
read progress, a failed selection read, the after-send capture and budget
notes) are `wordComposerNotice()`: one notice at a time by priority, `null`
when there is none, so the notice's live regions stay mounted. Nothing in the
Word composer renders above `AddinChatInputCore`.

Outlook feeds its chips from `previewOutlookSend()` (the facet: selection,
draft or appointment) and `planOutlookFiles()` (the files: the open thread,
each Office.js attachment, each drop), and the send uploads exactly that plan
through `resolveSelectedFilesForSend(plan)`. `outlookContextChips` turns both
into plain models and `useOutlookContextItems` into items. The choices live in
`outlookContextStore`, in memory only (roaming settings would sync them across
devices), per conversation, with item-scoped lifetimes; `afterSend` records
what a send carried and ends the choices that held for one message. Thread and
drop items carry their `.eml` as `estimate` with `estimateUpload`, so the
composer's own size and count check covers them and the add-in passes no
`sizeLimitExceeded` of its own; the draft, appointment or selection chip that
carries the facet gets the estimate of `previewOutlookSend().facet`, the same
resolver call its state comes from. Sticky
scheduling is a `composerModes` entry next to "+", not a chip, and shows only
where ending it changes the facet (`previewOutlookSend().mode`). The "+" menu
only adds what has no chip.

Teams has no resolver of its own: a transcript is nothing but uploads in the
composer's staged list, which is what the send carries. `TeamsChatInput`
mirrors that list through `ChatInput`'s `onStagedFilesChange` and
`previewTeamsSend()` keeps the picker's records whose transcript upload is
staged, keyed by upload id because transcript filenames repeat. Each becomes
one item (`useTeamsTranscriptContextItems`) whose `claimsFileIds` are the
record's staged uploads, so (x) removes the transcript and every file it
brought. The uploads are already counted, so there is no `estimate`. The chip
follows the staged list across chat switches, queue restores and sends.

A staged recording's transcription status is drawn by the shared composer on
its own file tile, in every host; there is no status card above the composer.

Selected tools show as chips next to "+" wherever the unified "+" menu is used
(every add-in surface): one button per tool that deselects it, after "+" and
the mode chips and before the model selector, as in the prototype. Under an
assistant that sets the tools, each chip shows a lock in place of its x. In a
narrow pane the chips wrap beside the controls before them and Send keeps its
corner; when the right side is wide (Exit audio mode) it moves to a line of its
own rather than cutting the chips' names. The "+" carries no count badge.

A sent user message names the context its facet carried under its text, in a
read-only "Sent with" row. Each host registers a descriptor per facet id
(`registerSentWithDescriptors()` in `installWordComponentRegistrations()` and
`installOutlookComponentRegistrations()`) that rebuilds the chips from the
stored `action_facet_args` through the formatters the composer chips use
(`wordSentWith.ts`, `outlookSentWith.ts`), so the two never read apart. A
facet that carried no user content (a mode, a reply to the open email, an
empty compose) returns `null` and shows no row. Teams registers none: its
context is uploads, which the message shows as conversations.

Editing a message runs the same lane. Its files go through the attachment
slot, a sent Teams transcript is one chip standing for its files again, and the
facet the message was sent with is a locked "Sent as before" chip: the server
sends the stored facet again with the edit, and only while it still offers
that facet, so `AddinChatCore` passes `isActionFacetAvailable` and an edit
never claims a facet the server would drop. Until `/me/facets` has loaded that
check says no, so the chip and its estimate appear once the facets are known.
A chip whose label is an excerpt (a quoted selection) shows its short name
there, so "Sent as before" keeps its room; the detail holds the passage.

## Landmines

- office.js nullifies `history.pushState`/`replaceState` on load (office-js
  #429/#1344). The add-in therefore intentionally performs zero router
  navigation. A host route that must navigate has to keep office.js off that
  route or save/restore the history functions around SDK load.
- Only one host SDK per loaded document: host SDKs patch globals, and the
  component registry holds exactly one host's overrides.

## The Word host

`WordApp` composes the shared shell and Office.js providers with Word auth
without a mailbox dependency. The manifest uses a distinct document add-in
identity and inherits deployment branding from the mail configuration.

Each document gets its own chat: `WordAddinSessionController` keeps the open
chat in pane state and remembers it per document in
`erato.addin.word.documentChats.v1`, keyed by a SHA-256 of the normalized URL.
Unsaved documents always start a new chat, and a chat whose history GET returns
404 is forgotten.

The open document is included by default (`default_settings.word_include_document`,
overridable per user and dismissible per chat); a selection the user made is
sent instead. The pane captures ahead of the send and reuses that capture until
Word reports a change (paragraph events, our own card operations, a Track Changes
check on returning to the pane, or any return where paragraph events are
unavailable); a failed read is retried at the next send, and a send never waits
on it longer than the capture deadline. Each send gets its own
copy with a fresh snapshot token. The host validates submitted structured plans
before offering consent; accepted plans still pass live-state checks before writing.
The compiler owns native XML, while the model receives typed document data.
Behavior instructions and action facets come from deployment configuration.

Writes are serialized across cards. Office.js batches can partially apply on
failure, so recovery preserves the original body or full file as appropriate.
Captures and recovery state live in pane memory and are lost on reload.

## The Teams host

`TeamsApp.tsx` composes outside-in: `SharedAddinShell` → `TeamsProvider` →
`TeamsThemeProvider` → `TeamsAuthProvider` → `AuthGate` →
`NeutralAddinChatPage` with `platform="teams"` and the Teams session
controller. It loads no office.js, so unlike the Outlook route it is free to
use the router.

- `TeamsProvider` owns the TeamsJS lifecycle and nothing else: `app.initialize`,
  `app.getContext`, the single-slot `app.registerOnThemeChangeHandler`,
  and `app.notifySuccess`/`notifyFailure`. It gates children on the handshake,
  which is what orders TeamsJS before MSAL — MSAL reads the NAA bridge exactly
  once and otherwise degrades to a non-nested client for the life of the page,
  silently. Only the handshake is fatal; a rejected `notifySuccess` is logged,
  never surfaced, because the tab is already usable by then.
- `isTeamsNestedAppAuthSupported` reads the `nestedAppAuthBridge` TeamsJS
  installs. `src/auth/isNestedAppAuthSupported.ts` cannot be reused: it is
  Office-gated, and `Office` does not exist in a tab. `TeamsAuthProvider` probes
  it per source rebuild rather than caching a verdict, so the `AuthGate` retry
  re-runs mode detection. TeamsJS skips its default bridge injection in a nested
  iframe, so the absent-bridge case is logged with the host identity.
- Auth is NAA-only, reusing `createEntraNaaAuthSource` and
  `SessionAuthProvider` unchanged, with the login hint from the Teams context.
  There is no Exchange or oauth2-proxy fallback on this route. The Entra app
  registration needs the SPA redirect URI `brk-multihub://<origin>` (origin
  only, no path).
- Serving: `frame-ancestors` for the Teams and Microsoft 365 hosts is emitted
  by `build_content_security_policy` in
  `backend/erato/src/frontend_environment.rs` whenever the add-in integration
  is enabled; deployments needing more origins still use
  `frontend.extra_frame_ancestors`. Emit no `X-Frame-Options` — any value a
  modern browser understands overrides the CSP and blanks the tab.
- Graph: `TeamsAuthProvider` mounts the shared `GraphTokenProvider` over the NAA
  source, so a Teams-hosted component can acquire a Graph token. The chat data
  layer (`src/teams/utils`, `src/teams/hooks`) reads chats, messages and search
  with delegated `Chat.Read`. Everything chat-scoped goes through
  `runGatedByChat`: Graph allows only 1 rps against a single chat, so paging one
  conversation is inherently serial and a fan-out is a bug, not a missed
  optimization. Reads across _different_ chats are what that gate cannot bound;
  `runWithChatReadSlot` caps those so a search page cannot land as one burst.
- Chat picker: `TeamsChatPickerProvider` sits above `NeutralAddinChatPage` and
  owns the picker dialog plus the in-flight transcript build. It cannot live
  under the composer's "+" popover — `AnchoredPopover` dismisses on any
  `pointerdown` outside its panel, and a portalled dialog is a DOM sibling of
  that panel, so it would close itself on first click. `open()` takes the
  composer's `TeamsComposerBridge`, which uploads through the composer's own
  path (size check, `uploadFiles`) without staging, so the provider learns the
  upload ids and records `{ lineage, transcriptUploadId, assetUploadIds }` per
  transcript. The bridge then stages the uploads, mirroring them into the
  composer's staged list in the same batch so a chip never drops for a render.
  "Edit selection" (the chip's detail, or "+" with a transcript staged)
  reopens the dialog with that record's selection and an "Update" button:
  Update rebuilds, unstages the old uploads before staging the new ones (the
  composer trims to `maxFiles` as it adds), and keeps the lineage, so the chip
  updates in place; Update with nothing ticked removes it; a failed upload
  leaves the old transcript as it was, and so does closing the dialog while the
  upload runs (each opening is a session; an upload that outlives its session
  stages nothing). A file removed in the chip's detail is noted on the record
  (`excludedAssetNames`), so an Update leaves it out. The record also keeps the
  names of every asset it handed over (`assetNames`); those the composer did
  not take, past `maxFiles` or of a refused type, are named in the detail
  rather than dropped silently. Records live in memory for the session.
- The standalone Teams manifest is staged as `manifest-teams.json` and served
  with its package from `/office-addin/teams`. Teams distribution is configured
  separately from the Outlook and Word XML add-ins.
- `manifests/manifest.json` remains as a parked combined Outlook + Teams
  manifest reference for future work. It is not staged or used by the current
  standalone Teams distribution or local Teams package flow.

## Client tools in delegated tasks

A delegated task can read through the pane its parent turn was sent from,
under a grant the server writes when the task launches. The core is
host-neutral (`backend/delegated-client-tools.md`); the Linear document
"Contract: delegated tasks with client tools" is the contract. Each host
supplies an adapter, and two conformance suites hold every adapter to the same
lineage check, read-only mode, freshness shape and loss outcomes.

### Checklist (contract §13)

| #   | Item                                                                        | Where it lives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A host context kind and a binding sent as `X-Erato-Executor`, or beside it  | The kind is compiled (`ClientToolHostContext` in `backend/erato_config/src/config.rs`). The pane registers its binding per tool with `registerOperationExecutor`; Word builds it in `word/utils/wordDocumentOperationBinding.ts`, Outlook in `outlook/hooks/useOutlookClientTools.ts`. A host whose pane also serves another host's binding registers with `{ additional: true }` (the desktop sidecar, `DesktopSidecarClientTools`): its binding travels in `X-Erato-Additional-Executors`, one per kind, and `X-Erato-Executor` stays what an older server routes by.                                                                       |
| 2   | The executor stream, handlers by tool, grant-capable tools advertised       | The shared coordinator opens one stream per binding (`openExecutorStream` in `frontend/src/lib/clientOperations/`); an additional binding's stream is held by one tab of the browser profile at a time (Web Locks). Register each read with `registerClientToolExecutor(name, execute, isAvailable, { acceptsGrantCalls: true })`; only those are listed in `X-Erato-Child-Client-Tools`.                                                                                                                                                                                                                                                     |
| 3   | The lineage check (§7)                                                      | The handler compares `ClientToolCallContext.hostGrant` with its own context owner and version before it reads anything. A context that outlives the pane has no owner turn on the device (the desktop sidecar): it checks the requesting ids and the context version, the server checks the owner at offer, dispatch, claim and every renewal, and its kit harness says `ownerCheck: "server"`.                                                                                                                                                                                                                                               |
| 4   | A read-only mode for every child-eligible tool                              | Configuration marks the tool: `child_access = "read"` and `host_context`, plus `child_context_arg` and `child_context_input` for a captured context version, and `child_host_inputs` for fields the handler fills from its own context (the task's model is not asked for them). Under `hostGrant` the handler returns no write token and no write guidance and leaves the coordinator's state alone. Write tools are registered without `acceptsGrantCalls`: `runClientToolCall`, the only place a `hostGrant` is made, used by the live dispatcher and the durable handler, answers a grant call to them with an error and never runs them. |
| 5   | A freshness producer, with its blind spots documented                       | `result.freshness` on every read (§10), listed in the host context template below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | Typed loss outcomes (§6)                                                    | A terminal `ok: false`: `validationErrors[].code` set to `capture-unavailable` (Word) or `context_unavailable`, with `submissionFeedback: { terminal: true, recovery: "cannot_continue" }`. A refusal on the device answers with the code `declined`, which becomes the `declined` outcome on both paths. On the slow path a `context_unavailable` loss completes nothing: the claim lapses and the call waits for a client that can serve it.                                                                                                                                                                                                |
| 7   | An overlay child facet                                                      | `facets.facets.<id>` with `child_host_context`: regular, not `hidden`, prompt only without `tool_call_allowlist`, listed in the coordinator facet's `delegation.child_facet_ids` and named in `facet_ids` by its template. Example: `[facets.facets.mailbox_reader]` in `backend/erato.template.toml`.                                                                                                                                                                                                                                                                                                                                        |
| 8   | Read results framed as untrusted data                                       | ERMAIN-946, before enablement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | A native gate matrix                                                        | The template below, filled for the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10  | The conformance tests pass                                                  | A backend row and a frontend handler test, see "Adding a host".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | An approval scope and its outside-change signal, or approval per call       | ERMAIN-1033.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | Pickup of durable calls after a reconnect, if the context outlives the pane | `child_dispatch = "durable"` (ERMAIN-1032): the call waits as an operation; a pane that takes grant calls gets the nudge when it connects or finds it in the inbox, claims it with `X-Erato-Child-Client-Tools`, runs it with `hostGrant` and continues the task; any client of the user continues or expires it. Word never takes the slow path.                                                                                                                                                                                                                                                                                             |
| 13  | Device approvals for a grant call registered under the owner chat           | `useConfirmationRegistryStore` under `hostGrant.ownerChatId`. The shared file approval (`useClientToolFileApproval`) does so and shows on `hostGrant.ownerMessageId` with the task's brief; it closes with the attempt (slow path) or the pushed call's `timeout_ms` (live path).                                                                                                                                                                                                                                                                                                                                                             |
| 14  | The release decision where a native component holds the data                | CT-9, in that component.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Host context template

Fill one in per host and keep it with the host's issue.

```text
Host context:          kind; identity (what the binding names); realm
Context version:       source; child_context_arg -> child_context_input, or none
Read tools:            qualified names, registered with acceptsGrantCalls
Write tools:           qualified names, registered without acceptsGrantCalls
Loss code:             capture-unavailable | context_unavailable
Freshness:             producer; capturedAt | readAt; blind spots (each reports unknown)
Child facet:           id; prompt text
Approval scope:        call | context; the outside-change signal
Outlives the pane:     no | yes (slow path, ERMAIN-1032)
Device approvals:      none | which, under the owner chat; release decision (CT-9)
Framing:               untrusted-data framing of read results (ERMAIN-946)
Conformance:           backend row; frontend handler test; enabling issue
```

Desktop sidecar (ERMAIN-1034):

```text
Host context:          desktop_sidecar; identity "local", device = this Erato
                       client's routing id (the sidecar reports no installation
                       id yet); realm desktop-sidecar; sent in
                       X-Erato-Additional-Executors only while the app is ready
                       in normal mode
Context version:       none
Read tools:            desktop/search_sidecar_index, read_sidecar_conversation,
                       get_sidecar_document, list_sidecar_mailboxes,
                       get_sidecar_folder_hierarchy, get_sidecar_search_fields
Write tools:           none
Loss code:             context_unavailable
Freshness:             readAt; changes none only for a search whose every source
                       is available, caught up and observed since the read
                       began; blind spots: a source observed earlier, newer items
                       queued, an unavailable source, no coverage reported, and
                       every non-search read; thread and document reads add
                       freshness.scope (position and added unknown until the
                       sidecar reports them)
Child facet:           desktop_delegated_search (overlay)
Approval scope:        call, until ERMAIN-1033 and the sidecar's thread counts
Outlives the pane:     yes (search, get document, read conversation durable)
Device approvals:      file uploads (get_sidecar_document, attachments of
                       read_sidecar_conversation), under the owner chat
Framing:               ERMAIN-946, before the overlay merges
Conformance:           backend row desktop_sidecar; frontend
                       desktopSidecar/chatTools.conformance.test.ts; overlay
                       erato-desktop-sidecar (draft)
```

### Native gate matrix template

Each cell holds "date · build · result". Windows first, then Mac and the web.

| Check                                                          | Windows | Mac | Web |
| -------------------------------------------------------------- | ------- | --- | --- |
| A grant read reaches the pane and returns                      |         |     |     |
| A foreign or stale grant gets the loss code                    |         |     |     |
| After a new Send, the earlier turn's grant gets the loss code  |         |     |     |
| A closed pane gives `context_unavailable`                      |         |     |     |
| Ask on the parent's card: approve reads, deny gives `declined` |         |     |     |
| A blind spot reports `unknown`                                 |         |     |     |
| Write tools refuse grant calls                                 |         |     |     |
| A device approval shows in the parent chat                     |         |     |     |

Desktop sidecar: every check is pending for classic Outlook on Windows, Mac (Full
Disk Access per build), the web app and the Teams personal app, plus two of its
own: an add-in sends both bindings and opens two streams, and two web tabs hold
one sidecar stream.

### Adding a host

- Backend: `client_tool_operations/delegated/conformance.rs` (under
  `backend/erato/tests/integration_tests/api/messages/`) runs every case once
  per row of `delegated/rows.rs`, against a test-driven pane. A row names the
  host's binding, read tool, action-facet arguments, context version, the part
  a read asks for and the freshness its pane reports. A new host adds one row
  constructor and one `host_conformance!(module_name: row())` line.
- Frontend: `clientToolHostAdapterConformanceFailures` from
  `@erato/frontend/conformance` runs the host's registered handlers through
  the registration, lineage, read-only, device-approval and freshness rules and
  returns the failures. Every grant call must settle within a second, or a
  second after its approval is answered. The host's handler test supplies the
  harness: how a turn starts, the coordinator's state (Maps and Sets count by
  content), the inputs the host fills itself (`child_host_inputs`), one call
  per read tool, the write tools, the write markers, the blind spots and any
  device approval. A read that asks on the device also gets every bad grant and
  must refuse it before it asks; a host whose every read asks lists none and is
  checked through that read.

Status:

- fake host: passes on both sides, with and without a context version
  (`frontend/src/conformance/clientToolHostAdapter.test.ts`);
- `word_document`: registered and skipped until ERMAIN-1003
  (`word/utils/__tests__/wordGrantReadConformance.test.ts`);
- `outlook_mailbox`: registered and skipped until ERMAIN-1006
  (`outlook/hooks/__tests__/outlookGrantReadConformance.test.ts`);
- `desktop_sidecar`: passes with the server checking the owner
  (`frontend/src/lib/desktopSidecar/chatTools.conformance.test.ts`; backend row
  `desktop_sidecar`, slow path included).

## Scoped Word cell reads

Authoring sends document identity, snapshot token, status and paragraph counts;
`wordActionFacet.ts` withholds the paragraph excerpt and heading outline. The
capture remains complete on the host. Review-only facets retain their excerpt.
An authoring capture has no initially writable paragraph ordinals, so paragraph
replacement artifacts cannot target text withheld from the model. Broader
requests use the existing paginated read and complete-plan workflow. Application
and customer instructions, permissions and MCP routing are unchanged.

`read_document_blocks` has an additive `table_cell` query with an explicit
`documentIdentity`. `wordTableCellRead.ts` searches the immutable inventory using
nearby text, first-row headers, first-column labels, current cell text and exact
source coordinates. These labels describe physical positions, not inferred
semantic roles. Search filters are bounded ANDed substrings. Results distinguish
not-found, ambiguous, unsupported and ready; ambiguity yields at most five
candidates per offset page and grants no authorization. Snippets are at most
256 serialized UTF-8 bytes and explicitly indicate truncation. A ready result
contains the exact target text (at most 4096 UTF-8 bytes), coordinates and a
random cell-scoped read token. At most 16 scopes are retained per request.

`wordTableCellScope.ts` binds that token to snapshot, identity, fingerprint and
exact original cell/text. Chat and assistant-request ownership remains in
`WordDocumentReadSession`. Targeted reads never mark body, story or layout
records as read and never create the full-read token. Scoped submissions must
use the existing concise envelope; full plans and repairs still require full
coverage. The host expands the concise edit into a complete plan. Validation
compares the entire normalized plan to the deterministic one-cell expansion,
including all keep entries and retained rows/cells, before ordinary validation,
compilation and preservation verification. Review and Apply repeat this scope
check; Apply also retains live fingerprint, document URL, tracking, consent and
recovery checks. A read grants no write permission.

The expanded plan is kept in the accepted receipt for review, as with the
existing concise implementation. Acceptance terminates model generation; later
receipt replay excludes the plan. Rejections on the scoped path expose bounded
diagnostics, with no materialized draft. All submission forms retain the shared
three-attempt deployment budget and existing argument/source/plan limits.

Discovery, scope authorization and plan validation use snapshot data and XML
utilities without Office.js calls. This keeps the editing core reusable by a
future server MCP or WASM host. This change uses the existing Office.js package
writer; it adds no native cell writer, MCP server or WASM runtime.

The supported operation remains one plain-text paragraph with uniform run
formatting in a standalone, unmerged body table. Rich/multiple paragraphs,
wrappers, nesting, merged cells, oversized target context, row changes and
formatting changes use complete reads and existing authoring. Existing capture
and conservative model-budget eligibility limits are unchanged. Tests cover
bounded context, scoped authorization and preservation.
