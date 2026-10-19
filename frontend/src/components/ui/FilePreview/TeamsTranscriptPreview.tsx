import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import { TeamsConversationView } from "@/components/ui/Teams/TeamsConversationView";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { createLogger } from "@/utils/debugLogger";
import {
  loadStoredTeamsTranscript,
  peekStoredTeamsTranscript,
} from "@/utils/teams/storedTeamsTranscript";

import { FilePreviewContent } from "./FilePreviewContent";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  StoredTeamsTranscript,
  StoredTeamsTranscriptOutcome,
} from "@/utils/teams/storedTeamsTranscript";
import type { TeamsTranscriptIndexAsset } from "@/utils/teams/teamsTranscriptIndex";

const logger = createLogger("UI", "TeamsTranscriptPreview");

interface TeamsTranscriptPreviewProps {
  filename: string;
  url: string;
  /**
   * Uploads this one can be resolved against — in practice every file the chat
   * knows about, not only the message's own. A transcript records the filenames
   * of what rode along but not the bytes, so they have to be found among them;
   * without any, the chips still name what was shared, they just cannot open.
   *
   * A wider set is harmless here: the names are content-hashed, so a match from
   * another message is the same bytes under the same name.
   */
  relatedFiles?: readonly FileUploadItem[];
}

type LoadState = { kind: "loading" } | StoredTeamsTranscriptOutcome;

/** A transcript a message card already read opens without a spinner. */
const settledState = (url: string): LoadState => {
  const settled = peekStoredTeamsTranscript(url);
  return settled && settled.kind !== "unreachable"
    ? settled
    : { kind: "loading" };
};

const MESSAGE_ANCHOR = "#msg=";

/**
 * Citations deep-link into a transcript as "…teams-chat.md#msg=7" (see the
 * erato-file:// handling in MessageContent). The fragment never reaches the
 * server — the load drops it — so it only has to be read out here.
 */
const parseMessageAnchor = (url: string): number | null => {
  const anchorAt = url.lastIndexOf(MESSAGE_ANCHOR);
  if (anchorAt === -1) return null;
  const ordinal = Number(url.slice(anchorAt + MESSAGE_ANCHOR.length));
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
};

/**
 * A stored Teams transcript, opened as the conversation it was taken from.
 *
 * Shaped after `EmlPreview`: fetch the one stored artifact and re-derive its
 * structure on demand, rather than reading anything kept beside it. What comes
 * back is the same index block the composer already renders before sending, so
 * both surfaces show the same conversation from the same source. The load is
 * shared with the message's Teams cards, so opening one does not download the
 * transcript again.
 *
 * The rendering itself is not here — `TeamsConversationView` owns it, and is
 * handed an already-parsed index. This component is only the acquisition half.
 *
 * It degrades rather than failing. A file with no readable block is still
 * markdown worth reading, so it renders as text; only a fetch that never
 * lands has nothing to show.
 */
export const TeamsTranscriptPreview: React.FC<TeamsTranscriptPreviewProps> = ({
  url,
  relatedFiles,
}) => {
  const [state, setState] = useState<LoadState>(() => settledState(url));
  const [selected, setSelected] = useState<FileUploadItem | null>(null);

  // The minted upload name is the join key the transcript recorded, and it is
  // exactly the filename the upload was stored under.
  const resolveAsset = useCallback(
    (asset: TeamsTranscriptIndexAsset) =>
      relatedFiles?.find((file) => file.filename === asset.name) ?? null,
    [relatedFiles],
  );

  useEffect(() => {
    let aborted = false;
    setState(settledState(url));

    loadStoredTeamsTranscript(url).then(
      (stored: StoredTeamsTranscript) => {
        if (!aborted) setState(stored);
      },
      (error: unknown) => {
        logger.error("failed to fetch transcript", error);
        if (!aborted) setState({ kind: "unreachable" });
      },
    );
    return () => {
      aborted = true;
    };
  }, [url]);

  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<ArrowLeftIcon className="size-4" aria-hidden="true" />}
          onClick={() => setSelected(null)}
          className="w-fit"
        >
          {t`Back to conversation`}
        </Button>
        <div className="truncate text-sm text-theme-fg-muted">
          {selected.filename}
        </div>
        <FilePreviewContent
          filename={selected.filename}
          url={selected.preview_url ?? selected.download_url}
          mimeType={selected.file_capability.mime_types[0]}
        />
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <SpinnerIcon size="lg" srText={t`Loading conversation…`} />
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
      focusOrdinal={parseMessageAnchor(url)}
      resolveAsset={resolveAsset}
      // `resolveAsset` only ever returns a member of this list, so matching on
      // identity narrows back to the upload without asserting a type.
      onFilePreview={(file) => {
        const upload = relatedFiles?.find((candidate) => candidate === file);
        if (upload) setSelected(upload);
      }}
      onOpenInTeams={(message) => {
        window.open(message.deepLink, "_blank", "noopener,noreferrer"); // eslint-disable-line lingui/no-unlocalized-strings
      }}
      className="min-w-0"
    />
  );
};
