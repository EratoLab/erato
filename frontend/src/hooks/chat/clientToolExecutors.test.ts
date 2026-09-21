import { afterEach, expect, it } from "vitest";

import {
  getClientToolExecutor,
  getClientToolHeaders,
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "./clientToolExecutors";

afterEach(resetClientToolRegistryForTests);

it("only advertises currently available tools, including after disconnection", async () => {
  let ready = false;
  const unregister = registerClientToolExecutor(
    "search_sidecar_index",
    async () => ({ ok: true, result: null }),
    () => ready,
  );
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe("");
  expect(getClientToolExecutor("search_sidecar_index")).toBeUndefined();
  ready = true;
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe(
    "search_sidecar_index",
  );
  ready = false;
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe("");
  unregister();
  ready = true;
  expect(getClientToolExecutor("search_sidecar_index")).toBeUndefined();
});

it("keeps legacy registrations available and prevents older cleanup removing a replacement", () => {
  const oldCleanup = registerClientToolExecutor(
    "fetch_availability",
    async () => ({ ok: true, result: 1 }),
  );
  registerClientToolExecutor("fetch_availability", async () => ({
    ok: true,
    result: 2,
  }));
  oldCleanup();
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe(
    "fetch_availability",
  );
});
