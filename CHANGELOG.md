# Changelog

All notable changes to this project will be documented in this file.

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
