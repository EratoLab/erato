import { readFile } from "node:fs/promises";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import type { SearchQueryV1Result } from "../typescript/src/index.js";

import {
  validateDiagnosticsEchoV1Params,
  validateDiscoveryDocument,
  validateJsonRpcEnvelope,
  validateLocalTasksStartV1Params,
  validateLocalTasksStatusV1Result,
  validateOutlookListEmailsV1Params,
  validateOutlookListMailboxesV1Result,
  validateOutlookSearchEmailsV1Params,
  validateOutlookSearchEmailsV1Result,
  validateSearchQueryV1Result,
  validateSidecarProgressV1Params,
  validateSidecarProgressV1Result,
} from "../typescript/src/generated/validators.mjs";

type CoverageSource = NonNullable<
  SearchQueryV1Result["coverage"]
>["sources"][number];

interface InvalidMessageFixture {
  cases: { name: string; message: unknown; error: string }[];
}

interface LocalDelegationFixture {
  binding: Record<string, unknown>;
  plan: Record<string, unknown>;
  contextHandle: string;
  authorization: string;
}

describe("language-neutral conformance fixtures", () => {
  it("rejects every invalid message fixture", async () => {
    const fixture = await readFixture<InvalidMessageFixture>(
      "invalid-messages.json",
    );
    for (const testCase of fixture.cases) {
      expect(validateJsonRpcEnvelope(testCase.message), testCase.name).toBe(
        false,
      );
    }
  });

  it("accepts additive parameter fields but rejects a changed required type", () => {
    expect(
      validateDiagnosticsEchoV1Params({
        message: "hello",
        futureOptionalField: true,
      }),
    ).toBe(true);
    expect(validateDiagnosticsEchoV1Params({ message: 42 })).toBe(false);
  });

  it("accepts additive fields throughout security-sensitive delegation objects", async () => {
    const fixture = await readFixture<LocalDelegationFixture>(
      "local-delegation.json",
    );
    const start = fixture;
    expect(
      validateLocalTasksStartV1Params({
        ...start,
        futureRequestField: { version: 2 },
        binding: { ...start.binding, futureBindingField: true },
        plan: { ...start.plan, futurePlanField: "ignored" },
      }),
    ).toBe(true);
    expect(
      validateLocalTasksStatusV1Result({
        handle: "h".repeat(32),
        state: "ready_for_review",
        futureStatusField: { revision: 2 },
      }),
    ).toBe(true);
  });

  it("accepts unknown future availability values without enabling them", async () => {
    const document = JSON.parse(
      await readFile(new URL("../openrpc.json", import.meta.url), "utf8"),
    );
    const echoMethod = document.methods.find(
      (method: { name?: string }) => method.name === "diagnostics.echo.v1",
    );
    echoMethod["x-erato-capability"].availability = {
      state: "requires_interaction",
      futureField: true,
    };

    expect(validateDiscoveryDocument(document)).toBe(true);
  });

  it("validates the sidecar.progress.v1 boundary", () => {
    expect(validateSidecarProgressV1Params({ requestId: "c-123" })).toBe(true);
    expect(validateSidecarProgressV1Params({ requestId: 7 })).toBe(true);
    expect(validateSidecarProgressV1Params({})).toBe(false);
    expect(validateSidecarProgressV1Params({ requestId: "" })).toBe(false);
  });

  it("accepts progress results for both rollout directions", () => {
    // A sidecar that does not track the request answers with a bare state.
    expect(validateSidecarProgressV1Result({ state: "unknown" })).toBe(true);
    // Unknown future states and additive fields stay valid; receivers treat
    // unrecognized states as running.
    expect(
      validateSidecarProgressV1Result({
        state: "futureState",
        futureField: { revision: 2 },
      }),
    ).toBe(true);
    // A running request returns the log so far, including nested work and a
    // superseding update for a step already reported.
    expect(
      validateSidecarProgressV1Result({
        state: "running",
        trace: {
          steps: [
            {
              sequence: 0,
              id: "delay",
              status: "running",
              startedAtOffsetMs: 0,
            },
            { sequence: 1, id: "readEmail", status: "ok", parentSequence: 0 },
            { sequence: 0, id: "delay", status: "ok", durationMs: 120 },
          ],
        },
      }),
    ).toBe(true);
    // The state is required, and a step without its sequence identity is
    // rejected.
    expect(validateSidecarProgressV1Result({ trace: { steps: [] } })).toBe(
      false,
    );
    expect(
      validateSidecarProgressV1Result({
        state: "finished",
        trace: { steps: [{ id: "delay", status: "ok" }] },
      }),
    ).toBe(false);
  });

  it("bounds the diagnostic echo delay", () => {
    expect(
      validateDiagnosticsEchoV1Params({ message: "hi", delayMs: 250 }),
    ).toBe(true);
    expect(
      validateDiagnosticsEchoV1Params({ message: "hi", delayMs: 60001 }),
    ).toBe(false);
    expect(
      validateDiagnosticsEchoV1Params({ message: "hi", delayMs: -1 }),
    ).toBe(false);
  });

  it("validates the Outlook action boundary", () => {
    expect(
      validateOutlookListEmailsV1Params({
        mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
      }),
    ).toBe(true);
    expect(validateOutlookListEmailsV1Params({ mailboxId: "" })).toBe(false);
    expect(
      validateOutlookListMailboxesV1Result({
        mailboxes: [
          {
            id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
            displayName: "Work",
            emailAddress: "work@example.com",
            profileName: "Work Profile",
            source: "windowsOutlook",
          },
        ],
        warnings: [],
      }),
    ).toBe(true);
  });
});

