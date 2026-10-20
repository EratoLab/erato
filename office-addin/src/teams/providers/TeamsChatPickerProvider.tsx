import {
  readTeamsTranscriptIndex,
  useFeatureConfig,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTeams } from "./TeamsProvider";
import { TeamsChatPickerDialog } from "../components/TeamsChatPickerDialog";
import { useTeamsChannelFetcher } from "../hooks/useTeamsChannelFetcher";
import { useTeamsChannelList } from "../hooks/useTeamsChannelList";
import { useTeamsChatFetcher } from "../hooks/useTeamsChatFetcher";
import { useTeamsChatList } from "../hooks/useTeamsChatList";
import { useTeamsDevProbe } from "../hooks/useTeamsDevProbe";
import { useTeamsFileFetcher } from "../hooks/useTeamsFileFetcher";
import { useTeamsTranscriptBuild } from "../hooks/useTeamsTranscriptBuild";
import {
  DEFAULT_CHAT_MESSAGE_LIMIT,
  MAX_CHAT_MESSAGE_LIMIT,
} from "../utils/teamsChatPager";
import {
  MAX_SELECTED_MESSAGES,
  countSelectedMessages,
  teamsSelectionDedupeKey,
  teamsSelectionKey,
} from "../utils/teamsChatSelection";

import type { UseTeamsChannelListResult } from "../hooks/useTeamsChannelList";
import type { UseTeamsChatListResult } from "../hooks/useTeamsChatList";
import type { TeamsComposerBridge } from "../hooks/useTeamsComposerBridge";
import type { TeamsTranscriptBuildOutcome } from "../hooks/useTeamsTranscriptBuild";
import type { TeamsTranscriptProgress } from "../utils/collectTeamsTranscript";
import type { ParsedTeamsChannel } from "../utils/parsedTeamsChannel";
import type {
  ParsedTeamsChat,
  TeamsSelfIdentity,
} from "../utils/parsedTeamsChat";
import type {
  TeamsChannelFetcher,
  TeamsChatFetcher,
  TeamsFileFetcher,
} from "../utils/teamsChatFetcher";
import type { TeamsChatSelection } from "../utils/teamsChatSelection";
import type { TeamsTranscriptRecord } from "../utils/teamsComposerTranscripts";
import type { ReactNode } from "react";

export type TeamsAttachFailure =
  /** Every selected message came back empty or unreadable. */
  | "nothing-to-attach"
  /** The composer never took the transcript, or the upload behind it failed. */
  | "upload-failed";

export interface TeamsChatPickerContextValue {
  isOpen: boolean;
  /**
   * Opens for one composer, kept for the life of the dialog. With `edit`, the
   * dialog starts from that transcript's selection and replaces it on Update.
   */
  open: (
    composer: TeamsComposerBridge,
    options?: { edit?: TeamsTranscriptRecord },
  ) => void;
  close: () => void;
  /** The transcript the open dialog is editing, if any. */
  editing: TeamsTranscriptRecord | null;

  fetcher: TeamsChatFetcher | null;
  /** Null when the channel scopes were not granted — the picker shows chats only. */
  channelFetcher: TeamsChannelFetcher | null;
  /** Null when `Files.Read.All` was not granted. */
  fileFetcher: TeamsFileFetcher | null;
  /** The deployment's upload limit; also caps chip-preview downloads. */
  maxFileBytes: number;
  self: TeamsSelfIdentity | undefined;
  chatList: UseTeamsChatListResult;
  channelList: UseTeamsChannelListResult;

  selection: ReadonlyMap<string, TeamsChatSelection>;
  isSelected: (selection: TeamsChatSelection) => boolean;
  toggle: (selection: TeamsChatSelection) => void;
  selectedMessageCount: number;
  /** True once individual message ticks have hit {@link MAX_SELECTED_MESSAGES}. */
  isMessageSelectionFull: boolean;

  /** Messages taken per whole-chat selection, newest first. */
  messageLimit: number;
  raiseMessageLimit: () => void;
  canRaiseMessageLimit: boolean;

  attach: () => Promise<void>;
  /** Accept the partial transcript the last build offered. */
  attachPartial: () => Promise<void>;
  /** Abort an in-flight build, keeping the dialog and the selection. */
  cancelBuild: () => void;
  isBuilding: boolean;
  progress: TeamsTranscriptProgress | null;
  partialOutcome: TeamsTranscriptBuildOutcome | null;
  attachError: TeamsAttachFailure | null;

