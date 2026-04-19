import { describe, expect, it } from "vitest";

import {
  MAILLISTROW_TRANSFER_TYPE,
  parseOutlookMailListPayload,
} from "../outlookMailListDragParse";

// Real payload captured from OWA drag-from-mail-list on 2026-04-19
const REAL_OWA_PAYLOAD = JSON.stringify({
  itemType: MAILLISTROW_TRANSFER_TYPE,
  rowKeys: ["AQAAAQ5of+4BAAABDmiB6AAAAAA="],
  tableViewId: "folderId:AQMk...",
  tableListViewType: 1,
  subjects: ["Hey how are you?"],
  haveIRM: [false],
  sizes: [61783],
  mailboxInfos: [
    {
      sourceId: "DEFDEFDE-FDEF-DEFD-EFDE-FDEFDEFDEFDE",
      type: "UserMailbox",
      mailboxSmtpAddress: "testuser@maxgoisser.onmicrosoft.com",
      userIdentity: "testuser@maxgoisser.onmicrosoft.com",
      mailboxRank: "Coprincipal",
      mailboxProvider: "Office365",
    },
  ],
  latestItemIds: [
    "AAkALgAAAAAAHYQDEapmEc2byACqAC/EWg0AWgnVLFiQIkWwcVdZvFpnJQABBI9sNAAA",
  ],
  itemIds: [
    "AAkALgAAAAAAHYQDEapmEc2byACqAC/EWg0AWgnVLFiQIkWwcVdZvFpnJQABBI9sNAAA",
  ],
  nodeIds: [],
});

describe("parseOutlookMailListPayload", () => {
  it("extracts itemIds, subjects, sizes, and mailbox addresses from the real OWA payload", () => {
    const items = parseOutlookMailListPayload(REAL_OWA_PAYLOAD);
    expect(items).toEqual([
      {
        itemId:
          "AAkALgAAAAAAHYQDEapmEc2byACqAC/EWg0AWgnVLFiQIkWwcVdZvFpnJQABBI9sNAAA",
        subject: "Hey how are you?",
        size: 61783,
        mailboxSmtpAddress: "testuser@maxgoisser.onmicrosoft.com",
      },
    ]);
  });

  it("parses multi-select payloads by index-aligning the parallel arrays", () => {
    const payload = JSON.stringify({
      itemType: MAILLISTROW_TRANSFER_TYPE,
      itemIds: ["id-a", "id-b", "id-c"],
      subjects: ["A", "B", "C"],
      sizes: [100, 200, 300],
      mailboxInfos: [
        { mailboxSmtpAddress: "a@x" },
        { mailboxSmtpAddress: "b@x" },
        { mailboxSmtpAddress: "c@x" },
      ],
    });
    const items = parseOutlookMailListPayload(payload);
    expect(items).toEqual([
      { itemId: "id-a", subject: "A", size: 100, mailboxSmtpAddress: "a@x" },
      { itemId: "id-b", subject: "B", size: 200, mailboxSmtpAddress: "b@x" },
      { itemId: "id-c", subject: "C", size: 300, mailboxSmtpAddress: "c@x" },
    ]);
  });

  it("returns null for non-JSON strings", () => {
    expect(parseOutlookMailListPayload("")).toBeNull();
    expect(parseOutlookMailListPayload("not-json")).toBeNull();
    expect(parseOutlookMailListPayload("{")).toBeNull();
  });

  it("returns null when itemType is not maillistrow", () => {
    const payload = JSON.stringify({
      itemType: "somethingelse",
      itemIds: ["id-a"],
    });
    expect(parseOutlookMailListPayload(payload)).toBeNull();
  });

  it("returns null when itemIds is missing or empty", () => {
    expect(
      parseOutlookMailListPayload(
        JSON.stringify({ itemType: MAILLISTROW_TRANSFER_TYPE }),
      ),
    ).toBeNull();
    expect(
      parseOutlookMailListPayload(
        JSON.stringify({ itemType: MAILLISTROW_TRANSFER_TYPE, itemIds: [] }),
      ),
    ).toBeNull();
  });

  it("falls back to empty strings / zero sizes when parallel arrays are missing or shorter", () => {
    const payload = JSON.stringify({
      itemType: MAILLISTROW_TRANSFER_TYPE,
      itemIds: ["id-a", "id-b"],
      subjects: ["only-first"],
    });
    const items = parseOutlookMailListPayload(payload);
    expect(items).toEqual([
      {
        itemId: "id-a",
        subject: "only-first",
        size: 0,
        mailboxSmtpAddress: "",
      },
      { itemId: "id-b", subject: "", size: 0, mailboxSmtpAddress: "" },
    ]);
  });

  it("returns null when itemIds array contains non-string entries", () => {
    const payload = JSON.stringify({
      itemType: MAILLISTROW_TRANSFER_TYPE,
      itemIds: ["id-a", 42, "id-c"],
    });
    expect(parseOutlookMailListPayload(payload)).toBeNull();
  });
});