describe("outlook.search_emails.v1 boundary", () => {
  it("accepts minimal and extended parameters but rejects an empty query", () => {
    expect(
      validateOutlookSearchEmailsV1Params({
        mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
        query: "quarterly offer",
      }),
    ).toBe(true);
    expect(
      validateOutlookSearchEmailsV1Params({
        mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
        query: "quarterly offer",
        limit: 5,
        includeAttachments: false,
        summarize: false,
        futureOptionalField: true,
      }),
    ).toBe(true);
    expect(
      validateOutlookSearchEmailsV1Params({
        mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
        query: "",
      }),
    ).toBe(false);
  });

  it("accepts results with and without an on-device trace (both rollout directions)", () => {
    const base = {
      mailbox: {
        id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
        displayName: "Work",
        source: "ost",
      },
      hits: [],
    };
    // Old sidecar, new client: no trace at all.
    expect(validateOutlookSearchEmailsV1Result(base)).toBe(true);
    // New sidecar: trace with known and unknown step ids/statuses.
    expect(
      validateOutlookSearchEmailsV1Result({
        ...base,
        trace: {
          steps: [
            {
              sequence: 0,
              id: "buildIndex",
              status: "ok",
              startedAtOffsetMs: 0,
              durationMs: 1200,
              cacheHit: false,
              counts: { messagesScanned: 812 },
            },
            {
              sequence: 1,
              id: "expandQuery",
              status: "degraded",
              durationMs: 30,
              model: "qwen3:14b",
              detail: "local query expansion unavailable",
            },
            { sequence: 2, id: "futureStep", status: "futureStatus" },
            // Nested work (a tool call inside a local model turn) and a
            // superseding update for a step already reported.
            { sequence: 3, id: "readEmail", status: "ok", parentSequence: 1 },
            { sequence: 1, id: "expandQuery", status: "ok" },
          ],
          totalDurationMs: 1500,
        },
      }),
    ).toBe(true);
    // A step without the required fields is rejected.
    expect(
      validateOutlookSearchEmailsV1Result({
        ...base,
        trace: { steps: [{ id: "noSequence", status: "ok" }] },
      }),
    ).toBe(false);
  });

  it("accepts a result with hits, local summary, and additive fields", () => {
    expect(
      validateOutlookSearchEmailsV1Result({
        mailbox: {
          id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
          displayName: "Work",
          source: "ost",
        },
        hits: [
          {
            email: { id: "message-1", subject: "Angebot Q3" },
            snippet: "…das finale Angebot für Q3 liegt bei…",
            matchedIn: ["subject", "attachmentContent"],
            matchedAttachmentNames: ["angebot-q3.docx"],
          },
        ],
        totalMatched: 3,
        summary: "Three messages discuss the Q3 offer.",
        summaryModel: "qwen3:14b",
        expandedKeywords: ["angebot", "q3", "offer"],
        warnings: [],
        futureOptionalField: true,
      }),
    ).toBe(true);
    expect(validateOutlookSearchEmailsV1Result({ hits: [] })).toBe(false);
  });
});

