import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  validateDiagnosticsEchoV1Params,
  validateLocalTaskStatus,
  validateLocalTasksStartV1Params,
  validateLocalTasksStatusV1Result,
  validateOutlookGetConversationV1Result,
  validateSearchQueryV1Result,
  validateSourcesListV1Result,
} from "../../../desktop-sidecar-protocol/typescript/src/generated/validators.mjs";
import { DesktopSidecarClient } from "../../../desktop-sidecar-protocol/typescript/src/index.js";
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const protocolRoot = path.join(repositoryRoot, "desktop-sidecar-protocol");
describe("desktop sidecar protocol extensibility", () => {
  it("keeps every object schema open and validates the full schema catalogue", async () => {
    const files = await listJsonFiles(path.join(protocolRoot, "schemas"));
    const schemas = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
    );
    const closedObjects: string[] = [];
    const implicitObjects: string[] = [];

    for (let index = 0; index < schemas.length; index += 1) {
      walkSchema(schemas[index], "", (schema, pointer) => {
        const location = `${files[index]}${pointer}`;
        if (schema.additionalProperties === false) closedObjects.push(location);
        if (!("additionalProperties" in schema)) implicitObjects.push(location);
      });
    }

    expect(closedObjects).toEqual([]);
    expect(implicitObjects).toEqual([]);
    execFileSync(process.execPath, ["scripts/validate.mjs"], {
      cwd: protocolRoot,
      stdio: "pipe",
    });
  });

  it("accepts additive fields at root and nested protocol boundaries", async () => {
    const source = {
      sourceId: "11111111-1111-4111-8111-111111111111",
      sourceKind: "outlook",
      sourceKey: "mailbox-a",
      locator: { mailboxId: "mailbox-a", providerExtension: { revision: 2 } },
      enabled: true,
      discoveryCursor: null,
      completedScanId: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      displayName: "Work mailbox",
      indexingEnabled: true,
      product: "outlook",
      product_variant: "outlook_classic",
    };
    expect(
      validateSourcesListV1Result({
        sources: [source],
        futureResultField: true,
      }),
    ).toBe(true);
    const legacySource = Object.fromEntries(
      Object.entries(source).filter(
        ([key]) =>
          ![
            "displayName",
            "indexingEnabled",
            "product",
            "product_variant",
          ].includes(key),
      ),
    );
    expect(validateSourcesListV1Result({ sources: [legacySource] })).toBe(true);
    expect(
      validateSourcesListV1Result({
        sources: [{ ...source, indexingEnabled: "yes" }],
      }),
    ).toBe(false);
    const teamsSource = {
      ...source,
      sourceKind: "teams",
      product: "teams",
      product_variant: "teams_new",
      displayName: "Contoso Ltd (jane@home.example)",
      account: {
        tenantId: "tenant-1",
        userId: "user-1",
        displayName: "Jane",
        email: "jane@home.example",
        userPrincipalName: "jane_home.example#EXT#@contoso.onmicrosoft.com",
        tenantName: "Contoso Ltd",
        userType: "Guest",
        futureAccountField: true,
      },
    };
    expect(validateSourcesListV1Result({ sources: [teamsSource] })).toBe(true);
    expect(
      validateSourcesListV1Result({
        sources: [{ ...teamsSource, account: { tenantId: "tenant-1" } }],
      }),
    ).toBe(false);
    const hit = {
      documentId: "22222222-2222-4222-8222-222222222222",
      chunkId: null,
      score: 1,
      kind: "teams_message",
      title: null,
      sender: "8:orgid:user-1",
      senderEmail: "jane@home.example",
      mailboxId: null,
      date: 1800000000,
      editedAt: 1800000100,
      mimeType: null,
      conversationKey: "19:chat@thread.v2",
    };
    const search = (hits: object[]) =>
      validateSearchQueryV1Result({
        hits,
        elapsedMs: 1,
        blocksRead: 0,
        candidatesScored: 1,
      });
    expect(search([hit])).toBe(true);
    expect(search([{ ...hit, editedAt: "yesterday" }])).toBe(false);
    expect(
      search([{ ...hit, conversationKey: "48:notes", selfNote: true }]),
    ).toBe(true);
    expect(search([{ ...hit, selfNote: "yes" }])).toBe(false);

    const start = JSON.parse(
      await readFile(
        path.join(protocolRoot, "conformance/fixtures/local-delegation.json"),
        "utf8",
      ),
    );
    expect(
      validateLocalTasksStartV1Params({
        ...start,
        futureRequestField: { revision: 2 },
        binding: { ...start.binding, futureBindingField: true },
        plan: { ...start.plan, futurePlanField: "ignored" },
      }),
    ).toBe(true);
    expect(
      validateLocalTasksStatusV1Result({
        handle: "h".repeat(32),
        state: "ready_for_review",
        futureStatusField: "ignored",
      }),
    ).toBe(true);
  });

  it("keeps validation of known fields and explicit enums strict", () => {
    expect(
      validateDiagnosticsEchoV1Params({ message: 42, futureField: true }),
    ).toBe(false);
    expect(
      validateLocalTaskStatus({
        handle: "h".repeat(32),
        state: "future_state",
        futureField: true,
      }),
    ).toBe(false);
    expect(
      validateOutlookGetConversationV1Result({
        state: "ok",
        messages: [
          {
            attachments: [
              {
                external_ids: [
                  { key: "future_id", value: "opaque", source: "future" },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("lets the generated reference client consume a result with additive fields", async () => {
    const document = JSON.parse(
      await readFile(path.join(protocolRoot, "openrpc.json"), "utf8"),
    );
    const client = new DesktopSidecarClient({
      transport: {
        request: async (body) => {
          const request = JSON.parse(body);
          let result: unknown;
          if (request.method === "rpc.discover") {
            const digestDocument = globalThis.structuredClone(document);
            delete digestDocument["x-erato-catalogue"].digest;
            document["x-erato-catalogue"].digest = `sha256:${createHash(
              "sha256",
            )
              .update(canonicalJson(digestDocument), "utf8")
              .digest("hex")}`;
            result = {
              protocolVersion: "1.0",
              serverInfo: { name: "test-sidecar", version: "0.1.0" },
              instanceId: "mock-sidecar-instance",
              document,
            };
          } else {
            result = {
              message: "hello",
              sidecarInstanceId: "mock-sidecar-instance",
              futureField: { revision: 2 },
            };
          }
          return JSON.stringify({ jsonrpc: "2.0", id: request.id, result });
        },
      },
      clientInfo: {
        name: "frontend-protocol-test",
        version: "0.1.0",
        host: { application: "test", runtime: "node" },
        os: { name: "test" },
      },
    });

    await client.discover();
    await expect(
      client.invoke("diagnostics.echo.v1", { message: "hello" }),
    ).resolves.toMatchObject({ message: "hello" });
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("executes every declared compatibility-matrix case", async () => {
    const matrix = JSON.parse(
      await readFile(
        path.join(
          protocolRoot,
          "conformance/fixtures/compatibility-matrix.json",
        ),
        "utf8",
      ),
    ) as { cases: Record<string, unknown>[] };
    const supportedFields = new Set([
      "name",
      "clientVersions",
      "sidecarVersions",
      "selected",
      "errorKind",
      "clientCompiledMethods",
      "sidecarAdvertisedMethods",
      "supportsRestart",
      "supportsOutlookActions",
      "supportsProgress",
      "supportsOpenDataDirectory",
      "sidecarAddsUnknownFields",
    ]);

    expect(matrix.cases.length).toBeGreaterThan(0);
    for (const testCase of matrix.cases) {
      for (const key of Object.keys(testCase)) {
        expect(
          supportedFields.has(key),
          `${String(testCase.name)}: unsupported ${key}`,
        ).toBe(true);
      }
      const versions = (testCase.clientVersions as string[]).filter((version) =>
        (testCase.sidecarVersions as string[]).includes(version),
      );
      if (testCase.errorKind === "incompatible_protocol") {
        expect(versions, String(testCase.name)).toEqual([]);
        continue;
      }
      if ("selected" in testCase) {
        expect(testCase.selected, String(testCase.name)).toBe(versions[0]);
      } else {
        expect(versions.length, String(testCase.name)).toBeGreaterThan(0);
      }

      const compiled = new Set(
        testCase.clientCompiledMethods as string[] | undefined,
      );
      const advertised = new Set(
        testCase.sidecarAdvertisedMethods as string[] | undefined,
      );
      for (const [method, flag] of [
        ["sidecar.restart.v1", "supportsRestart"],
        ["outlook.list_mailboxes.v1", "supportsOutlookActions"],
        ["sidecar.progress.v1", "supportsProgress"],
        ["sidecar.open_data_directory.v1", "supportsOpenDataDirectory"],
      ] as const) {
        if (flag in testCase) {
          expect(testCase[flag], `${String(testCase.name)}: ${method}`).toBe(
            compiled.has(method) && advertised.has(method),
          );
        }
      }
      if (testCase.sidecarAddsUnknownFields) {
        expect(
          validateSourcesListV1Result({
            sources: [],
            futureField: { revision: 2 },
          }),
          String(testCase.name),
        ).toBe(true);
      }
    }
  });

  it("typechecks generated types with additive fields and rejects invalid known fields", () => {
    execFileSync(
      process.execPath,
      [
        "node_modules/typescript/bin/tsc",
        "-p",
        "desktop-sidecar-protocol.types.tsconfig.json",
      ],
      { cwd: path.join(repositoryRoot, "frontend"), stdio: "pipe" },
    );
  });
});

async function listJsonFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listJsonFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function walkSchema(
  schema: unknown,
  pointer: string,
  visit: (schema: Record<string, unknown>, pointer: string) => void,
): void {
  if (Array.isArray(schema)) {
    schema.forEach((value, index) =>
      walkSchema(value, `${pointer}/${index}`, visit),
    );
    return;
  }
  if (!schema || typeof schema !== "object") return;

  const record = schema as Record<string, unknown>;
  if (
    record.type === "object" ||
    (Array.isArray(record.type) && record.type.includes("object")) ||
    "properties" in record ||
    "patternProperties" in record ||
    "additionalProperties" in record
  ) {
    visit(record, pointer || "/");
  }
  for (const [key, value] of Object.entries(record)) {
    walkSchema(
      value,
      `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      visit,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
