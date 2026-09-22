# Deploying the richer structured Word contract

The model submits the structured plan as the arguments of `word/submit_document_plan`. The add-in validates and compiles that typed plan before presenting its existing review card. Legacy `erato-word-document-plan` messages remain readable. The model does not generate or receive raw document XML. See [validated plan submissions](validated-plan-submissions.md) for configuration, corrections and review behavior.

The supported vocabulary is shipped with the add-in in [wordAuthoringContract.ts](../../src/word/utils/wordAuthoringContract.ts). The first `read_document_blocks` response includes this `contract` and the current `supportedBlocks`, `fullDocument`, styles, limits and attached image asset metadata. These describe the capabilities of the client handling this particular proposal.

## Version and configuration pairing

The JSON plan envelope remains `version: 1`. That number is not a promise that every older v1 client supports tables, stories or other new blocks. Capability checks must use the actual read response. A deployment of the new authoring instructions must include the matching add-in build.

The private deployment package supplies the Word facets and read-tool definition:

| Configuration section                          | Property                    | Purpose                                   |
| ---------------------------------------------- | --------------------------- | ----------------------------------------- |
| `action_facets.facets.word_document_authoring` | `template`                  | Deployment-owned behavioral instructions. |
| `client_tools.tools.word_read_document_blocks` | `description`, `parameters` | Deployment-owned tool definition.         |

The facet still advertises `word.apply_edits` and `word.apply_document_plan`. Its tool allowlist includes `word/read_document_blocks`, with `snapshot` and optional `cursor` parameters, and the validated `word/submit_document_plan` submission. Both execute on the client without changing the document; applying remains a separate confirmed action.

The private deployment source is `erato-subscription-content/configuration-packages/erato-action-facets.toml`. The local checkout uses the corresponding sections in ignored `backend/erato.toml`. Only the Word properties need synchronizing; unrelated environment and authentication settings are outside this package.

## Configuration boundary

Behavioral instructions, action-selection guidance and model-facing instructional examples belong in the private configuration repository. This public source tree contains wire shapes, supported properties, units, reference constraints, validation, execution and UI. The read-tool contract describes those capabilities; it does not supply a fallback behavioral prompt.

Public fixtures may exercise the protocol with synthetic data, but must not copy subscription templates. Local configuration and its backups remain ignored. Archived reproduction material follows the same boundary.

The 2026-09-21 archive cleanup applies to the current tree. Earlier local commits, including `91ba3c96`, retain the original experimental archive. Before publishing that history to the public remote, remove the archived instructions from those commits or publish a clean squashed history. This cleanup does not rewrite Git history or push the public branch.

Deployment guidance and prompt revision history live in the private repository's `docs/word-structured-authoring.md`. Deploy the configuration with its matching client capabilities; the envelope version alone does not identify that pairing.

## Local retest and rollout

### Context-estimate failures

The selected provider's `model_capabilities.context_size_tokens` supplies the context limit. A short document can still fail if the estimate request itself fails; increasing that limit does not repair the request. In particular, Responses reasoning replay must use the message repository supplied by the token estimator, which contains its unsaved draft. Looking up that draft directly in the database returns an error before token counting.

The add-in distinguishes a successful estimate that exceeds the limit (`model-budget`) from an unavailable estimate (`budget-unavailable`). The latter includes only fixed diagnostic codes such as `estimate-http-500`, `estimate-timeout` or `estimate-invalid`; backend response bodies are not forwarded to the model. The UI offers a retry for failed estimates. Both cases leave restructuring unavailable for that capture, and a new send performs a fresh check.

After updating the backend code, rebuild and restart the backend, reload the pane and send a new request. An existing chat can be reused. Rebuilding only the frontend does not update the running token-estimation endpoint.

### Retest steps

1. Build the matching add-in and frontend library when either changed. Continue using the existing checkout; no alternate worktree is needed. `just dev-linked` in `office-addin` supplies the linked development server.
2. Restart the backend process or deployment that loads the changed TOML configuration. Rebuilding the frontend or reloading the Word pane does not by itself replace a backend process's loaded facet instructions.
3. Reload the Word pane and send a new request with the document included. Earlier messages retain their original captured source and cannot acquire the new read token or capabilities retroactively.
4. Inspect the first structured read in the new turn. Expect `contract.version: 1`, the rich block types in `supportedBlocks`, table/media/structure/story/section schemas, and `fullDocument: true` for edits outside the body. A complete read includes a `readToken`.
5. Exercise a structural formatting request, table changes, attached image insertion, header/footer changes and full clear on a disposable mixed-content document. Review the plan before applying, then verify Word content and the add-in's Revert against the original. A successful parser/compiler check is not sufficient evidence for a native Word import on every host.

Useful mechanical regressions are [wordFullDocumentStructured.test.ts](../../src/word/utils/__tests__/wordFullDocumentStructured.test.ts), [wordMediaPlanIntegration.test.ts](../../src/word/utils/__tests__/wordMediaPlanIntegration.test.ts) and [wordRichDocumentPlanValidation.test.ts](../../src/word/utils/__tests__/wordRichDocumentPlanValidation.test.ts). See [implementation status](implementation-status.md) for the actual native host evidence and remaining acceptance checks. Earlier OOXML-experiment evidence does not certify this structured implementation.
