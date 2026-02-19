import { afterEach, describe, expect, it, vi } from "vitest";

import { createSSEConnection } from "./sseClient";

const makeStream = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
};

const waitForAsyncWork = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("sseClient fetch parser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses multiline SSE data blocks with event and id", async () => {
    const onMessage = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body: makeStream([
          "event: custom\nid: 42\ndata: first line\ndata: second line\n\n",
        ]),
      }),
    );

    createSSEConnection("/api/test", {
      method: "POST",
      onMessage,
      onError: vi.fn(),
      onClose: vi.fn(),
    });

    await waitForAsyncWork();

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      data: "first line\nsecond line",
      type: "custom",
      id: "42",
    });
  });

  it("fires onClose only once when stream ends and cleanup is called", async () => {
    const onClose = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body: makeStream(["data: done\n\n"]),
      }),
    );

    const cleanup = createSSEConnection("/api/test", {
      method: "POST",
      onMessage: vi.fn(),
      onError: vi.fn(),
      onClose,
    });

    await waitForAsyncWork();
    cleanup();
    await waitForAsyncWork();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
