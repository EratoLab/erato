import { toast } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InteractionRequiredError } from "../../auth/AuthSource";
import {
  EntraGraphTokenProvider,
  useGraphTokenOptional,
  type GraphTokenContextValue,
} from "../EntraGraphTokenProvider";

import type { AuthSource, GraphCapableSource } from "../../auth/AuthSource";

vi.mock("@erato/frontend/library", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

// The provider only reads the redeem seam on the SUCCESS path; these tests
// exercise the failure path, so a fresh-session stub suffices.
vi.mock("../SessionAuthProvider", () => ({
  useSessionRedeem: () => ({
    redeemSessionForToken: vi.fn(),
    lastRedeemedAtRef: { current: Number.MAX_SAFE_INTEGER },
  }),
}));

const consentRequiredSource = {
  acquireGraphToken: vi
    .fn()
    .mockRejectedValue(new InteractionRequiredError("consent_required")),
} as unknown as AuthSource & GraphCapableSource;

function mountAcquireToken(): GraphTokenContextValue {
  let ctx: GraphTokenContextValue | null = null;
  function Probe() {
    ctx = useGraphTokenOptional();
    return null;
  }
  render(
    <EntraGraphTokenProvider source={consentRequiredSource}>
      <Probe />
    </EntraGraphTokenProvider>,
  );
  if (ctx === null) throw new Error("provider did not mount");
  return ctx;
}

describe("EntraGraphTokenProvider", () => {
  beforeEach(() => {
    i18n.activate("en");
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("fires the sign-in toast on a silent failure by default", async () => {
    const { acquireToken } = mountAcquireToken();
    await expect(acquireToken(["Mail.Read"])).rejects.toBeInstanceOf(
      InteractionRequiredError,
    );
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("suppressSignInPrompt skips the toast but still rejects (optional-scope callers degrade silently)", async () => {
    const { acquireToken } = mountAcquireToken();
    await expect(
      acquireToken(["People.Read"], { suppressSignInPrompt: true }),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
