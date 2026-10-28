import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import sharepointEml from "../../../test/fixtures/eml/sharepoint-inline-images.eml?raw";
import {
  bodyContentIds,
  buildDropEmailGroup,
  dropAttachmentCounts,
  isBodyPicture,
  isEmailBodyPart,
  judgeDropEmailParts,
  partTypeLabel,
  senderAndDate,
} from "../buildDropEmailGroup";
import { collectDismissedPaths } from "../dismissedAttachmentPaths";
import { parseEmlBytes } from "../parsedEmail";
import { trimEmlAttachments } from "../trimEmlAttachments";

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
  "bodySizeLabel" | "verdicts" | "fallbackSubject"
>;

function makeOptions(overrides: Partial<FixedOptions> = {}) {
  return {
    fallbackSubject: "",
    dismissAttachment: vi.fn<(attachmentId: string) => void>(),
    restoreAttachment: vi.fn<(attachmentId: string) => void>(),
    ...overrides,
  };
}

/** The rows are built from parsed parts, so the file is always the item shape. */
function fileOf(item: { file: unknown }) {
  return item.file as {
    id: string;
    filename: string;
    displayName?: string;
    size: number;
  };
}

/**
 * A SharePoint notice as Exchange hands it over: three pictures the HTML
 * shows through `cid:` links, named by GUID or not at all, a nameless inline
 * picture nothing links to, and a named PDF.
 */
