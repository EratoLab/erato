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

- Fix/navigation [#281][repo-pr-281]
- Cursor/implement linear issue era 100 b1cd [#288][repo-pr-288]
- Feat/cargo deny [#289][repo-pr-289]
- Refactor/seaweedfs in cluster [#290][repo-pr-290]
- Test/e2e test scenarios [#291][repo-pr-291]
- Test/split tests [#292][repo-pr-292]
- Feat/experimental assistant config [#293][repo-pr-293]
- Fix/deletion of archived with file [#294][repo-pr-294]
- Feat/assistant endpoints [#295][repo-pr-295]
- Feat/chat from assistant [#296][repo-pr-296]
- Feat/list frequest assistants [#297][repo-pr-297]
- Test/all integration tests mock llm [#298][repo-pr-298]
- Chore/rust edition 2024 [#299][repo-pr-299]
- Basic Assistant UI [#300][repo-pr-300]
- Chore/file test minio config [#301][repo-pr-301]
- Fix missing attachment feature on assistants [#302][repo-pr-302]
- Add assistant avatar support in environment and UI components [#303][repo-pr-303]
- Feat/opentelemetry [#304][repo-pr-304]
- Perf/policy engine [#305][repo-pr-305]
- Fix/misaligned translations [#306][repo-pr-306]
- Feat/lingui custom formatter [#307][repo-pr-307]
- Feat/sharepoint intergration [#308][repo-pr-308]
- Feat/oauth2 proxy redis [#309][repo-pr-309]
- Feat/continue streaming [#310][repo-pr-310]
- Add base components, storybook additions [#311][repo-pr-311]
- Feat/share grants assistants [#312][repo-pr-312]
- Fix/extract file content spawned [#313][repo-pr-313]
- Perf/dont use chats latest message view [#314][repo-pr-314]
- Feat/file pointers [#315][repo-pr-315]
- Fix/default file storage with sharepoint [#316][repo-pr-316]
- Extend to assistant [#317][repo-pr-317]
- Add optimistic update cycle [#318][repo-pr-318]
- Feat/image analysis [#319][repo-pr-319]
- Feat/tokio console [#320][repo-pr-320]
- Fix/background task cleanup [#321][repo-pr-321]
- Feat/langfuse environment [#322][repo-pr-322]
- Fix/sharing assistant with user [#323][repo-pr-323]
- Fix/sharing assistant with user [#324][repo-pr-324]
- Assistant Sharing [#325][repo-pr-325]
- Feat/image generation [#326][repo-pr-326]
- Image gen support [#327][repo-pr-327]
- Chore/update rust 1 91 1 [#328][repo-pr-328]
- Perf/reduce recent chats route [#329][repo-pr-329]
- Chore/azure ai domain [#330][repo-pr-330]
- Fix/generate image with sharepoint [#331][repo-pr-331]
- Feat/skip ocr on images [#332][repo-pr-332]
- Feat/backend feedback routes [#333][repo-pr-333]
- Add table and routes for message feedback [#334][repo-pr-334]
- Feat/forward feedback to langfuse [#335][repo-pr-335]
- Feat/deployment version cache [#336][repo-pr-336]
- Fix issue with keyboard shortcuts [#337][repo-pr-337]
- Fix excessive estimate calls [#338][repo-pr-338]
- Release/0.5.0 [#339][repo-pr-339]

## [0.4.0] - 2025-11-06

### Full list of changes

- Feat/rerun messages via edit [#241][repo-pr-241]
- Feat/helm testing [#245][repo-pr-245]
- Feat/helm extra config files [#246][repo-pr-246]
- Test/validate helm test schema [#247][repo-pr-247]
- Refactor/move sentry config [#248][repo-pr-248]
- Feat/site favicon [#249][repo-pr-249]
- Test/shared login state [#250][repo-pr-250]
- Feat/helm annotations [#251][repo-pr-251]
- Docs/mcp servers [#252][repo-pr-252]
- Feat/telepresence [#253][repo-pr-253]
- Feat/local auth keycloak [#254][repo-pr-254]
- Feat/helm chart versioning [#255][repo-pr-255]
- Feat/local auth request params [#256][repo-pr-256]
- Feat/configure multiple chatproviders [#257][repo-pr-257]
- Feat/chat message metadata [#258][repo-pr-258]
- Feat/list models endpoint [#259][repo-pr-259]
- Feat/summary model [#260][repo-pr-260]
- Feat/model capabilities [#261][repo-pr-261]
- Feat/model permissions groups [#262][repo-pr-262]
- Feat/budget config [#263][repo-pr-263]
- Feat/frontend model selector [#264][repo-pr-264]
- Fix/multi chatprovider system prompt [#265][repo-pr-265]
- Fix/me models priority order [#266][repo-pr-266]
- Fix/azure openai model usage [#267][repo-pr-267]
- Fix/bottom grap chat history item [#268][repo-pr-268]
- Chore/update rust 1.90.0 [#269][repo-pr-269]
- Feat/mcp server stremable http [#270][repo-pr-270]
- Refactor/infrastructure script python [#271][repo-pr-271]
- Docs/file storage providers [#272][repo-pr-272]
- Feat/prepare frontend toggles [#273][repo-pr-273]
- Feat/usage indicator [#274][repo-pr-274]
- Remove static limit [#275][repo-pr-275]
- Add title attribute, adjust language files [#276][repo-pr-276]
- Tests/mocked llm tests [#277][repo-pr-277]
- Feat/site german version [#279][repo-pr-279]
- Feat/add github button [#280][repo-pr-280]
- Fix missing language default on relative time information [#282][repo-pr-282]
- Website/feature sections [#283][repo-pr-283]
- Implement FeatureConfigProvider with Context API [#284][repo-pr-284]
- Website/about page [#285][repo-pr-285]
- Feat/footnote style [#286][repo-pr-286]
- Website/german version [#287][repo-pr-287]

## [0.3.1] - 2025-08-27

### Full list of changes

- Chore/cleanup dependencies [#226][repo-pr-226]
- Chore/update axum 0 8 [#228][repo-pr-228]
- Feat/tls support [#229][repo-pr-229]
- Feat/cleanup worker [#230][repo-pr-230]
- Feat/frontend config [#231][repo-pr-231]
- Feat/chat provider azure openai [#232][repo-pr-232]
- Refactor/upstream genai [#233][repo-pr-233]
- Chore/update genai alpha3 [#234][repo-pr-234]
- Fix/reasoning model basic support [#235][repo-pr-235]
- Feat/multiple chat providers [#236][repo-pr-236]
- Feat/website [#237][repo-pr-237]
- Docs/configuration [#238][repo-pr-238]
- Docs/configuration [#239][repo-pr-239]
- Feat/basic langfuse tracing support [#240][repo-pr-240]
- Feat/langfuse prompt management [#242][repo-pr-242]
- Feat/langfuse tracing metadata [#243][repo-pr-243]
- Chore/release 0.3.1 [#244][repo-pr-244]

## [0.3.0] - 2025-06-27

### Full list of changes

- Chore/release 0.3.0 [#225][repo-pr-225]

## [0.3.0-rc.2] - 2025-06-27

### Full list of changes

- Feat/github release [#224][repo-pr-224]

## [0.3.0-rc.1] - 2025-06-27

First tagged release

### Full list of changes

- Feat/ollama smol builds [#23][repo-pr-23]
- Feat/faster ci builds [#25][repo-pr-25]
- Feat/pre push hook [#26][repo-pr-26]
- Feat/pre push hook [#27][repo-pr-27]
- Feat/ci arm64 build [#28][repo-pr-28]
- Feat/local dev k3d [#30][repo-pr-30]
- Feat/frontend build [#32][repo-pr-32]
- Feat/serve frontend [#33][repo-pr-33]
- Feat/sse integration [#34][repo-pr-34]
- Feat/ci cargo fmt [#35][repo-pr-35]
- Feat/integration test db setup [#36][repo-pr-36]
- Chore/refactor tests [#37][repo-pr-37]
- Feat/ci lint prettier [#38][repo-pr-38]
- Feat/backend openapi codegen [#39][repo-pr-39]
- Feat/timestamp relative [#40][repo-pr-40]
- Feat/local oidc setup [#41][repo-pr-41]
- Feat/integrate oidc to just [#42][repo-pr-42]
- Feat/backend parse profile [#43][repo-pr-43]
- Feat/oidc entra id setup [#44][repo-pr-44]
- Feat/chat history [#45][repo-pr-45]
- Feat/normalized user profile [#46][repo-pr-46]
- Chore/rename crate [#47][repo-pr-47]
- Feat/create user [#48][repo-pr-48]
- Chore/type alignment [#49][repo-pr-49]
- Fix/api v1 beta [#50][repo-pr-50]
- Chore/db dploy cmd [#52][repo-pr-52]
- Feat/webcomponent [#54][repo-pr-54]
- Feat/lint dockerfiles [#55][repo-pr-55]
- Feat/helm oidc setup [#56][repo-pr-56]
- Feat/chart upstream [#59][repo-pr-59]
- Feat/migrations init container [#60][repo-pr-60]
- Chore/clean cargo check [#61][repo-pr-61]
- Feat/user profile middleware [#62][repo-pr-62]
- Feat/create chat on message [#63][repo-pr-63]
- Feat/submit message stream flow [#64][repo-pr-64]
- Feat/integrate llm response [#65][repo-pr-65]
- Feat/arm64 ollama smol build [#66][repo-pr-66]
- Feat/run local services [#67][repo-pr-67]
- Feat/startup migration check [#68][repo-pr-68]
- Feat/test in ci [#69][repo-pr-69]
- Feat/additional headers [#70][repo-pr-70]
- Feat/ingress annotations tls [#71][repo-pr-71]
- Feat/backend env [#72][repo-pr-72]
- Feat/check gen openapi [#73][repo-pr-73]
- Feat/webcomponent [#74][repo-pr-74]
- Feat/webcomponent [#75][repo-pr-75]
- Feat/chat list [#76][repo-pr-76]
- Feat/message lineage [#77][repo-pr-77]
- Fix/flaky test retries [#79][repo-pr-79]
- Feat/get chat messages [#80][repo-pr-80]
- Feat/regenerate message [#81][repo-pr-81]
- Feat/webcomponent [#82][repo-pr-82]
- Feat/chat summary [#83][repo-pr-83]
- Feat/webcomponent [#85][repo-pr-85]
- Feat/webcomponent [#86][repo-pr-86]
- Fix/sqlx git [#87][repo-pr-87]
- Feat/ci db summary [#88][repo-pr-88]
- Feat/use message history [#89][repo-pr-89]
- Feat/dummy multipart file upload [#90][repo-pr-90]
- Feat/webcomponent [#92][repo-pr-92]
- Feat/webcomponent [#93][repo-pr-93]
- Feat/webcomponent [#94][repo-pr-94]
- Feat/webcomponent [#95][repo-pr-95]
- Feat/webcomponent [#96][repo-pr-96]
- Feat/webcomponent [#97][repo-pr-97]
- Feat/helm image pull secrets [#98][repo-pr-98]
- Feat/helm dev releases [#100][repo-pr-100]
- Feat/helm standard labels [#101][repo-pr-101]
- Feat/sentry backend [#102][repo-pr-102]
- Feat/tracing error [#103][repo-pr-103]
- Feat/sentry debug [#104][repo-pr-104]
- Feat/common chart dep [#105][repo-pr-105]
- Feat/object storage [#106][repo-pr-106]
- Feat/environment envvar [#108][repo-pr-108]
- Feat/feate flags lint [#109][repo-pr-109]
- Feat/proper file storage [#110][repo-pr-110]
- Feat/files tables [#111][repo-pr-111]
- Fix/fix test with filestorage [#112][repo-pr-112]
- Chore/bump docker build push action [#113][repo-pr-113]
- Chore/use registry build cache [#114][repo-pr-114]
- Feat/generate with file [#115][repo-pr-115]
- Feat/helm erato toml [#116][repo-pr-116]
- Fix/tesseract dep [#117][repo-pr-117]
- Feat/regenerate with replacement [#118][repo-pr-118]
- Feat/standalone chat create [#119][repo-pr-119]
- Feat/return used files [#120][repo-pr-120]
- Refactor/chat messaging temporary refetch [#121][repo-pr-121]
- Feat/custom theme [#122][repo-pr-122]
- Feat/serve frontend routes [#123][repo-pr-123]
- Fix/fix azblob presign [#124][repo-pr-124]
- Feat/e2e tests [#125][repo-pr-125]
- Feat/e2e tests [#126][repo-pr-126]
- Feat/#127 more theme modes [#127][repo-pr-127]
- Feat/archive chats [#129][repo-pr-129]
- Feat/estimate token usage [#130][repo-pr-130]
- Feat/injectable theme env [#131][repo-pr-131]
- Fix/archive route openapi [#135][repo-pr-135]
- Feat/archive [#138][repo-pr-138]
- Feat/context size warning [#141][repo-pr-141]
- Fix/145 unicode escape sequence [#146][repo-pr-146]
- Feat/support system message [#147][repo-pr-147]
- Feat/#127 more theme modes [#148][repo-pr-148]
- Chore/upgrade sqlx 0 8 5 [#149][repo-pr-149]
- Fix/reload on new chat [#150][repo-pr-150]
- Feat/early create message [#151][repo-pr-151]
- Feat/133 addittional env [#152][repo-pr-152]
- Feat/theme markdown rendering [#153][repo-pr-153]
- Fix/fix logo path [#154][repo-pr-154]
- Fix/156 generate summary for precreated chat [#157][repo-pr-157]
- Feat/mcp server tool calling [#159][repo-pr-159]
- Feat/styling improvements [#161][repo-pr-161]
- Feat/direct sse support [#162][repo-pr-162]
- Feat/tool calling frontend animation [#163][repo-pr-163]
- Fix/first message upload bug [#165][repo-pr-165]
- Refactor/nextjs to vite [#167][repo-pr-167]
- Fix/down migration0008 [#168][repo-pr-168]
- Fix/dont submit empty tool list [#171][repo-pr-171]
- Fix/assistant avatar [#172][repo-pr-172]
- Fix/storybook addon missing [#173][repo-pr-173]
- Fix/logout redirect [#174][repo-pr-174]
- Chore/revert local dev proxy setup [#175][repo-pr-175]
- Feat/prepare e2e tests for nightly [#176][repo-pr-176]
- Chore/clean up readme [#177][repo-pr-177]
- Feat/k3d build local [#178][repo-pr-178]
- Chore/update ollama smol [#179][repo-pr-179]
- Feat/vite i18n [#181][repo-pr-181]
- Fix/build i18n [#182][repo-pr-182]
- Feat/vite i18n [#183][repo-pr-183]
- Fix/archive function [#184][repo-pr-184]
- Feat/autofocus input [#185][repo-pr-185]
- Fix/partial locale match [#186][repo-pr-186]
- Feat/gh actions e2e tests [#188][repo-pr-188]
- Feat/e2e tests file upload [#189][repo-pr-189]
- Feat/chat tests [#190][repo-pr-190]
- Test/basic submit [#191][repo-pr-191]
- Feat/query permissions [#194][repo-pr-194]
- Feat/license [#195][repo-pr-195]
- Feat/simpler history item [#196][repo-pr-196]
- Feat/auto config files [#200][repo-pr-200]
- Feat/switch icon library [#201][repo-pr-201]
- Feat/add es pl language [#202][repo-pr-202]
- Fix/optimistic update null chat [#203][repo-pr-203]
- Feat/fix scrolling interrupt [#204][repo-pr-204]
- Feat/dont checkin lingui ts [#208][repo-pr-208]
- Feat/generate big test files [#209][repo-pr-209]
- Feat/add search [#210][repo-pr-210]
- Feat/backend max file size config [#211][repo-pr-211]
- Feat/chat title [#213][repo-pr-213]
- Test/test frontend ci [#214][repo-pr-214]
- Fix/test timeout upload [#215][repo-pr-215]
- Feat/load theme translations [#216][repo-pr-216]
- Feat/backend ci test speedup [#218][repo-pr-218]
- Chore/rust 1.87.0 [#219][repo-pr-219]
- Feat/welcome screen lang files [#220][repo-pr-220]
- Chore/ignore theme translations gen [#221][repo-pr-221]
- Fix/message content loss [#222][repo-pr-222]
- Feat/release scripts [#223][repo-pr-223]


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
