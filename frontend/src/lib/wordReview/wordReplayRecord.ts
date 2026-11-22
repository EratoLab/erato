/** The keys of the backend's replay record of an earlier turn's call before ERMAIN-1274. */
export const WORD_REPLAY_NOTE_KEY = "omitted_from_replay";
export const WORD_REPLAY_KEPT_KEY = "kept";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A model that copies the form earlier calls replay in sends the read under `kept`. Running that
 * read gives the result it asked for, so only the wrapper is dropped (ERMAIN-1274, the ERMAIN-1194
 * rule); anything else beside the wrapper stays and is refused. The backend replays such a call
 * by the same rule (replay_policy.rs copied_receipt), and the chat history rebuild reads it so.
 */
export function wordReplayRecordRead(input: unknown): {
  call: unknown;
  replayRecord: boolean;
} {
  if (
    !object(input) ||
    !(WORD_REPLAY_NOTE_KEY in input || WORD_REPLAY_KEPT_KEY in input)
  )
    return { call: input, replayRecord: false };
  const wrapperOnly = Object.keys(input).every((key) =>
    [WORD_REPLAY_NOTE_KEY, WORD_REPLAY_KEPT_KEY, "status"].includes(key),
  );
  return {
    call: wrapperOnly && object(input.kept) ? input.kept : input,
    replayRecord: true,
  };
}
