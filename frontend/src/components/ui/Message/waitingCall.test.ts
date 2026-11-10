import { describe, expect, it } from "vitest";

import { toolNameOfCall, waitingCallOf } from "./waitingCall";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const pending = (toolCallId: string): ContentPart => ({
  content_type: "client_tool_pending",
  attempt_id: `attempt-${toolCallId}`,
  tool_call_id: toolCallId,
  pending_tool_calls: [],
});
const text: ContentPart = { content_type: "text", text: "Next step." };

describe("waitingCallOf", () => {
  it("is the last marker while it ends the row", () => {
    expect(
      waitingCallOf([pending("first"), pending("second")])?.tool_call_id,
    ).toBe("second");
  });

  it("is the marker right before the stop that carries its tasks' questions", () => {
    const stop = {
      content_type: "tool_approval_request",
    } as unknown as ContentPart;
    expect(waitingCallOf([pending("call"), stop])?.tool_call_id).toBe("call");
  });

  it("is nothing once anything else followed the last marker", () => {
    expect(waitingCallOf([pending("call"), text])).toBeUndefined();
    expect(waitingCallOf([text])).toBeUndefined();
  });
});

describe("toolNameOfCall", () => {
  it("names the tool of the call's own step", () => {
    expect(
      toolNameOfCall(
        [
          {
            content_type: "tool_use",
            tool_call_id: "call",
            tool_name: "search_sidecar_index",
            status: "success",
          },
        ],
        "call",
      ),
    ).toBe("search_sidecar_index");
    expect(toolNameOfCall([text], "call")).toBeUndefined();
  });
});
