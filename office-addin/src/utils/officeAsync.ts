export interface CallOfficeAsyncOptions {
  /**
   * Reject if the Office callback has not fired within this many ms. Classic
   * Outlook Win32 was observed dropping callbacks entirely, hanging the promise
   * forever (ERMAIN-431); a timeout makes such a call fail loudly instead. Off
   * by default — most callers legitimately wait as long as the host takes.
   */
  timeoutMs?: number;
}

export function callOfficeAsync<T>(
  invoke: (callback: (result: Office.AsyncResult<T>) => void) => void,
  options?: CallOfficeAsyncOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer =
      options?.timeoutMs != null
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(
              new Error(
                `Office async call timed out after ${options.timeoutMs}ms`,
              ),
            );
          }, options.timeoutMs)
        : null;

    invoke((result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value);
        return;
      }

      reject(new Error(result.error?.message ?? "Office async call failed"));
    });
  });
}
