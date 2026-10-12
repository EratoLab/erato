/**
 * Runs `run` unless another pane or tab of this browser already holds the
 * same client call. Panes share one device id, so the server would hand them
 * the same claim; this keeps a stored call from executing twice. Without Web
 * Locks every context runs, as before.
 */
export async function withClientCallLock(
  messageId: string,
  toolCallId: string,
  run: () => Promise<void>,
): Promise<boolean> {
  const locks = globalThis.navigator.locks as LockManager | undefined;
  if (!locks) {
    await run();
    return true;
  }
  return locks.request(
    `erato.client-call:${messageId}:${toolCallId}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return false;
      await run();
      return true;
    },
  );
}
