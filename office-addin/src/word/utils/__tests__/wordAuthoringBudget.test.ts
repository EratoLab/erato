import { describe, expect, it, vi } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { checkWordAuthoringBudget } from "../wordAuthoringBudget";

const estimate = vi.hoisted(() => vi.fn());
vi.mock("@erato/frontend/library", () => ({
  fetchTokenUsageEstimate: estimate,
}));
describe("authoring model budget", () => {
  it("reserves source and output context against the selected model and existing chat", async () => {
    estimate.mockResolvedValue({
      stats: { total_tokens: 30000, max_tokens: 128000 },
    });
    const s = readySnapshot();
    expect(
      await checkWordAuthoringBudget(s, {
        message: "Restructure",
        mode: "complete",
        chatId: "chat",
        modelId: "model",
        fileIds: ["file"],
      }),
    ).toEqual({ ok: true });
    const request = estimate.mock.calls.at(-1)?.[0].body;
    expect(request).toMatchObject({
      existing_chat_id: "chat",
      chat_provider_id: "model",
      input_files_ids: ["file"],
    });
    expect(request.user_message).toContain("Pilot in October.");
    expect(request.user_message).not.toContain("pkg:package");
  });
  it("keeps scoped estimation independent of captured document contents", async () => {
    estimate.mockResolvedValue({
      stats: { total_tokens: 10000, max_tokens: 128000 },
    });
    const snapshot = readySnapshot();
    await checkWordAuthoringBudget(snapshot, {
      message: "Local edit",
      chatId: null,
    });
    const before = estimate.mock.calls.at(-1)?.[0].body.user_message;
    snapshot.blocks = Array.from({ length: 1000 }, (_, i) => ({
      ...snapshot.blocks[0],
      ref: `b${i}`,
      text: `Private content ${i}`,
    }));
    await checkWordAuthoringBudget(snapshot, {
      message: "Local edit",
      chatId: null,
    });
    const after = estimate.mock.calls.at(-1)?.[0].body.user_message;
    expect(after).toBe(before);
    expect(after).not.toContain("Private content");
    expect(after).not.toContain("Pilot in October.");
  });
  it("reports insufficient context only after a successful estimate", async () => {
    estimate.mockResolvedValue({
      stats: { total_tokens: 30000, max_tokens: 32000 },
    });
    expect(
      await checkWordAuthoringBudget(readySnapshot(), {
        message: "Rewrite",
        chatId: null,
      }),
    ).toEqual({ ok: false, issue: "model-budget" });
  });
  it.each([
    [new Error("offline"), "estimate-failed"],
    [{ status: 500, payload: "private backend details" }, "estimate-http-500"],
    [{ status: 401, payload: "private session details" }, "estimate-http-401"],
  ])(
    "distinguishes an unavailable estimate from insufficient context: %j",
    async (error, detail) => {
      estimate.mockRejectedValue(error);
      expect(
        await checkWordAuthoringBudget(readySnapshot(), {
          message: "Rewrite",
          chatId: null,
        }),
      ).toEqual({
        ok: false,
        issue: "budget-unavailable",
        details: [detail],
      });
    },
  );
  it.each([
    undefined,
    {},
    { total_tokens: 100, max_tokens: 0 },
    { total_tokens: -1, max_tokens: 128000 },
    { total_tokens: NaN, max_tokens: 128000 },
    { total_tokens: 100, max_tokens: Infinity },
  ])("fails closed on invalid estimate statistics: %j", async (stats) => {
    estimate.mockResolvedValue({ stats });
    expect(
      await checkWordAuthoringBudget(readySnapshot(), {
        message: "Rewrite",
        chatId: null,
      }),
    ).toEqual({
      ok: false,
      issue: "budget-unavailable",
      details: ["estimate-invalid"],
    });
  });
  it("times out the estimate so an unavailable endpoint cannot hold the composer indefinitely", async () => {
    vi.useFakeTimers();
    try {
      estimate.mockImplementation(
        (_request, signal: AbortSignal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      );
      const result = checkWordAuthoringBudget(readySnapshot(), {
        message: "Rewrite",
        chatId: null,
      });
      await vi.advanceTimersByTimeAsync(15000);
      expect(await result).toEqual({
        ok: false,
        issue: "budget-unavailable",
        details: ["estimate-timeout"],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
