import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutlookAddinSessionController } from "../OutlookAddinSessionController";
import {
  holdSessionPolicy,
  isSessionPolicyHeld,
  releaseSessionPolicy,
} from "../sessionPolicy";

import type { AddinSessionController } from "../../core/AddinChatProviderCore";

const spies = vi.hoisted(() => ({
  selectAction: vi.fn(),
  showToast: vi.fn(),
  dismissToasts: vi.fn(),
  anchor: { current: null as { itemKey: string } | null },
}));

vi.mock("@erato/frontend/library", async () => {
  const { useState } = await import("react");
  return {
    selectAddinSessionAction: spies.selectAction,
    useMessagingStore: Object.assign(() => ({}), {
      getState: () => ({
        abortActiveSSE: vi.fn(),
        clearUserMessages: vi.fn(),
        resetStreaming: vi.fn(),
      }),
    }),
    usePersistedState: <T,>(_key: string, initialValue: T) =>
      useState(initialValue),
  };
});

vi.mock("../components/sessionAskToast", () => ({
  showSessionAskToast: spies.showToast,
  dismissSessionToasts: spies.dismissToasts,
}));

vi.mock("../hooks/useOutlookSessionAnchor", () => ({
  useOutlookSessionAnchor: () => spies.anchor.current,
}));

const ANCHOR_A = { itemKey: "mail-a" };
const ANCHOR_B = { itemKey: "mail-b" };
const ANCHOR_C = { itemKey: "mail-c" };

const captured: { current: AddinSessionController | null } = { current: null };

function Harness({ anchor }: { anchor: { itemKey: string } | null }) {
  spies.anchor.current = anchor;
  return (
    <OutlookAddinSessionController chats={[]}>
      {(controller) => {
        captured.current = controller;
        return null;
      }}
    </OutlookAddinSessionController>
  );
}

describe("OutlookAddinSessionController policy gate", () => {
  // Without cleanup, harnesses from earlier tests stay mounted and
  // re-evaluate the policy whenever the shared gate notifies.
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    captured.current = null;
    spies.anchor.current = null;
    spies.selectAction.mockReturnValue({ kind: "ask", suggestedChatId: null });
    while (isSessionPolicyHeld()) {
      releaseSessionPolicy();
    }
  });

  it("defers anchor changes while held and evaluates exactly once on release", () => {
    const { rerender } = render(<Harness anchor={ANCHOR_A} />);
    expect(spies.selectAction).toHaveBeenCalledTimes(1);

    act(() => holdSessionPolicy());
    rerender(<Harness anchor={ANCHOR_B} />);
    rerender(<Harness anchor={ANCHOR_C} />);
    // Intermediate flickers collapse: nothing was evaluated during the hold.
    expect(spies.selectAction).toHaveBeenCalledTimes(1);

    act(() => releaseSessionPolicy());
    expect(spies.selectAction).toHaveBeenCalledTimes(2);
    // The deferred evaluation sees the pre-hold anchor as `previous`: the
    // ref never moved while the gate was held.
    expect(spies.selectAction.mock.calls[1]?.[0]).toMatchObject({
      trigger: {
        kind: "context-change",
        previous: ANCHOR_A,
        next: ANCHOR_C,
      },
      currentAnchor: ANCHOR_C,
    });
  });

  it("lets an explicit pick during the hold win silently", () => {
    const { rerender } = render(<Harness anchor={ANCHOR_A} />);
    expect(spies.showToast).toHaveBeenCalledTimes(1);

    act(() => holdSessionPolicy());
    rerender(<Harness anchor={ANCHOR_B} />);
    act(() => captured.current?.selectChat("chat-9"));
    expect(spies.dismissToasts).toHaveBeenCalled();

    // The pick re-anchored the saved session, so the deferred evaluation
    // resolves as a same-context resume — no second toast.
    spies.selectAction.mockReturnValue({ kind: "resume", chatId: "chat-9" });
    act(() => releaseSessionPolicy());

    expect(spies.showToast).toHaveBeenCalledTimes(1);
    expect(spies.selectAction.mock.calls.at(-1)?.[0]).toMatchObject({
      saved: { chatId: "chat-9", anchor: ANCHOR_B },
    });
  });

  it("dismisses pending session toasts on any explicit decision", () => {
    render(<Harness anchor={ANCHOR_A} />);
    spies.dismissToasts.mockClear();

    act(() => captured.current?.selectChat("chat-1"));
    expect(spies.dismissToasts).toHaveBeenCalledTimes(1);

    act(() => captured.current?.beginNewChat());
    expect(spies.dismissToasts).toHaveBeenCalledTimes(2);
  });

  // The drawer dismisses a pending ask toast the moment it opens. That is
  // only safe because a hold released with an unchanged anchor and no pick
  // re-evaluates the policy, which shows the still-unanswered ask again.
  it("re-shows a still-unanswered ask after a hold with an unchanged anchor", () => {
    render(<Harness anchor={ANCHOR_A} />);
    expect(spies.showToast).toHaveBeenCalledTimes(1);

    act(() => holdSessionPolicy());
    act(() => releaseSessionPolicy());

    expect(spies.showToast).toHaveBeenCalledTimes(2);
  });
});