  /**
   * What this session attached, by transcript upload id. Survives closing the
   * dialog; a composer shows a chip for each record whose upload it stages.
   */
  transcripts: ReadonlyMap<string, TeamsTranscriptRecord>;
  /** Drops a record, e.g. after its chip's (x). */
  forget: (transcriptUploadId: string) => void;
}

const EMPTY_CHAT_LIST: UseTeamsChatListResult = {
  chats: [],
  chatsById: new Map<string, ParsedTeamsChat>(),
  isLoading: false,
  isError: false,
  isPartial: false,
  hasMore: false,
  isLoadingMore: false,
  loadMore: () => {},
  refetch: () => {},
};

const EMPTY_CHANNEL_LIST: UseTeamsChannelListResult = {
  channels: [],
  channelsByKey: new Map<string, ParsedTeamsChannel>(),
  isLoading: false,
  isError: false,
  isPartial: false,
  refetch: () => {},
};

const CLOSED_PICKER: TeamsChatPickerContextValue = {
  isOpen: false,
  open: () => {},
  close: () => {},
  editing: null,
  fetcher: null,
  channelFetcher: null,
  fileFetcher: null,
  maxFileBytes: 0,
  self: undefined,
  chatList: EMPTY_CHAT_LIST,
  channelList: EMPTY_CHANNEL_LIST,
  selection: new Map<string, TeamsChatSelection>(),
  isSelected: () => false,
  toggle: () => {},
  selectedMessageCount: 0,
  isMessageSelectionFull: false,
  messageLimit: DEFAULT_CHAT_MESSAGE_LIMIT,
  raiseMessageLimit: () => {},
  canRaiseMessageLimit: false,
  attach: () => Promise.resolve(),
  attachPartial: () => Promise.resolve(),
  cancelBuild: () => {},
  isBuilding: false,
  progress: null,
  partialOutcome: null,
  attachError: null,
  transcripts: new Map<string, TeamsTranscriptRecord>(),
  forget: () => {},
};

const TeamsChatPickerContext =
  createContext<TeamsChatPickerContextValue>(CLOSED_PICKER);

export function useTeamsChatPicker(): TeamsChatPickerContextValue {
  return useContext(TeamsChatPickerContext);
}

/**
 * Owns the Teams chat picker dialog, mounted above the chat page rather than
 * inside the composer's "+" popover. `AnchoredPopover` dismisses on any
 * `pointerdown` outside its panel, and a portalled dialog is a DOM sibling of
 * that panel — so a dialog rendered from the menu row would close itself on
 * the first click inside it.
 *
 * The in-flight transcript build lives here too, so Escape or an overlay click
 * cancels it instead of orphaning the fetch in an unmounted subtree.
 */
