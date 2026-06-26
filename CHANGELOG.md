# Changelog

All notable changes to this project will be documented in this file.

<!--

More docs: see bottom

Typical "Notable changes" categories to copy & paste:

#### Features and enhancements
#### Stability improvements
#### Bug fixes
#### Test coverage
#### Documentation
#### Documentation & Website
#### Security
#### Observability
#### Dependency changes
#### Chores & Developer experience
#### Other

-->

## [0.6.2] - 2026-06-26

### Notable changes

#### Features and enhancements

**Assistant Hub**: Add Assistant Hub system that allows for controlled review, publish and highlighting of assistants
in an organization ([#770][repo-pr-770], [#764][repo-pr-764], [#730][repo-pr-730])

**Outlook addin + Exchange Server**: Built out support for using the Outlook addin in an environment that uses
Exchange Server (in contrast to Exchange Online) ([#722][repo-pr-722], [#723][repo-pr-723], [#768][repo-pr-768], [#727][repo-pr-727], [#728][repo-pr-728], [#720][repo-pr-720])

**Component Kits**: Add mechanism of "component kit"s that allow for runtime loading of custom components ([#746][repo-pr-746], [#747][repo-pr-747], [#749][repo-pr-749], [#773][repo-pr-773], [#767][repo-pr-767])
  - **Breaking change**: If you previously used custom components via the `componentRegistry.ts`, you have to transition to use a component kit instead.

**JIT-compiled translation files**: .po files can now be ingested at runtime, allowing a whole custom-theme including translations to be mounted without a required build step. ([#756][repo-pr-756], [#745][repo-pr-745])

**Guided microphone quality check**: Add guided microphone quality check in Audio settings tab ([#765][repo-pr-765])

**Improved error reporting**: Add "copy error report" button for errors, as well as option to display more verbose errors ([#759][repo-pr-759])

- Added search and endless scrolling over all historic chats ([#757][repo-pr-757])
- Add language-file-driven hover titles to audio dictation and conversational mode buttons ([#683][repo-pr-683])
- Improved parsing and preview of `.eml` files ([#713][repo-pr-713], [#716][repo-pr-716])
- Add preview of `.docx` files ([#733][repo-pr-733])
- Add copy button to markdown code snippets ([#724][repo-pr-724])
- Mobile chat: unified "+" add/tools menu ([#771][repo-pr-771])
- Don't render generated image twice if mentioned in output text ([#774][repo-pr-774])
- Retrieve profile picture from Graph API [#777][repo-pr-777]
- Also pass additional headers for audio & summary generation [#743][repo-pr-743]
- Make all strings and asset paths for office manifest configurable [#748][repo-pr-748]
- Make assistant system prompt character limit configurable via erato.toml [#729][repo-pr-729]
- Outlook read-mode reply via client-action proposals [#725][repo-pr-725]
- Add backend-configured toggle for displaying Settings > Data tab [#735][repo-pr-735]
- Add optional config to mask reasoning trace text in chat UI [#739][repo-pr-739]

#### Stability improvements

- Improved audio input handling: RMS speech-onset cue + WebKit/iOS; WebKit/iOS device loss ([#753][repo-pr-753], [#734][repo-pr-734], [#761][repo-pr-761])
- Improve auto-scroll interruption and resumption ([#731][repo-pr-731])
- Proxy preview URLs via backend to fix file previews in certain file provider scenarios [#740][repo-pr-740]
- Email token-leak hardening: data-URI images, nested forwards, malformed MIME [#715][repo-pr-715]

#### Bug fixes

- Fixed loading of Outlook addin in web version of Outlook ([#755][repo-pr-755], [#776][repo-pr-776])
- Fix persisted EML MIME detection [#711][repo-pr-711]
- Fix .eml extraction special case; Use ical crate for ical/vcard parsing [#721][repo-pr-721]
- Fix Outlook thread content loss; add attachment-byte dedup [#712][repo-pr-712]
- Fix .eml token-estimate bloat from unstripped HTML/CSS [#714][repo-pr-714]
- Fix loading of audio worklet 404 in office-addin [#772][repo-pr-772]
- Fix Langfuse prompts IDs that are in folders not resolving [#758][repo-pr-758]
- Fix mount time outlook addin reload loop with stale token [#778][repo-pr-778]
- Fix generation of AZBlob download URL with Content-Disposition [#738][repo-pr-738]
- Fix read-mode reply card gating [#736][repo-pr-736]
- Fix stale newlyCreatedChatId redirect undoing New chat in add-in [#737][repo-pr-737]
- Fix rendering of  dictation/stop mic icons on mobile Safari [#742][repo-pr-742]
- Supress spurious audio dictation error toast on Safari after successful completion [#751][repo-pr-751]

#### Dependency changes

- Update Redis in Helm chart to version 8.8.0 [#718][repo-pr-718]
- Update `kreuzberg` to 5.0.0-rc.18 [#726][repo-pr-726]
- Update backend dependencies; Reduce optional features [#752][repo-pr-752]
- Update React 19.0.0 -> 19.2.7 (frontend + office-addin) [#762][repo-pr-762]
- JS toolchain & version hygiene — Storybook 8.6.18, faker v10, pnpm 11.8.0, office-addin dep pins [#763][repo-pr-763]
 
 
#### Chores & Developer experience

- Adjust usage to new registry `registry.eratolabs.com` [#760][repo-pr-760]
- Set up storybook for component-kit-example 
- Adjust component-kit-example to use busybox as base image 
- Promote config keys `experimental_assistants` -> `assistants` [#750][repo-pr-750]
- Add dev-only console forwarding + dev_logged recipe [#741][repo-pr-741]
 
#### Other

- Add option to use extraInitContainers for backend / oauth2-proxy [#754][repo-pr-754]

### Full list of changes

- feat: add language-file-driven hover titles to audio dictation and conversational mode buttons [#683][repo-pr-683]
- Fix persisted EML MIME detection [#711][repo-pr-711]
- Fix Outlook thread content loss; add attachment-byte dedup [#712][repo-pr-712]
- Defer thread .eml synthesis off the render path [#713][repo-pr-713]
- Fix .eml token-estimate bloat from unstripped HTML/CSS [#714][repo-pr-714]
- Email token-leak hardening: data-URI images, nested forwards, malformed MIME [#715][repo-pr-715]
- Recover calendar (ICS) + vCard content and filter email noise [#716][repo-pr-716]
- Update Redis in Helm chart to version 8.8.0 [#718][repo-pr-718]
- Improve add-in email context loading [#720][repo-pr-720]
- Fix .eml extraction special case; Use ical crate for ical/vcard parsing [#721][repo-pr-721]
- Extract host-agnostic auth seam from MsalNaaProvider [#722][repo-pr-722]
- Extract host-agnostic auth seam from MsalNaaProvider [#723][repo-pr-723]
- feat: add copy button to markdown code snippets (ERMAIN-340) [#724][repo-pr-724]
- Outlook read-mode reply via client-action proposals [#725][repo-pr-725]
- Kreuzberg update to 5.0.0-rc.18 [#726][repo-pr-726]
- Add Exchange server proxy for office addin [#727][repo-pr-727]
- ERMAIN-350: Emit on-prem (≤1.5) funnel manifest for Exchange SE [#728][repo-pr-728]
- feat: make assistant system prompt character limit configurable via erato.toml [#729][repo-pr-729]
- Veto NAA for on-prem mailboxes despite host support [#730][repo-pr-730]
- Improve auto-scroll interruption and resumption [#731][repo-pr-731]
- Update changelog for version 0.6.1, 0.6.0, 0.5.2 [#732][repo-pr-732]
- Add support for previewing DOCX files [#733][repo-pr-733]
- Fix start/end-of-speech truncation in audio recorders (ERMAIN-334) [#734][repo-pr-734]
- Add backend-configured toggle for Settings data tab [#735][repo-pr-735]
- Fix read-mode reply card gating (ERMAIN-364) [#736][repo-pr-736]
- Fix stale newlyCreatedChatId redirect undoing New chat in add-in [#737][repo-pr-737]
- Fix generation of AZBlob download URL with Content-Disposition [#738][repo-pr-738]
- Add optional config to mask reasoning trace text in chat UI [#739][repo-pr-739]
- Proxy preview URLs via backend to resolve CORS incompatibilities [#740][repo-pr-740]
- feat(frontend): dev-only console forwarding + dev_logged recipe [#741][repo-pr-741]
- fix(frontend): render dictation/stop mic icons on mobile Safari [#742][repo-pr-742]
- Also pass additional headers for audio & summary generation [#743][repo-pr-743]
- Add dumping of i18n_keys.json [#745][repo-pr-745]
- Set up component kit mechanism [#746][repo-pr-746]
- Make lingui i18n mechansim work with component kits [#747][repo-pr-747]
- Make all strings and asset paths for office manifest configurable [#748][repo-pr-748]
- Build component-kit-example image in seperate CI job [#749][repo-pr-749]
- Promote config keys `experimental_assistants` -> `assistants` [#750][repo-pr-750]
- fix(frontend): suppress spurious audio dictation error toast on Safari after successful completion [#751][repo-pr-751]
- Update dependencies; Reduce optional features [#752][repo-pr-752]
- ERMAIN-379: RMS speech-onset cue + WebKit/iOS audio hardening [#753][repo-pr-753]
- Add option to use extraInitContaines for backend / oauth2-proxy [#754][repo-pr-754]
- Add usage of frame-ancestors CSP directive [#755][repo-pr-755]
- Add ability to JIT compile .po files for translations [#756][repo-pr-756]
- Add backend-based search for chats [#757][repo-pr-757]
- Fix Langfuse prompts IDs that are in folders not resolving [#758][repo-pr-758]
- Add `show_verbose_assistant_errors` option; Add "copy error report" button [#759][repo-pr-759]
- Adjust usage to new registry `registry.eratolabs.com` [#760][repo-pr-760]
- ERMAIN-390: capture-track device-loss watchdog (ended/mute/unmute) [#761][repo-pr-761]
- ERMAIN-394: upgrade React 19.0.0 -> 19.2.7 (frontend + addin) [#762][repo-pr-762]
- chore: JS toolchain & version hygiene — Storybook 8.6.18, faker v10, pnpm 11.8.0, office-addin dep pins [#763][repo-pr-763]
- Add Assistant Store system [#764][repo-pr-764]
- ERMAIN-380: guided microphone-quality check (replay + transcript proof) [#765][repo-pr-765]
- Polish some assistant store interactions [#766][repo-pr-766]
- Adjust component-kit-example to use busybox as base image [#767][repo-pr-767]
- Extend office-addin setup page for Exchange server [#768][repo-pr-768]
- Rename Assistant Store -> Assistant Hub [#770][repo-pr-770]
- Mobile chat: unified "+" add/tools menu [#771][repo-pr-771]
- fix(office-addin): fix audio worklet 404 in production (ERMAIN-399) [#772][repo-pr-772]
- Set up storbyook for component-kit-example [#773][repo-pr-773]
- Don't render generated image twice if mentioned in output text [#774][repo-pr-774]
- Add https://outlook.cloud.microsoft as default frame-ancestor [#776][repo-pr-776]
- Retrieve profile picture from Graph API [#777][repo-pr-777]
- Fix mount time outlook addin reload loop with stale token [#778][repo-pr-778]

## [0.6.1] - 2026-06-08

### Notable changes

#### Features and enhancements

- Add input guardrails against prompt injection [#709][repo-pr-709]
- Make summary prompt configurable [#687][repo-pr-687]
- Feature/ermain 316 stage full outlook conversation thread for chat upload [#690][repo-pr-690]
- Make office addin ID configurable [#691][repo-pr-691]
- feat: show explicit empty state label for missing default model (ERMAIN-326) [#696][repo-pr-696]
- Add microphone settings tab and gate audio to supported Outlook hosts [#698][repo-pr-698]
- Add option to show Sharepoint disclaimer regarding unexpected sites [#699][repo-pr-699]
- Integrate oauth2-proxy session redemption in add-in [#702][repo-pr-702]
- Update default oauth2-proxy to latest version of our fork [#700][repo-pr-700]
- Add rustLog and logJson config keys to Helm chart [#708][repo-pr-708]
 
#### Bug fixes

- Fix persistence of image pointers for proper preview/download [#689][repo-pr-689]
- Fix rendering of Markdown inline image [#692][repo-pr-692]
- Fix office-addin manifest taskPaneUrl [#704][repo-pr-704]
- Wrap AddinSetupPage in I18NProvider [#693][repo-pr-693]

#### Documentation

- Add docs for audio modes [#688][repo-pr-688]
- Add script to check that all config options are documented [#694][repo-pr-694]
- Add some more docs about how to configure prompts [#695][repo-pr-695]
- Adjust docs page to rebranding [#703][repo-pr-703]
- Add README header and clean up outdated requirements instructions [#707][repo-pr-707]
 
#### Dependency changes

- Update frontend dependencies with open CVEs [#697][repo-pr-697]
- Update backend crates with open CVEs [#701][repo-pr-701]
- Update Rust toolchain to 1.96.0 and build tools [#705][repo-pr-705]
- Update sqlx to 0.9.0; sea-orm to 2.0.0-rc.40 [#706][repo-pr-706]

#### Chores & Developer experience

- fix: resolve `import.meta` CJS warning in frontend and addin dev builds (ERMAIN-312) [#684][repo-pr-684]
- Prepare release 0.6.1 [#710][repo-pr-710]


### Full list of changes (same as above; uncategorized)

- fix: resolve `import.meta` CJS warning in frontend and addin dev builds (ERMAIN-312) [#684][repo-pr-684]
- Make summary prompt configurable [#687][repo-pr-687]
- Add docs for audio modes [#688][repo-pr-688]
- Fix persistence of image pointers for proper preview/download [#689][repo-pr-689]
- Feature/ermain 316 stage full outlook conversation thread for chat upload [#690][repo-pr-690]
- Make office addin ID configurable [#691][repo-pr-691]
- Fix rendering of Markdown inline image [#692][repo-pr-692]
- Wrap AddinSetupPage in I18NProvider [#693][repo-pr-693]
- Add script to check that all config options are documented [#694][repo-pr-694]
- Add some more docs about how to configure prompts [#695][repo-pr-695]
- feat: show explicit empty state label for missing default model (ERMAIN-326) [#696][repo-pr-696]
- Update frontend dependencies with open CVEs [#697][repo-pr-697]
- Add microphone settings tab and gate audio to supported Outlook hosts [#698][repo-pr-698]
- Add option to show Sharepoint disclaimer regarding unexpected sites [#699][repo-pr-699]
- Update default oauth2-proxy to latest version of our fork [#700][repo-pr-700]
- Update backend crates with open CVEs [#701][repo-pr-701]
- Integrate oauth2-proxy session redemption in add-in [#702][repo-pr-702]
- Adjust docs page to rebranding [#703][repo-pr-703]
- Fix office-addin manifest taskPaneUrl [#704][repo-pr-704]
- Update Rust toolchain to 1.96.0 and build tools [#705][repo-pr-705]
- Update sqlx to 0.9.0; sea-orm to 2.0.0-rc.40 [#706][repo-pr-706]
- Add README header and clean up outdated requirements instructions [#707][repo-pr-707]
- Add rustLog and logJson config keys to Helm chart [#708][repo-pr-708]
- Add input guardrails against prompt injection [#709][repo-pr-709]
- Prepare release 0.6.1 [#710][repo-pr-710]

## [0.6.0] - 2026-05-19

`0.6.0` is the first release after almost 3 months, with many new features & improvements.
We highly recommend to upgrade.

### Notable changes

#### Features and enhancements

**Starter prompts**: Add starter prompts that help users kickstart a conversation ([#530][repo-pr-530], [#550][repo-pr-550]); translateable ([#553][repo-pr-553]), and overridable via custom component registry ([#566][repo-pr-566])

**.eml support**: Add support for parsing and previewing `.eml` (Email) files ([#624][repo-pr-624], [#633][repo-pr-633], [#685][repo-pr-685], [#677][repo-pr-677])
 
**Theming system improvements**: Reworked theming system, to switch from JSON-based tokens to a CSS-based approach with more consistency and flexibility to override styles via theme
([#510][repo-pr-510], [#512][repo-pr-512], [#513][repo-pr-513], [#514][repo-pr-514], [#515][repo-pr-515],
[#516][repo-pr-516], [#523][repo-pr-523], [#526][repo-pr-526], [#527][repo-pr-527], [#528][repo-pr-528],
[#536][repo-pr-536], [#556][repo-pr-556], [#545][repo-pr-545], [#563][repo-pr-563]).
Also reworked how themes are served to work with multiple platforms (web, office-addin and beyond)
([#618][repo-pr-618]).

 **Action facets**: Add "action facet" system to complement existing facet system with one-off actions requested by the user with fixed contracts
 ([#573][repo-pr-573], [#575][repo-pr-575], [#584][repo-pr-584], [#576][repo-pr-576], [#577][repo-pr-577],
[#579][repo-pr-579], [#605][repo-pr-605], [#638][repo-pr-638])

**MCP authentication**: Add multiple modes of MCP authentication: `forwarded`, `fixed` ([#595][repo-pr-595], [#602][repo-pr-602]) and support for OAuth2 ([#601][repo-pr-601]) with encrypted secret handling ([#600][repo-pr-600])

**OpenAI Responses API**: Add support for OpenAI Responses API (and compatible providers) ([#641][repo-pr-641], [#640][repo-pr-640])

**Thinking trace support**: Add general support for displaying thinking traces from reasoning models
([#649][repo-pr-649], [#637][repo-pr-637], [#642][repo-pr-642], [#650][repo-pr-650], [#679][repo-pr-679])
and improve display of tool call progress by using a unified timeline for thinking & tool calls with tracked timings
( [#659][repo-pr-659], [#657][repo-pr-657], [#681][repo-pr-681], [#658][repo-pr-658])

**Shared chats**: Add optional feature to share chats between logged-in users via link ([#565][repo-pr-565], [#615][repo-pr-615], [#503][repo-pr-503])

**Sharepoint drive listing**: Extend support OneDrive/Sharepoint support to list all available Sharepoint sites,
with search and configureable discovery sources ([#639][repo-pr-639], [#616][repo-pr-616], [#628][repo-pr-628], [#660][repo-pr-660], [#665][repo-pr-665], [#675][repo-pr-675])

**Image editing**: Enhance tool calling inputs to support image editing via MCP servers [#625][repo-pr-625]

**Outlook addin**:
- Provide frontend as library; Initial Outlook addin version [#537][repo-pr-537]
- Stabilize office-addin/frontend dev watchers [#539][repo-pr-539]
- Harden office-addin packaged dev cache invalidation [#540][repo-pr-540]
- Add add-in auth to frontend API transports [#541][repo-pr-541]
- Outlook add-in: scope email suggestions to new chats and add email picker [#543][repo-pr-543]
- Improve Outlook add-in task pane sizing and file picker popover [#544][repo-pr-544]
- Add office-addin setup page [#603][repo-pr-603]
- Serve office-adding from backend [#591][repo-pr-591]
- Expose compose selection reading via useComposeSelection hook [#580][repo-pr-580]
- Add compose body write operations for Outlook [#585][repo-pr-585]
- Handle HTML vs plain text body format for compose insertions [#589][repo-pr-589]
- Hide chat advisory in Outlook add-in [#609][repo-pr-609]
- Build EratoEmailSuggestion component for erato-email code blocks [#586][repo-pr-586]
- Selection preview chip and action facet injection on send [#587][repo-pr-587]
- Register Office-aware erato-email renderer via componentRegistry [#588][repo-pr-588]
- Dynamic insert button labels based on compose selection state [#590][repo-pr-590]
- Full body context mode for general compose writing assistance [#592][repo-pr-592]
- Fix Outlook action-facet HTML preview and insertion [#610][repo-pr-610]
- Add officeTheme utils module (ERMAIN-265) [#619][repo-pr-619]
- Add useOfficeTheme hook (ERMAIN-266) [#620][repo-pr-620]
- Add redirect-uri instruction to office-addin setup page [#604][repo-pr-604]
- Add ephemeral token estimate + add-in attachment improvements [#634][repo-pr-634]
- Wire OfficeThemeProvider into App (ERMAIN-267) [#621][repo-pr-621]
- Fix linked add-in linked-dev asset rebuilds and startup flow [#622][repo-pr-622]
- Add fallback for Outlook hosts missing body.getTypeAsync [#614][repo-pr-614]
- Fix oversized-draft errors in Outlook compose-mode chat [#635][repo-pr-635]
- Show reply-context chip when composing a reply in Outlook [#643][repo-pr-643]
- Add-in settings dialog and Outlook session policy [#647][repo-pr-647]
- Extended mail utilities support [#626][repo-pr-626]

 
- Add namespaceOverride to erato Helm chart [#481][repo-pr-481]
- Add network policies to Helm chart [#484][repo-pr-484]
- Make user preferences dialog disableable [#483][repo-pr-483]
- Add estimation of tokens in assistant form [#485][repo-pr-485]
- Add button to stop message generation/streaming [#506][repo-pr-506]
- Re-focus chat input after response streaming completes [#507][repo-pr-507]
- Turn budget warning translation strings into explicit IDs [#509][repo-pr-509]
- Adjust file upload preview to show longer filename parts [#520][repo-pr-520]
- Allow for configuring default/locked facets for assistants [#521][repo-pr-521]
- Improve Preferences dialog accessibility and reuse [#525][repo-pr-525]
- Increase size of dropzone to whole center page [#531][repo-pr-531]
- Make budget i18n strings reference "personal budget" [#533][repo-pr-533]
- Preferences -> Settings; Move theme switcher into settings [#546][repo-pr-546]
- Allow for configuring assistant form context estimate thresholds [#552][repo-pr-552]
- Add ability to add description and icon for chat_provider [#558][repo-pr-558]
- Add regenerate message action [#562][repo-pr-562]
- Center empty chat input layout [#564][repo-pr-564]
- Adjust favicon to Erato logo [#607][repo-pr-607]
- Expand drive listing to Sharepoint sites/Teams channels [#606][repo-pr-606]
- Add hallucination loop suppression [#664][repo-pr-664]
- Make priority of language preferences configurable [#627][repo-pr-627]
- Refactor templating system on top of handlebars [#629][repo-pr-629]
- Show warnings when sharing Sharepoint files regarding permissions [#676][repo-pr-676]
- Add support for `facet_permissions`, `mcp_server_permissions`; Switch all config-based permissions to be evaluated via OPA policy [#561][repo-pr-561]


**Audio input modes**:

- Add audio-mode button with shared Waveform primitives [#666][repo-pr-666]
- Add dedicated audio chat mode to ChatInput [#667][repo-pr-667]
- Add microphone test panel to audio settings [#668][repo-pr-668]
- fix: resolve audio transcripts before generating chat summary (fixes "Untitled Chat" on audio sessions) [#670][repo-pr-670]
- Add shared voice runtime asset resolver [#671][repo-pr-671]
- Add Ricky VAD engine adapter [#672][repo-pr-672]
- Add conversational audio backend config [#673][repo-pr-673]
- Add support for audio transcription [#644][repo-pr-644]
- Add non-persistent audio dictation socket [#654][repo-pr-654]
 
#### Stability improvements

- Add limit for parallelism of file processing [#496][repo-pr-496]
- Add mechanism to ensure minimum tokio worker threads [#497][repo-pr-497]
- Adopt latest genai reqwest client settings [#651][repo-pr-651]
- Replace slow messages sibling constraing validation query [#611][repo-pr-611]
- Make tool listing resilient against MCP server unavailability [#613][repo-pr-613]
- Add compat_omit_strict flag as workaround for Bifrost bug [#648][repo-pr-648]

#### Bug fixes

- Fail gracefully if unshared files are attached to assistant [#492][repo-pr-492]
- Fix page number extraction regression by pinning kreuzberg version [#478][repo-pr-478]
- Fix opaque file too big upload error by draining file upload [#479][repo-pr-479]
- Fix/assistant icon collapse [#486][repo-pr-486]
- Fix file getting lost in edit; Use file picker duringe edits [#488][repo-pr-488]
- Fix token estimation not working with custom components [#489][repo-pr-489]
- Fix file upload error persisting between chats; Make input sticky [#490][repo-pr-490]
- Prevent copying of theme colors in Chromium-based browsers [#491][repo-pr-491]
- Only inject OTEL layer if OTEL is enabled [#493][repo-pr-493]
- Fix tool responses getting lost on subsequent messages [#494][repo-pr-494]
- Fix metrics: rename cache count to imply gauge, fix ratio range [#499][repo-pr-499]
- Fix anchor links of footnote citations [#500][repo-pr-500]
- Generate download links with correct filename [#501][repo-pr-501]
- Always open erato-file:// links in preview dialog [#502][repo-pr-502]
- Re-ingest OneDrive files on ETag change [#504][repo-pr-504]
- Fix preview URL generation for azblob file storage [#508][repo-pr-508]
- Fix broken image icon in slim navbar when no sidebar logo exists [#511][repo-pr-511]
- Refresh token estimate in assistant editor on file delete [#517][repo-pr-517]
- Make user prefrences dialog more consistent [#518][repo-pr-518]
- Fix textarea auto-resize and preferences spacing [#524][repo-pr-524]
- Fix broken history reconstruction with tool results [#529][repo-pr-529]
- Reload chats and then page after delete all chats [#532][repo-pr-532]
- Use correct hook when uploading via drag & drop [#534][repo-pr-534]
- Handle removal of shared assistant better in reliant chats [#535][repo-pr-535]
- Fix file uploads be shown twice in upload preview [#554][repo-pr-554]
- Fix preferences textarea sizing on first open [#559][repo-pr-559]
- Fix assistant welcome layout sizing [#560][repo-pr-560]
- Fix token estimate when entering assistant edit form [#567][repo-pr-567]
- Fix search page header/body background color mismatch [#568][repo-pr-568]
- Fix preferences textarea auto-resize on tab switch [#569][repo-pr-569]
- Default assistant model option to None [#617][repo-pr-617]
- Fix repeating start of text for Gemini calls with tools [#598][repo-pr-598]
- Skip caching of locales files [#682][repo-pr-682]
- Make settings dialog tabs scroll horizontally on small viewports [#645][repo-pr-645]
- Fix summary generation missing user input message [#662][repo-pr-662]
- Portal CloudFilePicker to document.body (ERMAIN-254) [#674][repo-pr-674]
- Fix user message soft line breaks [#655][repo-pr-655]
 
#### Test coverage

- Add mock-llm-server mock to check smooth streaming [#480][repo-pr-480]
- Add tests and fix triggeres for chat token estimates [#487][repo-pr-487]
- Improvements for accessibility and test coverage UI components [#557][repo-pr-557]
- Testing: Action-Facet integration tests [#578][repo-pr-578]
- Add Vitest test infrastructure for office-addin [#582][repo-pr-582]
 
#### Documentation

- Remove README from Helm chart gitignore; Add metadata [#482][repo-pr-482]
- Extend auth documentation [#597][repo-pr-597]
- Document MCP server access and overview of auth methods [#612][repo-pr-612]

#### Security

- Set up basic Helm chart scanning with Kubescan [#477][repo-pr-477]
- Use cargo-auditable for dependency SBOM [#505][repo-pr-505]
- Generate CycloneDX SBOMs for frontend [#680][repo-pr-680]
- Add secrecy for preventing leakage in log messages [#630][repo-pr-630]
 
#### Observability

- Trace Langfuse tool calls and tag summaries [#652][repo-pr-652]
- Add optional tracing of summary generation with Langfuse [#646][repo-pr-646]
- Add support for OTEL-based Langfuse ingestion [#653][repo-pr-653]
- Add tags on Langfuse traces for better filterability [#519][repo-pr-519]
- Add support for X-Erato-Platform header to track request platform [#551][repo-pr-551]
- Add prometheus metrics for active MCP sessions [#547][repo-pr-547]
- Add metrics for time to first/last token [#548][repo-pr-548]
- Add prometheus metrics for postgres query histograms [#549][repo-pr-549]
- Add logging config; Add json logging mode [#572][repo-pr-572]
- Fix X-Erato-Platform to send host name instead of runtime platform [#593][repo-pr-593]
- Wire X-Erato-Platform header in SSE client and office-addin [#574][repo-pr-574]
- Fix top-level langfuse trace name [#656][repo-pr-656]
- Fix tags missing in Langfuse OTEL-based tracing [#663][repo-pr-663]
- Add image variant with continous memory profiling [#495][repo-pr-495]
 
#### Dependency changes

##### Frontend

- Update Node.js from 22.10.0 to 22.22.2 LTS [#583][repo-pr-583]
- Update pnpm to 11.1.3 [#678][repo-pr-678]
- Update Vite from v5 to v6 [#581][repo-pr-581]
- Update `@tanstack/` frontend libraries [#669][repo-pr-669]
 
##### Backend

- Update to rmcp 1.3.0; Inline removed SSE transport [#599][repo-pr-599]
- Upgrade Kreuzberg to 4.9.4; Process attachments in Email files [#632][repo-pr-632]
- Upgrade to genai fork rev 102f18cb1f558fc1975bc413abc1bf206c75944a [#636][repo-pr-636]
- Update genai to version that skips tool rewriting [#661][repo-pr-661]
 
#### Chores & Developer experience

- Adjust Storybook to also use tooltip for facets in AssistantForm [#522][repo-pr-522]
- Add Geist font imports to Storybook preview [#555][repo-pr-555]
- Support `extra` field in lingui extraction [#571][repo-pr-571]
- Generate config reference file from config structs via facet [#570][repo-pr-570]
- Fix missing dev env config loading [#608][repo-pr-608]
- Fix test suite; Switch to seaweed fully [#631][repo-pr-631]
- Add input_parameters column for user message context [#596][repo-pr-596]
- Add direct owner of files to replace implied owner via linked chat [#498][repo-pr-498]
- Prepare release 0.6.0 [#686][repo-pr-686]

### Full list of changes (same as above; uncategorized)

- Set up basic Helm chart scanning with Kubescan [#477][repo-pr-477]
- Fix page number extraction regression by pinning kreuzberg version [#478][repo-pr-478]
- Fix opaque file too big upload error by draining file upload [#479][repo-pr-479]
- Add mock-llm-server mock to check smooth streaming [#480][repo-pr-480]
- Add namespaceOverride to erato Helm chart [#481][repo-pr-481]
- Remove README from Helm chart gitignore; Add metadata [#482][repo-pr-482]
- Make user preferences dialog disableable [#483][repo-pr-483]
- Add network policies to Helm chart [#484][repo-pr-484]
- Add estimation of tokens in assistant form [#485][repo-pr-485]
- Fix/assistant icon collapse [#486][repo-pr-486]
- Add tests and fix triggeres for chat token estimates [#487][repo-pr-487]
- Fix file getting lost in edit; Use file picker duringe edits [#488][repo-pr-488]
- Fix token estimation not working with custom components [#489][repo-pr-489]
- Fix file upload error persisting between chats; Make input sticky [#490][repo-pr-490]
- Prevent copying of theme colors in Chromium-based browsers [#491][repo-pr-491]
- Fail gracefully if unshared files are attached to assistant [#492][repo-pr-492]
- Only inject OTEL layer if OTEL is enabled [#493][repo-pr-493]
- Fix tool responses getting lost on subsequent messages [#494][repo-pr-494]
- Add image variant with continous memory profiling [#495][repo-pr-495]
- Add limit for parallelism of file processing [#496][repo-pr-496]
- Add mechanism to ensure minimum tokio worker threads [#497][repo-pr-497]
- Add direct owner of files to replace implied owner via linked chat [#498][repo-pr-498]
- Fix metrics: rename cache count to imply gauge, fix ratio range [#499][repo-pr-499]
- Fix anchor links of footnote citations [#500][repo-pr-500]
- Generate download links with correct filename [#501][repo-pr-501]
- Always open erato-file:// links in preview dialog [#502][repo-pr-502]
- Adjust assistant card layout to be consistent between own/shared [#503][repo-pr-503]
- Re-ingest OneDrive files on ETag change [#504][repo-pr-504]
- Use cargo-auditable for dependency SBOM [#505][repo-pr-505]
- Add button to stop message generation/streaming [#506][repo-pr-506]
- Re-focus chat input after response streaming completes [#507][repo-pr-507]
- Fix preview URL generation for azblob file storage [#508][repo-pr-508]
- Turn budget warning translation strings into explicit IDs [#509][repo-pr-509]
- feat(theme): load optional runtime theme.css support [#510][repo-pr-510]
- Fix broken image icon in slim navbar when no sidebar logo exists [#511][repo-pr-511]
- feat(theme): add stable styling hooks [#512][repo-pr-512]
- feat(theme): add typed shell token contract [#513][repo-pr-513]
- feat(theme): bridge legacy theme values [#514][repo-pr-514]
- refactor(theme): remove legacy theme applier [#515][repo-pr-515]
- feat(theme): consume token surface in core UI [#516][repo-pr-516]
- Refresh token estimate in assistant editor on file delete [#517][repo-pr-517]
- Make user prefrences dialog more consistent [#518][repo-pr-518]
- Add tags on Langfuse traces for better filterability [#519][repo-pr-519]
- Adjust file upload preview to show longer filename parts [#520][repo-pr-520]
- Allow for configuring default/locked facets for assistants [#521][repo-pr-521]
- Adjust Storybook to also use tooltip for facets in AssistantForm [#522][repo-pr-522]
- Repair foundation theme contracts and input geometry [#523][repo-pr-523]
- Fix textarea auto-resize and preferences spacing [#524][repo-pr-524]
- Improve Preferences dialog accessibility and reuse [#525][repo-pr-525]
- feat(frontend): theme primary button semantics [#526][repo-pr-526]
- Focus normalization and error-ring tokenization [#527][repo-pr-527]
- Typography contract expansion and audited consumer adoption [#528][repo-pr-528]
- Fix broken history reconstruction with tool results [#529][repo-pr-529]
- Add starter prompts [#530][repo-pr-530]
- Increase size of dropzone to whole center page [#531][repo-pr-531]
- Reload chats and then page after delete all chats [#532][repo-pr-532]
- Make budget i18n strings reference "personal budget" [#533][repo-pr-533]
- Use correct hook when uploading via drag & drop [#534][repo-pr-534]
- Handle removal of shared assistant better in reliant chats [#535][repo-pr-535]
- Expand foundation geometry and configurable code themes [#536][repo-pr-536]
- Provide frontend as library; Initial Outlook addin version [#537][repo-pr-537]
- Stabilize office-addin/frontend dev watchers [#539][repo-pr-539]
- Harden office-addin packaged dev cache invalidation [#540][repo-pr-540]
- Add add-in auth to frontend API transports [#541][repo-pr-541]
- Outlook add-in: scope email suggestions to new chats and add email picker [#543][repo-pr-543]
- Improve Outlook add-in task pane sizing and file picker popover [#544][repo-pr-544]
- Wire shell app page surfaces [#545][repo-pr-545]
- Preferences -> Settings; Move theme switcher into settings [#546][repo-pr-546]
- Add prometheus metrics for active MCP sessions [#547][repo-pr-547]
- Add metrics for time to first/last token [#548][repo-pr-548]
- Add prometheus metrics for postgres query histograms [#549][repo-pr-549]
- Remove starter prompts from assistants [#550][repo-pr-550]
- Add support for X-Erato-Platform header to track request platform [#551][repo-pr-551]
- Allow for configuring assistant form context estimate thresholds [#552][repo-pr-552]
- Make starter prompts translateable [#553][repo-pr-553]
- Fix file uploads be shown twice in upload preview [#554][repo-pr-554]
- Add Geist font imports to Storybook preview [#555][repo-pr-555]
- Normalize nested chat surface frame styling [#556][repo-pr-556]
- Improvements for accessibility and test coverage UI components [#557][repo-pr-557]
- Add ability to add description and icon for chat_provider [#558][repo-pr-558]
- Fix preferences textarea sizing on first open [#559][repo-pr-559]
- Fix assistant welcome layout sizing [#560][repo-pr-560]
- Refactor provider, MCP server, and facet permissions [#561][repo-pr-561]
- Add regenerate message action [#562][repo-pr-562]
- Interface refactor [#563][repo-pr-563]
- Center empty chat input layout [#564][repo-pr-564]
- Add ability to share chats [#565][repo-pr-565]
- Prompt suggestion harness [#566][repo-pr-566]
- Fix token estimate when entering assistant edit form [#567][repo-pr-567]
- Fix search page header/body background color mismatch [#568][repo-pr-568]
- Fix preferences textarea auto-resize on tab switch [#569][repo-pr-569]
- Generate config reference file from config structs via facet [#570][repo-pr-570]
- Support `extra` field in lingui extraction [#571][repo-pr-571]
- Add logging config; Add json logging mode [#572][repo-pr-572]
- Config: Add action_facets definitions to erato.toml [#573][repo-pr-573]
- Wire X-Erato-Platform header in SSE client and office-addin [#574][repo-pr-574]
- Backend API: action_facet request field, persistence, and plumbing [#575][repo-pr-575]
- Prompt composition: Action-Facet validation, rendering, and injection [#576][repo-pr-576]
- Frontend: codegen and hook updates for action_facet payload [#577][repo-pr-577]
- Testing: Action-Facet integration tests [#578][repo-pr-578]
- Docs: Add action_facets configuration reference [#579][repo-pr-579]
- Expose compose selection reading via useComposeSelection hook [#580][repo-pr-580]
- Upgrade Vite from v5 to v6 [#581][repo-pr-581]
- Add Vitest test infrastructure for office-addin [#582][repo-pr-582]
- Upgrade Node.js from 22.10.0 to 22.22.2 LTS [#583][repo-pr-583]
- Define Outlook compose Action-Facet template examples [#584][repo-pr-584]
- Add compose body write operations for Outlook [#585][repo-pr-585]
- Build EratoEmailSuggestion component for erato-email code blocks [#586][repo-pr-586]
- Selection preview chip and action facet injection on send [#587][repo-pr-587]
- Register Office-aware erato-email renderer via componentRegistry [#588][repo-pr-588]
- Handle HTML vs plain text body format for compose insertions [#589][repo-pr-589]
- Dynamic insert button labels based on compose selection state [#590][repo-pr-590]
- Serve office-adding from backend [#591][repo-pr-591]
- Full body context mode for general compose writing assistance [#592][repo-pr-592]
- Fix X-Erato-Platform to send host name instead of runtime platform [#593][repo-pr-593]
- Set up none/forwarded/fixed authentication for MCP servers [#595][repo-pr-595]
- Add input_parameters column for user message context [#596][repo-pr-596]
- Extend auth documentation [#597][repo-pr-597]
- Fix repeating start of text for Gemini calls with tools [#598][repo-pr-598]
- Update to rmcp 1.3.0; Inline removed SSE transport [#599][repo-pr-599]
- Add encryption key to config [#600][repo-pr-600]
- Add backend interactions for oauth2 MCP support [#601][repo-pr-601]
- Reduce logging for MCP oauth [#602][repo-pr-602]
- Add office-addin setup page [#603][repo-pr-603]
- Add redirect-uri instruction to office-addin setup page [#604][repo-pr-604]
- Adjust action_facets config structure; Add builtin outlook facets [#605][repo-pr-605]
- Expand drive listing to Sharepoint sites/Teams channels [#606][repo-pr-606]
- Adjust favicon to Erato logo [#607][repo-pr-607]
- Fix missing dev env config loading [#608][repo-pr-608]
- Hide chat advisory in Outlook add-in [#609][repo-pr-609]
- Fix Outlook action-facet HTML preview and insertion [#610][repo-pr-610]
- Replace slow messages sibling constraing validation query [#611][repo-pr-611]
- Document MCP server access and overview of auth methods [#612][repo-pr-612]
- Make tool listing resilient against MCP server unavailability [#613][repo-pr-613]
- Add fallback for Outlook hosts missing body.getTypeAsync [#614][repo-pr-614]
- Correctly display unavailable file preview in shared chat [#615][repo-pr-615]
- Add config option to allow limit OneDrive drive listing [#616][repo-pr-616]
- Default assistant model option to None [#617][repo-pr-617]
- Adjust platform i18n/theme system to have more structure [#618][repo-pr-618]
- Add officeTheme utils module (ERMAIN-265) [#619][repo-pr-619]
- Add useOfficeTheme hook (ERMAIN-266) [#620][repo-pr-620]
- Wire OfficeThemeProvider into App (ERMAIN-267) [#621][repo-pr-621]
- Fix linked add-in linked-dev asset rebuilds and startup flow [#622][repo-pr-622]
- Add backend .eml support and tests [#624][repo-pr-624]
- Enhance tool calling inputs to support image editing [#625][repo-pr-625]
- Extended mail utilities support [#626][repo-pr-626]
- Make priority of language preferences configurable [#627][repo-pr-627]
- Extend sharepoint with backend search and ordering [#628][repo-pr-628]
- Refactor templating system on top of handlebars [#629][repo-pr-629]
- Add secrecy for preventing leakage in log messages [#630][repo-pr-630]
- Fix test suite; Switch to seaweed fully [#631][repo-pr-631]
- Upgrade Kreuzberg to 4.9.4; Process attachments in Email files [#632][repo-pr-632]
- Register email FileType for .eml / message/rfc822 [#633][repo-pr-633]
- Add ephemeral token estimate + add-in attachment improvements [#634][repo-pr-634]
- Fix oversized-draft errors in Outlook compose-mode chat [#635][repo-pr-635]
- Upgrade to genai fork rev 102f18cb1f558fc1975bc413abc1bf206c75944a [#636][repo-pr-636]
- Add support for storing / replaying thought signatures [#637][repo-pr-637]
- Persist action facets as markers; render in user turn with sentinel [#638][repo-pr-638]
- Adjust default naming from "OneDrive" to "Sharepoint" [#639][repo-pr-639]
- Add chat provider recorder helper; Add Reponses API mock endpoint [#640][repo-pr-640]
- Fix replay of reasoning items [#641][repo-pr-641]
- Add streaming event/content part for reasoning [#642][repo-pr-642]
- Show reply-context chip when composing a reply in Outlook [#643][repo-pr-643]
- Add support for audio transcription [#644][repo-pr-644]
- Make settings dialog tabs scroll horizontally on small viewports [#645][repo-pr-645]
- Add optional tracing of summary generation with Langfuse [#646][repo-pr-646]
- Add-in settings dialog and Outlook session policy [#647][repo-pr-647]
- Add compat_omit_strict flag as workaround for Bifrost bug [#648][repo-pr-648]
- Workaround on .summary issue [#649][repo-pr-649]
- Turn reasoning encrypted_content and summary into separate configs [#650][repo-pr-650]
- Adopt latest genai reqwest client settings [#651][repo-pr-651]
- Trace Langfuse tool calls and tag summaries [#652][repo-pr-652]
- Add support for OTEL-based Langfuse ingestion [#653][repo-pr-653]
- Add non-persistent audio dictation socket [#654][repo-pr-654]
- Fix user message soft line breaks [#655][repo-pr-655]
- Fix top-level langfuse trace name [#656][repo-pr-656]
- Feature/inline tool call rendering [#657][repo-pr-657]
- Split multi-header reasoning into per-header trace steps [#658][repo-pr-658]
- Collapse trace timeline behind a 'Thought for X' summary on cold load [#659][repo-pr-659]
- Adjust sharepoint "Teams library" drive discovery with filter [#660][repo-pr-660]
- Update genai to version that skips tool rewriting [#661][repo-pr-661]
- Fix summary generation missing user input message [#662][repo-pr-662]
- Fix tags missing in Langfuse OTEL-based tracing [#663][repo-pr-663]
- Add hallucination loop suppression [#664][repo-pr-664]
- Adjust sharepoint group drive search: default public filter [#665][repo-pr-665]
- Add audio-mode button with shared Waveform primitives [#666][repo-pr-666]
- Add dedicated audio chat mode to ChatInput [#667][repo-pr-667]
- Add microphone test panel to audio settings [#668][repo-pr-668]
- Upgrade versions [#669][repo-pr-669]
- fix: resolve audio transcripts before generating chat summary (fixes "Untitled Chat" on audio sessions) [#670][repo-pr-670]
- Add shared voice runtime asset resolver [#671][repo-pr-671]
- Add Ricky VAD engine adapter [#672][repo-pr-672]
- Add conversational audio backend config [#673][repo-pr-673]
- Portal CloudFilePicker to document.body (ERMAIN-254) [#674][repo-pr-674]
- Fix Sharepoint filtering to not paginate internally and filter [#675][repo-pr-675]
- Show warnings when sharing Sharepoint files regarding permissions [#676][repo-pr-676]
- Add ParsedEmail shape and refactor parseEmlFile (ERMAIN-275) [#677][repo-pr-677]
- Update pnpm to 11.1.3 [#678][repo-pr-678]
- Discard reasoning items when switching chat providers [#679][repo-pr-679]
- Generate CycloneDX SBOMs for frontend [#680][repo-pr-680]
- Track timing per ContentPart for reasoning and tool calls [#681][repo-pr-681]
- Skip caching of locales files [#682][repo-pr-682]
- Add EmlPreview component for .eml file preview (ERMAIN-308) [#685][repo-pr-685]
- Prepare release 0.6.0 [#686][repo-pr-686]

## [0.5.2] - 2026-02-20

### Full list of changes

- Seed e2e test secrets from single file [#375][repo-pr-375]
- Set up Entra ID test scenario [#376][repo-pr-376]
- Set up initial CHANGELOG.md [#377][repo-pr-377]
- Set up nginx-auth test scenario [#379][repo-pr-379]
- Add tests for simple chat completion with slowdown [#380][repo-pr-380]
- Optimize navigation and state transition [#381][repo-pr-381]
- Add option to automatically use latest main commit for setup-dev [#382][repo-pr-382]
- Fix outdated policy data when trying to share assistant [#383][repo-pr-383]
- Extend infrastructure with architecture charts [#384][repo-pr-384]
- Add message lifecycle diagrams [#385][repo-pr-385]
- Filter sharing users/groups to ones user is a member of [#386][repo-pr-386]
- Add filter for sharing-relation to assistants list route [#387][repo-pr-387]
- Add endpoint and extend file model to show available capabilities [#388][repo-pr-388]
- Use content of last user-supplied message for Langfuse trace name [#389][repo-pr-389]
- Fix chatIsReadyToChat test helper expecting enabled chatbox [#390][repo-pr-390]
- Fix feedback sentiment not being changeable on edit [#391][repo-pr-391]
- Fix wrong `download_url`s being generated for assistant files [#392][repo-pr-392]
- Allow overriding the feedback placeholder by sentiment [#393][repo-pr-393]
- Fix broken OneDrive assistant files download_urls being generated [#394][repo-pr-394]
- Update to Ubuntu 24.04 and Debian Trixie [#395][repo-pr-395]
- Update GHA docker login action to 3.6.0 [#396][repo-pr-396]
- Add `query` option to groups/users endpoints for Graph API search [#397][repo-pr-397]
- Allow for more model settings (e.g. temprature) to be set [#398][repo-pr-398]
- Add scripts to create EntraID bulk import spam users [#399][repo-pr-399]
- Handle general generation errors and content_filter error [#400][repo-pr-400]
- Add prompt template variable to inject current date/time [#401][repo-pr-401]
- Inject file error message instead of omitting file message [#402][repo-pr-402]
- Add `kreuzberg` as alternative file processor with page-awareness [#403][repo-pr-403]
- Add tabs to differentiate assistant sharing [#404][repo-pr-404]
- Replace list with search on sharing [#405][repo-pr-405]
- Only query first page for empty users/groups query [#406][repo-pr-406]
- Check session status on window focus and redirect if expired [#407][repo-pr-407]
- Add file validation handling [#408][repo-pr-408]
- Add tooltip based on language file translations [#409][repo-pr-409]
- Fix checks on test [#410][repo-pr-410]
- Component registry + Assistant sample [#411][repo-pr-411]
- Resolve erato-file:// links in generated messages [#412][repo-pr-412]
- Add system prompt injection of user language preferences [#413][repo-pr-413]
- Refactor message composition [#414][repo-pr-414]
- Add docs for stream buffering [#415][repo-pr-415]
- Remove dbg! statements [#416][repo-pr-416]
- Add config/routes for experimental facets [#417][repo-pr-417]
- Add facet prompt injection logic [#418][repo-pr-418]
- Add facet MCP filter logic [#419][repo-pr-419]
- Add logic for applying model settings via settings [#420][repo-pr-420]
- Fix display of display_name of user/group in share grants [#421][repo-pr-421]
- Add config/route for prompt optimizer [#422][repo-pr-422]
- Add prompt-optimizer button to assistant creation dialog [#423][repo-pr-423]
- Add support for file generation in mcp servers [#424][repo-pr-424]
- Add slim navbar variant, optimize animations and performance [#425][repo-pr-425]
- Add facet selector to chat input [#426][repo-pr-426]
- Autolink erato-file:// URLs correctly [#427][repo-pr-427]
- Extend customization options [#428][repo-pr-428]
- Optimize layout and distances [#429][repo-pr-429]
- Add tests for pptx and docx [#430][repo-pr-430]
- Only build erato binary in backend Dockerfile [#431][repo-pr-431]
- Add helm-docs for automatic README generation [#432][repo-pr-432]
- Setup Entra ID assistant flow chats with multiple users [#433][repo-pr-433]
- Refactor e2e test scenario grouping [#434][repo-pr-434]
- Add images API to mock-llm-server [#435][repo-pr-435]
- Add default builtin facet system prompt template [#436][repo-pr-436]
- Set up many-models e2e test scenario [#437][repo-pr-437]
- Add docs FE architecture [#438][repo-pr-438]
- Missing frontend architecture docs [#439][repo-pr-439]
- Unify handling of static + langfuse prompt specs [#440][repo-pr-440]
- Fix assistant tooltip placement [#441][repo-pr-441]
- Add optional image advisory [#442][repo-pr-442]
- Add missing assistant_id on file uploads [#443][repo-pr-443]
- Fix navigation bug on assistant [#444][repo-pr-444]
- Add optional AI advisory below chat input [#445][repo-pr-445]
- Add handling of 429 rate limit error [#446][repo-pr-446]
- Improve accuracy of token usage estimate [#447][repo-pr-447]
- Fix broken download URLs for sharepoint [#448][repo-pr-448]
- Extend custom icon, Toggle display metadata [#449][repo-pr-449]
- Add more custom components samples, improve e2e pre checks [#450][repo-pr-450]
- Add Gemini/Vertex AI providers [#451][repo-pr-451]
- Fix race condition in assistant model selection [#452][repo-pr-452]
- Add e2e tests that verifies that chatting with different models works [#453][repo-pr-453]
- Set up CI build of docker image for mock-llm-server [#454][repo-pr-454]
- Add mock-llm-server to erato-local setup [#455][repo-pr-455]
- Add tests for error messages with mock-llm [#456][repo-pr-456]
- Add mock MCP server [#457][repo-pr-457]
- Add reproduction test for broken assistant file links [#458][repo-pr-458]
- Allow for configuring MCP session idle time [#459][repo-pr-459]
- Optimize MCP server listing; Fix tool patterns rendering in facets [#460][repo-pr-460]
- Add prometheus integration [#461][repo-pr-461]
- Add Prometheus metrics service for backend to Helm chart [#462][repo-pr-462]
- Add backend support for editing chat name [#463][repo-pr-463]
- Add support for pasting images from clipboard [#464][repo-pr-464]
- Add user preferences [#465][repo-pr-465]
- Add archive all button [#466][repo-pr-466]
- Add support for parsing/forwarding content filter error from MCP [#467][repo-pr-467]
- Update imprint page [#468][repo-pr-468]
- Refactor message streaming and include resume [#469][repo-pr-469]
- Fix regression in handleUserMessageSaved [#470][repo-pr-470]
- Add streaming resumption after network interruption [#471][repo-pr-471]
- Add cache metrics to metrics endpoint [#472][repo-pr-472]
- Add CI test to test MCP tool call [#473][repo-pr-473]
- Add prometheus info metrics for chat_providers [#474][repo-pr-474]
- Re-add $schema filtering [#475][repo-pr-475]
- Prepare release 0.5.2 [#476][repo-pr-476]

## [0.5.1] - 2026-01-14

### Full list of changes

- Prepare release 0.5.1 [#373][repo-pr-373]
- Adjust release script to work with cargo workspace for backend [#372][repo-pr-372]
- Fix optimistic ordering [#371][repo-pr-371]
- Add translatable section [#370][repo-pr-370]
- Fix parallel tool call panic [#369][repo-pr-369]
- Mock LLM server more [#367][repo-pr-367]
- Switch back to GHA runners [#368][repo-pr-368]
- Langfuse assistant ID [#360][repo-pr-360]
- Remove backrefs [#359][repo-pr-359]
- Latest test updates [#357][repo-pr-357]
- Fix archived assistant chats [#358][repo-pr-358]
- Fix assistants 404 errors [#356][repo-pr-356]
- Assistants scenario test [#354][repo-pr-354]
- Fix regenerated expired image contentparts [#353][repo-pr-353]
- Mock LLM server [#352][repo-pr-352]
- Playwright 1.57.0 [#351][repo-pr-351]
- GHA test backend cache apt [#350][repo-pr-350]
- Optimize setup dev chart update [#349][repo-pr-349]
- GHA playwright cache deps [#348][repo-pr-348]
- Optimize workflows [#346][repo-pr-346]
- Pin backend dockerfile [#345][repo-pr-345]
- E2E matrix [#344][repo-pr-344]
- Blacksmith migration [#343][repo-pr-343]
- Cargo workspace [#342][repo-pr-342]
- Langfuse update trace output [#341][repo-pr-341]
- Langfuse custom model name [#340][repo-pr-340]
- Add optional feedback edit time restriction [#363][repo-pr-363]
- Add toggle for user / group options [#364][repo-pr-364]
- Improve error handling on file upload v1 [#361][repo-pr-361]
- Add preview to assistant on files [#362][repo-pr-362]
- Fix mouse down event [#355][repo-pr-355]

## [0.5.0] - 2025-12-16

### Full list of changes

- Fix navigation [#281][repo-pr-281]
- Add imprint page [#288][repo-pr-288]
- Setup cargo-deny for license checking [#289][repo-pr-289]
- Switch from Azurite to SeaweedFS for erato-local chart [#290][repo-pr-290]
- Add support for E2E test scenarios [#291][repo-pr-291]
- Split up tests and enforce message role order for generation [#292][repo-pr-292]
- Add config for experimental assistants feature [#293][repo-pr-293]
- Fix deletion of archived chats with associated file uploads [#294][repo-pr-294]
- Set up CRUD endpoints for assistants [#295][repo-pr-295]
- Add paramter for chat creation to base it on assistant [#296][repo-pr-296]
- Add endpoint to list frequent assistants for a user [#297][repo-pr-297]
- Use mocked LLM for all integration tests [#298][repo-pr-298]
- Update to Rust edition 2024 [#299][repo-pr-299]
- Basic Assistant UI [#300][repo-pr-300]
- Refactor integration tests [#301][repo-pr-301]
- Fix missing attachment feature on assistants [#302][repo-pr-302]
- Add assistant avatar support in environment and UI components [#303][repo-pr-303]
- Set up OTEL tracing infrastructure [#304][repo-pr-304]
- Use a shared global PolicyEngine state for less data reloads [#305][repo-pr-305]
- Fix current broken translations [#306][repo-pr-306]
- Add custom .po file formatter + CI check [#307][repo-pr-307]
- Experimental Sharepoint integration [#308][repo-pr-308]
- Extend Helm ouauth2-proxy setup with Redis [#309][repo-pr-309]
- Add resumestream endpoint [#310][repo-pr-310]
- Add base components, storybook additions [#311][repo-pr-311]
- Add share grant system for sharing access to assistants [#312][repo-pr-312]
- Offload file parsing to worker threads [#313][repo-pr-313]
- Don't use chats_latest_message view due to bad performance [#314][repo-pr-314]
- Use file pointers in `generation_input_messages` [#315][repo-pr-315]
- Fix determining default file storage with sharepoint integration [#316][repo-pr-316]
- Extend to assistant [#317][repo-pr-317]
- Add optimistic update cycle [#318][repo-pr-318]
- Add ability to pass image contents to LLM [#319][repo-pr-319]
- Add local setup for tokio-console [#320][repo-pr-320]
- Remove delay for background task cleanup [#321][repo-pr-321]
- Supply environemnt to Langfuse; Fix Langfuse timestamp [#322][repo-pr-322]
- Fix sharing based on user_organization_id not being correctly evaluated [#323][repo-pr-323]
- Fix usage of shared assistant [#324][repo-pr-324]
- Assistant Sharing [#325][repo-pr-325]
- Add support for generating images [#326][repo-pr-326]
- Image gen support [#327][repo-pr-327]
- Update Rust version to 1.91.1 [#328][repo-pr-328]
- Simplify file references provided in recent-chats route [#329][repo-pr-329]
- Add .services.ai.azure.com to allowlist of domains [#330][repo-pr-330]
- Fix image generation randomly breaking if Sharepoint enabled [#331][repo-pr-331]
- Skip OCR on images since we are using image comprehension [#332][repo-pr-332]
- Add table and routes for message feedback [#333][repo-pr-333]
- Add table and routes for message feedback [#334][repo-pr-334]
- Allow forwarding the feedback to Langfuse [#335][repo-pr-335]
- Set deployment version in Helm chart and use for cache invalidation [#336][repo-pr-336]
- Fix issue with keyboard shortcuts [#337][repo-pr-337]
- Fix excessive estimate calls [#338][repo-pr-338]
- Prepare release 0.5.0 [#339][repo-pr-339]

## [0.4.0] - 2025-11-06

### Full list of changes

- Enable edit and rerun in FE [#241][repo-pr-241]
- Add unittests for Helm + extraVolumes/extraVolumeMounts [#245][repo-pr-245]
- Allow chart to provide erato.toml via plaintext + .auto.erato.toml [#246][repo-pr-246]
- Validate helm test suite files JSON schema [#247][repo-pr-247]
- Move sentry config key to integrations [#248][repo-pr-248]
- Add favicon to docs site [#249][repo-pr-249]
- Use shared login state in tests to speed them up [#250][repo-pr-250]
- Support annotations on most resources in Helm chart [#251][repo-pr-251]
- Extend documentation around MCP servers [#252][repo-pr-252]
- Enable telepresence workflow for local cluster [#253][repo-pr-253]
- Add local-auth variant based on Keycloak [#254][repo-pr-254]
- Adjust Helm chart publishing to use proper versioning [#255][repo-pr-255]
- Add local-auth setup using request params + nginx [#256][repo-pr-256]
- Extend config structure to allow for configuring multiple chat providers [#257][repo-pr-257]
- Track used generation_parameters for message [#258][repo-pr-258]
- Extend endpoints to support multiple models/model selection [#259][repo-pr-259]
- Allow for specifying specific model for chat summaries [#260][repo-pr-260]
- Allow to configure model capabilities [#261][repo-pr-261]
- Add support for model_permissions.rules [#262][repo-pr-262]
- Add budget config and endpoint [#263][repo-pr-263]
- Add model selector [#264][repo-pr-264]
- Fix using correct system_prompt according to chat_provider [#265][repo-pr-265]
- Order me/models according to configured priority_order [#266][repo-pr-266]
- Fix token usage not being reported for Azure OpenAI [#267][repo-pr-267]
- Make top and bottom padding on Chat history list item symetrical [#268][repo-pr-268]
- Update Rust to 1.90.0 and cargo-chef to 0.1.73 [#269][repo-pr-269]
- Switch to rmcp as MCP crate [#270][repo-pr-270]
- Refactor setup-dev script to Python [#271][repo-pr-271]
- Add docs for file_storage_providers keys [#272][repo-pr-272]
- Prepare frontend toggles for some features [#273][repo-pr-273]
- Usage indicator [#274][repo-pr-274]
- Remove static limit on ChatInput component [#275][repo-pr-275]
- Add title attribute, adjust language files [#276][repo-pr-276]
- Add mocktail to mock LLM responses [#277][repo-pr-277]
- Add locale i18n mechanism and add German main page [#279][repo-pr-279]
- Add Github button with CTA [#280][repo-pr-280]
- Fix missing language default on relative time information [#282][repo-pr-282]
- Add feature sections to website [#283][repo-pr-283]
- Implement FeatureConfigProvider with Context API [#284][repo-pr-284]
- Add about page to website [#285][repo-pr-285]
- Adjust footnotes style to square brackets [#286][repo-pr-286]
- Add German translations of website pages [#287][repo-pr-287]

## [0.3.1] - 2025-08-27

### Notable changes

#### Features and enhancements

- **Background worker**: Add background worker for deleting old archived chats [#230][repo-pr-230]
- **Chat providers**: Prepare support for multiple chat providers [#236][repo-pr-236]
- **Chat providers**: Add dedicated Azure OpenAI chat provider kind [#232][repo-pr-232]
- **Observability**: Add Langfuse tracing support including user and session metadata [#240][repo-pr-240], [#242][repo-pr-242], [#243][repo-pr-243]
- **Configuration**: Standardize frontend configuration with dedicated `frontend` config section [#231][repo-pr-231]
- **Security**: Add support for TLS connections to PostgreSQL database [#229][repo-pr-229]

#### Bug fixes

- **LLM**: Fix reasoning models not working due to max_completion_tokens parameter [#235][repo-pr-235]

#### Documentation

- **Website**: Add documentation website with basic landing page [#237][repo-pr-237]
- **Configuration**: Add Helm deployment documentation and configuration reference [#238][repo-pr-238], [#239][repo-pr-239]

#### Dependency changes

- **Backend**: Clean up unused backend dependencies [#226][repo-pr-226]
- **Backend**: Upgrade Axum to 0.8.x [#228][repo-pr-228]
- **Backend**: Update genai dependencies to official 0.4.0-alpha.3 release [#233][repo-pr-233], [#234][repo-pr-234]

### Full list of changes

- Clean up unused backend dependencies [#226][repo-pr-226]
- Upgrade Axum to 0.8.x [#228][repo-pr-228]
- Add support for postgres tls [#229][repo-pr-229]
- Add cleanup background worker [#230][repo-pr-230]
- Standardize frontend config [#231][repo-pr-231]
- Add azure_openai chatprovider kind [#232][repo-pr-232]
- Update to less forked version of genai [#233][repo-pr-233]
- Update genai to 0.4.0-alpha.3 [#234][repo-pr-234]
- Fix reasoning models not working due to max_completion_tokens [#235][repo-pr-235]
- Prepare support for multiple chat providers [#236][repo-pr-236]
- Add docs/website with basic landing page [#237][repo-pr-237]
- Add prettier; Basic config docs [#238][repo-pr-238]
- Fill out more documentation [#239][repo-pr-239]
- Add basic Langfuse tracing support [#240][repo-pr-240]
- Add support for specifying a system_prompt via Langfuse [#242][repo-pr-242]
- Add user_id + session_id metadata to Langfuse traces [#243][repo-pr-243]
- Prepare release 0.3.1 [#244][repo-pr-244]

## [0.3.0] - 2025-06-27

### Full list of changes

- Prepare release 0.3.0 [#225][repo-pr-225]

## [0.3.0-rc.2] - 2025-06-27

### Full list of changes

- Set up Github Release as part of release process [#224][repo-pr-224]

## [0.3.0-rc.1] - 2025-06-27

First tagged release

### Full list of changes

- Try to fix ollama-smol build [#23][repo-pr-23]
- Adjust Dockerfile cargo-chef usage to get faster builds [#25][repo-pr-25]
- Add pre-push hook to ask for testing/linting [#26][repo-pr-26]
- Fix tests; Set up backend CLI tool install to be more reproducible [#27][repo-pr-27]
- Do arm64 builds for main docker images [#28][repo-pr-28]
- Adjust local dev Helm setup [#30][repo-pr-30]
- Adjusted frontend build; Added pnpm [#32][repo-pr-32]
- Implement serving of frontend via backend [#33][repo-pr-33]
- Integrate rough outline of SSE message submit route [#34][repo-pr-34]
- Add CI job for linting [#35][repo-pr-35]
- Set up Rust integration tests with per-test DB setup [#36][repo-pr-36]
- Update ChatMessage component with unified controls [#37][repo-pr-37]
- Add prettier check lint step [#38][repo-pr-38]
- Set up OpenAPI codegen for frontend [#39][repo-pr-39]
- Enhance MessageTimestamp component and add tests [#40][repo-pr-40]
- Add basic local development OIDC setup [#41][repo-pr-41]
- Adjust frontend just dev command to start OIDC proxy proxy [#42][repo-pr-42]
- Add /me/profile route that returns back email of authenticated user [#43][repo-pr-43]
- Add configurable local Entra ID setup [#44][repo-pr-44]
- Add chat history [#45][repo-pr-45]
- Implement normalized user profiles on /me/profile endpoint [#46][repo-pr-46]
- Rename backend crate to erato [#47][repo-pr-47]
- Add users table; Add implicit user creation on first request [#48][repo-pr-48]
- Refactor chat types and extend API interfaces [#49][repo-pr-49]
- Update API endpoints from v1 to v1beta [#50][repo-pr-50]
- Chore/db dploy cmd [#52][repo-pr-52]
- Type adjustments / api alignment [#54][repo-pr-54]
- Use hadolint for linting Dockerfiles [#55][repo-pr-55]
- Adjust Helm chart and local k3d setup to use oauth2-proxy [#56][repo-pr-56]
- Use non-namespace service name in erato-local chart [#59][repo-pr-59]
- Add init container for migrations to Helm chart [#60][repo-pr-60]
- Fix all cargo clippy warnings; Add cargo clippy to CI [#61][repo-pr-61]
- Extract user profile upsert into middleware for /me routes [#62][repo-pr-62]
- Add logic to create chat on message submit [#63][repo-pr-63]
- Implement general submit message flow that creates chat and messages [#64][repo-pr-64]
- Integrate LLM for response generation [#65][repo-pr-65]
- Adjust ollama-smol GH actions workflow to also build for arm64 [#66][repo-pr-66]
- Add `just run_local_services` command [#67][repo-pr-67]
- Add check on startup to verify that we are on the latest migration [#68][repo-pr-68]
- Add a backend test step in CI [#69][repo-pr-69]
- Add support for additional headers/request params to support Azure [#70][repo-pr-70]
- Allow for specifying ingress annotations and TLS secret [#71][repo-pr-71]
- Extend Helm chart to allow for specifying backend env/secrets [#72][repo-pr-72]
- Add OpenAPI generation up-to-date check [#73][repo-pr-73]
- Fixes on chat [#74][repo-pr-74]
- Theme adjustments/ File upload preview [#75][repo-pr-75]
- Add recent_chats endpoint [#76][repo-pr-76]
- Extend messages lineage with previous and sibling messages [#77][repo-pr-77]
- Use --retries 2 for flaky db tests [#79][repo-pr-79]
- Add endpoint to get chat messages for chat [#80][repo-pr-80]
- Add regenerate message endpoint [#81][repo-pr-81]
- Enhance ESLint Configuration and Improve Code Quality [#82][repo-pr-82]
- Add one-off chat topic summary at start of chat [#83][repo-pr-83]
- Update chat functionality and improve session management [#85][repo-pr-85]
- Add statistics and load more options [#86][repo-pr-86]
- Switch to latest git version of sqlx [#87][repo-pr-87]
- Check whether DB schema is up-to-date in CI [#88][repo-pr-88]
- Use 10 last messages as message history and save the used input [#89][repo-pr-89]
- Add non-persistent file upload endpoint [#90][repo-pr-90]
- Refactor component structure [#92][repo-pr-92]
- Fix refactor issues [#93][repo-pr-93]
- Eslint tailwind, mobile friendly buttons [#94][repo-pr-94]
- Navigation persistence, performance optimization [#95][repo-pr-95]
- File uploads [#96][repo-pr-96]
- Toggle sidebar on mobile [#97][repo-pr-97]
- Add support for specifying imagePullSecrets in Helm chart [#98][repo-pr-98]
- Add script to publish dev release of erato Helm chart [#100][repo-pr-100]
- Use standard recommended labels in Helm chart [#101][repo-pr-101]
- Set up optional sentry integration [#102][repo-pr-102]
- Capture errors produced in streaming routes [#103][repo-pr-103]
- Add SENTRY_DEBUG envvar [#104][repo-pr-104]
- Add bitnami common chart as dependency [#105][repo-pr-105]
- Add script to run MinIO for local object storage [#106][repo-pr-106]
- Add ENVIRONMENT envvar [#108][repo-pr-108]
- Adjust clippy to check multiple feature flag configurations [#109][repo-pr-109]
- Add support for configuring and using S3 compatible file/Azure blob storage [#110][repo-pr-110]
- Add file_uploads table to persist file metadata [#111][repo-pr-111]
- Turn file_upload test back on [#112][repo-pr-112]
- Bump docker/build-push-action to v6.15.0 [#113][repo-pr-113]
- Attempt to switch from gha to registry docker build cache [#114][repo-pr-114]
- Use attached files in generation of messages [#115][repo-pr-115]
- Add possibility to provide erato.toml via secret [#116][repo-pr-116]
- Fix missing libtesseract dependency in app Dockerfile [#117][repo-pr-117]
- Add ability to edit existing messages [#118][repo-pr-118]
- Add manual chat creation endpoint [#119][repo-pr-119]
- Add files GET endpoint [#120][repo-pr-120]
- Refactor/recreate hook system [#121][repo-pr-121]
- Add custom theming support and welcome screen [#122][repo-pr-122]
- Try serving static-dynamic next.js pages [#123][repo-pr-123]
- Deactivate presign capability check [#124][repo-pr-124]
- Add basic e2e test setup with playwright [#125][repo-pr-125]
- Fix default dark/light mode [#126][repo-pr-126]
- Feat/#127 more theme modes [#127][repo-pr-127]
- Add endpoint to archive a chat [#129][repo-pr-129]
- Add endpoint for estimating token usage [#130][repo-pr-130]
- Replace usage of process.env. with window. injectable vars [#131][repo-pr-131]
- Fix wrong OpenAPI route for archive endpoint; archived_at in response [#135][repo-pr-135]
- Implement chat archiving functionality [#138][repo-pr-138]
- Add context size warning [#141][repo-pr-141]
- Strip null character from messages submitted to postgres [#146][repo-pr-146]
- Add support for configuring a system prompt [#147][repo-pr-147]
- Enhance theme system with system mode and UI improvements [#148][repo-pr-148]
- Upgrade sqlx to 0.8.5 [#149][repo-pr-149]
- Keep chat component mounted across page reloads [#150][repo-pr-150]
- Save assistant message before starting generation [#151][repo-pr-151]
- Add mechanism to set additional frontend environment [#152][repo-pr-152]
- Add markown rendering of theme description [#153][repo-pr-153]
- Refactor Logo component and improve logo path logic [#154][repo-pr-154]
- Also trigger summary generation for pre-created chat [#157][repo-pr-157]
- Add general support for tool calling via MCP servers [#159][repo-pr-159]
- Enhance UI and improve scrolling functionality [#161][repo-pr-161]
- Switch to native SSE implementation instead of mcp-proxy [#162][repo-pr-162]
- Add tool call display functionality [#163][repo-pr-163]
- Enhance chat navigation and debugging [#165][repo-pr-165]
- General refactor from Next.js to vite + react-router [#167][repo-pr-167]
- Fix JSON cast errror in down migration 0008 [#168][repo-pr-168]
- Don't submit empty tool list to prevent halucinations [#171][repo-pr-171]
- Fix mixed up display of Avatar between user and assistant [#172][repo-pr-172]
- Fix missing @storybook/addon-actions dep breaking local lint [#173][repo-pr-173]
- Serve no-cache headers for HTML responses [#174][repo-pr-174]
- Revert local frontend dev setup to correct variant [#175][repo-pr-175]
- Prepare e2e test suite for running it nightly [#176][repo-pr-176]
- Remove old peknow naming in /infrastructure; Clean up README [#177][repo-pr-177]
- Make k3d cluster easier to upgrade; Add --build-local;--wait flags [#178][repo-pr-178]
- Bump olllama to 0.9.0; Switch to qwen3:0.6b for ollama-smol [#179][repo-pr-179]
- Add i18n support with Lingui [#181][repo-pr-181]
- Fix bundling of lingui message catalogues [#182][repo-pr-182]
- Implement session-only locale detection and testing [#183][repo-pr-183]
- Archive bug - message handling for null chatId scenarios [#184][repo-pr-184]
- Auto-focus main chat input on page load [#185][repo-pr-185]
- Fix locale detection if browser provides long language tag [#186][repo-pr-186]
- Add e2e tests for GH actions [#188][repo-pr-188]
- Add azurite to local cluster setup; Add test for file upload [#189][repo-pr-189]
- Add support for normal OpenAI API [#190][repo-pr-190]
- Add test for basic chat submission [#191][repo-pr-191]
- Set up querying of permissions [#194][repo-pr-194]
- Add AGPL-3.0-only license to repository [#195][repo-pr-195]
- Simplify sidebar history items [#196][repo-pr-196]
- Add support for discoverign additional *.auto.erato.toml configs [#200][repo-pr-200]
- Replace custom and Heroicons with Iconoir icons [#201][repo-pr-201]
- Add polnish and spanish [#202][repo-pr-202]
- Improve handling of null chatId scenarios [#203][repo-pr-203]
- Fix scrolling interrupt interaction [#204][repo-pr-204]
- Don't check in compiled lingui files; Don't extract with lineno [#208][repo-pr-208]
- Set up generation of big test PDFs [#209][repo-pr-209]
- Add simple search on titles [#210][repo-pr-210]
- Show error message for too big file upload [#211][repo-pr-211]
- Make page title suffix translatable / customizable [#213][repo-pr-213]
- Add frontend tests to CI tests [#214][repo-pr-214]
- Increase file upload timeout in test [#215][repo-pr-215]
- Enable loading of custom-theme locales [#216][repo-pr-216]
- Adjust CI Rust cache usage [#218][repo-pr-218]
- Update Rust to 1.87.0 [#219][repo-pr-219]
- Refactor frontend configuration and localization [#220][repo-pr-220]
- Add generated translation files in themes to gitignore [#221][repo-pr-221]
- Fix file contents being emitted from history after first message [#222][repo-pr-222]
- Add scripts for release process [#223][repo-pr-223]


[repo-pr-23]: https://github.com/EratoLab/erato/pull/23
[repo-pr-25]: https://github.com/EratoLab/erato/pull/25
[repo-pr-26]: https://github.com/EratoLab/erato/pull/26
[repo-pr-27]: https://github.com/EratoLab/erato/pull/27
[repo-pr-28]: https://github.com/EratoLab/erato/pull/28
[repo-pr-30]: https://github.com/EratoLab/erato/pull/30
[repo-pr-32]: https://github.com/EratoLab/erato/pull/32
[repo-pr-33]: https://github.com/EratoLab/erato/pull/33
[repo-pr-34]: https://github.com/EratoLab/erato/pull/34
[repo-pr-35]: https://github.com/EratoLab/erato/pull/35
[repo-pr-36]: https://github.com/EratoLab/erato/pull/36
[repo-pr-37]: https://github.com/EratoLab/erato/pull/37
[repo-pr-38]: https://github.com/EratoLab/erato/pull/38
[repo-pr-39]: https://github.com/EratoLab/erato/pull/39
[repo-pr-40]: https://github.com/EratoLab/erato/pull/40
[repo-pr-41]: https://github.com/EratoLab/erato/pull/41
[repo-pr-42]: https://github.com/EratoLab/erato/pull/42
[repo-pr-43]: https://github.com/EratoLab/erato/pull/43
[repo-pr-44]: https://github.com/EratoLab/erato/pull/44
[repo-pr-45]: https://github.com/EratoLab/erato/pull/45
[repo-pr-46]: https://github.com/EratoLab/erato/pull/46
[repo-pr-47]: https://github.com/EratoLab/erato/pull/47
[repo-pr-48]: https://github.com/EratoLab/erato/pull/48
[repo-pr-49]: https://github.com/EratoLab/erato/pull/49
[repo-pr-50]: https://github.com/EratoLab/erato/pull/50
[repo-pr-52]: https://github.com/EratoLab/erato/pull/52
[repo-pr-54]: https://github.com/EratoLab/erato/pull/54
[repo-pr-55]: https://github.com/EratoLab/erato/pull/55
[repo-pr-56]: https://github.com/EratoLab/erato/pull/56
[repo-pr-59]: https://github.com/EratoLab/erato/pull/59
[repo-pr-60]: https://github.com/EratoLab/erato/pull/60
[repo-pr-61]: https://github.com/EratoLab/erato/pull/61
[repo-pr-62]: https://github.com/EratoLab/erato/pull/62
[repo-pr-63]: https://github.com/EratoLab/erato/pull/63
[repo-pr-64]: https://github.com/EratoLab/erato/pull/64
[repo-pr-65]: https://github.com/EratoLab/erato/pull/65
[repo-pr-66]: https://github.com/EratoLab/erato/pull/66
[repo-pr-67]: https://github.com/EratoLab/erato/pull/67
[repo-pr-68]: https://github.com/EratoLab/erato/pull/68
[repo-pr-69]: https://github.com/EratoLab/erato/pull/69
[repo-pr-70]: https://github.com/EratoLab/erato/pull/70
[repo-pr-71]: https://github.com/EratoLab/erato/pull/71
[repo-pr-72]: https://github.com/EratoLab/erato/pull/72
[repo-pr-73]: https://github.com/EratoLab/erato/pull/73
[repo-pr-74]: https://github.com/EratoLab/erato/pull/74
[repo-pr-75]: https://github.com/EratoLab/erato/pull/75
[repo-pr-76]: https://github.com/EratoLab/erato/pull/76
[repo-pr-77]: https://github.com/EratoLab/erato/pull/77
[repo-pr-79]: https://github.com/EratoLab/erato/pull/79
[repo-pr-80]: https://github.com/EratoLab/erato/pull/80
[repo-pr-81]: https://github.com/EratoLab/erato/pull/81
[repo-pr-82]: https://github.com/EratoLab/erato/pull/82
[repo-pr-83]: https://github.com/EratoLab/erato/pull/83
[repo-pr-85]: https://github.com/EratoLab/erato/pull/85
[repo-pr-86]: https://github.com/EratoLab/erato/pull/86
[repo-pr-87]: https://github.com/EratoLab/erato/pull/87
[repo-pr-88]: https://github.com/EratoLab/erato/pull/88
[repo-pr-89]: https://github.com/EratoLab/erato/pull/89
[repo-pr-90]: https://github.com/EratoLab/erato/pull/90
[repo-pr-92]: https://github.com/EratoLab/erato/pull/92
[repo-pr-93]: https://github.com/EratoLab/erato/pull/93
[repo-pr-94]: https://github.com/EratoLab/erato/pull/94
[repo-pr-95]: https://github.com/EratoLab/erato/pull/95
[repo-pr-96]: https://github.com/EratoLab/erato/pull/96
[repo-pr-97]: https://github.com/EratoLab/erato/pull/97
[repo-pr-98]: https://github.com/EratoLab/erato/pull/98
[repo-pr-100]: https://github.com/EratoLab/erato/pull/100
[repo-pr-101]: https://github.com/EratoLab/erato/pull/101
[repo-pr-102]: https://github.com/EratoLab/erato/pull/102
[repo-pr-103]: https://github.com/EratoLab/erato/pull/103
[repo-pr-104]: https://github.com/EratoLab/erato/pull/104
[repo-pr-105]: https://github.com/EratoLab/erato/pull/105
[repo-pr-106]: https://github.com/EratoLab/erato/pull/106
[repo-pr-108]: https://github.com/EratoLab/erato/pull/108
[repo-pr-109]: https://github.com/EratoLab/erato/pull/109
[repo-pr-110]: https://github.com/EratoLab/erato/pull/110
[repo-pr-111]: https://github.com/EratoLab/erato/pull/111
[repo-pr-112]: https://github.com/EratoLab/erato/pull/112
[repo-pr-113]: https://github.com/EratoLab/erato/pull/113
[repo-pr-114]: https://github.com/EratoLab/erato/pull/114
[repo-pr-115]: https://github.com/EratoLab/erato/pull/115
[repo-pr-116]: https://github.com/EratoLab/erato/pull/116
[repo-pr-117]: https://github.com/EratoLab/erato/pull/117
[repo-pr-118]: https://github.com/EratoLab/erato/pull/118
[repo-pr-119]: https://github.com/EratoLab/erato/pull/119
[repo-pr-120]: https://github.com/EratoLab/erato/pull/120
[repo-pr-121]: https://github.com/EratoLab/erato/pull/121
[repo-pr-122]: https://github.com/EratoLab/erato/pull/122
[repo-pr-123]: https://github.com/EratoLab/erato/pull/123
[repo-pr-124]: https://github.com/EratoLab/erato/pull/124
[repo-pr-125]: https://github.com/EratoLab/erato/pull/125
[repo-pr-126]: https://github.com/EratoLab/erato/pull/126
[repo-pr-127]: https://github.com/EratoLab/erato/pull/127
[repo-pr-129]: https://github.com/EratoLab/erato/pull/129
[repo-pr-130]: https://github.com/EratoLab/erato/pull/130
[repo-pr-131]: https://github.com/EratoLab/erato/pull/131
[repo-pr-135]: https://github.com/EratoLab/erato/pull/135
[repo-pr-138]: https://github.com/EratoLab/erato/pull/138
[repo-pr-141]: https://github.com/EratoLab/erato/pull/141
[repo-pr-146]: https://github.com/EratoLab/erato/pull/146
[repo-pr-147]: https://github.com/EratoLab/erato/pull/147
[repo-pr-148]: https://github.com/EratoLab/erato/pull/148
[repo-pr-149]: https://github.com/EratoLab/erato/pull/149
[repo-pr-150]: https://github.com/EratoLab/erato/pull/150
[repo-pr-151]: https://github.com/EratoLab/erato/pull/151
[repo-pr-152]: https://github.com/EratoLab/erato/pull/152
[repo-pr-153]: https://github.com/EratoLab/erato/pull/153
[repo-pr-154]: https://github.com/EratoLab/erato/pull/154
[repo-pr-157]: https://github.com/EratoLab/erato/pull/157
[repo-pr-159]: https://github.com/EratoLab/erato/pull/159
[repo-pr-161]: https://github.com/EratoLab/erato/pull/161
[repo-pr-162]: https://github.com/EratoLab/erato/pull/162
[repo-pr-163]: https://github.com/EratoLab/erato/pull/163
[repo-pr-165]: https://github.com/EratoLab/erato/pull/165
[repo-pr-167]: https://github.com/EratoLab/erato/pull/167
[repo-pr-168]: https://github.com/EratoLab/erato/pull/168
[repo-pr-171]: https://github.com/EratoLab/erato/pull/171
[repo-pr-172]: https://github.com/EratoLab/erato/pull/172
[repo-pr-173]: https://github.com/EratoLab/erato/pull/173
[repo-pr-174]: https://github.com/EratoLab/erato/pull/174
[repo-pr-175]: https://github.com/EratoLab/erato/pull/175
[repo-pr-176]: https://github.com/EratoLab/erato/pull/176
[repo-pr-177]: https://github.com/EratoLab/erato/pull/177
[repo-pr-178]: https://github.com/EratoLab/erato/pull/178
[repo-pr-179]: https://github.com/EratoLab/erato/pull/179
[repo-pr-181]: https://github.com/EratoLab/erato/pull/181
[repo-pr-182]: https://github.com/EratoLab/erato/pull/182
[repo-pr-183]: https://github.com/EratoLab/erato/pull/183
[repo-pr-184]: https://github.com/EratoLab/erato/pull/184
[repo-pr-185]: https://github.com/EratoLab/erato/pull/185
[repo-pr-186]: https://github.com/EratoLab/erato/pull/186
[repo-pr-188]: https://github.com/EratoLab/erato/pull/188
[repo-pr-189]: https://github.com/EratoLab/erato/pull/189
[repo-pr-190]: https://github.com/EratoLab/erato/pull/190
[repo-pr-191]: https://github.com/EratoLab/erato/pull/191
[repo-pr-194]: https://github.com/EratoLab/erato/pull/194
[repo-pr-195]: https://github.com/EratoLab/erato/pull/195
[repo-pr-196]: https://github.com/EratoLab/erato/pull/196
[repo-pr-200]: https://github.com/EratoLab/erato/pull/200
[repo-pr-201]: https://github.com/EratoLab/erato/pull/201
[repo-pr-202]: https://github.com/EratoLab/erato/pull/202
[repo-pr-203]: https://github.com/EratoLab/erato/pull/203
[repo-pr-204]: https://github.com/EratoLab/erato/pull/204
[repo-pr-208]: https://github.com/EratoLab/erato/pull/208
[repo-pr-209]: https://github.com/EratoLab/erato/pull/209
[repo-pr-210]: https://github.com/EratoLab/erato/pull/210
[repo-pr-211]: https://github.com/EratoLab/erato/pull/211
[repo-pr-213]: https://github.com/EratoLab/erato/pull/213
[repo-pr-214]: https://github.com/EratoLab/erato/pull/214
[repo-pr-215]: https://github.com/EratoLab/erato/pull/215
[repo-pr-216]: https://github.com/EratoLab/erato/pull/216
[repo-pr-218]: https://github.com/EratoLab/erato/pull/218
[repo-pr-219]: https://github.com/EratoLab/erato/pull/219
[repo-pr-220]: https://github.com/EratoLab/erato/pull/220
[repo-pr-221]: https://github.com/EratoLab/erato/pull/221
[repo-pr-222]: https://github.com/EratoLab/erato/pull/222
[repo-pr-223]: https://github.com/EratoLab/erato/pull/223
[repo-pr-224]: https://github.com/EratoLab/erato/pull/224
[repo-pr-225]: https://github.com/EratoLab/erato/pull/225
[repo-pr-226]: https://github.com/EratoLab/erato/pull/226
[repo-pr-228]: https://github.com/EratoLab/erato/pull/228
[repo-pr-229]: https://github.com/EratoLab/erato/pull/229
[repo-pr-230]: https://github.com/EratoLab/erato/pull/230
[repo-pr-231]: https://github.com/EratoLab/erato/pull/231
[repo-pr-232]: https://github.com/EratoLab/erato/pull/232
[repo-pr-233]: https://github.com/EratoLab/erato/pull/233
[repo-pr-234]: https://github.com/EratoLab/erato/pull/234
[repo-pr-235]: https://github.com/EratoLab/erato/pull/235
[repo-pr-236]: https://github.com/EratoLab/erato/pull/236
[repo-pr-237]: https://github.com/EratoLab/erato/pull/237
[repo-pr-238]: https://github.com/EratoLab/erato/pull/238
[repo-pr-239]: https://github.com/EratoLab/erato/pull/239
[repo-pr-240]: https://github.com/EratoLab/erato/pull/240
[repo-pr-241]: https://github.com/EratoLab/erato/pull/241
[repo-pr-242]: https://github.com/EratoLab/erato/pull/242
[repo-pr-243]: https://github.com/EratoLab/erato/pull/243
[repo-pr-244]: https://github.com/EratoLab/erato/pull/244
[repo-pr-245]: https://github.com/EratoLab/erato/pull/245
[repo-pr-246]: https://github.com/EratoLab/erato/pull/246
[repo-pr-247]: https://github.com/EratoLab/erato/pull/247
[repo-pr-248]: https://github.com/EratoLab/erato/pull/248
[repo-pr-249]: https://github.com/EratoLab/erato/pull/249
[repo-pr-250]: https://github.com/EratoLab/erato/pull/250
[repo-pr-251]: https://github.com/EratoLab/erato/pull/251
[repo-pr-252]: https://github.com/EratoLab/erato/pull/252
[repo-pr-253]: https://github.com/EratoLab/erato/pull/253
[repo-pr-254]: https://github.com/EratoLab/erato/pull/254
[repo-pr-255]: https://github.com/EratoLab/erato/pull/255
[repo-pr-256]: https://github.com/EratoLab/erato/pull/256
[repo-pr-257]: https://github.com/EratoLab/erato/pull/257
[repo-pr-258]: https://github.com/EratoLab/erato/pull/258
[repo-pr-259]: https://github.com/EratoLab/erato/pull/259
[repo-pr-260]: https://github.com/EratoLab/erato/pull/260
[repo-pr-261]: https://github.com/EratoLab/erato/pull/261
[repo-pr-262]: https://github.com/EratoLab/erato/pull/262
[repo-pr-263]: https://github.com/EratoLab/erato/pull/263
[repo-pr-264]: https://github.com/EratoLab/erato/pull/264
[repo-pr-265]: https://github.com/EratoLab/erato/pull/265
[repo-pr-266]: https://github.com/EratoLab/erato/pull/266
[repo-pr-267]: https://github.com/EratoLab/erato/pull/267
[repo-pr-268]: https://github.com/EratoLab/erato/pull/268
[repo-pr-269]: https://github.com/EratoLab/erato/pull/269
[repo-pr-270]: https://github.com/EratoLab/erato/pull/270
[repo-pr-271]: https://github.com/EratoLab/erato/pull/271
[repo-pr-272]: https://github.com/EratoLab/erato/pull/272
[repo-pr-273]: https://github.com/EratoLab/erato/pull/273
[repo-pr-274]: https://github.com/EratoLab/erato/pull/274
[repo-pr-275]: https://github.com/EratoLab/erato/pull/275
[repo-pr-276]: https://github.com/EratoLab/erato/pull/276
[repo-pr-277]: https://github.com/EratoLab/erato/pull/277
[repo-pr-279]: https://github.com/EratoLab/erato/pull/279
[repo-pr-280]: https://github.com/EratoLab/erato/pull/280
[repo-pr-281]: https://github.com/EratoLab/erato/pull/281
[repo-pr-282]: https://github.com/EratoLab/erato/pull/282
[repo-pr-283]: https://github.com/EratoLab/erato/pull/283
[repo-pr-284]: https://github.com/EratoLab/erato/pull/284
[repo-pr-285]: https://github.com/EratoLab/erato/pull/285
[repo-pr-286]: https://github.com/EratoLab/erato/pull/286
[repo-pr-287]: https://github.com/EratoLab/erato/pull/287
[repo-pr-288]: https://github.com/EratoLab/erato/pull/288
[repo-pr-289]: https://github.com/EratoLab/erato/pull/289
[repo-pr-290]: https://github.com/EratoLab/erato/pull/290
[repo-pr-291]: https://github.com/EratoLab/erato/pull/291
[repo-pr-292]: https://github.com/EratoLab/erato/pull/292
[repo-pr-293]: https://github.com/EratoLab/erato/pull/293
[repo-pr-294]: https://github.com/EratoLab/erato/pull/294
[repo-pr-295]: https://github.com/EratoLab/erato/pull/295
[repo-pr-296]: https://github.com/EratoLab/erato/pull/296
[repo-pr-297]: https://github.com/EratoLab/erato/pull/297
[repo-pr-298]: https://github.com/EratoLab/erato/pull/298
[repo-pr-299]: https://github.com/EratoLab/erato/pull/299
[repo-pr-300]: https://github.com/EratoLab/erato/pull/300
[repo-pr-301]: https://github.com/EratoLab/erato/pull/301
[repo-pr-302]: https://github.com/EratoLab/erato/pull/302
[repo-pr-303]: https://github.com/EratoLab/erato/pull/303
[repo-pr-304]: https://github.com/EratoLab/erato/pull/304
[repo-pr-305]: https://github.com/EratoLab/erato/pull/305
[repo-pr-306]: https://github.com/EratoLab/erato/pull/306
[repo-pr-307]: https://github.com/EratoLab/erato/pull/307
[repo-pr-308]: https://github.com/EratoLab/erato/pull/308
[repo-pr-309]: https://github.com/EratoLab/erato/pull/309
[repo-pr-310]: https://github.com/EratoLab/erato/pull/310
[repo-pr-311]: https://github.com/EratoLab/erato/pull/311
[repo-pr-312]: https://github.com/EratoLab/erato/pull/312
[repo-pr-313]: https://github.com/EratoLab/erato/pull/313
[repo-pr-314]: https://github.com/EratoLab/erato/pull/314
[repo-pr-315]: https://github.com/EratoLab/erato/pull/315
[repo-pr-316]: https://github.com/EratoLab/erato/pull/316
[repo-pr-317]: https://github.com/EratoLab/erato/pull/317
[repo-pr-318]: https://github.com/EratoLab/erato/pull/318
[repo-pr-319]: https://github.com/EratoLab/erato/pull/319
[repo-pr-320]: https://github.com/EratoLab/erato/pull/320
[repo-pr-321]: https://github.com/EratoLab/erato/pull/321
[repo-pr-322]: https://github.com/EratoLab/erato/pull/322
[repo-pr-323]: https://github.com/EratoLab/erato/pull/323
[repo-pr-324]: https://github.com/EratoLab/erato/pull/324
[repo-pr-325]: https://github.com/EratoLab/erato/pull/325
[repo-pr-326]: https://github.com/EratoLab/erato/pull/326
[repo-pr-327]: https://github.com/EratoLab/erato/pull/327
[repo-pr-328]: https://github.com/EratoLab/erato/pull/328
[repo-pr-329]: https://github.com/EratoLab/erato/pull/329
[repo-pr-330]: https://github.com/EratoLab/erato/pull/330
[repo-pr-331]: https://github.com/EratoLab/erato/pull/331
[repo-pr-332]: https://github.com/EratoLab/erato/pull/332
[repo-pr-333]: https://github.com/EratoLab/erato/pull/333
[repo-pr-334]: https://github.com/EratoLab/erato/pull/334
[repo-pr-335]: https://github.com/EratoLab/erato/pull/335
[repo-pr-336]: https://github.com/EratoLab/erato/pull/336
[repo-pr-337]: https://github.com/EratoLab/erato/pull/337
[repo-pr-338]: https://github.com/EratoLab/erato/pull/338
[repo-pr-339]: https://github.com/EratoLab/erato/pull/339
[repo-pr-340]: https://github.com/EratoLab/erato/pull/340
[repo-pr-341]: https://github.com/EratoLab/erato/pull/341
[repo-pr-342]: https://github.com/EratoLab/erato/pull/342
[repo-pr-343]: https://github.com/EratoLab/erato/pull/343
[repo-pr-344]: https://github.com/EratoLab/erato/pull/344
[repo-pr-345]: https://github.com/EratoLab/erato/pull/345
[repo-pr-346]: https://github.com/EratoLab/erato/pull/346
[repo-pr-348]: https://github.com/EratoLab/erato/pull/348
[repo-pr-349]: https://github.com/EratoLab/erato/pull/349
[repo-pr-350]: https://github.com/EratoLab/erato/pull/350
[repo-pr-351]: https://github.com/EratoLab/erato/pull/351
[repo-pr-352]: https://github.com/EratoLab/erato/pull/352
[repo-pr-353]: https://github.com/EratoLab/erato/pull/353
[repo-pr-354]: https://github.com/EratoLab/erato/pull/354
[repo-pr-355]: https://github.com/EratoLab/erato/pull/355
[repo-pr-356]: https://github.com/EratoLab/erato/pull/356
[repo-pr-357]: https://github.com/EratoLab/erato/pull/357
[repo-pr-358]: https://github.com/EratoLab/erato/pull/358
[repo-pr-359]: https://github.com/EratoLab/erato/pull/359
[repo-pr-360]: https://github.com/EratoLab/erato/pull/360
[repo-pr-361]: https://github.com/EratoLab/erato/pull/361
[repo-pr-362]: https://github.com/EratoLab/erato/pull/362
[repo-pr-363]: https://github.com/EratoLab/erato/pull/363
[repo-pr-364]: https://github.com/EratoLab/erato/pull/364
[repo-pr-366]: https://github.com/EratoLab/erato/pull/366
[repo-pr-367]: https://github.com/EratoLab/erato/pull/367
[repo-pr-368]: https://github.com/EratoLab/erato/pull/368
[repo-pr-369]: https://github.com/EratoLab/erato/pull/369
[repo-pr-370]: https://github.com/EratoLab/erato/pull/370
[repo-pr-371]: https://github.com/EratoLab/erato/pull/371
[repo-pr-372]: https://github.com/EratoLab/erato/pull/372
[repo-pr-373]: https://github.com/EratoLab/erato/pull/373
[repo-pr-375]: https://github.com/EratoLab/erato/pull/375
[repo-pr-376]: https://github.com/EratoLab/erato/pull/376
[repo-pr-377]: https://github.com/EratoLab/erato/pull/377
[repo-pr-379]: https://github.com/EratoLab/erato/pull/379
[repo-pr-380]: https://github.com/EratoLab/erato/pull/380
[repo-pr-381]: https://github.com/EratoLab/erato/pull/381
[repo-pr-382]: https://github.com/EratoLab/erato/pull/382
[repo-pr-383]: https://github.com/EratoLab/erato/pull/383
[repo-pr-384]: https://github.com/EratoLab/erato/pull/384
[repo-pr-385]: https://github.com/EratoLab/erato/pull/385
[repo-pr-386]: https://github.com/EratoLab/erato/pull/386
[repo-pr-387]: https://github.com/EratoLab/erato/pull/387
[repo-pr-388]: https://github.com/EratoLab/erato/pull/388
[repo-pr-389]: https://github.com/EratoLab/erato/pull/389
[repo-pr-390]: https://github.com/EratoLab/erato/pull/390
[repo-pr-391]: https://github.com/EratoLab/erato/pull/391
[repo-pr-392]: https://github.com/EratoLab/erato/pull/392
[repo-pr-393]: https://github.com/EratoLab/erato/pull/393
[repo-pr-394]: https://github.com/EratoLab/erato/pull/394
[repo-pr-395]: https://github.com/EratoLab/erato/pull/395
[repo-pr-396]: https://github.com/EratoLab/erato/pull/396
[repo-pr-397]: https://github.com/EratoLab/erato/pull/397
[repo-pr-398]: https://github.com/EratoLab/erato/pull/398
[repo-pr-399]: https://github.com/EratoLab/erato/pull/399
[repo-pr-400]: https://github.com/EratoLab/erato/pull/400
[repo-pr-401]: https://github.com/EratoLab/erato/pull/401
[repo-pr-402]: https://github.com/EratoLab/erato/pull/402
[repo-pr-403]: https://github.com/EratoLab/erato/pull/403
[repo-pr-404]: https://github.com/EratoLab/erato/pull/404
[repo-pr-405]: https://github.com/EratoLab/erato/pull/405
[repo-pr-406]: https://github.com/EratoLab/erato/pull/406
[repo-pr-407]: https://github.com/EratoLab/erato/pull/407
[repo-pr-408]: https://github.com/EratoLab/erato/pull/408
[repo-pr-409]: https://github.com/EratoLab/erato/pull/409
[repo-pr-410]: https://github.com/EratoLab/erato/pull/410
[repo-pr-411]: https://github.com/EratoLab/erato/pull/411
[repo-pr-412]: https://github.com/EratoLab/erato/pull/412
[repo-pr-413]: https://github.com/EratoLab/erato/pull/413
[repo-pr-414]: https://github.com/EratoLab/erato/pull/414
[repo-pr-415]: https://github.com/EratoLab/erato/pull/415
[repo-pr-416]: https://github.com/EratoLab/erato/pull/416
[repo-pr-417]: https://github.com/EratoLab/erato/pull/417
[repo-pr-418]: https://github.com/EratoLab/erato/pull/418
[repo-pr-419]: https://github.com/EratoLab/erato/pull/419
[repo-pr-420]: https://github.com/EratoLab/erato/pull/420
[repo-pr-421]: https://github.com/EratoLab/erato/pull/421
[repo-pr-422]: https://github.com/EratoLab/erato/pull/422
[repo-pr-423]: https://github.com/EratoLab/erato/pull/423
[repo-pr-424]: https://github.com/EratoLab/erato/pull/424
[repo-pr-425]: https://github.com/EratoLab/erato/pull/425
[repo-pr-426]: https://github.com/EratoLab/erato/pull/426
[repo-pr-427]: https://github.com/EratoLab/erato/pull/427
[repo-pr-428]: https://github.com/EratoLab/erato/pull/428
[repo-pr-429]: https://github.com/EratoLab/erato/pull/429
[repo-pr-430]: https://github.com/EratoLab/erato/pull/430
[repo-pr-431]: https://github.com/EratoLab/erato/pull/431
[repo-pr-432]: https://github.com/EratoLab/erato/pull/432
[repo-pr-433]: https://github.com/EratoLab/erato/pull/433
[repo-pr-434]: https://github.com/EratoLab/erato/pull/434
[repo-pr-435]: https://github.com/EratoLab/erato/pull/435
[repo-pr-436]: https://github.com/EratoLab/erato/pull/436
[repo-pr-437]: https://github.com/EratoLab/erato/pull/437
[repo-pr-438]: https://github.com/EratoLab/erato/pull/438
[repo-pr-439]: https://github.com/EratoLab/erato/pull/439
[repo-pr-440]: https://github.com/EratoLab/erato/pull/440
[repo-pr-441]: https://github.com/EratoLab/erato/pull/441
[repo-pr-442]: https://github.com/EratoLab/erato/pull/442
[repo-pr-443]: https://github.com/EratoLab/erato/pull/443
[repo-pr-444]: https://github.com/EratoLab/erato/pull/444
[repo-pr-445]: https://github.com/EratoLab/erato/pull/445
[repo-pr-446]: https://github.com/EratoLab/erato/pull/446
[repo-pr-447]: https://github.com/EratoLab/erato/pull/447
[repo-pr-448]: https://github.com/EratoLab/erato/pull/448
[repo-pr-449]: https://github.com/EratoLab/erato/pull/449
[repo-pr-450]: https://github.com/EratoLab/erato/pull/450
[repo-pr-451]: https://github.com/EratoLab/erato/pull/451
[repo-pr-452]: https://github.com/EratoLab/erato/pull/452
[repo-pr-453]: https://github.com/EratoLab/erato/pull/453
[repo-pr-454]: https://github.com/EratoLab/erato/pull/454
[repo-pr-455]: https://github.com/EratoLab/erato/pull/455
[repo-pr-456]: https://github.com/EratoLab/erato/pull/456
[repo-pr-457]: https://github.com/EratoLab/erato/pull/457
[repo-pr-458]: https://github.com/EratoLab/erato/pull/458
[repo-pr-459]: https://github.com/EratoLab/erato/pull/459
[repo-pr-460]: https://github.com/EratoLab/erato/pull/460
[repo-pr-461]: https://github.com/EratoLab/erato/pull/461
[repo-pr-462]: https://github.com/EratoLab/erato/pull/462
[repo-pr-463]: https://github.com/EratoLab/erato/pull/463
[repo-pr-464]: https://github.com/EratoLab/erato/pull/464
[repo-pr-465]: https://github.com/EratoLab/erato/pull/465
[repo-pr-466]: https://github.com/EratoLab/erato/pull/466
[repo-pr-467]: https://github.com/EratoLab/erato/pull/467
[repo-pr-468]: https://github.com/EratoLab/erato/pull/468
[repo-pr-469]: https://github.com/EratoLab/erato/pull/469
[repo-pr-470]: https://github.com/EratoLab/erato/pull/470
[repo-pr-471]: https://github.com/EratoLab/erato/pull/471
[repo-pr-472]: https://github.com/EratoLab/erato/pull/472
[repo-pr-473]: https://github.com/EratoLab/erato/pull/473
[repo-pr-474]: https://github.com/EratoLab/erato/pull/474
[repo-pr-475]: https://github.com/EratoLab/erato/pull/475
[repo-pr-476]: https://github.com/EratoLab/erato/pull/476
[repo-pr-477]: https://github.com/EratoLab/erato/pull/477
[repo-pr-478]: https://github.com/EratoLab/erato/pull/478
[repo-pr-479]: https://github.com/EratoLab/erato/pull/479
[repo-pr-480]: https://github.com/EratoLab/erato/pull/480
[repo-pr-481]: https://github.com/EratoLab/erato/pull/481
[repo-pr-482]: https://github.com/EratoLab/erato/pull/482
[repo-pr-483]: https://github.com/EratoLab/erato/pull/483
[repo-pr-484]: https://github.com/EratoLab/erato/pull/484
[repo-pr-485]: https://github.com/EratoLab/erato/pull/485
[repo-pr-486]: https://github.com/EratoLab/erato/pull/486
[repo-pr-487]: https://github.com/EratoLab/erato/pull/487
[repo-pr-488]: https://github.com/EratoLab/erato/pull/488
[repo-pr-489]: https://github.com/EratoLab/erato/pull/489
[repo-pr-490]: https://github.com/EratoLab/erato/pull/490
[repo-pr-491]: https://github.com/EratoLab/erato/pull/491
[repo-pr-492]: https://github.com/EratoLab/erato/pull/492
[repo-pr-493]: https://github.com/EratoLab/erato/pull/493
[repo-pr-494]: https://github.com/EratoLab/erato/pull/494
[repo-pr-495]: https://github.com/EratoLab/erato/pull/495
[repo-pr-496]: https://github.com/EratoLab/erato/pull/496
[repo-pr-497]: https://github.com/EratoLab/erato/pull/497
[repo-pr-498]: https://github.com/EratoLab/erato/pull/498
[repo-pr-499]: https://github.com/EratoLab/erato/pull/499
[repo-pr-500]: https://github.com/EratoLab/erato/pull/500
[repo-pr-501]: https://github.com/EratoLab/erato/pull/501
[repo-pr-502]: https://github.com/EratoLab/erato/pull/502
[repo-pr-503]: https://github.com/EratoLab/erato/pull/503
[repo-pr-504]: https://github.com/EratoLab/erato/pull/504
[repo-pr-505]: https://github.com/EratoLab/erato/pull/505
[repo-pr-506]: https://github.com/EratoLab/erato/pull/506
[repo-pr-507]: https://github.com/EratoLab/erato/pull/507
[repo-pr-508]: https://github.com/EratoLab/erato/pull/508
[repo-pr-509]: https://github.com/EratoLab/erato/pull/509
[repo-pr-510]: https://github.com/EratoLab/erato/pull/510
[repo-pr-511]: https://github.com/EratoLab/erato/pull/511
[repo-pr-512]: https://github.com/EratoLab/erato/pull/512
[repo-pr-513]: https://github.com/EratoLab/erato/pull/513
[repo-pr-514]: https://github.com/EratoLab/erato/pull/514
[repo-pr-515]: https://github.com/EratoLab/erato/pull/515
[repo-pr-516]: https://github.com/EratoLab/erato/pull/516
[repo-pr-517]: https://github.com/EratoLab/erato/pull/517
[repo-pr-518]: https://github.com/EratoLab/erato/pull/518
[repo-pr-519]: https://github.com/EratoLab/erato/pull/519
[repo-pr-520]: https://github.com/EratoLab/erato/pull/520
[repo-pr-521]: https://github.com/EratoLab/erato/pull/521
[repo-pr-522]: https://github.com/EratoLab/erato/pull/522
[repo-pr-523]: https://github.com/EratoLab/erato/pull/523
[repo-pr-524]: https://github.com/EratoLab/erato/pull/524
[repo-pr-525]: https://github.com/EratoLab/erato/pull/525
[repo-pr-526]: https://github.com/EratoLab/erato/pull/526
[repo-pr-527]: https://github.com/EratoLab/erato/pull/527
[repo-pr-528]: https://github.com/EratoLab/erato/pull/528
[repo-pr-529]: https://github.com/EratoLab/erato/pull/529
[repo-pr-530]: https://github.com/EratoLab/erato/pull/530
[repo-pr-531]: https://github.com/EratoLab/erato/pull/531
[repo-pr-532]: https://github.com/EratoLab/erato/pull/532
[repo-pr-533]: https://github.com/EratoLab/erato/pull/533
[repo-pr-534]: https://github.com/EratoLab/erato/pull/534
[repo-pr-535]: https://github.com/EratoLab/erato/pull/535
[repo-pr-536]: https://github.com/EratoLab/erato/pull/536
[repo-pr-537]: https://github.com/EratoLab/erato/pull/537
[repo-pr-539]: https://github.com/EratoLab/erato/pull/539
[repo-pr-540]: https://github.com/EratoLab/erato/pull/540
[repo-pr-541]: https://github.com/EratoLab/erato/pull/541
[repo-pr-543]: https://github.com/EratoLab/erato/pull/543
[repo-pr-544]: https://github.com/EratoLab/erato/pull/544
[repo-pr-545]: https://github.com/EratoLab/erato/pull/545
[repo-pr-546]: https://github.com/EratoLab/erato/pull/546
[repo-pr-547]: https://github.com/EratoLab/erato/pull/547
[repo-pr-548]: https://github.com/EratoLab/erato/pull/548
[repo-pr-549]: https://github.com/EratoLab/erato/pull/549
[repo-pr-550]: https://github.com/EratoLab/erato/pull/550
[repo-pr-551]: https://github.com/EratoLab/erato/pull/551
[repo-pr-552]: https://github.com/EratoLab/erato/pull/552
[repo-pr-553]: https://github.com/EratoLab/erato/pull/553
[repo-pr-554]: https://github.com/EratoLab/erato/pull/554
[repo-pr-555]: https://github.com/EratoLab/erato/pull/555
[repo-pr-556]: https://github.com/EratoLab/erato/pull/556
[repo-pr-557]: https://github.com/EratoLab/erato/pull/557
[repo-pr-558]: https://github.com/EratoLab/erato/pull/558
[repo-pr-559]: https://github.com/EratoLab/erato/pull/559
[repo-pr-560]: https://github.com/EratoLab/erato/pull/560
[repo-pr-561]: https://github.com/EratoLab/erato/pull/561
[repo-pr-562]: https://github.com/EratoLab/erato/pull/562
[repo-pr-563]: https://github.com/EratoLab/erato/pull/563
[repo-pr-564]: https://github.com/EratoLab/erato/pull/564
[repo-pr-565]: https://github.com/EratoLab/erato/pull/565
[repo-pr-566]: https://github.com/EratoLab/erato/pull/566
[repo-pr-567]: https://github.com/EratoLab/erato/pull/567
[repo-pr-568]: https://github.com/EratoLab/erato/pull/568
[repo-pr-569]: https://github.com/EratoLab/erato/pull/569
[repo-pr-570]: https://github.com/EratoLab/erato/pull/570
[repo-pr-571]: https://github.com/EratoLab/erato/pull/571
[repo-pr-572]: https://github.com/EratoLab/erato/pull/572
[repo-pr-573]: https://github.com/EratoLab/erato/pull/573
[repo-pr-574]: https://github.com/EratoLab/erato/pull/574
[repo-pr-575]: https://github.com/EratoLab/erato/pull/575
[repo-pr-576]: https://github.com/EratoLab/erato/pull/576
[repo-pr-577]: https://github.com/EratoLab/erato/pull/577
[repo-pr-578]: https://github.com/EratoLab/erato/pull/578
[repo-pr-579]: https://github.com/EratoLab/erato/pull/579
[repo-pr-580]: https://github.com/EratoLab/erato/pull/580
[repo-pr-581]: https://github.com/EratoLab/erato/pull/581
[repo-pr-582]: https://github.com/EratoLab/erato/pull/582
[repo-pr-583]: https://github.com/EratoLab/erato/pull/583
[repo-pr-584]: https://github.com/EratoLab/erato/pull/584
[repo-pr-585]: https://github.com/EratoLab/erato/pull/585
[repo-pr-586]: https://github.com/EratoLab/erato/pull/586
[repo-pr-587]: https://github.com/EratoLab/erato/pull/587
[repo-pr-588]: https://github.com/EratoLab/erato/pull/588
[repo-pr-589]: https://github.com/EratoLab/erato/pull/589
[repo-pr-590]: https://github.com/EratoLab/erato/pull/590
[repo-pr-591]: https://github.com/EratoLab/erato/pull/591
[repo-pr-592]: https://github.com/EratoLab/erato/pull/592
[repo-pr-593]: https://github.com/EratoLab/erato/pull/593
[repo-pr-595]: https://github.com/EratoLab/erato/pull/595
[repo-pr-596]: https://github.com/EratoLab/erato/pull/596
[repo-pr-597]: https://github.com/EratoLab/erato/pull/597
[repo-pr-598]: https://github.com/EratoLab/erato/pull/598
[repo-pr-599]: https://github.com/EratoLab/erato/pull/599
[repo-pr-600]: https://github.com/EratoLab/erato/pull/600
[repo-pr-601]: https://github.com/EratoLab/erato/pull/601
[repo-pr-602]: https://github.com/EratoLab/erato/pull/602
[repo-pr-603]: https://github.com/EratoLab/erato/pull/603
[repo-pr-604]: https://github.com/EratoLab/erato/pull/604
[repo-pr-605]: https://github.com/EratoLab/erato/pull/605
[repo-pr-606]: https://github.com/EratoLab/erato/pull/606
[repo-pr-607]: https://github.com/EratoLab/erato/pull/607
[repo-pr-608]: https://github.com/EratoLab/erato/pull/608
[repo-pr-609]: https://github.com/EratoLab/erato/pull/609
[repo-pr-610]: https://github.com/EratoLab/erato/pull/610
[repo-pr-611]: https://github.com/EratoLab/erato/pull/611
[repo-pr-612]: https://github.com/EratoLab/erato/pull/612
[repo-pr-613]: https://github.com/EratoLab/erato/pull/613
[repo-pr-614]: https://github.com/EratoLab/erato/pull/614
[repo-pr-615]: https://github.com/EratoLab/erato/pull/615
[repo-pr-616]: https://github.com/EratoLab/erato/pull/616
[repo-pr-617]: https://github.com/EratoLab/erato/pull/617
[repo-pr-618]: https://github.com/EratoLab/erato/pull/618
[repo-pr-619]: https://github.com/EratoLab/erato/pull/619
[repo-pr-620]: https://github.com/EratoLab/erato/pull/620
[repo-pr-621]: https://github.com/EratoLab/erato/pull/621
[repo-pr-622]: https://github.com/EratoLab/erato/pull/622
[repo-pr-624]: https://github.com/EratoLab/erato/pull/624
[repo-pr-625]: https://github.com/EratoLab/erato/pull/625
[repo-pr-626]: https://github.com/EratoLab/erato/pull/626
[repo-pr-627]: https://github.com/EratoLab/erato/pull/627
[repo-pr-628]: https://github.com/EratoLab/erato/pull/628
[repo-pr-629]: https://github.com/EratoLab/erato/pull/629
[repo-pr-630]: https://github.com/EratoLab/erato/pull/630
[repo-pr-631]: https://github.com/EratoLab/erato/pull/631
[repo-pr-632]: https://github.com/EratoLab/erato/pull/632
[repo-pr-633]: https://github.com/EratoLab/erato/pull/633
[repo-pr-634]: https://github.com/EratoLab/erato/pull/634
[repo-pr-635]: https://github.com/EratoLab/erato/pull/635
[repo-pr-636]: https://github.com/EratoLab/erato/pull/636
[repo-pr-637]: https://github.com/EratoLab/erato/pull/637
[repo-pr-638]: https://github.com/EratoLab/erato/pull/638
[repo-pr-639]: https://github.com/EratoLab/erato/pull/639
[repo-pr-640]: https://github.com/EratoLab/erato/pull/640
[repo-pr-641]: https://github.com/EratoLab/erato/pull/641
[repo-pr-642]: https://github.com/EratoLab/erato/pull/642
[repo-pr-643]: https://github.com/EratoLab/erato/pull/643
[repo-pr-644]: https://github.com/EratoLab/erato/pull/644
[repo-pr-645]: https://github.com/EratoLab/erato/pull/645
[repo-pr-646]: https://github.com/EratoLab/erato/pull/646
[repo-pr-647]: https://github.com/EratoLab/erato/pull/647
[repo-pr-648]: https://github.com/EratoLab/erato/pull/648
[repo-pr-649]: https://github.com/EratoLab/erato/pull/649
[repo-pr-650]: https://github.com/EratoLab/erato/pull/650
[repo-pr-651]: https://github.com/EratoLab/erato/pull/651
[repo-pr-652]: https://github.com/EratoLab/erato/pull/652
[repo-pr-653]: https://github.com/EratoLab/erato/pull/653
[repo-pr-654]: https://github.com/EratoLab/erato/pull/654
[repo-pr-655]: https://github.com/EratoLab/erato/pull/655
[repo-pr-656]: https://github.com/EratoLab/erato/pull/656
[repo-pr-657]: https://github.com/EratoLab/erato/pull/657
[repo-pr-658]: https://github.com/EratoLab/erato/pull/658
[repo-pr-659]: https://github.com/EratoLab/erato/pull/659
[repo-pr-660]: https://github.com/EratoLab/erato/pull/660
[repo-pr-661]: https://github.com/EratoLab/erato/pull/661
[repo-pr-662]: https://github.com/EratoLab/erato/pull/662
[repo-pr-663]: https://github.com/EratoLab/erato/pull/663
[repo-pr-664]: https://github.com/EratoLab/erato/pull/664
[repo-pr-665]: https://github.com/EratoLab/erato/pull/665
[repo-pr-666]: https://github.com/EratoLab/erato/pull/666
[repo-pr-667]: https://github.com/EratoLab/erato/pull/667
[repo-pr-668]: https://github.com/EratoLab/erato/pull/668
[repo-pr-669]: https://github.com/EratoLab/erato/pull/669
[repo-pr-670]: https://github.com/EratoLab/erato/pull/670
[repo-pr-671]: https://github.com/EratoLab/erato/pull/671
[repo-pr-672]: https://github.com/EratoLab/erato/pull/672
[repo-pr-673]: https://github.com/EratoLab/erato/pull/673
[repo-pr-674]: https://github.com/EratoLab/erato/pull/674
[repo-pr-675]: https://github.com/EratoLab/erato/pull/675
[repo-pr-676]: https://github.com/EratoLab/erato/pull/676
[repo-pr-677]: https://github.com/EratoLab/erato/pull/677
[repo-pr-678]: https://github.com/EratoLab/erato/pull/678
[repo-pr-679]: https://github.com/EratoLab/erato/pull/679
[repo-pr-680]: https://github.com/EratoLab/erato/pull/680
[repo-pr-681]: https://github.com/EratoLab/erato/pull/681
[repo-pr-682]: https://github.com/EratoLab/erato/pull/682
[repo-pr-683]: https://github.com/EratoLab/erato/pull/683
[repo-pr-684]: https://github.com/EratoLab/erato/pull/684
[repo-pr-685]: https://github.com/EratoLab/erato/pull/685
[repo-pr-686]: https://github.com/EratoLab/erato/pull/686
[repo-pr-687]: https://github.com/EratoLab/erato/pull/687
[repo-pr-688]: https://github.com/EratoLab/erato/pull/688
[repo-pr-689]: https://github.com/EratoLab/erato/pull/689
[repo-pr-690]: https://github.com/EratoLab/erato/pull/690
[repo-pr-691]: https://github.com/EratoLab/erato/pull/691
[repo-pr-692]: https://github.com/EratoLab/erato/pull/692
[repo-pr-693]: https://github.com/EratoLab/erato/pull/693
[repo-pr-694]: https://github.com/EratoLab/erato/pull/694
[repo-pr-695]: https://github.com/EratoLab/erato/pull/695
[repo-pr-696]: https://github.com/EratoLab/erato/pull/696
[repo-pr-697]: https://github.com/EratoLab/erato/pull/697
[repo-pr-698]: https://github.com/EratoLab/erato/pull/698
[repo-pr-699]: https://github.com/EratoLab/erato/pull/699
[repo-pr-700]: https://github.com/EratoLab/erato/pull/700
[repo-pr-701]: https://github.com/EratoLab/erato/pull/701
[repo-pr-702]: https://github.com/EratoLab/erato/pull/702
[repo-pr-703]: https://github.com/EratoLab/erato/pull/703
[repo-pr-704]: https://github.com/EratoLab/erato/pull/704
[repo-pr-705]: https://github.com/EratoLab/erato/pull/705
[repo-pr-706]: https://github.com/EratoLab/erato/pull/706
[repo-pr-707]: https://github.com/EratoLab/erato/pull/707
[repo-pr-708]: https://github.com/EratoLab/erato/pull/708
[repo-pr-709]: https://github.com/EratoLab/erato/pull/709
[repo-pr-710]: https://github.com/EratoLab/erato/pull/710
[repo-pr-711]: https://github.com/EratoLab/erato/pull/711
[repo-pr-712]: https://github.com/EratoLab/erato/pull/712
[repo-pr-713]: https://github.com/EratoLab/erato/pull/713
[repo-pr-714]: https://github.com/EratoLab/erato/pull/714
[repo-pr-715]: https://github.com/EratoLab/erato/pull/715
[repo-pr-716]: https://github.com/EratoLab/erato/pull/716
[repo-pr-718]: https://github.com/EratoLab/erato/pull/718
[repo-pr-720]: https://github.com/EratoLab/erato/pull/720
[repo-pr-721]: https://github.com/EratoLab/erato/pull/721
[repo-pr-722]: https://github.com/EratoLab/erato/pull/722
[repo-pr-723]: https://github.com/EratoLab/erato/pull/723
[repo-pr-724]: https://github.com/EratoLab/erato/pull/724
[repo-pr-725]: https://github.com/EratoLab/erato/pull/725
[repo-pr-726]: https://github.com/EratoLab/erato/pull/726
[repo-pr-727]: https://github.com/EratoLab/erato/pull/727
[repo-pr-728]: https://github.com/EratoLab/erato/pull/728
[repo-pr-729]: https://github.com/EratoLab/erato/pull/729
[repo-pr-730]: https://github.com/EratoLab/erato/pull/730
[repo-pr-731]: https://github.com/EratoLab/erato/pull/731
[repo-pr-732]: https://github.com/EratoLab/erato/pull/732
[repo-pr-733]: https://github.com/EratoLab/erato/pull/733
[repo-pr-734]: https://github.com/EratoLab/erato/pull/734
[repo-pr-735]: https://github.com/EratoLab/erato/pull/735
[repo-pr-736]: https://github.com/EratoLab/erato/pull/736
[repo-pr-737]: https://github.com/EratoLab/erato/pull/737
[repo-pr-738]: https://github.com/EratoLab/erato/pull/738
[repo-pr-739]: https://github.com/EratoLab/erato/pull/739
[repo-pr-740]: https://github.com/EratoLab/erato/pull/740
[repo-pr-741]: https://github.com/EratoLab/erato/pull/741
[repo-pr-742]: https://github.com/EratoLab/erato/pull/742
[repo-pr-743]: https://github.com/EratoLab/erato/pull/743
[repo-pr-745]: https://github.com/EratoLab/erato/pull/745
[repo-pr-746]: https://github.com/EratoLab/erato/pull/746
[repo-pr-747]: https://github.com/EratoLab/erato/pull/747
[repo-pr-748]: https://github.com/EratoLab/erato/pull/748
[repo-pr-749]: https://github.com/EratoLab/erato/pull/749
[repo-pr-750]: https://github.com/EratoLab/erato/pull/750
[repo-pr-751]: https://github.com/EratoLab/erato/pull/751
[repo-pr-752]: https://github.com/EratoLab/erato/pull/752
[repo-pr-753]: https://github.com/EratoLab/erato/pull/753
[repo-pr-754]: https://github.com/EratoLab/erato/pull/754
[repo-pr-755]: https://github.com/EratoLab/erato/pull/755
[repo-pr-756]: https://github.com/EratoLab/erato/pull/756
[repo-pr-757]: https://github.com/EratoLab/erato/pull/757
[repo-pr-758]: https://github.com/EratoLab/erato/pull/758
[repo-pr-759]: https://github.com/EratoLab/erato/pull/759
[repo-pr-760]: https://github.com/EratoLab/erato/pull/760
[repo-pr-761]: https://github.com/EratoLab/erato/pull/761
[repo-pr-762]: https://github.com/EratoLab/erato/pull/762
[repo-pr-763]: https://github.com/EratoLab/erato/pull/763
[repo-pr-764]: https://github.com/EratoLab/erato/pull/764
[repo-pr-765]: https://github.com/EratoLab/erato/pull/765
[repo-pr-766]: https://github.com/EratoLab/erato/pull/766
[repo-pr-767]: https://github.com/EratoLab/erato/pull/767
[repo-pr-768]: https://github.com/EratoLab/erato/pull/768
[repo-pr-770]: https://github.com/EratoLab/erato/pull/770
[repo-pr-771]: https://github.com/EratoLab/erato/pull/771
[repo-pr-772]: https://github.com/EratoLab/erato/pull/772
[repo-pr-773]: https://github.com/EratoLab/erato/pull/773
[repo-pr-774]: https://github.com/EratoLab/erato/pull/774
[repo-pr-776]: https://github.com/EratoLab/erato/pull/776
[repo-pr-777]: https://github.com/EratoLab/erato/pull/777
[repo-pr-778]: https://github.com/EratoLab/erato/pull/778

---

## Changelog Structure

This changelog follows the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release section contains:

- **Release version and date**: The version number and release date in YYYY-MM-DD format
- **Full list of changes**: A comprehensive list of all pull requests merged for that release, with:
  - Brief description of the change
  - Link to the original pull request
    - Pull requests may be dectected from `git log` via either the pattern of `#123` (for ff-merged PRs) or `Merge Pull request` commit messages


The reference links to pull requests are listed alphabetically by number at the bottom of the file, before this structure section.
