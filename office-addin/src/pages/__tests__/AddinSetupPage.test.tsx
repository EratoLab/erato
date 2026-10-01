import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSetupRoute } from "../AddinSetupPage";

describe("AddinSetupRoute host boundary", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "Office");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "<OfficeApp />",
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  it("loads without Office.js or appending its CDN script", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild");
    render(<AddinSetupRoute />);

    expect(
      await screen.findByRole("heading", {
        name: "Upload the generated manifest",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(
      appendChild.mock.calls.some(
        ([node]) =>
          node instanceof HTMLScriptElement &&
          URL.canParse(node.src) &&
          new URL(node.src).hostname === "appsforoffice.microsoft.com",
      ),
    ).toBe(false);
  });
});

describe("AddinSetupRoute Word branch", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "Office");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "<OfficeApp />",
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  /** Locale catalogs share the fetch mock, so raw call counts include non-manifest requests. */
  function fetchedManifests(): string[] {
    return vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.includes("manifest"));
  }

  async function selectWord() {
    render(<AddinSetupRoute />);
    await waitFor(() => expect(fetchedManifests()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Word" }));
    await waitFor(() => expect(fetchedManifests()).toHaveLength(2));
  }

  it("offers Word as a selectable product and refetches the document manifest", async () => {
    await selectWord();

    const requested = fetchedManifests();
    expect(requested.at(0)).toContain("manifest.xml");
    expect(requested.at(0)).not.toContain("manifest-document.xml");
    expect(requested.at(1)).toContain("manifest-document.xml");
    expect(screen.getByRole("button", { name: "Word" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  function stubDownload(): HTMLAnchorElement {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:manifest"),
      revokeObjectURL: vi.fn(),
    });
    const anchor = document.createElement("a");
    vi.spyOn(anchor, "click").mockImplementation(() => undefined);
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    return anchor;
  }

  it("downloads the document manifest under its own filename", async () => {
    await selectWord();

    const anchor = stubDownload();
    fireEvent.click(
      screen.getByRole("button", { name: "Download manifest-document.xml" }),
    );

    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.download).toBe("manifest-document.xml");
  });

  it("leaves the Outlook download filename alone, on both Exchange variants", async () => {
    render(<AddinSetupRoute />);
    await waitFor(() => expect(fetchedManifests()).toHaveLength(1));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Exchange Server SE / Exchange Server 2016",
      }),
    );
    await waitFor(() => expect(fetchedManifests()).toHaveLength(2));
    expect(fetchedManifests().at(1)).toContain("manifest-exchange-server.xml");

    const anchor = stubDownload();
    fireEvent.click(
      screen.getByRole("button", { name: "Download manifest.xml" }),
    );

    expect(anchor.download).toBe("manifest.xml");
  });

  it("shows no Exchange-setup selector, because Word has no mailbox axis", async () => {
    await selectWord();

    expect(screen.queryByText("Exchange setup")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Exchange Online" }),
    ).not.toBeInTheDocument();
  });

  it("names both delivery routes, the Mac gap, and the SPA redirect URI", async () => {
    await selectWord();

    expect(screen.getByRole("link", { name: "Integrated Apps" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "SharePoint app catalog" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Word on Mac is not supported for on-premises mailboxes/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(`brk-multihub://${window.location.host}`),
    ).toBeVisible();
  });
});

describe("AddinSetupRoute Teams bot section", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");
  const botId = "11111111-2222-3333-4444-555555555555";

  function stubTeamsManifest(manifest: object) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          String(url).includes("teams/manifest.json")
            ? JSON.stringify(manifest)
            : "<OfficeApp />",
      })),
    );
  }

  async function selectTeams() {
    render(<AddinSetupRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Teams" }));
    const preview = screen.getByLabelText<HTMLTextAreaElement>(
      "Teams manifest preview (JSON)",
    );
    await waitFor(() => expect(preview.value).toContain("webApplicationInfo"));
  }

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "Office");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  it("stays hidden when the manifest has no bot", async () => {
    stubTeamsManifest({
      webApplicationInfo: { id: "tab", resource: "api://tab" },
    });
    await selectTeams();

    expect(
      screen.queryByRole("heading", { name: "Teams bot" }),
    ).not.toBeInTheDocument();
  });

  const authAppId = "22222222-2222-2222-2222-222222222222";
  const tenantId = "33333333-3333-3333-3333-333333333333";
  const subscriptionId = "44444444-4444-4444-4444-444444444444";

  async function prepareCommands() {
    stubTeamsManifest({
      bots: [{ botId }],
      webApplicationInfo: { id: authAppId, resource: `api://${authAppId}` },
    });
    await selectTeams();
    fireEvent.change(screen.getByLabelText("Tenant ID"), {
      target: { value: tenantId },
    });
    fireEvent.change(screen.getByLabelText("Subscription ID"), {
      target: { value: subscriptionId },
    });
  }

  it("offers Cloud Shell and reviewable source without a local download/upload", async () => {
    stubTeamsManifest({
      bots: [{ botId }],
      webApplicationInfo: { id: authAppId, resource: `api://${authAppId}` },
    });
    await selectTeams();
    expect(screen.getByRole("heading", { name: "Teams bot" })).toBeVisible();
    expect(
      screen.getByText(/Azure settings have not been checked/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Azure Cloud Shell" }),
    ).toHaveAttribute("href", "https://shell.azure.com/powershell");
    expect(screen.getByRole("button", { name: "View script" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Download Cloud Shell helper" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Manual setup and troubleshooting guide",
      }),
    ).toHaveAttribute("href", "https://erato.chat/docs/integrations/ms_teams");
    fireEvent.click(screen.getByRole("button", { name: "View script" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("PowerShell source").value,
    ).toContain("SupportsShouldProcess");
  });

  it("copies a check command only after target details are valid", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await prepareCommands();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const command = writeText.mock.calls[0][0] as string;
    expect(command).toContain(tenantId);
    expect(command).toContain(subscriptionId);
    expect(command).toContain(
      `api://${window.location.host}/botid-${authAppId}`,
    );
    expect(command).toContain("Get-FileHash");
    expect(command).not.toContain("-Apply");
    expect(screen.getByRole("button", { name: "Copied!" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Tenant ID"), {
      target: { value: "wrong" },
    });
    expect(screen.getByRole("button", { name: "Copy command" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter complete IDs");
  });

  it("provides a selectable command if clipboard permission is denied", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await prepareCommands();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clipboard access is unavailable",
    );
    expect(screen.getByLabelText("Copy command")).toBeVisible();
  });

  it("keeps apply separate and blocks reuse of the existing connection name", async () => {
    await prepareCommands();
    fireEvent.click(screen.getByText("Preview and apply changes"));
    expect(
      screen.getByRole("button", { name: "Copy preview command" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Copy apply command" }),
    ).toBeEnabled();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Copy preview command").value,
    ).toContain("-WhatIf");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Copy apply command").value,
    ).toContain("-Apply");
    fireEvent.change(screen.getByLabelText("SSO connection name"), {
      target: { value: "GRAPH" },
    });
    expect(
      screen.getByRole("button", { name: "Copy apply command" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "The check can use the current connection",
    );
    expect(screen.getByRole("button", { name: "Copy command" })).toBeEnabled();
  });
});
