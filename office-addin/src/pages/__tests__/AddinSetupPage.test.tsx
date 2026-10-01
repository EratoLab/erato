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

  it("shows the messaging endpoint, token exchange URL and setup guide", async () => {
    stubTeamsManifest({
      bots: [{ botId }],
      webApplicationInfo: { id: botId, resource: `api://botid-${botId}` },
    });
    await selectTeams();

    expect(screen.getByRole("heading", { name: "Teams bot" })).toBeVisible();
    expect(screen.getAllByText(botId)[0]).toBeVisible();
    expect(
      screen.getByText(
        `${window.location.origin}/api/integrations/ms_teams/messages`,
      ),
    ).toBeVisible();
    expect(screen.getByText(`api://botid-${botId}`)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Teams bot setup guide" }),
    ).toHaveAttribute("href", "https://erato.chat/docs/integrations/ms_teams");
  });

  it("proposes a combined URI while explaining that Azure has not been checked", async () => {
    stubTeamsManifest({
      bots: [{ botId }],
      webApplicationInfo: { id: "tab", resource: "api://tab" },
    });
    await selectTeams();

    expect(screen.getByRole("heading", { name: "Teams bot" })).toBeVisible();
    expect(screen.queryByText("api://tab")).not.toBeInTheDocument();
    expect(
      screen.getByText(`api://${window.location.host}/botid-tab`),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Azure settings and the package installed in Teams have not been checked/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Open Azure Cloud Shell",
        hidden: true,
      }),
    ).toHaveAttribute("href", "https://shell.azure.com/");
  });
});
