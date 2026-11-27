import { i18n, type Messages } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { SignedOutError } from "@/auth/authRecovery";
import {
  markClosedStream,
  markNetworkFailure,
  markStalledStream,
} from "@/lib/connectivity/connectivity";
import enMessages from "@/locales/en/messages.json";
import { FrontendRequestError } from "@/utils/errorReport";
import { plainErrorMessage } from "@/utils/plainErrorMessage";

beforeAll(() => {
  i18n.load("en", enMessages.messages as unknown as Messages);
  i18n.activate("en");
});

const NO_CONNECTION =
  "No connection to the server. Check your network and try again.";

describe("plainErrorMessage", () => {
  it("says there is no connection for a request the request layer tagged", () => {
    expect(
      plainErrorMessage(
        markNetworkFailure({
          name: "unknown",
          message: "Network error (Load failed)",
        }),
      ),
    ).toBe(NO_CONNECTION);
  });

  it("reads plain objects instead of printing [object Object]", () => {
    expect(plainErrorMessage({ status: 500, payload: "{}" })).toBeNull();
    expect(plainErrorMessage({})).toBeNull();
    expect(plainErrorMessage(null)).toBeNull();
  });

  it("uses the connectivity tags", () => {
    expect(plainErrorMessage(markNetworkFailure(new Error("weird")))).toBe(
      NO_CONNECTION,
    );
    expect(
      plainErrorMessage(markStalledStream(new Error("SSE stream stalled"))),
    ).toBe("The server stopped answering. Please try again.");
  });

  it("names stream and server problems in plain words", () => {
    expect(
      plainErrorMessage(
        markClosedStream(
          new Error("SSE connection closed unexpectedly (edit)"),
        ),
      ),
    ).toBe("The connection to the server was lost. Please try again.");
    expect(
      plainErrorMessage(new Error("Network error (request timed out)")),
    ).toBe("The server did not answer in time. Please try again.");
    expect(
      plainErrorMessage(
        new FrontendRequestError(
          "SSE request failed: 502 Bad Gateway",
          { method: "POST", url: "/api" },
          { status: 502, statusText: "Bad Gateway" },
        ),
      ),
    ).toBe("The server did not answer. Please try again in a moment.");
    expect(plainErrorMessage({ status: 504, payload: "" })).toBe(
      "The server did not answer. Please try again in a moment.",
    );
  });

  it("says a signed-out session in plain words", () => {
    expect(plainErrorMessage(new SignedOutError())).toBe(
      "You are signed out. Reload to sign in again.",
    );
  });

  it("keeps any other message, so the server's detail is not lost", () => {
    expect(
      plainErrorMessage(new Error("SSE request failed: budget exceeded")),
    ).toBe("SSE request failed: budget exceeded");
  });
});
