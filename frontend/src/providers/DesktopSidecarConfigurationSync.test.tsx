import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DesktopSidecarConfigurationSync,
  DesktopSidecarProvider,
} from "./DesktopSidecarProvider";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  supports: vi.fn(() => true),
  invalidateQueries: vi.fn(),
  snapshot: {
    state: "ready",
    instanceId: "instance",
    localDelegation: undefined as { enforcement?: string } | undefined,
  },
  organization: {
    policy_guides: {
      policies: {
        confidential: {
          enabled: true,
          question: "Is this confidential?",
          choice_refuse: "Confidential",
          choice_allow: "Public",
          decision_providers: ["first", "second"],
          metadata: { nested: [true, { label: "Policy" }] },
        },
      },
    },
  },
}));

vi.mock("@erato/desktop-sidecar-protocol", () => ({
  DesktopSidecarClient: class {
    invoke = mocks.invoke;
    supports = mocks.supports;
    getSnapshot = () => mocks.snapshot;
    subscribe = () => () => undefined;
    discover = async () => undefined;
    reset = () => undefined;
  },
  HttpTransport: class {},
  createBrowserClientInfo: () => ({}),
}));
vi.mock("@/hooks/profile/useProfileApi", () => ({
  useProfileApi: () => ({
    profile: { email: "user@example.test", organization_user_id: "user-id" },
  }),
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useOrganizationConfiguration: () => ({ data: mocks.organization }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));
const queryClient = { invalidateQueries: mocks.invalidateQueries };

const saved = {
  user_configuration: {
    show_tray_icon: false,
    future_setting: { preserve: true },
  },
  organization_configuration: { policy_guides: { policies: { obsolete: {} } } },
};

function mount() {
  return render(
    <DesktopSidecarProvider
      endpoint="http://localhost/rpc"
      retryDiscovery={false}
    >
      <DesktopSidecarConfigurationSync />
    </DesktopSidecarProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.localDelegation = undefined;
  mocks.snapshot.state = "ready";
  mocks.supports.mockReturnValue(true);
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === "indexing.status.v1") return { configuration: saved };
    if (method === "outlook.list_mailboxes.v1") return { mailboxes: [] };
    return {};
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("DesktopSidecarConfigurationSync", () => {
  it.each([
    undefined,
    { enforcement: "enforced" },
    { enforcement: "future-mode" },
    {},
  ])(
    "sends configuration independently of delegation declaration %j",
    async (declaration) => {
      mocks.snapshot.localDelegation = declaration;
      mount();
      await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled());
      expect(mocks.invoke).toHaveBeenCalledWith(
        "sidecar.configure.v1",
        {
          ...saved,
          organization_configuration: mocks.organization,
          signed_in_user: {
            user_id: "user-id",
            tenant_id: null,
            email: "user@example.test",
            user_principal_name: null,
          },
        },
        { signal: expect.any(AbortSignal) },
      );
    },
  );

  it("still sends configuration when optional mailbox enumeration is denied", async () => {
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === "indexing.status.v1") return { configuration: saved };
      if (method === "outlook.list_mailboxes.v1") throw new Error("denied");
      return {};
    });
    mount();
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith(
      "sidecar.configure.v1",
      expect.objectContaining({ user_configuration: saved.user_configuration }),
      expect.anything(),
    );
  });

  it("respects configuration rejection without reporting a successful refresh", async () => {
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === "indexing.status.v1") return { configuration: saved };
      if (method === "outlook.list_mailboxes.v1") return { mailboxes: [] };
      throw new Error("sidecar does not trust outside configuration");
    });
    mount();
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(
      mocks.invoke.mock.calls.filter(
        ([method]) => method === "sidecar.configure.v1",
      ),
    ).toHaveLength(1);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it.each(["missing", "denied"])(
    "does not replace saved user settings when configuration is %s",
    async (mode) => {
      mocks.invoke.mockImplementation(async () => {
        if (mode === "denied") throw new Error("status denied");
        return {};
      });
      mount();
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith(
          "indexing.status.v1",
          {},
          expect.anything(),
        ),
      );
      expect(
        mocks.invoke.mock.calls.some(
          ([method]) => method === "sidecar.configure.v1",
        ),
      ).toBe(false);
      expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    },
  );

  it.each(["sidecar.configure.v1", "indexing.status.v1"])(
    "requires capability %s",
    async (missing) => {
      mocks.supports.mockImplementation(
        (method?: string) => method !== missing,
      );
      mount();
      await waitFor(() => expect(mocks.supports).toHaveBeenCalledWith(missing));
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );
});