export function TeamsChatPickerProvider({ children }: { children: ReactNode }) {
  const { userPrincipalName, userId } = useTeams();
  const { fetcher } = useTeamsChatFetcher();
  const { fetcher: channelFetcher } = useTeamsChannelFetcher();
  const { fetcher: fileFetcher } = useTeamsFileFetcher();
  // Shared-file downloads cap at what the deployment's upload limit accepts.
  const maxFileBytes = useFeatureConfig().upload.maxSizeBytes;
  useTeamsDevProbe();

  const [isOpen, setIsOpen] = useState(false);
  const [hasEverOpened, setHasEverOpened] = useState(false);
  const [selection, setSelection] = useState<
    ReadonlyMap<string, TeamsChatSelection>
  >(() => new Map());
  const [messageLimit, setMessageLimit] = useState(DEFAULT_CHAT_MESSAGE_LIMIT);
  const [attachError, setAttachError] = useState<TeamsAttachFailure | null>(
    null,
  );
  const [partialOutcome, setPartialOutcome] =
    useState<TeamsTranscriptBuildOutcome | null>(null);

  const [transcripts, setTranscripts] = useState<
    ReadonlyMap<string, TeamsTranscriptRecord>
  >(() => new Map());
  const [editing, setEditing] = useState<TeamsTranscriptRecord | null>(null);
  // Read after the build's awaits, where the state above may be stale.
  const editingRef = useRef<TeamsTranscriptRecord | null>(null);
  const lineageRef = useRef(0);
  // Bumped when the dialog closes after changing the composer, so focus goes
  // back to it once the dialog's own focus return has had its turn.
  const [refocus, setRefocus] = useState<{
    composer: TeamsComposerBridge;
  } | null>(null);

  const composerRef = useRef<TeamsComposerBridge | null>(null);
  const cancelledRef = useRef(false);
  const lastBuildRef = useRef<{ key: string; files: File[] } | null>(null);

  // The object id is the reliable match; the login hint can differ from a
  // member's primary SMTP address, which would leave the viewer in their own
  // participant list and title a 1:1 chat with their own name.
  const self = useMemo<TeamsSelfIdentity | undefined>(
    () =>
      userPrincipalName || userId ? { userPrincipalName, userId } : undefined,
    [userPrincipalName, userId],
  );

  // Listing costs a Graph call, so it stays cold until the picker is first
  // opened and warm afterwards — reopening is then free.
  const chatList = useTeamsChatList(hasEverOpened ? fetcher : null, self);
  const channelList = useTeamsChannelList(
    hasEverOpened ? channelFetcher : null,
  );

  const { build, progress, isBuilding, cancel, reset } =
    useTeamsTranscriptBuild(fetcher, channelFetcher, fileFetcher);

  const open = useCallback(
    (
      composer: TeamsComposerBridge,
      options: { edit?: TeamsTranscriptRecord } = {},
    ) => {
      const edit = options.edit ?? null;
      composerRef.current = composer;
      editingRef.current = edit;
      setEditing(edit);
      if (edit) {
        setSelection(
          new Map(
            edit.selections.map((selected) => [
              teamsSelectionKey(selected),
              selected,
            ]),
          ),
        );
        setMessageLimit(edit.messageLimit);
      }
      setAttachError(null);
      setPartialOutcome(null);
      setHasEverOpened(true);
      setIsOpen(true);
    },
    [],
  );

  const cancelBuild = useCallback(() => {
    cancelledRef.current = true;
    cancel();
  }, [cancel]);

  const close = useCallback(() => {
    cancelBuild();
    reset();
    composerRef.current = null;
    editingRef.current = null;
    lastBuildRef.current = null;
    setIsOpen(false);
    setEditing(null);
    setSelection(new Map());
    setAttachError(null);
    setPartialOutcome(null);
  }, [cancelBuild, reset]);

  const forget = useCallback((transcriptUploadId: string) => {
    setTranscripts((current) => {
      if (!current.has(transcriptUploadId)) return current;
      const next = new Map(current);
      next.delete(transcriptUploadId);
      return next;
    });
  }, []);

  // After the dialog's own focus return: an Attach started from "+" or an
  // Update that removed the chip leaves no opener to go back to.
  useEffect(() => {
    if (!refocus) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      refocus.composer.focusComposer();
    }
  }, [refocus]);

  const selectedMessageCount = countSelectedMessages([...selection.values()]);
  const isMessageSelectionFull = selectedMessageCount >= MAX_SELECTED_MESSAGES;

  const isSelected = useCallback(
    (candidate: TeamsChatSelection) =>
      selection.has(teamsSelectionKey(candidate)),
    [selection],
  );

  const toggle = useCallback((candidate: TeamsChatSelection) => {
    const key = teamsSelectionKey(candidate);
    setSelection((current) => {
      const next = new Map(current);
      if (next.delete(key)) return next;
      if (
        candidate.kind === "message" &&
        countSelectedMessages([...next.values()]) >= MAX_SELECTED_MESSAGES
      ) {
        return current;
      }
      next.set(key, candidate);
      return next;
    });
    setAttachError(null);
    setPartialOutcome(null);
  }, []);

  const raiseMessageLimit = useCallback(() => {
    setMessageLimit((current) =>
      Math.min(MAX_CHAT_MESSAGE_LIMIT, current + DEFAULT_CHAT_MESSAGE_LIMIT),
    );
  }, []);

  /**
   * Uploads through the composer, then stages the result: added, or in place
   * of the transcript being edited. `retryKey` keeps the built transcript
   * around after a failure: rebuilding it means walking Graph again, which is
   * tens of seconds. A failed upload leaves the record and its files as they
   * were.
   */
  const deliver = useCallback(
    async (
      files: File[],
      built: {
        selections: readonly TeamsChatSelection[];
        limit: number;
        retryKey?: string;
      },
    ): Promise<boolean> => {
      const composer = composerRef.current;
      const fail = () => {
        if (built.retryKey) {
          lastBuildRef.current = { key: built.retryKey, files };
        }
        setAttachError("upload-failed");
        return false;
      };
      // The transcript leads, its assets follow — the order every caller
      // hands over, and what makes the first file the one the chip reads.
      const [file] = files;
      if (!composer || !file) return fail();
      // Read before staging, so the chip's first render already knows the
      // conversation.
      await readTeamsTranscriptIndex(file);
      const uploaded = await composer.upload(files);
      if (!uploaded) return fail();

      const transcriptUpload = uploaded.find(
        (upload) => upload.filename === file.name,
      );
      if (!transcriptUpload) return fail();
      const previous = editingRef.current;
      lineageRef.current += 1;
      const record: TeamsTranscriptRecord = {
        lineage: previous?.lineage ?? `teams-transcript-${lineageRef.current}`,
        transcriptUploadId: transcriptUpload.id,
        assetUploadIds: uploaded
          .filter((upload) => upload !== transcriptUpload)
          .map((upload) => upload.id),
        file,
        selections: [...built.selections],
        messageLimit: built.limit,
      };
      if (previous) {
        composer.replace(previous, uploaded);
      } else {
        composer.add(uploaded);
      }
      setTranscripts((current) => {
        const next = new Map(current);
        if (previous) next.delete(previous.transcriptUploadId);
        next.set(record.transcriptUploadId, record);
        return next;
      });
      composer.announce(
        previous
          ? t({
              id: "officeAddin.teams.composer.announce.updated",
              message: "Teams transcript updated.",
            })
          : t({
              id: "officeAddin.teams.composer.announce.attached",
              message: "Teams transcript attached.",
            }),
      );
      close();
      setRefocus({ composer });
      return true;
    },
    [close],
  );

  const attach = useCallback(async () => {
    const selections = [...selection.values()];
    const previous = editingRef.current;
    const composer = composerRef.current;
    if (selections.length === 0) {
      // Update with nothing ticked takes the transcript out.
      if (previous && composer) {
        composer.remove(composer.claimedIds(previous));
        forget(previous.transcriptUploadId);
        composer.announce(
          t({
            id: "officeAddin.teams.composer.announce.removed",
            message: "Teams transcript removed.",
          }),
        );
        close();
        setRefocus({ composer });
      }
      return;
    }
    cancelledRef.current = false;
    setAttachError(null);
    setPartialOutcome(null);

    const key = teamsSelectionDedupeKey(selections, messageLimit);
    const built = lastBuildRef.current;
    if (built?.key === key) {
      await deliver(built.files, {
        selections,
        limit: messageLimit,
        retryKey: key,
      });
      return;
    }

    const outcome = await build({
      selections,
      knownChats: chatList.chatsById,
      knownChannels: channelList.channelsByKey,
      self,
      limit: messageLimit,
      maxFileBytes,
    });
    // A user-initiated cancel is not a failure to report.
    if (cancelledRef.current) return;
    if (!outcome.file) {
      setAttachError("nothing-to-attach");
      return;
    }
    if (outcome.state !== "ok") {
      setPartialOutcome(outcome);
      return;
    }
    await deliver([outcome.file, ...outcome.assets], {
      selections,
      limit: messageLimit,
      retryKey: key,
    });
  }, [
    build,
    chatList.chatsById,
    channelList.channelsByKey,
    close,
    deliver,
    forget,
    maxFileBytes,
    messageLimit,
    selection,
    self,
  ]);

  const attachPartial = useCallback(async () => {
    const outcome = partialOutcome;
    if (!outcome?.file) return;
    setPartialOutcome(null);
    // Put the offer back if the composer never took it — the partial
    // transcript is the only copy of a walk that already ran.
    const delivered = await deliver([outcome.file, ...outcome.assets], {
      selections: [...selection.values()],
      limit: messageLimit,
    });
    if (!delivered) {
      setPartialOutcome(outcome);
    }
  }, [deliver, messageLimit, partialOutcome, selection]);

  const value = useMemo<TeamsChatPickerContextValue>(
    () => ({
      isOpen,
      open,
      close,
      editing,
      fetcher,
      channelFetcher,
      fileFetcher,
      maxFileBytes,
      self,
      chatList,
      channelList,
      selection,
      isSelected,
      toggle,
      selectedMessageCount,
      isMessageSelectionFull,
      messageLimit,
      raiseMessageLimit,
      canRaiseMessageLimit: messageLimit < MAX_CHAT_MESSAGE_LIMIT,
      attach,
      attachPartial,
      cancelBuild,
      isBuilding,
      progress,
      partialOutcome,
      attachError,
      transcripts,
      forget,
    }),
    [
      attach,
      attachError,
      attachPartial,
      cancelBuild,
      channelFetcher,
      channelList,
      chatList,
      close,
      editing,
      fetcher,
      fileFetcher,
      forget,
      isBuilding,
      isMessageSelectionFull,
      isOpen,
      isSelected,
      maxFileBytes,
      messageLimit,
      open,
      partialOutcome,
      progress,
      raiseMessageLimit,
      selectedMessageCount,
      selection,
      self,
      toggle,
      transcripts,
    ],
  );

  return (
    <TeamsChatPickerContext.Provider value={value}>
      {children}
      <TeamsChatPickerDialog />
    </TeamsChatPickerContext.Provider>
  );
}
