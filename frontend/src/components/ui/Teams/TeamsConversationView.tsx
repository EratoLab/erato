import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback } from "react";

import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";

import { InteractiveContainer } from "../Container/InteractiveContainer";
import { FilePreviewBase } from "../FileUpload/FilePreviewBase";
import { MessageTimestamp } from "../Message/MessageTimestamp";
import { OpenNewWindowIcon } from "../icons";

import type {
  FileResource,
  LocalFilePreviewItem,
} from "../FileUpload/FilePreviewBase";
import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexAsset,
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
} from "@/utils/teams/teamsTranscriptIndex";
import type React from "react";

/**
 * Renders an attached Teams transcript as the conversation it was taken from.
 *
 * Pure on purpose: it is handed an already-parsed index and never fetches. The
 * composer parses the `File` it is already holding, the post-send preview
 * fetches the stored file first — one renderer, and each caller keeps its own
 * acquisition. Fetching from inside, as the email preview does, would tie the
 * component to a single surface.
 *
 * The projection is deliberately not the prose the model reads. The transcript
 * gives every message its own header so a citation can name it; a reader wants
 * the opposite, so consecutive messages from one speaker collapse under a
 * single name and the timestamps shrink to a local time under a day divider.
 */
export interface TeamsConversationViewProps {
  index: TeamsTranscriptIndex;
  /** Render one conversation; omit for every section in the index. */
  sectionIndex?: number;
  /**
   * Set false where the host already names the conversation — a modal titled
   * with it, say. The window and participants still render; only the heading
   * goes, so the name is not painted twice.
   */
  showTitle?: boolean;
  /** Omit to render the per-message Teams link inert. */
  onOpenInTeams?: (message: TeamsTranscriptIndexMessage) => void;
  onFilePreview?: (file: FileResource) => void;
  /**
   * The upload behind an asset, when the caller holds it. Null just means the
   * chip is not clickable — a message still says what rode along with it.
   */
  resolveAsset?: (asset: TeamsTranscriptIndexAsset) => FileResource | null;
  /**
   * Ordinal of a cited message: scrolled into view on mount and kept
   * highlighted, so a citation lands on the message it names.
   */
  focusOrdinal?: number | null;
  className?: string;
}

/** Threaded down to every level that can act on a message or its uploads. */
interface ConversationCallbacks {
  onOpenInTeams?: (message: TeamsTranscriptIndexMessage) => void;
  onFilePreview?: (file: FileResource) => void;
  resolveAsset?: (asset: TeamsTranscriptIndexAsset) => FileResource | null;
}

/** Consecutive messages from one speaker, within one day. */
interface SpeakerRun {
  key: string;
  sender: string;
  isViewer: boolean;
  messages: TeamsTranscriptIndexMessage[];
}

interface DayGroup {
  key: string;
  label: string;
  runs: SpeakerRun[];
}

export const DefaultTeamsConversationView: React.FC<
  TeamsConversationViewProps
> = ({
  index,
  sectionIndex,
  showTitle = true,
  onOpenInTeams,
  onFilePreview,
  resolveAsset,
  focusOrdinal,
  className,
}) => {
  const positions =
    sectionIndex === undefined
      ? index.sections.map((_, position) => position)
      : [sectionIndex];

  return (
    <div className={clsx("flex flex-col gap-4", className)}>
      {positions.map((position) => {
        const section = index.sections.at(position);
        if (!section) return null;
        return (
          <ConversationSection
            key={position}
            section={section}
            showTitle={showTitle}
            messages={index.messages.filter(
              (message) => message.section === position,
            )}
            onOpenInTeams={onOpenInTeams}
            onFilePreview={onFilePreview}
            resolveAsset={resolveAsset}
            focusOrdinal={focusOrdinal ?? null}
          />
        );
      })}
    </div>
  );
};

const ConversationSection: React.FC<
  ConversationCallbacks & {
    section: TeamsTranscriptIndexSection;
    messages: TeamsTranscriptIndexMessage[];
    showTitle: boolean;
    focusOrdinal: number | null;
  }
