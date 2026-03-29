import { describe, it, expect } from "vitest";

import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import { callOfficeAsync } from "../officeAsync";

describe("callOfficeAsync", () => {
  it("resolves with the value on success", async () => {
    const result = await callOfficeAsync<string>((callback) => {
      callback(createMockAsyncResult("hello"));
    });

    expect(result).toBe("hello");
  });

  it("rejects with the error message on failure", async () => {
    await expect(
      callOfficeAsync<string>((callback) => {
        callback(
          createMockAsyncResult(null as unknown as string, "failed", {
            message: "Item not found",
            code: "5001",
          }),
        );
      }),
    ).rejects.toThrow("Item not found");
  });

  it("rejects with a default message when error has no message", async () => {
    await expect(
      callOfficeAsync<string>((callback) => {
        callback(createMockAsyncResult(null as unknown as string, "failed"));
      }),
    ).rejects.toThrow("Office async call failed");
  });
});
