import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";
import {
  emitHostShellEvent,
  installHostShell,
  removeHostShell,
} from "@/test/hostShellStub";

import { ChatInputAddControls } from "../ChatInputAddControls";

import type {
  ChatInputAddMenuActions,
  ChatInputAddMenuData,
} from "../ChatInputAddControls";
import type { ChatAddMenuExtraContentProps } from "@/config/componentRegistry";
import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const onSelectDisk = vi.fn();
vi.mock("@/hooks/files/useChatFileSources", () => ({
  useChatFileSources: () => ({
    isProcessing: false,
    fileSourceItems: [{ id: "computer", label: "Upload", onSelect: vi.fn() }],
    onSelectDisk,
    onSelectCloud: vi.fn(),
    onSelectFiles: vi.fn(),
    dropzoneRootProps: (props: object = {}) => props,
    dropzoneInputProps: (props: object = {}) => props,
    cloudPickerProps: null,
  }),
}));

const seenExtraContentProps: ChatAddMenuExtraContentProps[] = [];
function ProbeExtraContent(props: ChatAddMenuExtraContentProps) {
  seenExtraContentProps.push(props);
  return <div data-testid="probe-extra-content" />;
}

const facets: FacetInfo[] = [
  { id: "web_search", display_name: "Web search", default_enabled: false },
];

function renderControls(
  props: Partial<{
    uploadDisabled: boolean;
    menu: Partial<ChatInputAddMenuData>;
    actions: Partial<ChatInputAddMenuActions>;
    onToggleFacet: (facetId: string) => void;
  }> = {},
) {
  return render(
    <ChatInputAddControls
      canUpload
      upload={{ message: "" }}
      facets={facets}
      selectedFacetIds={[]}
      onToggleFacet={props.onToggleFacet ?? (() => {})}
      menu={{ onlySingleFacet: false, ...props.menu }}
      actions={{
        openConnectors: vi.fn(),
        openAssistants: vi.fn(),
        compact: vi.fn(),
        selectModel: vi.fn(),
        ...props.actions,
      }}
      uploadDisabled={props.uploadDisabled}
    />,
  );
}

const connectors: ChatInputAddMenuData["connectors"] = {
  servers: [
    {
      id: "linear",
      display_name: "Linear",
      connection_status: "SUCCESS",
      authentication_mode: "oauth2",
    },
    {
      id: "jira",
      display_name: "Jira",
      connection_status: "NEEDS_AUTHENTICATION",
      authentication_mode: "oauth2",
    },
  ],
  disabledServerIds: ["linear"],
  writeToolsEnabled: true,
};

