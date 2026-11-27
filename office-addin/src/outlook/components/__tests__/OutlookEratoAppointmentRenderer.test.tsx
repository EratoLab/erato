import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OutlookEratoAppointmentRenderer } from "../OutlookEratoAppointmentRenderer";

// Mocked at the same seams as the email renderer's suite: the artifact + chat
// snapshot (what AddinChat stamps), the current Outlook item identity, the
// user's server decisions, and the Office.js form module — the tests only assert
// WHETHER the appointment form is reached, never how. The fence PARSER runs
// for real: the payload contract is part of what's under test.
const mockUseOutlookMailItem = vi.fn();
const mockUseOutlookArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const server = vi.hoisted(() => ({
  decisions: {},
}));
const mockOpenNewAppointmentForm = vi.fn();
const mockIsCreateAppointmentSupported = vi.fn();

vi.mock("@erato/frontend/library", async () => ({
  useChatContext: () => mockUseChatContext(),
  ...(await import("../../../test/helpers/eratoLibraryMock")).chatHooksFrom(
    () => mockUseChatContext(),
  ),
  useOutlookArtifact: () => mockUseOutlookArtifact(),
  useApprovalTools: () => [
    {
      qualified_name: "outlook/open_appointment",
      client_actions: ["outlook.create_appointment"],
    },
  ],
  useProfile: () => ({
    profile: { client_tool_decisions: server.decisions },
  }),
}));

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  NO_ITEM_SEND_IDENTITY: "no-item",
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

vi.mock("../../utils/outlookCreateAppointment", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isCreateAppointmentSupported: () => mockIsCreateAppointmentSupported(),
  openNewAppointmentForm: (...args: unknown[]) =>
    Promise.resolve(mockOpenNewAppointmentForm(...args)),
}));

const FACET = "outlook_schedule";
const CREATE = "outlook.create_appointment";

const DETAILS = {
  start: "2026-07-09T10:00:00+02:00",
  end: "2026-07-09T10:30:00+02:00",
  subject: "Projekt-Sync",
  attendees: ["alice@example.com"],
};
const FENCE = JSON.stringify(DETAILS);

interface TestArtifact {
  facetId: string;
  renderMode: "body" | "suggestions";
  messageId: string;
  allowedClientActions: string[];
  isFreshCompletion?: boolean;
  itemIdentity?: string;
  proposedClientAction?: string;
}

let nextMessageId = 0;

function makeArtifact(overrides: Partial<TestArtifact> = {}): TestArtifact {
  nextMessageId += 1;
  return {
    facetId: FACET,
    renderMode: "body",
    messageId: `appt-msg-${nextMessageId}`,
    allowedClientActions: [CREATE],
    ...overrides,
  };
}

function prime(options: {
  artifact: TestArtifact | null;
  currentItemIdentity: string | null;
  /** The user's decisions on the server, by tool. */
  decisions?: Record<string, string>;
  supported?: boolean;
}) {
  mockUseOutlookArtifact.mockReturnValue(options.artifact);
  mockUseOutlookMailItem.mockReturnValue({
    mailItem: null,
    itemIdentity: options.currentItemIdentity,
  });
  const messageId = options.artifact?.messageId ?? "unrelated";
  mockUseChatContext.mockReturnValue({
    messages: { [messageId]: { id: messageId, role: "assistant" } },
    messageOrder: [messageId],
  });
  server.decisions = options.decisions ?? {};
  mockIsCreateAppointmentSupported.mockReturnValue(options.supported ?? true);
  mockOpenNewAppointmentForm.mockResolvedValue(undefined);
}

beforeAll(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OutlookEratoAppointmentRenderer — summary card", () => {
  it("renders the parsed appointment (subject, time, attendees) with the action button", () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: null });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByText("Projekt-Sync")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open appointment" }),
    ).toBeInTheDocument();
  });

  it("renders the raw payload without actions while it doesn't parse (streaming)", () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: null });
    render(<OutlookEratoAppointmentRenderer content='{"start": "2026-07-' />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/"start": "2026-07-/)).toBeInTheDocument();
  });

  it("offers no action when the facet does not advertise it (read-only backend)", () => {
    prime({
      artifact: makeArtifact({ allowedClientActions: [] }),
      currentItemIdentity: null,
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByText("Projekt-Sync")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers no action without an artifact at all (foreign fence)", () => {
    prime({ artifact: null, currentItemIdentity: null });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers no action on hosts without form support (Outlook mobile)", () => {
    prime({
      artifact: makeArtifact(),
      currentItemIdentity: null,
      supported: false,
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("OutlookEratoAppointmentRenderer — click semantics", () => {
  it("executes directly on click — the fully-described button IS the consent", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: null });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open appointment" }));
    });

    expect(mockOpenNewAppointmentForm).toHaveBeenCalledWith(DETAILS);
    expect(screen.getByRole("button", { name: "Opened!" })).toBeInTheDocument();
  });

  it("opens nothing on its own for a proposal, whatever the user decided for Erato", () => {
    prime({
      artifact: makeArtifact({
        isFreshCompletion: true,
        itemIdentity: "item-a",
        proposedClientAction: CREATE,
      }),
      currentItemIdentity: "item-a",
      decisions: { "outlook/open_appointment": "always_allow" },
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(mockOpenNewAppointmentForm).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Open appointment" }),
    ).toBeEnabled();
  });

  it("offers no button for an action the user set to Never", () => {
    prime({
      artifact: makeArtifact(),
      currentItemIdentity: null,
      decisions: { "outlook/open_appointment": "never_allow" },
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByText("Projekt-Sync")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the inline alert when a click-launched open fails", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: null });
    mockOpenNewAppointmentForm.mockRejectedValue(new Error("host says no"));
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open appointment" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to open the appointment form",
    );
    // No success swap on a failed open.
    expect(screen.queryByRole("button", { name: "Opened!" })).toBeNull();
  });
});
