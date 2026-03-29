import { vi } from "vitest";

/**
 * Installs Outlook-specific stubs: `Office.MailboxEnums` and `Office.context.mailbox`.
 * Call in `beforeEach` for tests that depend on Outlook mailbox context.
 * Returns the mailbox object so tests can set `.item` directly.
 */
export function installMockMailbox() {
  const office = Office as unknown as Record<string, unknown>;

  office.MailboxEnums = {
    AttachmentContentFormat: {
      Base64: "base64",
      Eml: "eml",
      ICalendar: "iCalendar",
      Url: "url",
    },
    ItemType: {
      Message: "message",
      Appointment: "appointment",
    },
  };

  const mailbox = {
    item: null as unknown,
    addHandlerAsync: vi.fn(
      (
        _eventType: unknown,
        _handler: unknown,
        callback?: (result: unknown) => void,
      ) => {
        callback?.({ status: Office.AsyncResultStatus.Succeeded });
      },
    ),
    removeHandlerAsync: vi.fn(
      (_eventType: unknown, callback?: (result: unknown) => void) => {
        callback?.({ status: Office.AsyncResultStatus.Succeeded });
      },
    ),
  };

  (Office.context as unknown as Record<string, unknown>).mailbox = mailbox;

  return mailbox;
}

/**
 * Removes Outlook-specific stubs to restore a clean shared state.
 * Call in `afterEach`.
 */
export function uninstallMockMailbox() {
  const office = Office as unknown as Record<string, unknown>;
  delete office.MailboxEnums;
  delete (Office.context as unknown as Record<string, unknown>).mailbox;
}
