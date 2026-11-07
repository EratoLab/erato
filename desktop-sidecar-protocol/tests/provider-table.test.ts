import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopSidecarClient,
  HttpTransport,
  SIDECAR_PROVIDER,
  type CallToolResult,
  type JobsStartV1Params,
} from "../typescript/src/index.js";
import { validateToolProviderTable } from "../typescript/src/generated/validators.mjs";
import { MockSidecar, createMockSidecar } from "../test-server/src/index.js";

const document = JSON.parse(
  await readFile(new URL("../openrpc.json", import.meta.url), "utf8"),
) as { methods: { name: string }[] };
const table = JSON.parse(
  await readFile(new URL("../providers/sidecar.json", import.meta.url), "utf8"),
) as typeof SIDECAR_PROVIDER;

/** Human-only and operational methods; never part of a tool. */
const ADMINISTRATIVE_METHODS = [
  "sidecar.configure.v1",
  "sidecar.restart.v1",
  "sidecar.request_permission.v1",
  "sidecar.open_data_directory.v1",
  "sidecar.status.v1",
  "sidecar.install_ui_package.v1",
  "sidecar.progress.v1",
  "diagnostics.echo.v1",
  "indexing.status.v1",
  "indexing.start.v1",
  "indexing.stop.v1",
  "indexing.reset.v1",
  "indexing.benchmark.start.v1",
  "indexing.benchmark.status.v1",
  "indexing.benchmark.list.v1",
];
/** RPCs that exist for non-LLM clients but are not tools. */
const NON_TOOL_METHODS = ["outlook.list_emails.v1", "outlook.search_emails.v1"];
const ORIGIN = "https://app.erato.example";
const activeSidecars: MockSidecar[] = [];

afterEach(async () => {
  await Promise.all(activeSidecars.splice(0).map((sidecar) => sidecar.stop()));
});

