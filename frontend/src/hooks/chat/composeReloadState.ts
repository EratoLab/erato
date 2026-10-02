import {
  EMPTY_COMPOSE_DRAFT,
  useComposeSessionStore,
} from "./store/composeSessionStore";
import { useMessageQueueStore } from "./store/messageQueueStore";

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

/** Explicit, one-reload snapshot for hosts whose consent flow reloads the pane. */
export function saveComposeReloadState(storage: Storage, key: string): void {
  if (reloadHolds.size > 0) {
    const error = new Error(
      "Pending local attachments prevent composer reload",
    );
    // eslint-disable-next-line lingui/no-unlocalized-strings -- internal error code, translated by the host
    error.name = "ComposeReloadBlockedError";
    throw error;
  }
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
  // Do not swallow quota/security errors: the host must not reload if saving fails.
  const options = {
    ...restoredOptions,
    ...Object.fromEntries([...activeOptions].map(([id, read]) => [id, read()])),
  };
  storage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionIdByChatKey,
      draftsBySessionId: drafts,
      options,
    }),
  );
}

export function restoreComposeReloadState(storage: Storage, key: string): void {
  const raw = storage.getItem(key);
  if (!raw) return;
  const snapshot = JSON.parse(raw) as {
    version: number;
    options?: typeof restoredOptions;
    sessionIdByChatKey?: ReturnType<
      typeof useComposeSessionStore.getState
    >["sessionIdByChatKey"];
    draftsBySessionId?: ReturnType<
      typeof useComposeSessionStore.getState
    >["draftsBySessionId"];
  };
  if (
    snapshot.version !== 1 ||
    !snapshot.sessionIdByChatKey ||
    !snapshot.draftsBySessionId
  ) {
    throw new Error("Invalid composer reload snapshot");
  }
  useComposeSessionStore.setState({
    sessionIdByChatKey: snapshot.sessionIdByChatKey,
    draftsBySessionId: snapshot.draftsBySessionId,
  });
  restoredOptions = snapshot.options ?? {};
  storage.removeItem(key);
}