describe("search.query.v1 result boundary", () => {
  it("accepts externally relatable identifiers and a document URI", () => {
    expect(
      validateSearchQueryV1Result({
        hits: [
          {
            documentId: "document-1",
            uri: "https://outlook.example.test/message-1",
            external_ids: [
              { key: "email_message_id", value: "<message-1@example.com>" },
              { key: "future_source_identifier", value: "source-value" },
            ],
            chunkId: null,
            score: 1.25,
            kind: "email",
            title: "Quarterly offer",
            sender: "sender@example.com",
            mailboxId: "mailbox-1",
            date: 1774291200,
            mimeType: "message/rfc822",
            conversationKey: "conversation-1",
          },
        ],
        elapsedMs: 1,
        blocksRead: 1,
        candidatesScored: 1,
      }),
    ).toBe(true);
  });

  it("keeps the new fields optional for previous sidecars", () => {
    expect(
      validateSearchQueryV1Result({
        hits: [],
        elapsedMs: 0,
        blocksRead: 0,
        candidatesScored: 0,
      }),
    ).toBe(true);
  });

  it("rejects malformed external identifiers and URIs", () => {
    const baseHit = {
      documentId: "document-1",
      chunkId: null,
      score: 1,
      kind: "email",
      title: null,
      sender: null,
      mailboxId: null,
      date: null,
      mimeType: null,
      conversationKey: null,
    };
    const baseResult = {
      hits: [baseHit],
      elapsedMs: 0,
      blocksRead: 0,
      candidatesScored: 0,
    };

    expect(
      validateSearchQueryV1Result({
        ...baseResult,
        hits: [{ ...baseHit, uri: "not a URI" }],
      }),
    ).toBe(false);
    expect(
      validateSearchQueryV1Result({
        ...baseResult,
        hits: [{ ...baseHit, external_ids: [{ key: "only-key" }] }],
      }),
    ).toBe(false);
  });

  it("accepts the searched period per source and limitReached", async () => {
    const fixture = await readFixture<SearchQueryV1Result>(
      "search-coverage.json",
    );
    const listing = structuredClone(fixture);
    listing.hits = [];
    listing.limitReached = false;
    Object.assign(listing.coverage!, {
      basis: "catalog",
      futureCoverageField: true,
    });
    Object.assign(listing.coverage!.sources[0]!, {
      from: null,
      through: null,
      observedAt: null,
      unavailableReason: "not_enumerated",
      futureSourceField: true,
    });
    const legacy: Partial<SearchQueryV1Result> = structuredClone(fixture);
    delete legacy.coverage;
    delete legacy.limitReached;
    const noSources = structuredClone(fixture);
    noSources.coverage!.sources = [];
    for (const result of [fixture, listing, legacy, noSources])
      expect(validateSearchQueryV1Result(result)).toBe(true);
  });

  it("rejects coverage with offset timestamps, negative counts or missing identity", async () => {
    const fixture = await readFixture<SearchQueryV1Result>(
      "search-coverage.json",
    );
    const source = (override: Record<string, unknown>) => {
      const data = structuredClone(fixture);
      Object.assign(data.coverage!.sources[1]!, override);
      return data;
    };
    const coverage = (override: Record<string, unknown>) => {
      const data = structuredClone(fixture);
      Object.assign(data.coverage!, override);
      return data;
    };
    const missingSourceId = structuredClone(fixture);
    delete (missingSourceId.coverage!.sources[0] as Partial<CoverageSource>)
      .sourceId;
    for (const result of [
      coverage({ sampledAt: "2026-09-15T14:00:00+02:00" }),
      coverage({ basis: "" }),
      coverage({ sources: null }),
      source({ observedAt: "2026-09-15T11:59:00+00:00" }),
      source({ from: { at: "2026-06-02T09:15:00", inclusive: true } }),
      source({ olderPending: -1 }),
      source({ pendingNewer: 2.5 }),
      source({ product: "" }),
      source({ inventory: null }),
      missingSourceId,
      { ...fixture, limitReached: "yes" },
    ])
      expect(validateSearchQueryV1Result(result)).toBe(false);
  });

  it("keeps coverage readable by the previous search result schema", async () => {
    const fixture = await readFixture<SearchQueryV1Result>(
      "search-coverage.json",
    );
    const previous = await readSchema(
      "methods/search-query-v1-result.schema.json",
    );
    delete previous.properties.coverage;
    delete previous.properties.limitReached;
    delete previous.definitions;
    const ajv = new Ajv({
      strict: true,
      schemas: await Promise.all(
        [
          "source/external-ids.schema.json",
          "source/top-level-parent.schema.json",
        ].map(readSchema),
      ),
    });
    addFormats(ajv);
    expect(ajv.compile(previous)(fixture)).toBe(true);
  });
});

async function readSchema(relativePath: string) {
  return JSON.parse(
    await readFile(
      new URL(`../schemas/${relativePath}`, import.meta.url),
      "utf8",
    ),
  );
}

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(
      new URL(`../conformance/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
