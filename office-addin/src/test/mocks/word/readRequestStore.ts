export function createWordReadRequestStore() {
  const empty = { currentMessageId: null as string | null, isStreaming: false };
  let state = {
    activeStreamKey: "chat-A",
    streamKeyAliases: {} as Record<string, string>,
    streams: {} as Record<string, typeof empty>,
  };
  const getState = () => ({
    ...state,
    getStreaming: (key: string) => {
      while (state.streamKeyAliases[key]) key = state.streamKeyAliases[key];
      return state.streams[key] ?? empty;
    },
  });
  const listeners = new Set<(value: ReturnType<typeof getState>) => void>();
  return {
    getState,
    subscribe: (listener: (value: ReturnType<typeof getState>) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (next: Partial<typeof state>) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener(getState());
    },
    listenerCount: () => listeners.size,
  };
}
