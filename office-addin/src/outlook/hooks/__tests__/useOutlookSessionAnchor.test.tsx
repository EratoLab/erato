import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook is a pure derivation over the mail-item context, so the provider is
// mocked wholesale — that keeps the test off Office.js and lets each case state
// the exact host situation it describes.
const mockUseOutlookMailItem = vi.fn();

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

import { useOutlookSessionAnchor } from "../useOutlookSessionAnchor";

import type { OutlookMailItemData } from "../../providers/OutlookMailItemProvider";
import type { OutlookSelectedConversation } from "../../sessionPolicy";

const ANCHOR_DEBOUNCE_MS = 400;

const SELECTED_CONVERSATION: OutlookSelectedConversation = {
  conversationId: "conv-1",
  itemId: "item-newest",
  messageCount: 4,
};

function makeMailItem(
  overrides: Partial<OutlookMailItemData> = {},
): OutlookMailItemData {
  return {
    itemKind: "message",
    subject: "Project kickoff",
    from: { displayName: "Sender", emailAddress: "sender@x" },
    to: [],
    cc: [],
    organizer: null,
    requiredAttendees: [],
    optionalAttendees: [],
    location: "",
    start: null,
    end: null,
    dateTimeCreated: null,
    conversationId: "conv-live",
    internetMessageId: "<m1@x>",
    itemId: "item-live",
    bodyText: "body",
    bodyHtml: null,
    isLoadingBody: false,
    isComposeMode: false,
    ...overrides,
  };
}

/**
 * One stable context object per call: the hook's `useMemo` and the debounce
 * effect both compare by reference, so handing back a fresh object on every
 * render would look like a stream of real changes.
 */
function setContext(context: {
  itemIdentity?: string | null;
  mailItem?: OutlookMailItemData | null;
  selectedConversation?: OutlookSelectedConversation | null;
  isLoading?: boolean;
}) {
  mockUseOutlookMailItem.mockReturnValue({
    itemIdentity: null,
    mailItem: null,
    selectedConversation: null,
    isLoading: false,
    ...context,
  });
}

describe("useOutlookSessionAnchor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mockUseOutlookMailItem.mockReset();
  });

  it("anchors on the selected conversation when the host reports no item", () => {
    setContext({ selectedConversation: SELECTED_CONVERSATION });

    const { result } = renderHook(() => useOutlookSessionAnchor());

    expect(result.current).toEqual({
      conversationId: "conv-1",
      isCompose: false,
    });
    // Nothing here names a single message, so item-bound executors (reply)
    // must keep failing closed — no identity may be minted for a header click.
    expect(result.current?.itemIdentity ?? null).toBeNull();
    // Omitting `itemKind` is what lets `strictAnchorsEqual` compare a header
    // click equal to the message anchor of the thread already being read.
    expect(result.current?.itemKind).toBeUndefined();
  });

  it("returns null with neither an item nor a selection", () => {
    setContext({});

    const { result } = renderHook(() => useOutlookSessionAnchor());

    expect(result.current).toBeNull();
  });

  it("returns null while the provider is loading, selection or not", () => {
    setContext({
      isLoading: true,
      selectedConversation: SELECTED_CONVERSATION,
    });

    const { result } = renderHook(() => useOutlookSessionAnchor());

    expect(result.current).toBeNull();
  });

  it("prefers a live item over a selection", () => {
    setContext({
      mailItem: makeMailItem(),
      selectedConversation: SELECTED_CONVERSATION,
    });

    const { result } = renderHook(() => useOutlookSessionAnchor());

    expect(result.current).toEqual({
      conversationId: "conv-live",
      isCompose: false,
      itemKind: "message",
    });
  });

  it("switches from the open message to the conversation on a header click", () => {
    setContext({ isLoading: true });

    const { result, rerender } = renderHook(() => useOutlookSessionAnchor());

    // Cold open lands the message on the leading edge, so the header click
    // that follows is a genuinely debounced transition.
    setContext({ mailItem: makeMailItem() });
    rerender();
    expect(result.current).toEqual({
      conversationId: "conv-live",
      isCompose: false,
      itemKind: "message",
    });

    setContext({ selectedConversation: SELECTED_CONVERSATION });
    rerender();
    expect(result.current).toEqual({
      conversationId: "conv-live",
      isCompose: false,
      itemKind: "message",
    });

    act(() => {
      vi.advanceTimersByTime(ANCHOR_DEBOUNCE_MS);
    });

    expect(result.current).toEqual({
      conversationId: "conv-1",
      isCompose: false,
    });
  });
});
