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
  fetchUiPackageToken: vi.fn(),
  organizationEnabled: [] as (boolean | undefined)[],
  profile: undefined as
    | { email: string; organization_user_id: string | null }
    | undefined,
  snapshot: {
    state: "ready",
    instanceId: "instance",
    strict: undefined as boolean | undefined,
    ui: undefined as
      | { host_apis: number[]; seed: null; installed: null }
      | undefined,
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
  UI_PACKAGE_CHUNK_BYTES: 131_072,
  UI_PACKAGE_MAX_ARCHIVE_BYTES: 9_437_184,
}));
vi.mock("@/hooks/profile/useProfileApi", () => ({
  useProfileApi: () => ({ profile: mocks.profile }),
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useOrganizationConfiguration: (
    _params: unknown,
    options: { enabled?: boolean },
  ) => {
    mocks.organizationEnabled.push(options.enabled);
    return { data: options.enabled ? mocks.organization : undefined };
  },
  fetchUiPackageToken: mocks.fetchUiPackageToken,
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

const tree = () => (
  <DesktopSidecarProvider
    endpoint="http://localhost/rpc"
    retryDiscovery={false}
  >
    <DesktopSidecarConfigurationSync />
  </DesktopSidecarProvider>
);

function mount() {
  return render(tree());
}

const packageToken = {
  url: "/api/v1beta/desktop-sidecar/ui-package",
  token: "1762560000.signature",
  digest: "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab",
  host_api: 1,
  expires_at: "2026-11-07T12:00:00Z",
};

beforeEach(() => {
  mocks.snapshot.state = "ready";
  mocks.organizationEnabled.length = 0;
  mocks.profile = {
    email: "user@example.test",
    organization_user_id: "user-id",
  };
  vi.clearAllMocks();
  mocks.snapshot.strict = undefined;
  mocks.snapshot.ui = undefined;
  mocks.snapshot.state = "ready";
  mocks.supports.mockReturnValue(true);
  mocks.fetchUiPackageToken.mockResolvedValue(packageToken);
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === "indexing.status.v1") return { configuration: saved };
    if (method === "outlook.list_mailboxes.v1") return { mailboxes: [] };
    return {};
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("DesktopSidecarConfigurationSync", () => {
  it.each([undefined, false, true])(
    "sends configuration independently of strict mode %j",
    async (strict) => {
      mocks.snapshot.strict = strict;
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

  it("waits for the profile before configuring", async () => {
    mocks.profile = undefined;
    const { rerender } = mount();
    await waitFor(() => expect(mocks.organizationEnabled).toContain(true));
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.profile = {
      email: "user@example.test",
      organization_user_id: "user-id",
    };
    rerender(tree());
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "sidecar.configure.v1",
        expect.objectContaining({
          signed_in_user: expect.objectContaining({ user_id: "user-id" }),
        }),
        expect.anything(),
      ),
    );
  });

  it("configures a loaded profile without an Entra ID sign-in", async () => {
    mocks.profile = {
      email: "user@example.test",
      organization_user_id: null,
    };
    mount();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "sidecar.configure.v1",
        expect.objectContaining({ signed_in_user: null }),
        expect.anything(),
      ),
    );
  });

  it("does not ask for the organization configuration without a ready sidecar", async () => {
    mocks.snapshot.state = "unavailable";
    mount();
    await waitFor(() =>
      expect(mocks.organizationEnabled.length).toBeGreaterThan(0),
    );
    expect(mocks.organizationEnabled).not.toContain(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

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

  it("sends the deployment's package reference to a sidecar that hosts the desktop UI", async () => {
    mocks.snapshot.ui = { host_apis: [1], seed: null, installed: null };
    mount();
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled());
    expect(mocks.fetchUiPackageToken).toHaveBeenCalledWith(
      {},
      expect.any(AbortSignal),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "sidecar.configure.v1",
      expect.objectContaining({
        ui_package: {
          url: `${window.location.origin}/api/v1beta/desktop-sidecar/ui-package`,
          token: packageToken.token,
          digest: packageToken.digest,
          host_api: 1,
        },
      }),
      expect.anything(),
    );
  });

  it("sends no package reference to a sidecar that reports no desktop UI", async () => {
    mount();
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled());
    expect(mocks.fetchUiPackageToken).not.toHaveBeenCalled();
    const [, params] = mocks.invoke.mock.calls.find(
      ([method]) => method === "sidecar.configure.v1",
    )!;
    expect(params).not.toHaveProperty("ui_package");
  });

  it("watches the package download after configuring a sidecar that takes a relayed package", async () => {
    mocks.snapshot.ui = { host_apis: [1], seed: null, installed: null };
    mount();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "sidecar.status.v1",
        {},
        expect.anything(),
      ),
    );
    const methods = mocks.invoke.mock.calls.map(([method]) => method);
    expect(methods.indexOf("sidecar.status.v1")).toBeGreaterThan(
      methods.indexOf("sidecar.configure.v1"),
    );
  });

  it.each([
    ["lists no relay method", "sidecar.install_ui_package.v1", true],
    ["reports no desktop UI", null, false],
  ])(
    "does not watch the package download of a sidecar that %s",
    async (_name, missing, ui) => {
      if (ui)
        mocks.snapshot.ui = { host_apis: [1], seed: null, installed: null };
      mocks.supports.mockImplementation(
        (method?: string) => method !== missing,
      );
      mount();
      await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        mocks.invoke.mock.calls.some(
          ([method]) => method === "sidecar.status.v1",
        ),
      ).toBe(false);
    },
  );

  it("relays a refused package download and refreshes the sidecar status", async () => {
    mocks.snapshot.ui = { host_apis: [1], seed: null, installed: null };
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === "indexing.status.v1") return { configuration: saved };
      if (method === "outlook.list_mailboxes.v1") return { mailboxes: [] };
      if (method === "sidecar.status.v1")
        return {
          permissions: {},
          ui_package: {
            state: "failed",
            digest: packageToken.digest,
            reason: "proxy",
            attempted_at: "2026-11-07T10:15:00Z",
            relay: true,
          },
        };
      if (method === "sidecar.install_ui_package.v1")
        return { state: "installed" };
      return {};
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { ETag: `"${packageToken.digest}"` },
      }),
    );
    mount();
    await waitFor(() =>
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["sidecar-status", "instance"],
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      `${window.location.origin}${packageToken.url}`,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${packageToken.token}` },
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "sidecar.install_ui_package.v1",
      expect.objectContaining({
        digest: packageToken.digest,
        total_bytes: 3,
        chunk_index: 0,
        chunk_count: 1,
        content_base64: "AQID",
      }),
      expect.anything(),
    );
  });

  it.each([
    ["serves no package", { status: 404, payload: "" }],
    ["fails", new Error("network")],
  ])(
    "still configures without a package reference when the deployment %s",
    async (_name, failure) => {
      mocks.snapshot.ui = { host_apis: [1], seed: null, installed: null };
      mocks.fetchUiPackageToken.mockRejectedValue(failure);
      mount();
      await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled());
      const [, params] = mocks.invoke.mock.calls.find(
        ([method]) => method === "sidecar.configure.v1",
      )!;
      expect(params).not.toHaveProperty("ui_package");
      expect(params).toHaveProperty("user_configuration");
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
