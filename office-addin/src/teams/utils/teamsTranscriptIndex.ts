/**
 * Writing side of the transcript index block. The format itself — types and
 * parser — lives in the frontend library, where its readers are; only the
 * Teams picker ever produces one, so only the serializer lives here.
 */

import { TEAMS_TRANSCRIPT_INDEX_MARKER } from "@erato/frontend/library";

import type { TeamsTranscriptIndex } from "@erato/frontend/library";

/** The single line appended to the transcript. */
export function serializeTeamsTranscriptIndex(
  index: TeamsTranscriptIndex,
): string {
  const payload = escapeCommentEnd(JSON.stringify(index));
  return `<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v${index.version} ${payload} -->`;
}

/**
 * `-->` inside the payload would end the comment early. Escaping the first `-`
 * of every pair as a JSON escape keeps the parsed string byte-identical, so
 * message text survives the round trip untouched.
 */
function escapeCommentEnd(json: string): string {
  return json.replace(/-(?=-)/g, "\\u002d");
}
