import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  validateOutlookFileProvenance,
  type OutlookFileProvenance,
} from "../typescript/src/index.js";
import {
  validateOutlookGetConversationV1Result,
  validateSearchQueryV1Result,
  validateSourcesGetDocumentV1Result,
} from "../typescript/src/generated/validators.mjs";

const fixtures = JSON.parse(
  await readFile(
    new URL(
      "../conformance/fixtures/outlook-file-provenance.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  valid: { name: string; value: OutlookFileProvenance }[];
  rollout: { name: string; fields: Record<string, unknown> }[];
};

const document = {
  external_ids: [{ key: "ews_id", value: "AQMk/CaseSensitive+EwsId==" }],
};

describe("persisted Outlook file provenance contract", () => {
  it.each(fixtures.valid)(
    "accepts $name without rewriting identity",
    ({ value }) => {
      const before = JSON.stringify(value);
      expect(validateOutlookFileProvenance(value)).toBe(true);
      expect(JSON.stringify(value)).toBe(before);
      expect(validateOutlookFileProvenance(JSON.parse(before))).toBe(true);
    },
  );

  it.each([
    {},
    { version: 2, origins: [{ document }] },
    { version: 1, origins: [] },
    { version: 1, origins: [{}] },
    { version: 1, origins: [{ document: { external_ids: [] } }] },
    { version: 1, origins: [{ topLevelParent: null }] },
    { version: 1, origins: [{ document, launchUrl: "outlook:untrusted" }] },
  ])("rejects unsupported or empty provenance: %j", (value) => {
    expect(validateOutlookFileProvenance(value)).toBe(false);
  });

  it.each([
    {},
    { profileName: "Work" },
    { mailboxId: "not-a-mailbox" },
    { emailAddress: " " },
  ])("rejects incomplete mailbox context: %j", (mailbox) => {
    expect(
      validateOutlookFileProvenance({
        version: 1,
        origins: [{ document: { ...document, mailbox } }],
      }),
    ).toBe(false);
  });

  it.each(["outlook_entry_id", "outlook_store_id"])(
    "accepts only complete hexadecimal bytes for %s in persisted metadata",
    (key) => {
      for (const value of [
        "",
        "ABC",
        "AQMk/Id==",
        "00 11",
        '00" /select other',
      ]) {
        expect(
          validateOutlookFileProvenance({
            version: 1,
            origins: [{ document: { external_ids: [{ key, value }] } }],
          }),
        ).toBe(false);
      }
    },
  );

  // No RPC schema changed in this release. These are the same v1 validators
  // used before this standalone contract: both rollout directions must work.
  it.each(fixtures.rollout)(
    "preserves RPC compatibility: $name",
    ({ fields }) => {
      expect(
        validateSearchQueryV1Result({
          hits: [
            {
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
              ...fields,
            },
          ],
          elapsedMs: 0,
          blocksRead: 0,
          candidatesScored: 0,
        }),
      ).toBe(true);
      expect(
        validateSourcesGetDocumentV1Result({
          filename: "attachment.pdf",
          mimeType: "application/pdf",
          contentBase64: "YQ==",
          ...fields,
        }),
      ).toBe(true);
      expect(
        validateOutlookGetConversationV1Result({
          state: "ok",
          messages: [{ ...document, attachments: [fields] }],
        }),
      ).toBe(true);
    },
  );
});
