import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "../SharedAddinShell";

const spies = vi.hoisted(() => ({
  sessionAuth: {
    current: {
      isInitialized: true,
      isAuthenticated: true,
      retryAuthentication: () => undefined,
      error: null as string | null,
    },
  },
}));

vi.mock("@erato/frontend/library", () => ({
  GenerationStatusPoller: ({ seedOnMount }: { seedOnMount?: boolean }) => (
    <div data-testid="generation-poller" data-seed={String(seedOnMount)} />
  ),
}));

vi.mock("../SessionAuthProvider", () => ({
  useSessionAuth: () => spies.sessionAuth.current,
}));

/**
 * The poller seeds once on mount, so where it mounts decides whether that
 * request is authenticated. Above the gate it would fire before
 * SessionAuthProvider exists at all — a guaranteed 401 on a cold session,
 * whose recovery advances the auth refresh backoff.
 */
describe("AuthGate", () => {
  beforeEach(() => {
    i18n.activate("en");
    spies.sessionAuth.current = {
      isInitialized: true,
      isAuthenticated: true,
      retryAuthentication: () => undefined,
      error: null,
    };
  });

  it("mounts no poller while authentication is still initializing", () => {
    spies.sessionAuth.current = {
      ...spies.sessionAuth.current,
      isInitialized: false,
    };

    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    );

    expect(screen.queryByTestId("generation-poller")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app")).not.toBeInTheDocument();
  });

  it("mounts no poller for a user who is not signed in", () => {
    spies.sessionAuth.current = {
      ...spies.sessionAuth.current,
      isAuthenticated: false,
    };

    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    );

    expect(screen.queryByTestId("generation-poller")).not.toBeInTheDocument();
  });

  it("seeds the status poll once the session is established", () => {
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    );

    expect(screen.getByTestId("app")).toBeInTheDocument();
    expect(screen.getByTestId("generation-poller")).toHaveAttribute(
      "data-seed",
      "true",
    );
  });
});
