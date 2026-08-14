import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { TeamsConversationView } from "@/components/ui/Teams/TeamsConversationView";
import { LoadingIcon } from "@/components/ui/icons";
import { createLogger } from "@/utils/debugLogger";
import { parseTeamsTranscriptIndex } from "@/utils/teams/teamsTranscriptIndex";

import type { TeamsTranscriptIndex } from "@/utils/teams/teamsTranscriptIndex";

const logger = createLogger("UI", "TeamsTranscriptPreview");

interface TeamsTranscriptPreviewProps {
  filename: string;
  url: string;
}

/**
 * A stored Teams transcript, opened as the conversation it was taken from.
 *
 * Shaped after `EmlPreview`: fetch the one stored artifact and re-derive its
 * structure on demand, rather than reading anything kept beside it. What comes
 * back is the same index block the composer already renders before sending, so
 * both surfaces show the same conversation from the same source.
 *
 * The rendering itself is not here — `TeamsConversationView` owns it, and is
 * handed an already-parsed index. This component is only the acquisition half.
 *
 * It degrades rather than failing. A file with no readable block is still
 * markdown worth reading, so it renders as text; only a fetch that never
 * lands has nothing to show.
 */
type LoadState =
  | { kind: "loading" }
  | { kind: "unreachable" }
  | { kind: "conversation"; index: TeamsTranscriptIndex }
  /** Readable, but carrying no block this build understands. */
  | { kind: "markdown"; text: string };

export const TeamsTranscriptPreview: React.FC<TeamsTranscriptPreviewProps> = ({
  url,
}) => {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let aborted = false;
    setState({ kind: "loading" });

    const load = async () => {
      let text: string;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
      } catch (error) {
        logger.error("failed to fetch transcript", error);
        if (!aborted) setState({ kind: "unreachable" });
        return;
      }
      if (aborted) return;
      const index = parseTeamsTranscriptIndex(text);
      setState(
        index ? { kind: "conversation", index } : { kind: "markdown", text },
      );
    };

    void load();
    return () => {
      aborted = true;
    };
  }, [url]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <LoadingIcon className="size-6 animate-spin text-theme-fg-muted" />
        <span className="sr-only">{t`Loading conversation…`}</span>
      </div>
    );
  }

  if (state.kind === "unreachable") {
    return (
      <Alert type="error">{t`This conversation could not be loaded.`}</Alert>
    );
  }

  if (state.kind === "markdown") {
    return (
      <div className="flex flex-col gap-2">
        <Alert type="info">
          {t`This file carries no conversation data, so it is shown as text.`}
        </Alert>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-theme-fg-primary">
          {state.text}
        </pre>
      </div>
    );
  }

  return (
    <TeamsConversationView
      index={state.index}
      // Nothing here holds the uploads a message carried — the modal is showing
      // one stored file, not the set it arrived with — so the chips name what
      // rode along without offering to open it.
      onOpenInTeams={(message) => {
        window.open(message.deepLink, "_blank", "noopener,noreferrer"); // eslint-disable-line lingui/no-unlocalized-strings
      }}
      className="min-w-0"
    />
  );
};
