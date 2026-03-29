/**
 * Creates a mock Office.AsyncResult for use in test callbacks.
 */
export function createMockAsyncResult<T>(
  value: T,
  status: "succeeded" | "failed" = "succeeded",
  error?: { message: string; code: string },
): Office.AsyncResult<T> {
  return {
    value,
    status:
      status === "succeeded"
        ? Office.AsyncResultStatus.Succeeded
        : Office.AsyncResultStatus.Failed,
    error: error ?? null,
    asyncContext: undefined,
    diagnostics: undefined,
  } as unknown as Office.AsyncResult<T>;
}
