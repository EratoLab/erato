import { action } from "@storybook/addon-actions";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChatInput } from "@/components/ui/Chat/ChatInput";
import { Button } from "@/components/ui/Controls/Button";
import { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { useTeamsTranscriptContextItems } from "@/components/ui/Teams/useTeamsTranscriptContextItems";
import { readTeamsTranscriptIndex } from "@/hooks/teams/useTeamsTranscriptIndex";
import {
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
} from "@/utils/teams/teamsTranscriptIndex";

import { stagedFile } from "./composerContextStoryKit";
import {
  TEAMS_STORY_CONVERSATIONS,
  TEAMS_STORY_PICKER_CHOICES,
  teamsStoryFileName,
  teamsStoryRemovedNames,
  teamsStoryStaged,
  teamsStoryTranscriptText,
  teamsStoryTranscriptUploads,
  teamsStoryUpdate,
} from "./composerContextTeamsScenarios";

import type {
  TeamsStoryConversationKey,
  TeamsStorySeed,
  TeamsStoryTranscript,
  TeamsStoryUpload,
} from "./composerContextTeamsScenarios";
import type { ChatInputControlsHandle } from "@/components/ui/Chat/ChatInputControlsContext";
import type { TeamsTranscriptContextEntry } from "@/components/ui/Teams/useTeamsTranscriptContextItems";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const FORMAT = {
  marker: TEAMS_TRANSCRIPT_INDEX_MARKER,
  version: TEAMS_TRANSCRIPT_INDEX_VERSION,
};

/** The add-in's record of one transcript (TeamsChatPickerProvider). */
interface StoryRecord {
  transcript: TeamsStoryTranscript;
  version: number;
  file: File;
  assetUploadIds: string[];
  /** Upload names of every asset handed over with it. */
  assetNames: string[];
  /** Upload names the user removed; an Update leaves them out. */
  excludedNames: string[];
}

type SizedUpload = FileUploadItem & { size: number };

const toUpload = (upload: TeamsStoryUpload): SizedUpload => ({
  ...stagedFile(upload.id, upload.filename),
  size: upload.size,
});

function recordOf(
  transcript: TeamsStoryTranscript,
  version: number,
  release?: Promise<void>,
  excludedNames: string[] = teamsStoryRemovedNames(transcript),
): StoryRecord {
  const text = teamsStoryTranscriptText(transcript, FORMAT);
  const file = new File([text], teamsStoryFileName(transcript.conversations), {
    type: "text/markdown",
  });
  if (release) {
    Object.defineProperty(file, "text", {
      value: () => release.then(() => text),
    });
  }
  const excluded = new Set(excludedNames);
  const assets = teamsStoryTranscriptUploads(transcript).assets.filter(
    (upload) => !excluded.has(upload.filename),
  );
  return {
    transcript,
    version,
    file,
    assetUploadIds: assets.map((upload) => upload.id),
    assetNames: assets.map((upload) => upload.filename),
    excludedNames,
  };
}

/** The staged uploads of a record, the transcript sized as its file is. */
function uploadsOf(record: StoryRecord): SizedUpload[] {
  const uploads = teamsStoryTranscriptUploads(record.transcript);
  const handed = new Set(record.assetUploadIds);
  return [
    toUpload({ ...uploads.transcript, size: record.file.size }),
    ...uploads.assets.filter((upload) => handed.has(upload.id)).map(toUpload),
  ];
}

/** previewTeamsSend: records whose transcript upload is staged, in staged order. */
function storyTeamsSend(
  records: ReadonlyMap<string, StoryRecord>,
  staged: readonly FileUploadItem[],
) {
  const byUpload = new Map(
    [...records.values()].map((record) => [record.transcript.uploadId, record]),
  );
  return staged.flatMap((file) => {
    const record = byUpload.get(file.id);
    if (!record) return [];
    const ids = new Set(record.assetUploadIds);
    const assets = staged.filter((candidate) => ids.has(candidate.id));
    const taken = new Set([
      ...assets.map((asset) => asset.filename),
      ...record.excludedNames,
    ]);
    return [
      {
        record,
        transcript: file,
        assets,
        notAttachedAssetNames: record.assetNames.filter(
          (name) => !taken.has(name),
        ),
      },
    ];
  });
}

const titleOf = (key: TeamsStoryConversationKey) => {
  const conversation = TEAMS_STORY_CONVERSATIONS[key];
  return conversation.teamName
    ? `${conversation.title} · ${conversation.teamName}`
    : conversation.title;
};

const sublineOf = (key: TeamsStoryConversationKey) => {
  const conversation = TEAMS_STORY_CONVERSATIONS[key];
  if (conversation.selection === "messages") {
    return `Chat · ${conversation.messages.length} picked messages`;
  }
  return conversation.kind === "channel" ? "Channel" : "Chat";
};

/**
 * Stands in for the add-in's TeamsChatPickerDialog in edit mode, which needs
 * Microsoft Graph: the transcript's conversations ticked, "Update" enabled
 * even with nothing ticked. The real dialog is pinned by the add-in's tests.
 */
function StandInPicker({
  record,
  onCancel,
  onUpdate,
}: {
  record: StoryRecord;
  onCancel: () => void;
  onUpdate: (conversations: TeamsStoryConversationKey[]) => void;
}) {
  const listed = useMemo(() => {
    const own = record.transcript.conversations;
    const titles = new Set(own.map(titleOf));
    return [
      ...own,
      ...TEAMS_STORY_PICKER_CHOICES.filter((key) => !titles.has(titleOf(key))),
    ];
  }, [record]);
  const [ticked, setTicked] = useState(
    () => new Set<TeamsStoryConversationKey>(record.transcript.conversations),
  );
  const idPrefix = useId();
  const toggle = (key: TeamsStoryConversationKey) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ModalBase
      isOpen
      onClose={onCancel}
      title="Teams chats"
      footer={
        <div className="flex flex-col gap-2">
          {ticked.size === 0 ? (
            <p
              data-testid="teams-story-picker-hint"
              className="text-xs text-theme-fg-secondary"
            >
              Nothing selected: Update removes the transcript.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => onUpdate(listed.filter((key) => ticked.has(key)))}
            >
              Update
            </Button>
          </div>
        </div>
      }
    >
      <ul
        data-testid="teams-story-picker"
        className="flex list-none flex-col gap-2 p-0"
      >
        {listed.map((key) => (
          <li key={key} className="flex flex-col">
            <label className="flex items-center gap-2 text-sm text-theme-fg-primary">
              <input
                type="checkbox"
                checked={ticked.has(key)}
                aria-describedby={`${idPrefix}-${key}`}
                onChange={() => toggle(key)}
              />
              {titleOf(key)}
            </label>
            <span
              id={`${idPrefix}-${key}`}
              className="pl-6 text-xs text-theme-fg-secondary"
            >
              {sublineOf(key)}
            </span>
          </li>
        ))}
      </ul>
    </ModalBase>
  );
}

const LIVE_REGIONS = [
  '[data-ui="composer-context-live"]',
  '[data-testid="teams-composer-announcer"]',
  '[data-ui="teams-transcript-detail-live"]',
];

/**
 * Mirrors every polite region a Teams composer speaks through into the page:
 * the lane's, the Teams host's (attach, update, remove by update) and the
 * detail's (a file removed inside it).
 */
function TeamsAnnouncementLog() {
  const [entries, setEntries] = useState<string[]>([]);
  const lastRef = useRef(new Map<string, string>());
  useEffect(() => {
    const observer = new MutationObserver(() => {
      for (const selector of LIVE_REGIONS) {
        const text =
          document
            .querySelector(selector)
            ?.textContent?.replace(/\u200b/g, "")
            .trim() ?? "";
        if (text && text !== lastRef.current.get(selector)) {
          setEntries((current) => [text, ...current].slice(0, 6));
        }
        lastRef.current.set(selector, text);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);
  return (
    <ol
      data-testid="announcement-log"
      aria-hidden="true"
      className="mt-3 list-none space-y-1 p-0 text-xs text-theme-fg-secondary"
    >
      {entries.map((entry, index) => (
        <li key={`${entry}-${index}`}>{`Announced: ${entry}`}</li>
      ))}
    </ol>
  );
}

interface ComposerProps {
  seed: TeamsStorySeed;
  records: Map<string, StoryRecord>;
  staged: FileUploadItem[];
  interactive: boolean;
  release: (() => void) | null;
}

function Composer({
  seed,
  records: seedRecords,
  staged: seedStaged,
  interactive,
  release,
}: ComposerProps) {
  const composerRef = useRef<ChatInputControlsHandle>(null);
  const [records, setRecords] = useState(seedRecords);
  // The host's mirror of the composer's staged files, changed in the same
  // batch as the composer (useTeamsComposerBridge), so a chip whose record
  // swaps on "Update" never loses its upload for a render.
  const [staged, setStaged] = useState<FileUploadItem[]>(seedStaged);
  const stagedRef = useRef(staged);
  useLayoutEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  const [announcement, setAnnouncement] = useState("");
  const [preview, setPreview] = useState<FileUploadItem | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState<string[][]>([]);
  const [chat, setChat] = useState<"this" | "other">("this");
  const [reading, setReading] = useState(release !== null);
  const chatBase = useId();
  const picker = seed.picker !== false;

  const removeIds = useCallback((fileIds: readonly string[]) => {
    if (fileIds.length === 0) return;
    const ids = new Set(fileIds);
    composerRef.current?.removeUploadedFiles([...ids]);
    setStaged((current) => current.filter((file) => !ids.has(file.id)));
  }, []);
  const addUploads = useCallback((uploads: FileUploadItem[]) => {
    composerRef.current?.addUploadedFiles(uploads);
    setStaged((current) => {
      const known = new Set(current.map((file) => file.id));
      return [...current, ...uploads.filter((file) => !known.has(file.id))];
    });
  }, []);
  const claimedIds = (record: StoryRecord) => {
    const ids = new Set(stagedRef.current.map((file) => file.id));
    return [record.transcript.uploadId, ...record.assetUploadIds].filter((id) =>
      ids.has(id),
    );
  };

  const handlersRef = useRef(
    new Map<string, { onRemove: () => void; onEditSelection: () => void }>(),
  );
  const handlersFor = useCallback((lineage: string) => {
    let handlers = handlersRef.current.get(lineage);
    if (!handlers) {
      handlers = {
        onRemove: () =>
          setRecords((current) => {
            const next = new Map(current);
            next.delete(lineage);
            return next;
          }),
        onEditSelection: () => {
          action("editSelection")(lineage);
          setEditing(lineage);
        },
      };
      handlersRef.current.set(lineage, handlers);
    }
    return handlers;
  }, []);

  const send = useMemo(
    () => storyTeamsSend(records, staged),
    [records, staged],
  );
  const entries = useMemo(
    () =>
      send.map(
        ({
          record,
          transcript,
          assets,
          notAttachedAssetNames,
        }): TeamsTranscriptContextEntry => {
          const handlers = handlersFor(record.transcript.lineage);
          return {
            id: record.transcript.lineage,
            transcript: record.file,
            uploads: { transcript, assets },
            notAttachedAssetNames,
            onRemove: handlers.onRemove,
            onEditSelection: picker ? handlers.onEditSelection : undefined,
          };
        },
      ),
    [handlersFor, picker, send],
  );
  // The record remembers the removal, so an Update leaves the file out.
  const onRemoveFile = useCallback(
    (fileId: string) => {
      const name = stagedRef.current.find(
        (file) => file.id === fileId,
      )?.filename;
      if (name) {
        setRecords((current) => {
          const next = new Map(current);
          for (const [lineage, record] of current) {
            if (record.assetUploadIds.includes(fileId)) {
              next.set(lineage, {
                ...record,
                excludedNames: [...record.excludedNames, name],
              });
            }
          }
          return next;
        });
      }
      removeIds([fileId]);
    },
    [removeIds],
  );
  const onFilePreview = useCallback(
    (file: FileUploadItem) => setPreview(file),
    [],
  );
  const contextItems = useTeamsTranscriptContextItems(entries, {
    onRemoveFile,
    onFilePreview,
  });

  const editingRecord = editing === null ? undefined : records.get(editing);
  const update = async (
    record: StoryRecord,
    conversations: TeamsStoryConversationKey[],
  ) => {
    const lineage = record.transcript.lineage;
    if (conversations.length === 0) {
      removeIds(claimedIds(record));
      setRecords((current) => {
        const next = new Map(current);
        next.delete(lineage);
        return next;
      });
      setAnnouncement("Teams transcript removed.");
      setEditing(null);
      composerRef.current?.focusInput();
      return;
    }
    const version = record.version + 1;
    const next = recordOf(
      teamsStoryUpdate(record.transcript, conversations, version),
      version,
      undefined,
      record.excludedNames,
    );
    // The picker reads the index before it hands the files over, so the
    // chip's first render after "Update" already names the conversations.
    await readTeamsTranscriptIndex(next.file);
    removeIds(claimedIds(record));
    addUploads(uploadsOf(next));
    setRecords((current) => new Map(current).set(lineage, next));
    setAnnouncement("Teams transcript updated.");
    setEditing(null);
  };

  return (
    <>
      <ChatInput
        ref={composerRef}
        chatId={`teams-story${chatBase}${chat}`}
        onSendMessage={(message, fileIds) => {
          action("onSendMessage")(message, fileIds);
          setSent((current) => [fileIds ?? [], ...current]);
        }}
        initialFiles={seedStaged}
        onStagedFilesChange={setStaged}
        contextItems={contextItems}
        onFilePreview={onFilePreview}
        disabled={seed.locked === true}
        maxFiles={10}
        showControls
      />
      <div
        className="sr-only"
        aria-live="polite"
        data-testid="teams-composer-announcer"
      >
        {announcement}
      </div>
      {interactive || reading ? (
        <div
          role="group"
          aria-label="Simulate"
          className="mt-3 flex flex-wrap gap-2 text-xs"
        >
          {reading ? (
            <button
              type="button"
              onClick={() => {
                release?.();
                setReading(false);
              }}
              className="border border-theme-border px-2 py-1 text-theme-fg-primary"
            >
              Finish reading
            </button>
          ) : null}
          {interactive ? (
            <button
              type="button"
              onClick={() =>
                setChat((current) => (current === "this" ? "other" : "this"))
              }
              className="border border-theme-border px-2 py-1 text-theme-fg-primary"
            >
              {chat === "this" ? "Switch to another chat" : "Back to this chat"}
            </button>
          ) : null}
        </div>
      ) : null}
      <ol
        data-testid="send-log"
        aria-hidden="true"
        className="mt-3 list-none space-y-1 p-0 text-xs text-theme-fg-secondary"
      >
        {sent.map((ids, index) => (
          <li key={`${ids.join()}-${index}`}>
            {`Sent: ${ids.length > 0 ? ids.join(", ") : "no files"}`}
          </li>
        ))}
      </ol>
      <TeamsAnnouncementLog />
      {editingRecord ? (
        <StandInPicker
          record={editingRecord}
          onCancel={() => setEditing(null)}
          onUpdate={(conversations) =>
            void update(editingRecord, conversations)
          }
        />
      ) : null}
      <FilePreviewModal
        isOpen={preview !== null}
        onClose={() => setPreview(null)}
        file={preview}
      />
    </>
  );
}

/**
 * The Teams tab's composer from data: the picker's records, the composer's
 * staged uploads, and the library's own chip hook between them. Records are
 * read before the composer renders, as the picker reads a transcript before
 * it hands it over; a `slowRead` transcript waits for "Finish reading".
 */
export function TeamsStoryComposer({
  seed,
  interactive = false,
}: {
  seed: TeamsStorySeed;
  interactive?: boolean;
}) {
  const [initial] = useState(() => {
    const reader = { release: () => {} };
    const gate = new Promise<void>((resolve) => {
      reader.release = () => resolve();
    });
    const slow = seed.transcripts.some((transcript) => transcript.slowRead);
    const records = new Map(
      seed.transcripts.map((transcript) => [
        transcript.lineage,
        recordOf(transcript, 1, transcript.slowRead ? gate : undefined),
      ]),
    );
    const sizes = new Map(
      [...records.values()].map((record) => [
        record.transcript.uploadId,
        record.file.size,
      ]),
    );
    const staged = teamsStoryStaged(seed).map((upload) =>
      toUpload({ ...upload, size: sizes.get(upload.id) ?? upload.size }),
    );
    return { records, staged, release: slow ? reader.release : null };
  });
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      [...initial.records.values()]
        .filter((record) => !record.transcript.slowRead)
        .map((record) => readTeamsTranscriptIndex(record.file)),
    ).then(() => {
      if (alive) setPrimed(true);
    });
    return () => {
      alive = false;
    };
  }, [initial]);
  if (!primed) return null;
  return (
    <Composer
      seed={seed}
      records={initial.records}
      staged={initial.staged}
      interactive={interactive}
      release={initial.release}
    />
  );
}
