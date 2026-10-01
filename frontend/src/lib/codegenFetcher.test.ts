import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

import {
  generateReactQueryComponents,
  generateSchemaTypes,
} from "@openapi-codegen/typescript";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";

const postprocessor = resolve("scripts/fix-codegen-types.mjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function generatedFixture() {
  const directory = mkdtempSync(join(tmpdir(), "erato-codegen-query-"));
  directories.push(directory);
  const generated = join(directory, "src/lib/generated/v1betaApi");
  mkdirSync(generated, { recursive: true });
  const context: Parameters<typeof generateReactQueryComponents>[0] = {
    openAPIDocument: {
      openapi: "3.0.0",
      info: { title: "Query regression", version: "1" },
      paths: {
        "/operations": {
          get: {
            operationId: "listOperations",
            parameters: [
              {
                name: "after",
                in: "query",
                schema: { type: "string", format: "uuid" },
              },
            ],
            responses: {
              "200": {
                description: "Page",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Page" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Page: { type: "object", properties: { after: { type: "string" } } },
        },
      },
    },
    existsFile: (file) => existsSync(join(generated, file)),
    readFile: async (file) => readFileSync(join(generated, file), "utf8"),
    writeFile: async (file, content) => {
      writeFileSync(join(generated, file), content);
    },
  };
  async function generate() {
    const { schemasFiles } = await generateSchemaTypes(context, {
      filenamePrefix: "v1betaApi",
    });
    await generateReactQueryComponents(context, {
      filenamePrefix: "v1betaApi",
      schemasFiles,
    });
  }
  await generate();
  const fetcher = join(generated, "v1betaApiFetcher.ts");
  return {
    directory,
    fetcher,
    generate,
    read: () => readFileSync(fetcher, "utf8"),
    patch: () =>
      execFileSync(process.execPath, [postprocessor], {
        cwd: directory,
        encoding: "utf8",
      }),
  };
}

it("restores safe query serialization after clean generation and preserves it on repeated generation", async () => {
  const fixture = await generatedFixture();
  fixture.patch();
  const fixed = fixture.read();

  // Exercise the freshly generated and patched transport, not a copy of its serializer.
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({}),
  });
  const exports: Record<string, (options: unknown) => Promise<unknown>> = {};
  const compiled = ts.transpileModule(fixed, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  runInNewContext(compiled.outputText, {
    exports,
    window: { fetch: fetchMock },
    URLSearchParams,
    FormData,
  });
  await exports.v1betaApiFetch({
    url: "/operations",
    method: "get",
    queryParams: { after: undefined },
  });
  await exports.v1betaApiFetch({
    url: "/operations",
    method: "get",
    queryParams: { after: "550e8400-e29b-41d4-a716-446655440000" },
  });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/operations",
    "/operations?after=550e8400-e29b-41d4-a716-446655440000",
  ]);

  fixture.patch();
  expect(fixture.read()).toBe(fixed);
  await fixture.generate();
  fixture.patch();
  expect(fixture.read()).toBe(fixed);
});

it("fails regeneration visibly when the query serializer template changes", async () => {
  const fixture = await generatedFixture();
  const original = fixture.read();
  const changed = original.replace(
    "new URLSearchParams(queryParams).toString()",
    "changedGeneratorSerializer(queryParams)",
  );
  expect(changed).not.toBe(original);
  writeFileSync(fixture.fetcher, changed);
  const result = spawnSync(process.execPath, [postprocessor], {
    cwd: fixture.directory,
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Unexpected fetcher query parameter template",
  );
});