describe("ChatInputAddControls", () => {
  const previousExtraContent = componentRegistry.ChatAddMenuExtraContent;

  afterEach(() => {
    componentRegistry.ChatAddMenuExtraContent = previousExtraContent;
    seenExtraContentProps.length = 0;
    removeHostShell();
  });

  // Host rows add files through onSelectFiles, so they must see the
  // attachment-limit state — overflow past the limit is silently discarded
  // by the composer merge, not rejected.
  it("forwards the upload-limit state to host extra content", () => {
    componentRegistry.ChatAddMenuExtraContent = ProbeExtraContent;

    renderControls({ uploadDisabled: true });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    expect(screen.getByTestId("probe-extra-content")).toBeInTheDocument();
    const props = seenExtraContentProps.at(-1);
    expect(props?.uploadDisabled).toBe(true);
    expect(props?.disabled).toBe(false);
  });

  it("leaves host extra content enabled below the limit", () => {
    componentRegistry.ChatAddMenuExtraContent = ProbeExtraContent;

    renderControls();
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const props = seenExtraContentProps.at(-1);
    expect(props?.uploadDisabled).toBe(false);
    expect(props?.disabled).toBe(false);
  });

  // Both rows open a dialog that focuses itself: the menu's usual delayed
  // close would return focus to the "+" trigger behind the overlay.
  it("renders the assistants as one row that opens their dialog at once", () => {
    const openAssistants = vi.fn();
    renderControls({
      menu: { assistants: { suggested: [{ id: "a-1", name: "Researcher" }] } },
      actions: { openAssistants },
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const row = screen.getByTestId("chat-input-add-menu-extra-ask-assistant");
    expect(row).toHaveTextContent("Ask an assistant…");
    expect(row).toHaveTextContent("Researcher");

    fireEvent.click(row);
    expect(openAssistants).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the connectors as one row with their summary that opens their dialog at once", () => {
    const openConnectors = vi.fn();
    renderControls({ menu: { connectors }, actions: { openConnectors } });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const row = screen.getByTestId("chat-input-add-menu-extra-connectors");
    expect(row).toHaveAttribute("role", "menuitem");
    expect(row).toHaveTextContent("Connectors…");
    expect(row).toHaveTextContent("Off: Linear · 1 to connect");

    fireEvent.click(row);
    expect(openConnectors).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("orders the connectors before the assistants, without group headers", () => {
    renderControls({
      menu: {
        assistants: { suggested: [{ id: "a-1", name: "Researcher" }] },
        connectors: { servers: [], writeToolsEnabled: false },
      },
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const rows = screen
      .getAllByTestId(/^chat-input-add-menu-extra-/)
      .map((row) => row.dataset.testid);
    expect(rows).toEqual([
      "chat-input-add-menu-extra-connectors",
      "chat-input-add-menu-extra-ask-assistant",
    ]);
    expect(screen.queryByText("Assistants")).not.toBeInTheDocument();
  });

  it("says under each locked tool why it is set", () => {
    renderControls({
      menu: { toolsLocked: { reason: "Set by the assistant." } },
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const tool = screen.getByTestId("chat-input-add-menu-tool-web_search");
    expect(tool).toHaveTextContent("Set by the assistant.");
    expect(tool).toHaveAttribute("aria-disabled", "true");
  });

  describe("in an app with system menus", () => {
    const answers = (show: unknown = { shown: true, chosen: null }) =>
      vi.fn((method: string) =>
        Promise.resolve(
          method === "systemMenus.attach"
            ? { attached: true }
            : method === "systemMenus.show"
              ? show
              : { updated: true },
        ),
      );

    it("hands the app the same rows and does what a pick asks", async () => {
      const request = installHostShell({ systemMenus: 1 }, answers());
      const onToggleFacet = vi.fn();
      const openConnectors = vi.fn();
      renderControls({
        menu: { connectors },
        actions: { openConnectors },
        onToggleFacet,
      });

      await waitFor(
        () =>
          expect(request).toHaveBeenCalledWith(
            "systemMenus.attach",
            expect.objectContaining({ id: "chat-input-add" }),
          ),
        { timeout: 2000 },
      );
      const params = request.mock.calls.find(
        ([method]) => method === "systemMenus.attach",
      )?.[1] as { items: { id: string; children?: { id: string }[] }[] };
      expect(params.items.map((section) => section.id)).toEqual([
        "section:uploads",
        "section:tools",
        "section:connectors",
      ]);

      emitHostShellEvent("systemMenus.toggled", {
        id: "chat-input-add",
        itemId: "tool:web_search",
        on: true,
      });
      expect(onToggleFacet).toHaveBeenCalledWith("web_search");
      emitHostShellEvent("systemMenus.chosen", {
        id: "chat-input-add",
        itemId: "connectors",
      });
      await waitFor(() => expect(openConnectors).toHaveBeenCalledTimes(1));
      emitHostShellEvent("systemMenus.chosen", {
        id: "chat-input-add",
        itemId: "upload:computer",
      });
      await waitFor(() => expect(onSelectDisk).toHaveBeenCalledTimes(1));
    });

    it("keeps the web menu while a host draws rows of its own", async () => {
      componentRegistry.ChatAddMenuExtraContent = ProbeExtraContent;
      const request = installHostShell({ systemMenus: 1 }, answers());
      renderControls();

      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
      expect(screen.getByTestId("probe-extra-content")).toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    });

    it("opens the web menu where the app cannot draw this one", async () => {
      installHostShell(
        { systemMenus: 1 },
        answers({ shown: false, unsupported: ["items[1].badge"] }),
      );
      renderControls();

      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
      expect(
        await screen.findByRole("menu", {}, { timeout: 2000 }),
      ).toBeInTheDocument();
    });
  });
});
