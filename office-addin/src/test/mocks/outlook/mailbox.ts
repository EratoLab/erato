import { vi } from "vitest";

import { createMockAsyncResult } from "../../helpers/asyncResult";

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
    getSelectedItemsAsync: vi.fn((callback: (result: unknown) => void) =>
      callback(createMockAsyncResult([])),
    ),
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

/**
 * Installs the requirement-set probe that gates multi-select reads, answering
 * "supported" for every set. The shared setup file deliberately leaves
 * `Office.context.requirements` undefined so the default suite keeps modelling
 * an Exchange SE host, which caps well below the sets multi-select needs —
 * install this only in tests that exercise the modern-host path.
 */
export function installMultiSelectSupport() {
  (Office.context as unknown as Record<string, unknown>).requirements = {
    isSetSupported: vi.fn(() => true),
  };
}

/**
 * Removes the requirement-set probe, restoring the Exchange SE shape.
 * Call in `afterEach`.
 */
export function uninstallMultiSelectSupport() {
  delete (Office.context as unknown as Record<string, unknown>).requirements;
}
