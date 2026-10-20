import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildThreadGroup } from "../buildThreadGroup";

import type { StagedThread, ThreadPartVerdicts } from "../buildThreadGroup";
import type { StagedPartValidation } from "../validateStagedPart";

const attachment = (
  id: string,
  filename: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  filename,
  mimeType: "application/octet-stream",
  size: 10,
  contentBytes: null,
  isInline: false,
  contentId: null,
  unavailableReason: null,
  ...extra,
});

const message = (
  id: string,
  attachments: ReturnType<typeof attachment>[],
  date: string | null = null,
) => ({
  id,
  internetMessageId: id,
  subject: "Kickoff",
  from: { name: "Anna", address: "anna@example.com" },
  to: [],
  cc: [],
  date,
  bodyText: "hi",
  bodyHtml: null,
  attachments,
});

function staged(
  dismissedMessageIds: string[] = ["m1"],
  dismissedAttachmentIds: string[] = ["a2"],
): StagedThread {
  return {
    key: "current-thread:conv-1",
    source: "current-thread",
    thread: {
      conversationId: "conv-1",
      subject: "Kickoff",
      incomplete: false,
      messages: [
        message("m1", [
          attachment("a1", "plan.pdf"),
          attachment("a2", "notes.pdf"),
          attachment("a3", "setup.exe"),
          attachment("a4", "logo.png", { isInline: true }),
          attachment("a5", "budget.pdf"),
        ]),
        message("m2", [], new Date(2026, 9, 6, 9, 14).toISOString()),
      ],
    },
    dismissedMessageIds: new Set(dismissedMessageIds),
    dismissedAttachmentIds: new Set(dismissedAttachmentIds),
  };
}

const excluded: StagedPartValidation = {
  ok: false,
  verdict: "unsupported",
  reason: "Won't be read by the AI",
};

const verdicts: ThreadPartVerdicts = new Map([
  ["m1", new Map([["a3", excluded]])],
]);

const handlers = () => ({
  dismissMessage: vi.fn(),
  restoreMessage: vi.fn(),
  dismissAttachment: vi.fn(),
  restoreAttachment: vi.fn(),
});

function firstMessage(group: ReturnType<typeof buildThreadGroup>) {
  const first = group.items[0];
  if (first?.kind !== "threadMessageGroup") {
    throw new Error("expected a thread message");
  }
  return first;
}

describe("buildThreadGroup", () => {
  beforeEach(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

  it("counts the messages, keeps every card open and reads an unticked message's attachments unticked", () => {
    const group = buildThreadGroup({
      staged: staged(),
      verdicts,
      metaLabel: "1.2 MB of 25 MB",
      handlers: handlers(),
    });

    expect(group.label).toBe("2 messages");
    expect(group.metaLabel).toBe("1.2 MB of 25 MB");
    expect(group).not.toHaveProperty("collapsible");
    const card = firstMessage(group);
    expect(card.selected).toBe(false);
    expect(card.defaultCollapsed).toBe(false);
    expect(card.attachments.map((entry) => entry.id)).toEqual([
      "a1",
      "a2",
      "a3",
      "a5",
    ]);
    expect(card.attachments.every((entry) => entry.selected === false)).toBe(
      true,
    );
    // Policy-excluded parts stay read-only.
    expect(card.attachments[2]?.onToggle).toBeUndefined();
  });

  it("dates a message in the app's language", () => {
    const group = buildThreadGroup({
      staged: staged(),
      verdicts,
      metaLabel: "",
      handlers: handlers(),
    });
    const second = group.items[1];
    expect(second?.kind === "threadMessageGroup" && second.sublabel).toMatch(
      /^Oct 6, 2026, 9:14\sAM · Kickoff$/u,
    );

    i18n.loadAndActivate({ locale: "de", messages: {} });
    const german = buildThreadGroup({
      staged: staged(),
      verdicts,
      metaLabel: "",
      handlers: handlers(),
    }).items[1];
    expect(german?.kind === "threadMessageGroup" && german.sublabel).toBe(
      "06.10.2026, 09:14 · Kickoff",
    );
  });

  it("brings the message back with only the ticked attachment", () => {
    const calls = handlers();
    const group = buildThreadGroup({
      staged: staged(),
      verdicts,
      metaLabel: "",
      handlers: calls,
    });

    firstMessage(group).attachments[0]?.onToggle?.();

    expect(calls.restoreMessage).toHaveBeenCalledWith("m1");
    expect(calls.restoreAttachment).not.toHaveBeenCalled();
    expect(calls.dismissAttachment.mock.calls).toEqual([["m1", "a5"]]);
  });

  it("restores a dismissed attachment it ticks and holds back the rest", () => {
    const calls = handlers();
    const group = buildThreadGroup({
      staged: staged(),
      verdicts,
      metaLabel: "",
      handlers: calls,
    });

    firstMessage(group).attachments[1]?.onToggle?.();

    expect(calls.restoreMessage).toHaveBeenCalledWith("m1");
    expect(calls.restoreAttachment).toHaveBeenCalledWith("m1", "a2");
    expect(calls.dismissAttachment.mock.calls).toEqual([
      ["m1", "a1"],
      ["m1", "a5"],
    ]);
  });

  it("toggles a ticked message and its attachments one by one", () => {
    const calls = handlers();
    const group = buildThreadGroup({
      staged: staged([], []),
      verdicts,
      metaLabel: "",
      handlers: calls,
    });
    const card = firstMessage(group);

    card.onToggle?.();
    card.attachments[0]?.onToggle?.();

    expect(calls.dismissMessage).toHaveBeenCalledWith("m1");
    expect(calls.dismissAttachment).toHaveBeenCalledWith("m1", "a1");
  });
});
