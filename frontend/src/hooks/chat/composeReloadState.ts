import { registerWorkInProgress } from "@/lib/chunkLoadRecovery";

import {
  EMPTY_COMPOSE_DRAFT,
  useComposeSessionStore,
} from "./store/composeSessionStore";
import { useMessageQueueStore } from "./store/messageQueueStore";
import { NEW_CHAT_KEY } from "./useComposeSession";

type ComposeReloadOptions = {
  selectedFacetIds: string[];
  selectedChatProviderId?: string;
};

const reloadHolds = new Set<symbol>();

/** Protect local files that cannot be reconstructed from uploaded file IDs. */
export function holdComposeReload() {
  const hold = Symbol();
  reloadHolds.add(hold);
  return () => {
    reloadHolds.delete(hold);
  };
}

const activeOptions = new Map<string, () => ComposeReloadOptions>();
let restoredOptions: Partial<Record<string, ComposeReloadOptions>> = {};

export function registerComposeReloadOptions(
  sessionId: string,
  read: () => ComposeReloadOptions,
) {
  activeOptions.set(sessionId, read);
  return () => {
    if (activeOptions.get(sessionId) === read) activeOptions.delete(sessionId);
  };
}

export function takeComposeReloadOptions(sessionId: string) {
  const options = restoredOptions[sessionId];
  delete restoredOptions[sessionId];
  return options;
}

export function hasPendingComposeUploads(): boolean {
  return reloadHolds.size > 0;
}

registerWorkInProgress(hasPendingComposeUploads);

type ComposeSessionState = ReturnType<typeof useComposeSessionStore.getState>;

/** The composers' unsent state, as kept over one reload of the page. */
export interface ComposeReloadSnapshot {
  version: 2;
  /** Profile id of the person who wrote it; another person never gets it. */
  ownerId: string;
  savedAt: number;
  sessionIdByChatKey: ComposeSessionState["sessionIdByChatKey"];
  draftsBySessionId: ComposeSessionState["draftsBySessionId"];
  options: Partial<Record<string, ComposeReloadOptions>>;
}

export function buildComposeReloadSnapshot(
  ownerId: string,
  savedAt: number,
): ComposeReloadSnapshot {
  const { sessionIdByChatKey, draftsBySessionId } =
    useComposeSessionStore.getState();
  const drafts = { ...draftsBySessionId };
  // A reload must not auto-send a queued message. Return it to its draft.
  for (const [sessionId, queued] of Object.entries(
    useMessageQueueStore.getState().queuedBySessionId,
  )) {
    if (!queued) continue;
    const draft = drafts[sessionId] ?? EMPTY_COMPOSE_DRAFT;
    drafts[sessionId] = {
      message: [queued.message, draft.message].filter(Boolean).join("\n\n"),
      attachedFiles: [
        ...new Map(
          [...queued.attachedFiles, ...draft.attachedFiles].map((file) => [
            file.id,
            file,
          ]),
        ).values(),
      ],
      mentionedAssistants: [
        ...new Map(
          [...queued.mentionedAssistants, ...draft.mentionedAssistants].map(
            (mention) => [mention.id, mention],
          ),
        ).values(),
      ],
    };
  }
  // A new chat's files belong to the chat created for its upload, which the
  // page forgets on reload; sending them from a fresh chat would fail.
  const newChatSessionId = sessionIdByChatKey[NEW_CHAT_KEY];
  // A download link opens the file without a session; the snapshot can
  // outlive the session, so it keeps only the proxied preview.
  for (const [sessionId, draft] of Object.entries(drafts)) {
    if (!draft?.attachedFiles.length) continue;
    drafts[sessionId] = {
      ...draft,
      attachedFiles:
        sessionId === newChatSessionId
          ? []
          : draft.attachedFiles.map((file) => ({ ...file, download_url: "" })),
    };
  }
  return {
    version: 2,
    ownerId,
    savedAt,
    sessionIdByChatKey,
    draftsBySessionId: drafts,
    options: {
      ...restoredOptions,
      ...Object.fromEntries(
        [...activeOptions].map(([id, read]) => [id, read()]),
      ),
    },
  };
}

/** Null for anything that is not a version 2 snapshot. */
export function parseComposeReloadSnapshot(
  raw: string,
): ComposeReloadSnapshot | null {
  try {
    // Untrusted until checked: written by an earlier page, maybe an older build.
    const snapshot = JSON.parse(raw) as Record<
      keyof ComposeReloadSnapshot,
      unknown
    >;
    if (
      snapshot.version !== 2 ||
      typeof snapshot.ownerId !== "string" ||
      typeof snapshot.savedAt !== "number" ||
      typeof snapshot.sessionIdByChatKey !== "object" ||
      snapshot.sessionIdByChatKey === null ||
      typeof snapshot.draftsBySessionId !== "object" ||
      snapshot.draftsBySessionId === null
    ) {
      return null;
    }
    return {
      ...snapshot,
      options: snapshot.options ?? {},
    } as unknown as ComposeReloadSnapshot;
  } catch {
    return null;
  }
}

/**
 * Brings a snapshot's drafts back. A chat whose composer already holds text
 * keeps it. Open composers pick the drafts up through `restoreEpoch`.
 */
export function applyComposeReloadSnapshot(
  snapshot: ComposeReloadSnapshot,
): void {
  const state = useComposeSessionStore.getState();
  const sessionIdByChatKey = { ...state.sessionIdByChatKey };
  const draftsBySessionId = { ...state.draftsBySessionId };
  for (const [chatKey, sessionId] of Object.entries(
    snapshot.sessionIdByChatKey,
  )) {
    if (!sessionId) continue;
    const current = sessionIdByChatKey[chatKey];
    const currentDraft = current ? draftsBySessionId[current] : undefined;
    if (
      currentDraft &&
      (currentDraft.message ||
        currentDraft.attachedFiles.length ||
        currentDraft.mentionedAssistants.length)
    ) {
      continue;
    }
    sessionIdByChatKey[chatKey] = sessionId;
    const draft = snapshot.draftsBySessionId[sessionId];
    if (draft) draftsBySessionId[sessionId] = draft;
    const options = snapshot.options[sessionId];
    if (options) restoredOptions[sessionId] = options;
  }
  useComposeSessionStore.setState({
    sessionIdByChatKey,
    draftsBySessionId,
    restoreEpoch: state.restoreEpoch + 1,
  });
}
