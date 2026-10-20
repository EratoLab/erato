import { plural, t } from "@lingui/core/macro";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { announceRemoved } from "@/components/ui/Chat/ComposerContext/composerContextStrings";
import { Button } from "@/components/ui/Controls/Button";
import { AttachmentTile } from "@/components/ui/FileUpload/AttachmentTile";
import { isFileUploadItem } from "@/components/ui/FileUpload/FilePreviewBase";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "@/components/ui/icons";
import {
  teamsAssetDisplayName,
  teamsTranscriptName,
  teamsTranscriptSections,
} from "@/utils/teams/teamsTranscriptContext";
import { teamsUploadDisplayName } from "@/utils/teams/teamsUploadName";

import { TeamsConversationView } from "./TeamsConversationView";

import type { FileResource } from "@/components/ui/FileUpload/FilePreviewBase";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { TeamsTranscriptSectionFile } from "@/utils/teams/teamsTranscriptContext";
import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexAsset,
  TeamsTranscriptIndexMessage,
} from "@/utils/teams/teamsTranscriptIndex";

/** A staged upload under the name a reader should see. */
export type TeamsTranscriptNamedUpload = FileUploadItem & {
  displayName: string;
};

export interface TeamsTranscriptDetailProps {
  /** Null for a transcript whose index block can't be read. */
  index: TeamsTranscriptIndex | null;
  /** The staged uploads the transcript brought, its own file excluded. */
  assets: readonly FileUploadItem[];
  /** Disables every control that changes what is sent. */
  locked: boolean;
  onRemoveFile: (fileId: string) => void;
  /** Receives the staged upload, named as the row shows it. */
  onFilePreview?: (file: TeamsTranscriptNamedUpload) => void;
}

interface PendingFocus {
  removed: string;
  candidates: string[];
  section: number;
}

const openInTeams = (message: TeamsTranscriptIndexMessage) => {
  window.open(message.deepLink, "_blank", "noopener,noreferrer"); // eslint-disable-line lingui/no-unlocalized-strings
};

const named = (
  upload: FileUploadItem,
  displayName: string,
): TeamsTranscriptNamedUpload => ({ ...upload, displayName });

/**
 * A Teams transcript's chip detail: what each conversation contributes, the
 * picked messages, and the shared files it brought, each with a preview and
 * a remove that never hides behind hover. "Open conversation" swaps the view
 * in place for that conversation's messages.
 */
