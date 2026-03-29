import { vi } from "vitest";

/**
 * Creates a minimal mock Office.MessageRead item.
 * Extend with additional properties as tests require them.
 */
export function createMockMessageRead(
  overrides: Partial<{
    subject: string;
    from: { displayName: string; emailAddress: string } | null;
    to: Office.EmailAddressDetails[];
    cc: Office.EmailAddressDetails[];
    dateTimeCreated: Date | null;
    conversationId: string | null;
    internetMessageId: string | null;
    attachments: Office.AttachmentDetails[];
    body: { getAsync: ReturnType<typeof vi.fn> };
  }> = {},
) {
  return {
    // In read mode, subject is a plain string (this is the compose vs read discriminator)
    subject: overrides.subject ?? "Test Subject",
    from: overrides.from ?? {
      displayName: "Test Sender",
      emailAddress: "sender@example.com",
    },
    to: overrides.to ?? [],
    cc: overrides.cc ?? [],
    dateTimeCreated: overrides.dateTimeCreated ?? new Date("2026-01-01"),
    conversationId: overrides.conversationId ?? "mock-conversation-id",
    internetMessageId:
      overrides.internetMessageId ?? "mock-internet-message-id",
    attachments: overrides.attachments ?? [],
    body: overrides.body ?? { getAsync: vi.fn() },
  };
}
