export function callOfficeAsync<T>(
  invoke: (callback: (result: Office.AsyncResult<T>) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value);
        return;
      }

      reject(new Error(result.error?.message ?? "Office async call failed"));
    });
  });
}