export function TeamsTranscriptDetail({
  index,
  assets,
  locked,
  onRemoveFile,
  onFilePreview,
}: TeamsTranscriptDetailProps) {
  const [openSection, setOpenSection] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const returnToSectionRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  const idPrefix = useId();

  const sections = useMemo(
    () => (index ? teamsTranscriptSections(index, assets) : []),
    [index, assets],
  );
  const conversation =
    openSection === null ? undefined : sections.at(openSection);

  const query = useCallback(
    (selector: string) =>
      rootRef.current?.querySelector<HTMLElement>(selector) ?? null,
    [],
  );

  // Keyed on the switch alone, so a re-render inside the conversation never
  // pulls focus back to the back button.
  useLayoutEffect(() => {
    if (openSection !== null) {
      query('[data-ui="teams-transcript-back"]')?.focus();
      return;
    }
    const section = returnToSectionRef.current;
    if (section !== null) {
      returnToSectionRef.current = null;
      query(
        `[data-ui="teams-transcript-open-conversation"][data-section="${section}"]`,
      )?.focus();
    }
  }, [openSection, query]);

  // Focus moves once the removed row is gone: to the next row's remove, the
  // previous one, or the section's way into its conversation.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || assets.some((upload) => upload.id === pending.removed)) {
      return;
    }
    pendingFocusRef.current = null;
    const removes = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>(
        '[data-ui="attachment-remove"]',
      ) ?? []),
    ];
    for (const candidate of pending.candidates) {
      const target = removes.find(
        (button) => button.dataset.fileId === candidate,
      );
      if (target) {
        target.focus();
        return;
      }
    }
    query(
      `[data-ui="teams-transcript-open-conversation"][data-section="${pending.section}"]`,
    )?.focus();
  }, [assets, query]);

  const removeFile = useCallback(
    (
      files: readonly TeamsTranscriptSectionFile[],
      position: number,
      section: number,
      label: string,
    ) => {
      const removed = files[position].upload.id;
      pendingFocusRef.current = {
        removed,
        candidates: [
          ...files.slice(position + 1, position + 2),
          ...files.slice(Math.max(0, position - 1), position),
        ].map((file) => file.upload.id),
        section,
      };
      setAnnouncement(announceRemoved(label));
      onRemoveFile(removed);
    },
    [onRemoveFile],
  );

  const resolveAsset = useCallback(
    (asset: TeamsTranscriptIndexAsset): FileResource | null => {
      const upload = assets.find((file) => file.filename === asset.name);
      return upload ? named(upload, teamsAssetDisplayName(asset)) : null;
    },
    [assets],
  );
  const previewResolved = useMemo(
    () =>
      onFilePreview
        ? (file: FileResource) => {
            if (isFileUploadItem(file) && "displayName" in file) {
              onFilePreview(file as TeamsTranscriptNamedUpload);
            }
          }
        : undefined,
    [onFilePreview],
  );

  const fileRows = (
    files: readonly TeamsTranscriptSectionFile[],
    section: number,
    label: string,
  ) => (
    <ul
      data-ui="teams-transcript-files"
      aria-label={label}
      className="flex flex-col gap-1.5"
    >
      {files.map((file, position) => {
        const shown = named(file.upload, file.displayName);
        return (
          <li key={file.upload.id} className="flex items-center gap-1">
            <AttachmentTile
              file={shown}
              variant="row"
              isImage={file.isImage}
              className="min-w-0 flex-1"
              onActivate={
                onFilePreview ? () => onFilePreview(shown) : undefined
              }
            />
            <Button
              variant="icon-only"
              size="sm"
              data-ui="attachment-remove"
              data-file-id={file.upload.id}
              disabled={locked}
              aria-label={`${t({ id: "common.remove", message: "Remove" })} ${file.displayName}`}
              icon={<CloseIcon className="size-4" />}
              onClick={() =>
                removeFile(files, position, section, file.displayName)
              }
            />
          </li>
        );
      })}
    </ul>
  );

  const live = (
    <div
      data-ui="teams-transcript-detail-live"
      aria-live="polite"
      className="sr-only"
    >
      {announcement}
    </div>
  );

  if (!index) {
    const files = assets.map(
      (upload): TeamsTranscriptSectionFile => ({
        upload,
        displayName: teamsUploadDisplayName(upload.filename) ?? upload.filename,
        isImage: upload.filename.startsWith("teams-img-"),
      }),
    );
    const name = teamsTranscriptName();
    return (
      <div
        ref={rootRef}
        data-ui="teams-transcript-detail"
        data-view="unreadable"
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "teams.context.detail.unreadable",
            message:
              "This transcript is still sent, but its conversations can't be shown here.",
          })}
        </p>
        {files.length > 0 ? fileRows(files, -1, filesLabel(name)) : null}
        {live}
      </div>
    );
  }

  if (conversation) {
    return (
      <div
        ref={rootRef}
        data-ui="teams-transcript-detail"
        data-view="conversation"
        className="flex flex-col gap-3"
      >
        <Button
          variant="link"
          data-ui="teams-transcript-back"
          className="self-start"
          icon={<ChevronLeftIcon className="size-4" />}
          onClick={() => {
            returnToSectionRef.current = conversation.position;
            setOpenSection(null);
          }}
        >
          {t({
            id: "teams.context.detail.allConversations",
            message: "All conversations",
          })}
        </Button>
        <TeamsConversationView
          index={index}
          sectionIndex={conversation.position}
          onOpenInTeams={openInTeams}
          onFilePreview={previewResolved}
          resolveAsset={resolveAsset}
        />
        {live}
      </div>
    );
  }

  const count = sections.length;
  return (
    <div
      ref={rootRef}
      data-ui="teams-transcript-detail"
      data-view="sections"
      className="flex flex-col gap-4"
    >
      {count >= 2 ? (
        <p className="text-xs text-theme-fg-secondary">
          {t({
            id: "teams.context.detail.oneFile",
            message: plural(count, {
              one: "One file covers this conversation",
              other: "One file covers all # conversations",
            }),
          })}
        </p>
      ) : null}
      {sections.map((section) => {
        const headingId = `${idPrefix}-${section.position}`;
        const title = section.title;
        return (
          <section
            key={section.key}
            data-ui="teams-transcript-section"
            data-selection={section.selection}
            data-kind={section.kind}
            aria-labelledby={headingId}
            className="flex flex-col gap-2"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3
                  id={headingId}
                  className="break-words text-sm font-semibold text-theme-fg-primary"
                >
                  {title}
                </h3>
                {section.meta ? (
                  <p className="text-xs text-theme-fg-secondary">
                    {section.meta}
                  </p>
                ) : null}
              </div>
              <Button
                variant="link"
                data-ui="teams-transcript-open-conversation"
                data-section={section.position}
                className="shrink-0 text-xs"
                aria-label={t({
                  id: "teams.context.detail.openConversationNamed",
                  message: `Open conversation: ${title}`,
                })}
                onClick={() => setOpenSection(section.position)}
              >
                {t({
                  id: "teams.context.detail.openConversation",
                  message: "Open conversation",
                })}
                <ChevronRightIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs text-theme-fg-secondary">
              {section.selectionLine}
            </p>
            {section.picked.length > 0 ? (
              <ul
                data-ui="teams-transcript-picked"
                className="flex flex-col gap-1.5"
              >
                {section.picked.map((message) => (
                  <li
                    key={message.key}
                    className="border-l-2 border-theme-border pl-2 text-xs"
                  >
                    <p className="flex flex-wrap gap-x-2">
                      <span className="font-semibold text-theme-fg-primary">
                        {message.sender}
                      </span>
                      {message.when ? (
                        <span className="text-theme-fg-secondary">
                          {message.when}
                        </span>
                      ) : null}
                    </p>
                    {message.excerpt ? (
                      <p className="break-words text-theme-fg-primary">
                        {message.excerpt}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {section.files.length > 0
              ? fileRows(section.files, section.position, filesLabel(title))
              : null}
          </section>
        );
      })}
      {live}
    </div>
  );
}

const filesLabel = (title: string) =>
  t({
    id: "teams.context.detail.filesLabel",
    message: `Shared files in ${title}`,
  });