> = ({
  section,
  messages,
  showTitle,
  onOpenInTeams,
  onFilePreview,
  resolveAsset,
  focusOrdinal,
}) => {
  const title = section.teamName
    ? `${section.title} · ${section.teamName}`
    : section.title;
  const window = dateRange(section.window.from, section.window.to);
  const participants = section.participants.join(", ");
  const skipped = section.skippedCount;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-col gap-0.5 border-b border-theme-border pb-2">
        {showTitle && (
          <h2
            className="truncate text-sm font-semibold text-theme-fg-primary"
            title={title}
          >
            {title}
          </h2>
        )}
        {window && <p className="text-xs text-theme-fg-muted">{window}</p>}
        {participants && (
          <p className="text-xs text-theme-fg-muted" title={participants}>
            {participants}
          </p>
        )}
        {section.truncated && (
          <p className="text-xs text-theme-fg-muted">
            {t`Older messages are not included.`}
          </p>
        )}
        {skipped > 0 && (
          <p className="text-xs text-theme-fg-muted">
            {skipped === 1
              ? t`1 message could not be loaded.`
              : t`${skipped} messages could not be loaded.`}
          </p>
        )}
      </header>

      {messages.length === 0 ? (
        <p className="text-xs text-theme-fg-muted">{t`No messages.`}</p>
      ) : (
        groupByDay(messages, section.viewer).map((day) => (
          <div key={day.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 pt-1">
              <span
                className="h-px flex-1 bg-theme-border"
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-theme-fg-muted">
                {day.label}
              </span>
              <span
                className="h-px flex-1 bg-theme-border"
                aria-hidden="true"
              />
            </div>
            {day.runs.map((run) => (
              <div key={run.key} className="flex flex-col gap-1">
                <p
                  className={clsx(
                    "text-xs font-semibold",
                    run.isViewer
                      ? "text-theme-fg-accent"
                      : "text-theme-fg-primary",
                  )}
                >
                  {run.sender}
                </p>
                {run.messages.map((message) => (
                  <MessageBlock
                    key={message.ordinal}
                    message={message}
                    isViewer={run.isViewer}
                    isFocused={message.ordinal === focusOrdinal}
                    onOpenInTeams={onOpenInTeams}
                    onFilePreview={onFilePreview}
                    resolveAsset={resolveAsset}
                  />
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
};

const MessageBlock: React.FC<
  ConversationCallbacks & {
    message: TeamsTranscriptIndexMessage;
    isViewer: boolean;
    isFocused: boolean;
  }
> = ({
  message,
  isViewer,
  isFocused,
  onOpenInTeams,
  onFilePreview,
  resolveAsset,
}) => {
  const body = bodyWithoutAssetMarkers(message);
  const createdAt = toDate(message.createdAt);
  // A callback ref rather than an effect: it fires exactly once, when the
  // cited message's node exists, which is the only moment the jump can happen.
  const revealOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div
      ref={isFocused ? revealOnMount : undefined}
      data-ordinal={message.ordinal}
      className={clsx(
        "rounded-[var(--theme-radius-message)] border px-2 py-1.5",
        isViewer
          ? "border-theme-border-strong bg-theme-bg-accent"
          : "border-theme-border bg-theme-bg-secondary",
        isFocused && "ring-2 ring-theme-focus",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {message.subject && (
            <p className="truncate text-xs font-medium text-theme-fg-primary">
              {message.subject}
            </p>
          )}
          {body && (
            <p className="whitespace-pre-wrap break-words text-sm text-theme-fg-primary">
              {body}
            </p>
          )}
          {!body && !message.subject && (
            <p className="text-sm italic text-theme-fg-muted">{t`No text.`}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {createdAt && (
            <MessageTimestamp
              createdAt={createdAt}
              displayStyle="time"
              className="shrink-0 text-xs tabular-nums text-theme-fg-muted"
            />
          )}
          {onOpenInTeams && message.deepLink && (
            <button
              type="button"
              onClick={() => onOpenInTeams(message)}
              className="focus-ring-tight inline-flex size-5 items-center justify-center rounded-[var(--theme-radius-base)] text-theme-fg-muted hover:text-theme-fg-primary"
              aria-label={t`Open in Teams`}
              title={t`Open in Teams`}
            >
              <OpenNewWindowIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {message.editedAt && (
        <p className="mt-0.5 text-xs italic text-theme-fg-muted">{t`Edited`}</p>
      )}
      {message.assets.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {/* Position, not name: hash dedupe lets one message name the same
              upload twice — a quoted reply carrying the original image. */}
          {message.assets.map((asset, position) => (
            <AssetRow
              key={`${asset.name}:${position}`}
              asset={asset}
              onFilePreview={onFilePreview}
              resolveAsset={resolveAsset}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The chip is named from the index, never from the upload: the minted filename
 * is a join key carrying a content hash, and no reader should have to see it.
 */
const AssetRow: React.FC<
  Pick<ConversationCallbacks, "onFilePreview" | "resolveAsset"> & {
    asset: TeamsTranscriptIndexAsset;
  }
> = ({ asset, onFilePreview, resolveAsset }) => {
  // Never fall through to `asset.name`: an empty displayName is falsy, so
  // `getFileName` would reach for the filename and print the content hash the
  // whole index exists to keep out of sight.
  const label =
    asset.displayName ?? (asset.kind === "image" ? t`Image` : t`Attachment`);
  const shown: LocalFilePreviewItem = {
    id: asset.name,
    filename: asset.name,
    displayName: label,
  };
  const resolved = resolveAsset?.(asset) ?? null;
  const preview =
    onFilePreview && resolved ? () => onFilePreview(resolved) : null;
  const chip = (
    <FilePreviewBase
      file={shown}
      onRemove={() => {}}
      showRemoveButton={false}
      showSize={false}
      showFileType={false}
      filenameClassName="max-w-full"
      chromeless
    />
  );

  if (!preview) {
    return <div className="min-w-0">{chip}</div>;
  }

  return (
    <InteractiveContainer
      onClick={preview}
      fullWidth={false}
      className="min-w-0 rounded-[var(--theme-radius-base)] text-left hover:bg-theme-bg-accent"
      aria-label={`${t`Preview attachment`} ${label}`}
    >
      {chip}
    </InteractiveContainer>
  );
};

/**
 * Drops the `[image: …]` / `[attachment: …]` markers the transcript carries for
 * the model's benefit — the files they name render as their own rows, so left
 * in the text they would show the reader a content hash twice over.
 *
 * A marker for a file that was never uploaded stays: it is the only record that
 * something was shared, and it still reads as the name Teams gave it.
 */
function bodyWithoutAssetMarkers(message: TeamsTranscriptIndexMessage): string {
  let text = message.text;
  for (const asset of message.assets) {
    const marker = asset.kind === "image" ? "image" : "attachment";
    text = text.split(`[${marker}: ${asset.name}]`).join("");
  }
  // A marker lifted out of mid-sentence leaves the spaces that surrounded it
  // on either side, and the body renders `whitespace-pre-wrap`.
  return text
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function groupByDay(
  messages: readonly TeamsTranscriptIndexMessage[],
  viewer: string | null,
): DayGroup[] {
  const days: DayGroup[] = [];
  for (const message of messages) {
    const label = dayLabel(message.createdAt);
    const previous = days.at(-1);
    const day: DayGroup =
      previous?.label === label
        ? previous
        : { key: `${label}:${message.ordinal}`, label, runs: [] };
    if (day !== previous) days.push(day);

    const run = day.runs.at(-1);
    const continuesRun = run?.sender === message.sender;
    if (run !== undefined && continuesRun) {
      run.messages.push(message);
      continue;
    }
    day.runs.push({
      key: `${message.ordinal}`,
      sender: message.sender,
      isViewer: viewer !== null && message.sender === viewer,
      messages: [message],
    });
  }
  return days;
}

/** Local, not the transcript's zone: the prose is for the model, this is not. */
function dayLabel(iso: string | null): string {
  const date = toDate(iso);
  if (!date) return t`Unknown date`;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dateRange(from: string | null, to: string | null): string {
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) return "";
  const startLabel = dayLabel(from);
  const endLabel = dayLabel(to);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const TeamsConversationView: React.FC<TeamsConversationViewProps> = (
  props,
) => {
  const Rendered = resolveComponentOverride(
    componentRegistry.TeamsConversationView,
    DefaultTeamsConversationView,
  );
  return <Rendered {...props} />;
};