/** The value an RFC 6901 JSON pointer names, or undefined. */
function resolvePointer(value: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>(
      (node, key) =>
        node !== null && typeof node === "object" && Object.hasOwn(node, key)
          ? (node as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

describe("sidecar provider table", () => {
  it("is a valid provider table and the library exports it unchanged", () => {
    expect(validateToolProviderTable(table)).toBe(true);
    expect(SIDECAR_PROVIDER).toEqual(table);
  });

  it("enumerates exactly the six read-only built-in tools", () => {
    expect(table).toMatchObject({
      id: "sidecar",
      readOnly: true,
      egress: "none",
    });
    expect(table.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "get_sidecar_document",
        "get_sidecar_folder_hierarchy",
        "get_sidecar_search_fields",
        "list_sidecar_mailboxes",
        "read_sidecar_conversation",
        "search_sidecar_index",
      ].sort(),
    );
    for (const tool of table.tools) expect(tool.readOnly, tool.name).toBe(true);
  });

  it("references only methods the catalogue defines", () => {
    const defined = new Set(document.methods.map((method) => method.name));
    for (const tool of table.tools)
      for (const method of tool.methods)
        expect(defined.has(method), `${tool.name}: ${method}`).toBe(true);
  });

  it("is a closed enumeration without administrative or operational methods", () => {
    const referenced = new Set(table.tools.flatMap((tool) => tool.methods));
    for (const method of [...ADMINISTRATIVE_METHODS, ...NON_TOOL_METHODS]) {
      expect(referenced.has(method), method).toBe(false);
    }
    for (const method of referenced)
      expect(method, method).not.toMatch(/^(?:rpc|erato|jobs)\./);
    expect([...referenced].sort()).toEqual(
      [
        "outlook.get_conversation.v1",
        "outlook.list_mailboxes.v1",
        "search.metadata_fields.v1",
        "search.query.v1",
        "sources.get_document.v1",
        "sources.get_folder_hierarchy.v1",
        "sources.list.v1",
      ].sort(),
    );
  });

  it("declares what strict review selects per tool", () => {
    const selection = Object.fromEntries(
      table.tools.map((tool) => [tool.name, tool.selection?.items ?? null]),
    );
    expect(selection).toEqual({
      list_sidecar_mailboxes: null,
      get_sidecar_search_fields: null,
      get_sidecar_folder_hierarchy:
        "/sources.get_folder_hierarchy.v1/result/nodes",
      search_sidecar_index: "/search.query.v1/result/hits",
      get_sidecar_document: "content",
      read_sidecar_conversation: "/outlook.get_conversation.v1/result/messages",
    });
    // Each pointer starts at one of the tool's own methods.
    for (const tool of table.tools)
      for (const pointer of [
        tool.selection?.items,
        ...(tool.selection?.resultMetadata ?? []),
        ...(tool.selection?.itemMetadata ?? []).map((entry) => entry.pointer),
      ].filter((value) => value?.startsWith("/")))
        expect(tool.methods, `${tool.name}: ${pointer}`).toContain(
          pointer?.split("/")[1],
        );
  });

  it("points only into the results the tools return", async () => {
    const sidecar = await createMockSidecar({ allowedOrigins: [ORIGIN] });
    activeSidecars.push(sidecar);
    const client = new DesktopSidecarClient({
      transport: new HttpTransport(sidecar.address.url, {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Origin", ORIGIN);
          return fetch(input, { ...init, headers });
        },
      }),
      clientInfo: {
        name: "erato-test-client",
        version: "0.1.0",
        host: { application: "test", runtime: "node" },
        os: { name: "test" },
      },
    });
    await client.discover();
    const run = async (name: string, variants: Record<string, unknown>[]) => {
      const { results } = await client.invoke("jobs.start.v1", {
        calls: variants.map((args) => ({
          server: "sidecar",
          name,
          arguments: args,
        })) as JobsStartV1Params["calls"],
        wait_ms: 5_000,
      });
      return (results ?? []).map((entry) => {
        const { result } = entry as { result?: CallToolResult };
        if (!result) throw new Error(`${name} failed.`);
        return result;
      });
    };
    const [mailboxes] = await run("list_sidecar_mailboxes", [{}]);
    const sourceId = resolvePointer(
      mailboxes?.structuredContent,
      "/sources.list.v1/result/sources/0/sourceId",
    );
    // Each tool's result variants, including methods that only some calls
    // run: the source list beside unsupported folders, and the field list
    // beside a metadata filter.
    const variants: Record<string, Record<string, unknown>[]> = {
      list_sidecar_mailboxes: [{}],
      get_sidecar_search_fields: [{}],
      get_sidecar_folder_hierarchy: [
        { sourceId },
        { sourceId: "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a" },
      ],
      search_sidecar_index: [
        { query: "report" },
        {
          query: "report",
          metadata_filters: [
            { field: "category", operator: "eq", value: "Finance" },
          ],
        },
      ],
      get_sidecar_document: [
        { documentId: "2b0f6a43-8f5e-4c79-9d8e-0d6b5e7a9c11" },
      ],
      read_sidecar_conversation: [
        {
          mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
          internetMessageId: "<mock-outlook-email@example.com>",
        },
      ],
    };
    for (const tool of table.tools) {
      const results = await run(tool.name, variants[tool.name] ?? []);
      expect(results.length, tool.name).toBeGreaterThan(0);
      if (!tool.selection) continue;
      const { items, resultMetadata, itemMetadata = [] } = tool.selection;
      const selected = results.map((result) =>
        items === "content"
          ? result.content
          : resolvePointer(result.structuredContent, items),
      );
      expect(selected.some(Array.isArray), `${tool.name}: ${items}`).toBe(true);
      for (const pointer of resultMetadata)
        expect(
          results.some(
            (result) =>
              resolvePointer(result.structuredContent, pointer) !== undefined,
          ),
          `${tool.name}: ${pointer}`,
        ).toBe(true);
      for (const { pointer } of itemMetadata)
        expect(
          results.some((result) =>
            Array.isArray(resolvePointer(result.structuredContent, pointer)),
          ),
          `${tool.name}: ${pointer}`,
        ).toBe(true);
    }
  });
});
