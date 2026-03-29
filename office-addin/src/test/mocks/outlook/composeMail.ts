import { vi } from "vitest";

/**
 * Creates a minimal mock Office.MessageCompose item.
 * Extend with additional methods as tests require them.
 */
export function createMockMessageCompose(
  overrides: Partial<{
    conversationId: string | null;
    subject: { getAsync: ReturnType<typeof vi.fn> };
    to: { getAsync: ReturnType<typeof vi.fn> };
    cc: { getAsync: ReturnType<typeof vi.fn> };
    body: {
      getAsync: ReturnType<typeof vi.fn>;
      getTypeAsync: ReturnType<typeof vi.fn>;
      setSelectedDataAsync: ReturnType<typeof vi.fn>;
      prependAsync: ReturnType<typeof vi.fn>;
    };
    getSelectedDataAsync: ReturnType<typeof vi.fn>;
    getAttachmentsAsync: ReturnType<typeof vi.fn>;
    addHandlerAsync: ReturnType<typeof vi.fn>;
    removeHandlerAsync: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    conversationId: overrides.conversationId ?? "mock-conversation-id",
    subject: overrides.subject ?? { getAsync: vi.fn() },
    to: overrides.to ?? { getAsync: vi.fn() },
    cc: overrides.cc ?? { getAsync: vi.fn() },
    body: overrides.body ?? {
      getAsync: vi.fn(),
      getTypeAsync: vi.fn(),
      setSelectedDataAsync: vi.fn(),
      prependAsync: vi.fn(),
    },
    getSelectedDataAsync: overrides.getSelectedDataAsync ?? vi.fn(),
    getAttachmentsAsync: overrides.getAttachmentsAsync ?? vi.fn(),
    addHandlerAsync: overrides.addHandlerAsync ?? vi.fn(),
    removeHandlerAsync: overrides.removeHandlerAsync ?? vi.fn(),
  };
}
