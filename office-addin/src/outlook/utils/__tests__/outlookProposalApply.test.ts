import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOutlookProposalExecutor,
  outlookEmailDraft,
} from "../outlookProposalApply";

import type { OutlookHostArtifact } from "../outlookClientActions";
import type { OutlookProposalBridge } from "../outlookProposalApply";
import type { ContentPart } from "@erato/frontend/library";

const office = vi.hoisted(() => ({
  openReplyForm: vi.fn(),
  openNewAppointmentForm: vi.fn(),
  appointmentSupported: true,
}));
vi.mock("../outlookReadReply", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openReplyForm: office.openReplyForm,
}));
vi.mock("../outlookCreateAppointment", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openNewAppointmentForm: office.openNewAppointmentForm,
  isCreateAppointmentSupported: () => office.appointmentSupported,
}));

const text = (value: string): ContentPart => ({
  content_type: "text",
  text: value,
});
const REPLY = "Thanks!\n\n```erato-email\nHello Ana,\n\nsee you.\n```";
const APPOINTMENT =
  '```erato-appointment\n{"subject":"Sync","start":"2026-11-25T10:00:00Z","end":"2026-11-25T10:30:00Z","attendees":["ana@example.com"]}\n```';
const artifact: OutlookHostArtifact = {
  facetId: "outlook_reply_from_read",
  renderMode: "body",
  bodyFormat: "text",
  messageId: "m1",
};

function bridge(options: {
  open?: string | null;
  sent?: string;
  answer?: string;
  latest?: boolean;
}): () => OutlookProposalBridge {
  return () => ({
    itemIdentity: () => (options.open === undefined ? "item-A" : options.open),
    message: (messageId) =>
      messageId === "m1"
        ? {
            content: [text(options.answer ?? REPLY)],
            artifact,
            sendItemIdentity: options.sent,
            latest: options.latest ?? true,
          }
        : undefined,
  });
}
const context = { toolCallId: "p1.apply", messageId: "m1", chatId: "c1" };
const input = (
  action: string,
  itemIdentity: string | null = "item-A",
): Record<string, unknown> => ({
  proposal_call_id: "p1",
  action,
  item_identity: itemIdentity,
});
const result = (answer: unknown) => (answer as { result: unknown }).result;

beforeEach(() => {
  office.openReplyForm.mockReset().mockResolvedValue(undefined);
  office.openNewAppointmentForm.mockReset().mockResolvedValue(undefined);
  office.appointmentSupported = true;
});

describe("open_reply", () => {
  it("opens the reply with the answer's draft on the email it was made for", async () => {
    const execute = createOutlookProposalExecutor("open_reply", bridge({}));
    expect(result(await execute(input("outlook.reply"), context))).toEqual({
      status: "applied",
    });
    expect(office.openReplyForm).toHaveBeenCalledWith(
      "outlook.reply",
      "Hello Ana,\n\nsee you.",
      false,
    );
  });

  it("refuses another email than the one the answer was made for", async () => {
    const execute = createOutlookProposalExecutor(
      "open_reply",
      bridge({ open: "item-B" }),
    );
    expect(result(await execute(input("outlook.reply"), context))).toEqual({
      status: "unavailable",
      reason: "other_item",
    });
    expect(office.openReplyForm).not.toHaveBeenCalled();
  });

  it("refuses when no item is known for the answer", async () => {
    const execute = createOutlookProposalExecutor("open_reply", bridge({}));
    expect(
      result(await execute(input("outlook.reply", null), context)),
    ).toEqual({ status: "unavailable", reason: "other_item" });
  });

  it("refuses when no email is open", async () => {
    const execute = createOutlookProposalExecutor(
      "open_reply",
      bridge({ open: null }),
    );
    expect(result(await execute(input("outlook.reply"), context))).toEqual({
      status: "unavailable",
      reason: "other_item",
    });
  });

  it("takes the send-time item of a running answer", async () => {
    const execute = createOutlookProposalExecutor(
      "open_reply",
      bridge({ sent: "item-A" }),
    );
    expect(
      result(await execute(input("outlook.reply", null), context)),
    ).toEqual({ status: "applied" });
  });

  it("acts only for the latest answer", async () => {
    const execute = createOutlookProposalExecutor(
      "open_reply",
      bridge({ latest: false }),
    );
    expect(result(await execute(input("outlook.reply"), context))).toEqual({
      status: "unavailable",
      reason: "not_latest",
    });
  });

  it("says so when the answer has no draft", async () => {
    const execute = createOutlookProposalExecutor(
      "open_reply",
      bridge({ answer: "Some prose.\n\n```python\nx = 1\n```" }),
    );
    expect(result(await execute(input("outlook.reply"), context))).toEqual({
      status: "failed",
      reason: "not_found",
    });
  });

  it("opens the form once for a call sent again", async () => {
    const execute = createOutlookProposalExecutor("open_reply", bridge({}));
    await execute(input("outlook.reply"), context);
    await execute(input("outlook.reply"), context);
    expect(office.openReplyForm).toHaveBeenCalledTimes(1);
  });

  it("refuses an action that is not its own", async () => {
    const execute = createOutlookProposalExecutor("open_reply", bridge({}));
    expect(
      result(await execute(input("outlook.reply_all"), context)),
    ).toMatchObject({ status: "failed", reason: "invalid_input" });
  });
});

describe("open_reply_all", () => {
  it("opens reply all on the same email", async () => {
    const execute = createOutlookProposalExecutor("open_reply_all", bridge({}));
    expect(result(await execute(input("outlook.reply_all"), context))).toEqual({
      status: "applied",
    });
    expect(office.openReplyForm).toHaveBeenCalledWith(
      "outlook.reply_all",
      expect.any(String),
      false,
    );
  });

  it("refuses another email", async () => {
    const execute = createOutlookProposalExecutor(
      "open_reply_all",
      bridge({ open: "item-B" }),
    );
    expect(result(await execute(input("outlook.reply_all"), context))).toEqual({
      status: "unavailable",
      reason: "other_item",
    });
  });
});

describe("open_appointment", () => {
  it("opens the appointment from the answer on any open item", async () => {
    const execute = createOutlookProposalExecutor(
      "open_appointment",
      bridge({ open: "item-B", answer: APPOINTMENT }),
    );
    expect(
      result(await execute(input("outlook.create_appointment"), context)),
    ).toEqual({ status: "applied" });
    expect(office.openNewAppointmentForm).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Sync" }),
    );
  });

  it("refuses where the host cannot open the form", async () => {
    office.appointmentSupported = false;
    const execute = createOutlookProposalExecutor(
      "open_appointment",
      bridge({ answer: APPOINTMENT }),
    );
    expect(
      result(await execute(input("outlook.create_appointment"), context)),
    ).toEqual({ status: "unavailable", reason: "not_supported" });
  });
});

describe("the email draft", () => {
  it("takes the whole answer when the model wrote no fence", () => {
    expect(outlookEmailDraft([text("Hello Ana")], artifact)).toEqual({
      content: "Hello Ana",
      isHtml: false,
    });
  });

  it("does not guess between two drafts", () => {
    expect(
      outlookEmailDraft(
        [text("```erato-email\nA\n```\n```erato-email\nB\n```")],
        artifact,
      ),
    ).toEqual({ missing: "ambiguous" });
  });
});
