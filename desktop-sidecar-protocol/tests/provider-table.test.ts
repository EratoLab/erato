import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { SIDECAR_PROVIDER } from "../typescript/src/index.js";
import { validateToolProviderTable } from "../typescript/src/generated/validators.mjs";

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
      expect(method, method).not.toMatch(
        /^(?:rpc|erato|jobs|local_contexts|local_tasks|local_exports)\./,
      );
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
      get_sidecar_folder_hierarchy: "/nodes",
      search_sidecar_index: "/hits",
      get_sidecar_document: "content",
      read_sidecar_conversation: "/messages",
    });
  });
});
