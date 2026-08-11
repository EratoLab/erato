import { useFileUploadStore } from "@erato/frontend/library";
import {
  createContext,
  useCallback,
  useContext,
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
} from "../utils/teamsChatFetcher";
import type { TeamsChatSelection } from "../utils/teamsChatSelection";
import type { ReactNode } from "react";

export type TeamsAttachFailure =
  /** Every selected message came back empty or unreadable. */
  | "nothing-to-attach"
  /** The composer never took the transcript, or the upload behind it failed. */
  | "upload-failed";

export interface TeamsChatPickerContextValue {
  isOpen: boolean;
  /** Captures the composer's upload callback for the life of the dialog. */
  open: (onSelectFiles: (files: File[]) => Promise<void>) => void;
  close: () => void;

  fetcher: TeamsChatFetcher | null;
  /** Null when the channel scopes were not granted — the picker shows chats only. */
  channelFetcher: TeamsChannelFetcher | null;
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
  fetcher: null,
  channelFetcher: null,
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

  const handoffRef = useRef<((files: File[]) => Promise<void>) | null>(null);
  const cancelledRef = useRef(false);
  const lastBuildRef = useRef<{ key: string; file: File } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

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
  const channelsByKeyRef = useRef(channelList.channelsByKey);
  channelsByKeyRef.current = channelList.channelsByKey;
  const chatsByIdRef = useRef(chatList.chatsById);
  chatsByIdRef.current = chatList.chatsById;

  const { build, progress, isBuilding, cancel, reset } =
    useTeamsTranscriptBuild(fetcher, channelFetcher);

  const messageLimitRef = useRef(messageLimit);
  messageLimitRef.current = messageLimit;

  const open = useCallback(
    (onSelectFiles: (files: File[]) => Promise<void>) => {
      handoffRef.current = onSelectFiles;
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
    handoffRef.current = null;
    lastBuildRef.current = null;
    setIsOpen(false);
    setSelection(new Map());
    setAttachError(null);
    setPartialOutcome(null);
  }, [cancelBuild, reset]);

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
   * The composer's callback resolves whether or not the upload landed, so the
   * shared upload store is the only success signal available here. `retryKey`
   * keeps the built transcript around after a failure: rebuilding it means
   * walking Graph again, which is tens of seconds.
   */
  const deliver = useCallback(
    async (file: File, retryKey?: string): Promise<boolean> => {
      const handoff = handoffRef.current;
      const fail = () => {
        if (retryKey) lastBuildRef.current = { key: retryKey, file };
        setAttachError("upload-failed");
        return false;
      };
      if (!handoff || useFileUploadStore.getState().isUploading) {
        return fail();
      }
      try {
        await handoff([file]);
      } catch (error) {
        console.warn(
          "[TeamsChatPicker] attaching the transcript failed",
          error,
        );
        return fail();
      }
      if (useFileUploadStore.getState().error) {
        return fail();
      }
      close();
      return true;
    },
    [close],
  );

  const attach = useCallback(async () => {
    const selections = [...selectionRef.current.values()];
    if (selections.length === 0) return;
    cancelledRef.current = false;
    setAttachError(null);
    setPartialOutcome(null);

    const key = teamsSelectionDedupeKey(selections, messageLimitRef.current);
    const built = lastBuildRef.current;
    if (built?.key === key) {
      await deliver(built.file, key);
      return;
    }

    const outcome = await build({
      selections,
      knownChats: chatsByIdRef.current,
      knownChannels: channelsByKeyRef.current,
      self,
      limit: messageLimitRef.current,
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
    await deliver(outcome.file, key);
  }, [build, deliver, self]);

  const attachPartial = useCallback(async () => {
    const outcome = partialOutcome;
    if (!outcome?.file) return;
    setPartialOutcome(null);
    // Put the offer back if the composer never took it — the partial
    // transcript is the only copy of a walk that already ran.
    if (!(await deliver(outcome.file))) setPartialOutcome(outcome);
  }, [deliver, partialOutcome]);

  const value = useMemo<TeamsChatPickerContextValue>(
    () => ({
      isOpen,
      open,
      close,
      fetcher,
      channelFetcher,
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
      fetcher,
      isBuilding,
      isMessageSelectionFull,
      isOpen,
      isSelected,
      messageLimit,
      open,
      partialOutcome,
      progress,
      raiseMessageLimit,
      selectedMessageCount,
      selection,
      self,
      toggle,
    ],
  );

  return (
    <TeamsChatPickerContext.Provider value={value}>
      {children}
      <TeamsChatPickerDialog />
    </TeamsChatPickerContext.Provider>
  );
}
