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
Pass a memoized array, give included items an `estimate` instead of adding
the same content to `virtualFiles` (both count toward the token estimate),
and list files a chip stands for in `claimsFileIds` so the file row does not
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
drop items carry `estimate`, so the host passes no `virtualFiles`. Sticky
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
