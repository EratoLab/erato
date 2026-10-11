/** Office.js work cannot be cancelled; the timeout only stops the caller from waiting on it. */
export function withWordTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
