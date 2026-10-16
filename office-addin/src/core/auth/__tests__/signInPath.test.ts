import { afterEach, describe, expect, it } from "vitest";

import {
  InteractionRequiredError,
  NestedAppAuthUnavailableError,
} from "../AuthSource";
import { Oauth2ProxySessionRedeemError } from "../oauth2ProxySession";
import {
  describeSignInFailure,
  readRememberedProxyLogin,
  rememberProxyLogin,
  shouldSwitchToProxyLogin,
} from "../signInPath";

// Shaped like MSAL's AuthError subclasses, which core never imports.
function msalError(errorCode: string, message = errorCode, name = "AuthError") {
  const error = new Error(message) as Error & { errorCode: string };
  error.name = name;
  error.errorCode = errorCode;
  return error;
}

describe("shouldSwitchToProxyLogin", () => {
  it.each([
    ["the browser popup", msalError("user_cancelled")],
    ["the NAA bridge", msalError("user_canceled", "", "ClientAuthError")],
  ])("stays on NAA when the user cancels %s", (_, error) => {
    expect(shouldSwitchToProxyLogin(error)).toBe(false);
  });

  it.each([
    ["the core signal", new InteractionRequiredError()],
    [
      "MSAL's error",
      msalError("consent_required", "", "InteractionRequiredAuthError"),
    ],
  ])("stays on NAA when %s asks for interaction", (_, error) => {
    expect(shouldSwitchToProxyLogin(error)).toBe(false);
  });

  it("stays on NAA when the device is offline or a prompt is already open", () => {
    expect(shouldSwitchToProxyLogin(msalError("no_network_connectivity"))).toBe(
      false,
    );
    expect(shouldSwitchToProxyLogin(msalError("interaction_in_progress"))).toBe(
      false,
    );
  });

  it("stays on NAA when the redeem request never reached the proxy", () => {
    expect(
      shouldSwitchToProxyLogin(
        new Oauth2ProxySessionRedeemError("could not reach oauth2-proxy"),
      ),
    ).toBe(false);
  });

  it.each([
    ["a missing bridge", new NestedAppAuthUnavailableError()],
    ["a disabled bridge", msalError("nested_app_auth_bridge_disabled")],
    ["an MSAL timeout", msalError("timed_out")],
    [
      "an Entra error",
      msalError(
        "invalid_request",
        "AADSTS50011: The redirect URI does not match",
        "ServerError",
      ),
    ],
    ["a host without an Entra account", msalError("no_account_found")],
    [
      "a token the proxy refused",
      new Oauth2ProxySessionRedeemError("rejected", { status: 403 }),
    ],
    ["an unknown error", new Error("boom")],
  ])("switches to the proxy login on %s", (_, error) => {
    expect(shouldSwitchToProxyLogin(error)).toBe(true);
  });
});

describe("describeSignInFailure", () => {
  it("names MSAL codes, Entra codes and redeem statuses without the message text", () => {
    expect(describeSignInFailure(msalError("timed_out"))).toBe("timed_out");
    expect(
      describeSignInFailure(
        msalError(
          "invalid_request",
          "AADSTS50011: The redirect URI 'secret' does not match",
          "ServerError",
        ),
      ),
    ).toBe("invalid_request:AADSTS50011");
    expect(
      describeSignInFailure(
        new Oauth2ProxySessionRedeemError("rejected", {
          status: 401,
          body: "id_token=abc",
        }),
      ),
    ).toBe("redeem_401");
    expect(
      describeSignInFailure(new Oauth2ProxySessionRedeemError("offline")),
    ).toBe("redeem_network_error");
    expect(describeSignInFailure(new NestedAppAuthUnavailableError())).toBe(
      "naa_bridge_unavailable",
    );
    expect(describeSignInFailure(new TypeError("token abc"))).toBe("TypeError");
  });
});

describe("remembered proxy login", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("is off until a switch is remembered for this pane session", () => {
    expect(readRememberedProxyLogin()).toBe(false);
    rememberProxyLogin();
    expect(readRememberedProxyLogin()).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });
});
