import {
  useChatInputControls,
  useTeamsTranscriptContextItems,
  useUploadFeature,
} from "@erato/frontend/library";
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { TeamsComposerContext } from "./TeamsComposerContext";
import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import { useTeamsComposerBridge } from "../hooks/useTeamsComposerBridge";
import { useTeamsPickerAvailability } from "../hooks/useTeamsPickerAvailability";
import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";
import { previewTeamsSend } from "../utils/teamsComposerTranscripts";

import type { TeamsComposerContextValue } from "./TeamsComposerContext";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { TeamsTranscriptRecord } from "../utils/teamsComposerTranscripts";
import type {
  ChatInputControlsHandle,
  FileUploadItem,
  TeamsTranscriptContextEntry,
  TeamsTranscriptNamedUpload,
} from "@erato/frontend/library";

interface RecordHandlers {
  onRemove: () => void;
  onEditSelection: () => void;
}

/**
 * The Teams tab's composer: every transcript this session attached is one
 * context chip, standing for the transcript upload and the files it brought,
 * for exactly as long as that upload is staged here.
 */
export const TeamsChatInput = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputCoreProps
>(function TeamsChatInput(props, ref) {
  const picker = useTeamsChatPicker();
  const controls = useChatInputControls();
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const { canPick } = useTeamsPickerAvailability();

  const [staged, setStaged] = useState<FileUploadItem[]>([]);
  const stagedRef = useRef<readonly FileUploadItem[]>(staged);
  useLayoutEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  const [announcement, setAnnouncement] = useState("");

  const bridge = useTeamsComposerBridge({
    uploadFiles: props.uploadFiles,
    controls,
    stagedRef,
    setStaged,
    announce: setAnnouncement,
    maxSizeBytes,
    maxSizeFormatted,
  });

  const preview = useMemo(
    () => previewTeamsSend(picker.transcripts.values(), staged),
    [picker.transcripts, staged],
  );

  // Per lineage, so an item keeps its handlers while the picker re-renders
  // through a build; they act on whatever record carries the lineage now.
  const latestRef = useRef({
    records: new Map<string, TeamsTranscriptRecord>(),
    forget: picker.forget,
    open: picker.open,
    bridge,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      records: new Map(
        preview.transcripts.map(({ record }) => [record.lineage, record]),
      ),
      forget: picker.forget,
      open: picker.open,
      bridge,
    };
  });
  const handlersRef = useRef(new Map<string, RecordHandlers>());
  const handlersFor = useCallback((lineage: string): RecordHandlers => {
    let handlers = handlersRef.current.get(lineage);
    if (!handlers) {
      handlers = {
        onRemove: () => {
          const latest = latestRef.current;
          const record = latest.records.get(lineage);
          if (record) latest.forget(record.transcriptUploadId);
        },
        onEditSelection: () => {
          const latest = latestRef.current;
          const record = latest.records.get(lineage);
          if (record) latest.open(latest.bridge, { edit: record });
        },
      };
      handlersRef.current.set(lineage, handlers);
    }
    return handlers;
  }, []);

  const entries = useMemo(
    () =>
      preview.transcripts.map(
        ({ record, transcript, assets }): TeamsTranscriptContextEntry => {
          const handlers = handlersFor(record.lineage);
          return {
            id: record.lineage,
            transcript: record.file,
            uploads: { transcript, assets },
            onRemove: handlers.onRemove,
            onEditSelection: canPick ? handlers.onEditSelection : undefined,
          };
        },
      ),
    [canPick, handlersFor, preview],
  );

  const onRemoveFile = useCallback(
    (fileId: string) => bridge.remove([fileId]),
    [bridge],
  );
  const previewRef = useRef(props.onFilePreview);
  useLayoutEffect(() => {
    previewRef.current = props.onFilePreview;
  });
  const onFilePreview = useCallback(
    (file: TeamsTranscriptNamedUpload) => previewRef.current?.(file),
    [],
  );
  const contextItems = useTeamsTranscriptContextItems(entries, {
    onRemoveFile,
    onFilePreview,
  });

  const stagedTranscript = preview.transcripts.at(-1)?.record ?? null;
  const composer = useMemo<TeamsComposerContextValue>(
    () => ({ bridge, stagedTranscript }),
    [bridge, stagedTranscript],
  );

  return (
    <TeamsComposerContext.Provider value={composer}>
      <AddinChatInputCore
        {...props}
        ref={ref}
        contextItems={contextItems}
        onStagedFilesChange={setStaged}
      />
      <div
        className="sr-only"
        aria-live="polite"
        data-testid="teams-composer-announcer"
      >
        {announcement}
      </div>
    </TeamsComposerContext.Provider>
  );
});