async function parseSharepoint(): Promise<ParsedEmail> {
  const parsed = await parseEmlBytes(
    new TextEncoder().encode(sharepointEml).buffer,
    { filename: "sharepoint.eml" },
  );
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
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
  it("renders the read-only body row, the flat attachment rows, and the forward as a nested card", async () => {
    const parsed = await parseFixture();
    const group = buildDropEmailGroup(
      stagedDrop(parsed),
      makeOptions({ bodySizeLabel: "41 KB" }),
    );

    expect(group.id).toBe("staged-email:drop-1");
    // The detail's header names the sender; the sheet's title is the subject.
    expect(group.label).toBe("Anna");
    expect(group.metaLabel).toBe("");
    expect(group).not.toHaveProperty("collapsible");
    expect(group.items.map((item) => [item.kind, item.id])).toEqual([
      ["selectableAttachment", "drop-1:body"],
      ["selectableAttachment", "drop-1:att-0"],
      ["threadMessageGroup", "drop-1:att-1"],
    ]);
    const body = group.items[0];
    if (body.kind !== "selectableAttachment") throw new Error("no body row");
    // The chip's (x) removes the email; the body has no tick of its own.
    expect(body.selected).toBe(true);
    expect(body.onToggle).toBeUndefined();
    expect(body.metaLabel).toBe("Email · 41 KB · Always sent");

    const updating = buildDropEmailGroup(
      stagedDrop(parsed),
      makeOptions({ bodySizeLabel: "Updating…" }),
    ).items[0];
    expect(updating.kind === "selectableAttachment" && updating.metaLabel).toBe(
      "Email · Updating… · Always sent",
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

  it("names the email by its subject, then the host's, when it has no sender", async () => {
    const parsed = { ...(await parseFixture()), from: null, date: null };

    expect(buildDropEmailGroup(stagedDrop(parsed), makeOptions()).label).toBe(
      "Cover note",
    );
    expect(
      buildDropEmailGroup(
        stagedDrop({ ...parsed, subject: null }),
        makeOptions({ fallbackSubject: "From the host" }),
      ).label,
    ).toBe("From the host");
  });

  it("dates the sender line in the app's language, with the year", async () => {
    const parsed = {
      ...(await parseFixture()),
      date: new Date(2026, 9, 7, 12).toISOString(),
    };
    expect(senderAndDate(parsed)).toBe("Anna • 10/7/2026");

    i18n.loadAndActivate({ locale: "de", messages: {} });
    try {
      expect(senderAndDate(parsed)).toBe("Anna • 7.10.2026");
    } finally {
      i18n.loadAndActivate({ locale: "en", messages: {} });
    }
  });

  describe("an email whose body shows pictures", () => {
    it("counts the pictures in the body row's name and names and types the rest by their MIME type", async () => {
      const parsed = await parseSharepoint();
      expect(parsed.attachments).toHaveLength(5);

      const group = buildDropEmailGroup(
        stagedDrop(parsed),
        makeOptions({ bodySizeLabel: "3 KB" }),
      );
      expect(
        group.items.map((item) =>
          item.kind === "selectableAttachment"
            ? [
                fileOf(item).displayName ?? fileOf(item).filename,
                item.labelOverride,
                typeof item.onToggle,
              ]
            : item.kind,
        ),
      ).toEqual([
        ["Email body with 3 images", "Email", "undefined"],
        // Inline but linked from nowhere: still listed, read-only, by its type.
        ["Inline image 1", "PNG image", "undefined"],
        ["Wiederherstellung.pdf", undefined, "function"],
      ]);
      const body = group.items[0];
      expect(body.kind === "selectableAttachment" && body.metaLabel).toBe(
        "Email · 3 KB · Always sent",
      );
      expect(JSON.stringify(group)).not.toMatch(/696debbf|0ce1705a|373014b8/);
    });

    it("leaves the pictures in what is sent when the attachment is left out", async () => {
      const parsed = await parseSharepoint();
      const pdf = parsed.attachments.find(
        (attachment) => attachment.filename === "Wiederherstellung.pdf",
      )!;
      const trimmed = trimEmlAttachments(
        new Uint8Array(parsed.rawBytes),
        collectDismissedPaths(parsed.attachments, new Set([pdf.id])),
      );
      const sent = await parseEmlBytes(trimmed!.slice().buffer);

      const bodyIds = bodyContentIds(sent!.html);
      expect(
        sent!.attachments.filter((part) => isBodyPicture(part, bodyIds)),
      ).toHaveLength(3);
      expect(sent!.attachments.map((part) => part.mimeType)).not.toContain(
        "application/pdf",
      );
      // The chip counts what the reader would call attachments: the PDF.
      expect(dropAttachmentCounts(stagedDrop(parsed), undefined)).toEqual({
        kept: 1,
        total: 1,
      });
    });

    it("folds the pictures a forward's body shows into the forward", async () => {
      const outer =
        `From: Anna <a@example.com>${CRLF}` +
        `Subject: Fwd: Achtung${CRLF}` +
        `Content-Type: multipart/mixed; boundary="----OUTER"${CRLF}${CRLF}` +
        `------OUTER${CRLF}` +
        `Content-Type: text/plain${CRLF}${CRLF}` +
        `See below.${CRLF}` +
        `------OUTER${CRLF}` +
        `Content-Type: message/rfc822${CRLF}${CRLF}` +
        sharepointEml +
        `${CRLF}------OUTER--${CRLF}`;
      const parsed = await parseEmlBytes(
        new TextEncoder().encode(outer).buffer,
      );

      const card = forwardCard(
        buildDropEmailGroup(stagedDrop(parsed!), makeOptions()).items,
      );
      expect(
        card.attachments.map((row) => [
          fileOf(row).displayName ?? fileOf(row).filename,
          row.labelOverride,
        ]),
      ).toEqual([
        ["Inline image 1", "PNG image"],
        ["Wiederherstellung.pdf", undefined],
      ]);
    });

    it("finds a cid link whatever its case or escaping", () => {
      expect([
        ...bodyContentIds(
          `<img src="CID:Logo%40x"><div style="background:url(cid:bg@x)">`,
        ),
      ]).toEqual(["logo@x", "bg@x"]);
      expect(bodyContentIds(null).size).toBe(0);
    });
  });

  describe("partTypeLabel", () => {
    it("names the type a reader knows from the MIME type", () => {
      expect(partTypeLabel("image/png")).toBe("PNG image");
      expect(partTypeLabel("image/jpeg; name=x")).toBe("JPEG image");
      expect(partTypeLabel("image/svg+xml")).toBe("SVG image");
      expect(partTypeLabel("image/x-emf")).toBe("EMF image");
      expect(partTypeLabel("application/pdf")).toBe("PDF document");
      expect(partTypeLabel("audio/mpeg")).toBe("MPEG audio");
      expect(partTypeLabel("application/octet-stream")).toBeNull();
    });
  });

  describe("dropAttachmentCounts", () => {
    it("counts attachments and forwards, not body parts, and what the user or policy leaves out", async () => {
      const parsed = await parseFixture();

      expect(dropAttachmentCounts(stagedDrop(parsed), undefined)).toEqual({
        kept: 2,
        total: 2,
      });
      expect(
        dropAttachmentCounts(stagedDrop(parsed, ["att-1"]), undefined),
      ).toEqual({ kept: 1, total: 2 });
      expect(
        dropAttachmentCounts(
          stagedDrop(parsed),
          new Map([["att-0", UNSUPPORTED]]),
        ),
      ).toEqual({ kept: 1, total: 2 });
    });
  });

  describe("judgeDropEmailParts", () => {
    const unsupportedPdf = (part: { mimeType: string }) =>
      part.mimeType === "application/pdf" ? UNSUPPORTED : { ok: true as const };

    it("judges the attachments and the parts of a forward, skipping body parts", async () => {
      const { verdicts, excluded } = judgeDropEmailParts(
        await parseFixture(),
        unsupportedPdf,
      );

      expect([...verdicts.keys()]).toEqual(["att-0", "att-1", "att-1/att-0"]);
      expect(excluded).toEqual(["att-0", "att-1/att-0"]);
    });

    it("never excludes a part inside a forward that cannot be cut out", async () => {
      const { verdicts, excluded } = judgeDropEmailParts(
        await parseFixture({ encodeForward: true }),
        unsupportedPdf,
      );

      // Still judged, so the row can carry its badge.
      expect(verdicts.get("att-1/att-0")).toBe(UNSUPPORTED);
      expect(excluded).toEqual(["att-0"]);
    });
  });
});
