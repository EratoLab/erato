import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildDropEmailGroup, isEmailBodyPart } from "../buildDropEmailGroup";
import { parseEmlBytes } from "../parsedEmail";

import type {
  DropEmailGroupOptions,
  StagedDropEmail,
} from "../buildDropEmailGroup";
import type { ParsedEmail } from "../parsedEmail";
import type { StagedPartValidation } from "../validateStagedPart";
import type { FileAttachmentGroupItem } from "@erato/frontend/library";

const CRLF = "\r\n";

/** `top.pdf` plus a forwarded email carrying `deep.pdf` and an inline logo. */
function buildEmailWithForward(
  options: {
    forwardDisposition?: string;
    encodeForward?: boolean;
  } = {},
): string {
  const inner =
    `From: Carla <c@example.com>${CRLF}` +
    `Date: Mon, 2 Mar 2026 10:00:00 +0000${CRLF}` +
    `Subject: Re: budget numbers${CRLF}` +
    `Content-Type: multipart/mixed; boundary="----INNER"${CRLF}${CRLF}` +
    `------INNER${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}` +
    `Forwarded body.${CRLF}` +
    `------INNER${CRLF}` +
    `Content-Type: application/pdf; name="deep.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="deep.pdf"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `REVFUA==${CRLF}` +
    `------INNER${CRLF}` +
    `Content-Type: image/png; name="logo.png"${CRLF}` +
    `Content-Disposition: inline; filename="logo.png"${CRLF}` +
    `Content-ID: <logo@x>${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `UE5H${CRLF}` +
    `------INNER--${CRLF}`;
  const forwardHeaders =
    `Content-Type: message/rfc822${CRLF}` +
    (options.forwardDisposition
      ? `Content-Disposition: ${options.forwardDisposition}${CRLF}`
      : "") +
    (options.encodeForward ? `Content-Transfer-Encoding: base64${CRLF}` : "");
  return (
    `From: Anna <a@example.com>${CRLF}` +
    `Subject: Cover note${CRLF}` +
    `Content-Type: multipart/mixed; boundary="----OUTER"${CRLF}${CRLF}` +
    `------OUTER${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}` +
    `See attached.${CRLF}` +
    `------OUTER${CRLF}` +
    `Content-Type: application/pdf; name="top.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="top.pdf"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `VE9Q${CRLF}` +
    `------OUTER${CRLF}` +
    `${forwardHeaders}${CRLF}` +
    (options.encodeForward ? btoa(inner) : inner) +
    `${CRLF}------OUTER--${CRLF}`
  );
}

async function parseFixture(
  options: Parameters<typeof buildEmailWithForward>[0] = {},
): Promise<ParsedEmail> {
  const parsed = await parseEmlBytes(
    new TextEncoder().encode(buildEmailWithForward(options)).buffer,
    { filename: "cover.eml" },
  );
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
}

function stagedDrop(
  parsed: ParsedEmail,
  dismissed: string[] = [],
  bodyDismissed = false,
): StagedDropEmail {
  return {
    key: "drop-1",
    parsed,
    bodyDismissed,
    dismissedAttachmentIds: new Set(dismissed),
  };
}

type FixedOptions = Pick<
  DropEmailGroupOptions,
  "resolvedSize" | "bodyMetaLabel" | "verdicts" | "fallbackSubject"
>;

function makeOptions(overrides: Partial<FixedOptions> = {}) {
  return {
    fallbackSubject: "",
    dismissBody: vi.fn<() => void>(),
    restoreBody: vi.fn<() => void>(),
    dismissAttachment: vi.fn<(attachmentId: string) => void>(),
    restoreAttachment: vi.fn<(attachmentId: string) => void>(),
    ...overrides,
  };
}

/** The rows are built from parsed parts, so the file is always the item shape. */
function fileOf(item: { file: unknown }) {
  return item.file as { id: string; filename: string; size: number };
}

const UNSUPPORTED: StagedPartValidation = {
  ok: false,
  verdict: "unsupported",
  reason: "Won't be read by the AI",
};
const TOO_LARGE: StagedPartValidation = {
  ok: false,
  verdict: "too-large",
  reason: "File exceeds the server limit of 1 KB",
};

function forwardCard(items: FileAttachmentGroupItem[]) {
  const card = items.find((item) => item.kind === "threadMessageGroup");
  if (!card || card.kind !== "threadMessageGroup") {
    throw new Error("no nested card rendered");
  }
  return card;
}

beforeAll(() => {
  i18n.activate("en");
});

describe("buildDropEmailGroup", () => {
  it("renders the body row, the flat attachment rows, and the forward as a nested card", async () => {
    const parsed = await parseFixture();
    const group = buildDropEmailGroup(
      stagedDrop(parsed),
      makeOptions({ resolvedSize: 123, bodyMetaLabel: "Updating…" }),
    );

    expect(group.id).toBe("staged-email:drop-1");
    expect(group.label).toBe("Cover note");
    expect(group.metaLabel).toBe("Anna");
    expect(group.items.map((item) => [item.kind, item.id])).toEqual([
      ["selectableAttachment", "drop-1:body"],
      ["selectableAttachment", "drop-1:att-0"],
      ["threadMessageGroup", "drop-1:att-1"],
    ]);
    const body = group.items[0];
    expect(body.kind === "selectableAttachment" && fileOf(body).size).toBe(123);
    expect(body.kind === "selectableAttachment" && body.metaLabel).toBe(
      "Updating…",
    );

    const card = forwardCard(group.items);
    expect(card.label).toBe("Re: budget numbers");
    expect(card.sublabel).toContain("Carla");
    expect(card.selected).toBe(true);
    expect(card.defaultCollapsed).toBe(true);
    expect(
      card.attachments.map((row) => [
        row.id,
        fileOf(row).filename,
        row.selected,
        typeof row.onToggle,
      ]),
    ).toEqual([
      ["drop-1:att-1/att-0", "deep.pdf", true, "function"],
      // Part of the forwarded body: shown, always sent, no checkbox.
      ["drop-1:att-1/att-1", "logo.png", true, "undefined"],
    ]);
  });

  it("dismisses and restores by the path id of the row, and the forward by its own id", async () => {
    const parsed = await parseFixture();
    const options = makeOptions();

    const live = forwardCard(
      buildDropEmailGroup(stagedDrop(parsed), options).items,
    );
    live.attachments[0].onToggle?.();
    expect(options.dismissAttachment).toHaveBeenCalledWith("att-1/att-0");
    live.onToggle?.();
    expect(options.dismissAttachment).toHaveBeenCalledWith("att-1");

    const dismissed = forwardCard(
      buildDropEmailGroup(stagedDrop(parsed, ["att-1/att-0", "att-1"]), options)
        .items,
    );
    expect(dismissed.selected).toBe(false);
    expect(dismissed.attachments[0].selected).toBe(false);
    dismissed.attachments[0].onToggle?.();
    expect(options.restoreAttachment).toHaveBeenCalledWith("att-1/att-0");
    dismissed.onToggle?.();
    expect(options.restoreAttachment).toHaveBeenCalledWith("att-1");
  });

  it("keeps an inline-disposed forward a dismissable card rather than a read-only body part", async () => {
    const parsed = await parseFixture({ forwardDisposition: "inline" });
    expect(parsed.attachments[1].disposition).toBe("inline");
    expect(isEmailBodyPart(parsed.attachments[1])).toBe(false);

    const card = forwardCard(
      buildDropEmailGroup(stagedDrop(parsed), makeOptions()).items,
    );
    expect(card.onToggle).toBeTypeOf("function");
  });

  it("makes the rows of a transfer-encoded forward read-only: it goes whole or not at all", async () => {
    const parsed = await parseFixture({ encodeForward: true });
    expect(parsed.attachments[1].nestedTrimmable).toBe(false);

    const card = forwardCard(
      buildDropEmailGroup(
        stagedDrop(parsed),
        makeOptions({
          verdicts: new Map([["att-1/att-0", TOO_LARGE]]),
        }),
      ).items,
    );
    expect(card.onToggle).toBeTypeOf("function");
    expect(fileOf(card.attachments[0]).filename).toBe("deep.pdf");
    expect(card.attachments[0].onToggle).toBeUndefined();
    // The badge still tells the user what is inside.
    expect(card.attachments[0].validation).toBe(TOO_LARGE);
  });

  it("locks the card and its rows when policy excludes the forward, and a row when policy excludes it", async () => {
    const parsed = await parseFixture();

    const excludedForward = forwardCard(
      buildDropEmailGroup(
        stagedDrop(parsed),
        makeOptions({ verdicts: new Map([["att-1", UNSUPPORTED]]) }),
      ).items,
    );
    expect(excludedForward.validation).toBe(UNSUPPORTED);
    expect(excludedForward.onToggle).toBeUndefined();
    expect(excludedForward.attachments[0].onToggle).toBeUndefined();

    const excludedRow = forwardCard(
      buildDropEmailGroup(
        stagedDrop(parsed),
        makeOptions({
          verdicts: new Map<string, StagedPartValidation>([
            ["att-1", { ok: true }],
            ["att-1/att-0", UNSUPPORTED],
          ]),
        }),
      ).items,
    );
    expect(excludedRow.onToggle).toBeTypeOf("function");
    expect(excludedRow.attachments[0].onToggle).toBeUndefined();
    expect(excludedRow.attachments[0].validation).toBe(UNSUPPORTED);
  });

  it("toggles the body and falls back to the host subject for a subject-less email", async () => {
    const parsed = { ...(await parseFixture()), subject: null };
    const options = makeOptions({ fallbackSubject: "From the host" });

    const group = buildDropEmailGroup(stagedDrop(parsed, [], true), options);
    expect(group.label).toBe("From the host");
    const body = group.items[0];
    expect(body.kind === "selectableAttachment" && body.selected).toBe(false);
    if (body.kind === "selectableAttachment") body.onToggle?.();
    expect(options.restoreBody).toHaveBeenCalled();
  });
});
