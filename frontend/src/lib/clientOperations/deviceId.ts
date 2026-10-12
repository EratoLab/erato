const STORAGE_KEY = "erato.clientOperations.deviceId";
const VALID_DEVICE_ID = /^[A-Za-z0-9_-]{16,128}$/;

/** Per-origin routing id for client-asserted executor bindings. Without
 * storage there is no stable id, so callers advertise no binding at all. */
export function clientOperationDeviceId(): string | undefined {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    if (stored !== null && VALID_DEVICE_ID.test(stored)) return stored;
    const id = globalThis.crypto.randomUUID();
    globalThis.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return undefined;
  }
}
