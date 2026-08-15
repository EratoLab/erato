/**
 * The Teams transcript contract, as its own entry point.
 *
 * Separate from `@erato/frontend/library` on purpose: this is data, not UI, and
 * pulling it out of the component barrel keeps it free of React and the DOM. A
 * consumer that only needs to read or write the transcript format — the add-in's
 * picker and serializer, a future sidecar — pays for none of that.
 *
 * It also keeps the format out of the way of the barrel's blast radius: several
 * add-in suites replace `@erato/frontend/library` wholesale with a stub, which
 * silently empties anything imported from it at runtime. Importing the contract
 * from here is untouched by those stubs.
 */

export {
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
  parseTeamsTranscriptIndex,
  type TeamsTranscriptIndex,
  type TeamsTranscriptIndexAsset,
  type TeamsTranscriptIndexMessage,
  type TeamsTranscriptIndexSection,
  type TeamsTranscriptIndexWindow,
} from "./teamsTranscriptIndex";

export type {
  TeamsChannelConversationRef,
  TeamsChatConversationRef,
  TeamsConversationRef,
  TeamsMessageRef,
} from "./teamsConversationRef";

export { teamsUploadDisplayName } from "./teamsUploadName";
