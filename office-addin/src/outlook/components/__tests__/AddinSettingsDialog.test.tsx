import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSettingsDialog } from "../AddinSettingsDialog";

import type { AddinSettingsHostContribution } from "../../../core/AddinSettingsDialogCore";

vi.mock("../../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: (props: {
    hostContribution?: AddinSettingsHostContribution;
  }) => <div>{props.hostContribution?.serversToolsEntities}</div>,
}));
vi.mock("../BehaviorTabContent", () => ({ BehaviorTabContent: () => null }));
vi.mock("../../../providers/OfficeProvider", () => ({
  useOffice: () => ({ supportsAudioCapture: false }),
}));

const server: {
  tools: {
    qualified_name: string;
    title: string;
    client_actions?: string[];
  }[];
} = { tools: [] };

vi.mock("@erato/frontend/library", () => ({
  MailIcon: () => <svg />,
  EntityRow: ({
    name,
    caption,
    children,
    "data-testid": testId,
  }: {
    name: string;
    caption: string;
    children: React.ReactNode;
    "data-testid"?: string;
  }) => (
    <div data-testid={testId}>
      <span>{name}</span>
      <span>{caption}</span>
      {children}
    </div>
  ),
  useApprovalTools: () => server.tools,
  approvalToolRows: (tools: { qualified_name: string; title: string }[]) =>
    tools.map((tool) => ({
      qualifiedName: tool.qualified_name,
      label: tool.title,
    })),
  ClientToolDecisionList: ({
    tools,
    "data-testid": testId,
  }: {
    tools: { qualifiedName: string; label: string }[];
    "data-testid"?: string;
  }) => (
    <ul data-testid={testId}>
      {tools.map((tool) => (
        <li key={tool.qualifiedName}>{tool.label}</li>
      ))}
    </ul>
  ),
}));

const WORD_TOOL = {
  qualified_name: "word/apply_document_plan",
  title: "Change the document",
  client_actions: ["word.apply_document_plan"],
};
const row = () => screen.queryByTestId("servers-tools-outlook-actions-row");

describe("Outlook AddinSettingsDialog", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    server.tools = [];
  });
  afterEach(cleanup);

  it("shows no Outlook actions row while the server lists no Outlook tool", () => {
    server.tools = [
      WORD_TOOL,
      { qualified_name: "outlook/search_mail", title: "Search mail" },
    ];
    render(<AddinSettingsDialog isOpen onClose={() => {}} />);

    expect(row()).toBeNull();
    expect(screen.queryByTestId("outlook-server-tool-decisions")).toBeNull();
  });

  it("lists the server's Outlook tools, whose choices hold on every device", () => {
    server.tools = [
      WORD_TOOL,
      {
        qualified_name: "outlook/open_reply",
        title: "Open a reply",
        client_actions: ["outlook.reply"],
      },
    ];
    render(<AddinSettingsDialog isOpen onClose={() => {}} />);

    expect(row()).toHaveTextContent("Outlook actions");
    expect(row()).toHaveTextContent("Built into Outlook · every device");
    const list = screen.getByTestId("outlook-server-tool-decisions");
    expect(list).toHaveTextContent("Open a reply");
    expect(list).not.toHaveTextContent("Change the document");
  });
});
