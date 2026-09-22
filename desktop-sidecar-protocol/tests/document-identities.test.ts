import { describe, expect, it } from "vitest";
import {
  validateOutlookGetConversationV1Result,
  validateSearchQueryV1Result,
  validateSourcesGetDocumentV1Result,
} from "../typescript/src/generated/validators.mjs";

const ids = [{ key: "ews_id", value: "AQMk/CaseSensitive+EwsId==" }];
const parent = {
  documentId: "11111111-1111-4111-8111-111111111111",
  external_ids: ids,
};
const hit = {
  documentId: "attachment",
  chunkId: null,
  score: 1,
  kind: "file",
  title: null,
  sender: null,
  mailboxId: null,
  date: null,
  mimeType: null,
  conversationKey: null,
};
const exportResult = {
  filename: "a.txt",
  mimeType: "text/plain",
  contentBase64: "YQ==",
};
const boundaries = [
  (fields: object) =>
    validateSearchQueryV1Result({
      hits: [{ ...hit, ...fields }],
      elapsedMs: 0,
      blocksRead: 0,
      candidatesScored: 0,
    }),
  (fields: object) =>
    validateSourcesGetDocumentV1Result({ ...exportResult, ...fields }),
  (fields: object) =>
    validateOutlookGetConversationV1Result({
      state: "ok",
      messages: [{ external_ids: ids, attachments: [{ ...fields }] }],
    }),
];

describe("document identity compatibility", () => {
  it("accepts old responses and independently identified attachments at each boundary", () => {
    for (const validate of boundaries) {
      expect(validate({})).toBe(true);
      expect(validate({ external_ids: [], topLevelParent: parent })).toBe(true);
      expect(
        validate({ external_ids: [], topLevelParent: { external_ids: ids } }),
      ).toBe(true);
      expect(
        validate({
          external_ids: [{ key: "future_key", value: "opaque" }],
          topLevelParent: { external_ids: [] },
        }),
      ).toBe(true);
    }
    expect(
      validateOutlookGetConversationV1Result({
        state: "ok",
        messages: [{ attachments: [] }],
      }),
    ).toBe(true);
  });
  it("validates IDs on every conversation message", () => {
    expect(
      validateOutlookGetConversationV1Result({
        state: "ok",
        messages: [
          { external_ids: ids, attachments: [] },
          { external_ids: [{ key: "ews_id" }], attachments: [] },
        ],
      }),
    ).toBe(false);
  });
  it("rejects malformed identities and parent references at each boundary", () => {
    for (const validate of boundaries) {
      for (const external_ids of [
        null,
        [{ key: "ews_id" }],
        [{ key: "", value: "id" }],
        [{ key: "ews_id", value: "" }],
        [{ key: "ews_id", value: 1 }],
      ]) {
        expect(validate({ external_ids })).toBe(false);
        expect(validate({ topLevelParent: { external_ids } })).toBe(false);
      }
      expect(
        validate({ topLevelParent: { documentId: parent.documentId } }),
      ).toBe(false);
      expect(
        validate({ topLevelParent: { ...parent, documentId: "folder" } }),
      ).toBe(false);
    }
  });
});
