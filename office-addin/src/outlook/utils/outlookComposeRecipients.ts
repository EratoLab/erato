import { callOfficeAsync } from "../../utils/officeAsync";

export interface ComposeRecipient {
  displayName: string;
  emailAddress: string;
}

export interface ComposeRecipients {
  to?: ComposeRecipient[];
  cc?: ComposeRecipient[];
  bcc?: ComposeRecipient[];
}

/** Mailbox 1.1. Read live fields at send time; a failed field stays unknown. */
export async function readComposeRecipients(
  item: Office.MessageCompose,
): Promise<ComposeRecipients | undefined> {
  const entries = await Promise.all(
    (["to", "cc", "bcc"] as const).map(async (role) => {
      const field = item[role];
      if (typeof field?.getAsync !== "function") return null;
      try {
        const recipients = await callOfficeAsync<Office.EmailAddressDetails[]>(
          (callback) => field.getAsync(callback),
          { timeoutMs: 2000 },
        );
        return [
          role,
          recipients.map(({ displayName, emailAddress }) => ({
            displayName,
            emailAddress,
          })),
        ] as const;
      } catch {
        return null;
      }
    }),
  );
  const knownFields = entries.filter((entry) => entry !== null);
  return knownFields.length > 0 ? Object.fromEntries(knownFields) : undefined;
}

/** Stay within the backend's 64 KiB per-argument limit. */
export function serializeComposeRecipients(
  recipients: ComposeRecipients | undefined,
): string | undefined {
  if (!recipients) return undefined;
  const serialized = JSON.stringify(recipients);
  return new TextEncoder().encode(serialized).byteLength <= 64 * 1024
    ? serialized
    : undefined;
}
