import { toast } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InteractionRequiredError } from "../../../core/auth/AuthSource";
import {
  EntraGraphTokenProvider,
  useGraphTokenOptional,
  type GraphTokenContextValue,
} from "../EntraGraphTokenProvider";

import type {
  AuthSource,
  GraphCapableSource,
} from "../../../core/auth/AuthSource";

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
vi.mock("../../../core/SessionAuthProvider", () => ({
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

function mountLatest(source: AuthSource & GraphCapableSource): {
  current: GraphTokenContextValue | null;
} {
  const latest: { current: GraphTokenContextValue | null } = { current: null };
  function Probe() {
    latest.current = useGraphTokenOptional();
    return null;
  }
  render(
    <EntraGraphTokenProvider source={source}>
      <Probe />
    </EntraGraphTokenProvider>,
  );
  return latest;
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

  it("prompts for access, not a sign-in, when only a scope grant is missing", async () => {
    const source = {
      acquireGraphToken: vi.fn().mockRejectedValue(
        new InteractionRequiredError("consent_required", {
          reason: "consent",
        }),
      ),
    } as unknown as AuthSource & GraphCapableSource;
    const latest = mountLatest(source);

    await expect(
      latest.current!.acquireToken(["Mail.Read.Shared"]),
    ).rejects.toBeInstanceOf(InteractionRequiredError);

    // The user is signed in; "Sign in" would send them to a step that
    // cannot fix a missing grant.
    expect(toast.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Allow access to load email",
        actions: [expect.objectContaining({ label: "Allow access" })],
      }),
    );
  });

  it("bumps signInCount once the prompt's action completes a sign-in", async () => {
    const source = {
      acquireGraphToken: vi.fn(
        async (_scopes: string[], options?: { allowInteraction?: boolean }) => {
          if (options?.allowInteraction) {
            return { accessToken: "graph-token", bootstrap: "bootstrap" };
          }
          throw new InteractionRequiredError("interaction_required");
        },
      ),
    } as unknown as AuthSource & GraphCapableSource;
    const latest = mountLatest(source);
    expect(latest.current?.signInCount).toBe(0);

    await expect(
      latest.current!.acquireToken(["Mail.Read"]),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    const [prompt] = vi.mocked(toast.warning).mock.calls[0] as unknown as [
      { actions: Array<{ onClick: () => void }> },
    ];

    await act(async () => {
      prompt.actions[0].onClick();
    });

    // Consumers holding a failed Graph-backed query key their retry on this.
    expect(latest.current?.signInCount).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
