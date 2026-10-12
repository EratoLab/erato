import type { ExecutorBinding } from "@erato/frontend/library";

let paneInstance: string | undefined;

export async function wordDocumentOperationBinding(
  documentIdentity: string,
  deviceId: string | undefined,
  paneId = (paneInstance ??= globalThis.crypto.randomUUID()),
): Promise<ExecutorBinding | undefined> {
  if (!deviceId || !documentIdentity) return undefined;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([documentIdentity, paneId])),
  );
  return {
    device_id: deviceId,
    realm: "office-addin",
    host_context: {
      kind: "word_document",
      identity: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    },
  };
}
