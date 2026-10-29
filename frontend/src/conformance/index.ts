/**
 * `@erato/frontend/conformance` — host-authored contract tests a component kit
 * runs against its own overrides, and a host adapter against its client tool
 * handlers.
 */
export {
  chatHistoryListConformanceFailures,
  type ChatHistoryConformanceHarness,
  type ChatHistoryConformanceOptions,
} from "./chatHistoryList";
export {
  clientToolHostAdapterConformanceFailures,
  type ClientToolHostCall,
  type ClientToolHostConformanceHarness,
  type ClientToolHostTurn,
} from "./clientToolHostAdapter";
export {
  composerContextChipFaceConformanceFailures,
  type ComposerContextChipFaceConformanceHarness,
} from "./composerContextChipFace";
