import { readFile } from "node:fs/promises";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import type {
  OutlookListMailboxesV1Result,
  SourcesListV1Result,
} from "../typescript/src/index.js";

import {
  validateIndexingStatusV1Result,
  validateOutlookGetConversationV1Result,
  validateOutlookListMailboxesV1Result,
  validateSearchQueryV1Result,
  validateSourcesListV1Result,
} from "../typescript/src/generated/validators.mjs";

async function readJson<T = Record<string, any>>(relativePath: string) {
  return JSON.parse(
    await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"),
  ) as T;
}

const readSchema = (relativePath: string) =>
  readJson(`schemas/${relativePath}`);

/** Compiles a result schema against an earlier version of one of its parts. */
async function previousValidator(
  resultPath: string,
  partPath: string,
  strip: (part: Record<string, any>) => void,
  otherParts: string[] = [],
) {
  const part = await readSchema(partPath);
  strip(part);
  const ajv = new Ajv({
    strict: true,
    schemas: [part, ...(await Promise.all(otherParts.map(readSchema)))],
  });
  addFormats(ajv);
  return ajv.compile(await readSchema(resultPath));
}

const fixture = () =>
  readJson<SourcesListV1Result>(
    "conformance/fixtures/source-capabilities.json",
  );

const hxMailbox = (
  capabilities: Record<string, unknown> | undefined,
): OutlookListMailboxesV1Result => ({
  mailboxes: [
    {
      id: "21111111222243338444555555555555",
      displayName: "jane@example.com",
      emailAddress: "jane@example.com",
      source: "macOsHxAccount",
      sourceIds: ["b1111111-b222-4333-8444-c55555555555"],
      ...(capabilities && { capabilities }),
    },
  ],
  warnings: [
    {
      message:
        "The profile appears to have migrated to new Outlook's Hx store.",
    },
  ],
});

const hit = (extra: Record<string, unknown>) => ({
  hits: [
    {
      documentId: "d1111111-b222-4333-8444-c55555555555",
      chunkId: null,
      score: 1,
      kind: "email",
      title: "Quarterly offer",
      sender: "jane@example.com",
      mailboxId: "21111111-2222-4333-8444-555555555555",
      date: 1789387200,
      mimeType: "message/rfc822",
      conversationKey: "5d2f2a0e-8e57-4f0c-9e57-1f0a1c3d5b7e",
      ...extra,
    },
  ],
  elapsedMs: 1,
  blocksRead: 1,
  candidatesScored: 1,
});

describe("source capabilities", () => {
  it("accepts sources and mailboxes with and without capabilities", async () => {
    const current = await fixture();
    const legacy = structuredClone(current);
    for (const source of legacy.sources) delete source.capabilities;
    const partial = structuredClone(current);
    partial.sources[0]!.capabilities = { conversations: true };
    const futureValue = structuredClone(current);
    futureValue.sources[1]!.capabilities!.documentExport = "streamed";

    for (const result of [current, legacy, partial, futureValue])
      expect(validateSourcesListV1Result(result)).toBe(true);
    for (const result of [
      hxMailbox(current.sources[1]!.capabilities),
      hxMailbox(undefined),
    ])
      expect(validateOutlookListMailboxesV1Result(result)).toBe(true);
  });

  it("rejects malformed capabilities", async () => {
    const source = async (capabilities: Record<string, unknown>) => {
      const data = await fixture();
      data.sources[1]!.capabilities = capabilities;
      return data;
    };
    for (const result of [
      await source({ conversations: "no" }),
      await source({ documentExport: "" }),
      await source({ metadataFields: ["to", "to"] }),
      await source({ metadataFields: [""] }),
    ])
      expect(validateSourcesListV1Result(result)).toBe(false);
    expect(
      validateOutlookListMailboxesV1Result({
        ...hxMailbox(undefined),
        mailboxes: [
          { ...hxMailbox(undefined).mailboxes[0], sourceIds: ["not-a-uuid"] },
        ],
      }),
    ).toBe(false);
  });

  it("keeps capabilities readable by the previous source and mailbox schemas", async () => {
    const previousSources = await previousValidator(
      "methods/sources-list-v1-result.schema.json",
      "source/source-descriptor.schema.json",
      (descriptor) => delete descriptor.properties.capabilities,
    );
    expect(previousSources(await fixture())).toBe(true);

    const previousMailboxes = await previousValidator(
      "methods/outlook-list-mailboxes-v1-result.schema.json",
      "outlook/mailbox.schema.json",
      (mailbox) => {
        delete mailbox.properties.capabilities;
        delete mailbox.properties.sourceIds;
      },
      ["outlook/listing-warning.schema.json"],
    );
    expect(
      previousMailboxes(hxMailbox((await fixture()).sources[1]!.capabilities)),
    ).toBe(true);
  });
});

describe("search hit source", () => {
  it("accepts hits with and without sourceId, but only a UUID", () => {
    expect(validateSearchQueryV1Result(hit({}))).toBe(true);
    expect(
      validateSearchQueryV1Result(
        hit({ sourceId: "b1111111-b222-4333-8444-c55555555555" }),
      ),
    ).toBe(true);
    expect(validateSearchQueryV1Result(hit({ sourceId: "source-1" }))).toBe(
      false,
    );
  });
});

describe("source errors and warnings", () => {
  it("accepts sourceError beside every protocol kind and keeps it optional", async () => {
    const errorData = await readSchema("bootstrap/error-data.schema.json");
    const ajv = new Ajv({
      strict: true,
      schemas: [await readSchema("common.schema.json")],
    });
    addFormats(ajv);
    const validate = ajv.compile(errorData);
    for (const sourceError of [
      "missing_from_local_cache",
      "source_changed",
      "unsupported_source",
      "export_too_large",
      "future_source_error",
    ])
      expect(validate({ kind: "sidecar_internal", sourceError })).toBe(true);
    expect(validate({ kind: "sidecar_internal" })).toBe(true);
    expect(validate({ kind: "sidecar_internal", sourceError: "" })).toBe(false);
    expect(validate({ kind: "missing_from_local_cache" })).toBe(false);

    delete errorData.properties.sourceError;
    const previous = new Ajv({
      strict: true,
      schemas: [await readSchema("common.schema.json")],
    });
    addFormats(previous);
    expect(
      previous.compile(errorData)({
        kind: "sidecar_internal",
        sourceError: "missing_from_local_cache",
      }),
    ).toBe(true);
  });

  it("accepts an unsupported_source conversation without messages", () => {
    expect(
      validateOutlookGetConversationV1Result({
        state: "partial",
        messages: [],
        warnings: [
          {
            code: "unsupported_source",
            message:
              "Conversation retrieval is unavailable for this mailbox storage format.",
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts the syncCache inventory", async () => {
    const status = await readJson(
      "conformance/fixtures/indexing-statistics.json",
    );
    for (const entry of status.discovery) {
      if (entry.indexedRange) entry.indexedRange.inventory = "syncCache";
    }
    expect(validateIndexingStatusV1Result(status)).toBe(true);
  });
});
