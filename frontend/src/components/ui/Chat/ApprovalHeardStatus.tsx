import { t } from "@lingui/core/macro";

import { useApprovalListening } from "@/hooks/audio/approvalListening";
import { useApprovalSpeech } from "@/hooks/audio/approvalSpeech";

import type { ApprovalVoiceMeaning } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const understoodAs = (meaning: ApprovalVoiceMeaning): string | null => {
  switch (meaning) {
    case "skip":
      return t({ id: "chat.audio.card_understood.skip", message: "next" });
    case "rest":
      return t({ id: "chat.audio.card_understood.rest", message: "what else" });
    case "repeat":
      return t({ id: "chat.audio.card_understood.repeat", message: "again" });
    case "read_text":
      return t({
        id: "chat.audio.card_understood.read_text",
        message: "read the text",
      });
    case "stop":
      return t({ id: "chat.audio.card_understood.stop", message: "stop" });
    case "approve":
      return t({
        id: "chat.audio.card_understood.approve",
        message: "allow (on screen only)",
      });
    case "reject":
      return t({
        id: "chat.audio.card_understood.reject",
        message: "deny (on screen only)",
      });
    case "change":
      return t({
        id: "chat.audio.card_understood.change",
        message: "change the request",
      });
    case "new_request":
      return t({
        id: "chat.audio.card_understood.new_request",
        message: "a new request",
      });
    case "noise":
      return null;
    case "unclear":
      return t({
        id: "chat.audio.card_understood.unclear",
        message: "not understood",
      });
  }
};

/**
 * Shows at once that words said to a waiting card were heard, then the
 * words, then what they were understood as: the moments until the voice
 * answers are bridged on screen.
 */
export function ApprovalHeardStatus() {
  const cardKey = useApprovalSpeech((state) => state.key);
  const heard = useApprovalListening((state) =>
    state.heard?.key === cardKey ? state.heard : null,
  );
  if (!heard) return null;
  const { words } = heard;
  const meaning = heard.meaning ? understoodAs(heard.meaning) : null;
  return (
    <span
      role="status"
      className="max-w-64 truncate text-sm text-theme-fg-secondary"
      data-testid="chat-input-audio-card-heard"
      title={words ?? undefined}
    >
      {words === null
        ? t({ id: "chat.audio.card_heard", message: "Heard …" })
        : meaning
          ? t({
              id: "chat.audio.card_understood",
              message: `“${words}” · Understood: ${meaning}`,
            })
          : `“${words}”`}
    </span>
  );
}
