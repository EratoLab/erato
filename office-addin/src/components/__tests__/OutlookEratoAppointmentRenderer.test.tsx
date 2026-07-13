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
// persisted decisions, and the Office.js form module — the tests only assert
// WHETHER the appointment form is reached, never how. The fence PARSER runs
// for real: the payload contract is part of what's under test.
const mockUseOutlookMailItem = vi.fn();
const mockUseOutlookArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const mockUsePersistedState = vi.fn();
const mockOpenNewAppointmentForm = vi.fn();
const mockIsCreateAppointmentSupported = vi.fn();

vi.mock("@erato/frontend/library", () => ({
  ActionConfirmationCard: (props: {
    description?: unknown;
    onAllowOnce: () => void;
    onAlwaysAllow: () => void;
    onDeny: () => void;
    status?: string;
    resolvedLabel?: string;
    isBusy?: boolean;
  }) => (
    <div
      data-testid="confirmation-card"
      data-status={props.status ?? "pending"}
      data-busy={props.isBusy ? "true" : "false"}
    >
      <div data-testid="confirmation-description">
        {props.description as never}
      </div>
      {(props.status ?? "pending") === "pending" ? (
        <>
          <button
            type="button"
            disabled={props.isBusy}
            onClick={props.onAllowOnce}
          >
            allow-once
          </button>
          <button
            type="button"
            disabled={props.isBusy}
            onClick={props.onAlwaysAllow}
          >
            always-allow
          </button>
          <button type="button" disabled={props.isBusy} onClick={props.onDeny}>
            deny
          </button>
        </>
      ) : (
        <span data-testid="resolved-label">{props.resolvedLabel}</span>
      )}
    </div>
  ),
  useChatContext: () => mockUseChatContext(),
  useOutlookArtifact: () => mockUseOutlookArtifact(),
  usePersistedState: () => mockUsePersistedState(),
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
  alwaysAskClientActions?: string[];
  clientActionPresentation: string;
  isFreshCompletion?: boolean;
  itemIdentity?: string;
  proposedClientAction?: string;
}

// Unique per test: the once-per-message auto-prompt slot is module-level
// state that intentionally survives remounts (and thus tests).
let nextMessageId = 0;

function makeArtifact(overrides: Partial<TestArtifact> = {}): TestArtifact {
  nextMessageId += 1;
  return {
    facetId: FACET,
    renderMode: "body",
    messageId: `appt-msg-${nextMessageId}`,
    allowedClientActions: [CREATE],
    alwaysAskClientActions: [CREATE],
    clientActionPresentation: "render_buttons",
    ...overrides,
  };
}

function prime(options: {
  artifact: TestArtifact | null;
  currentItemIdentity: string | null;
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
  mockUsePersistedState.mockReturnValue([options.decisions ?? {}, vi.fn()]);
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

function makeAutoPromptArtifact(
  overrides: Partial<TestArtifact> = {},
): TestArtifact {
  return makeArtifact({
    isFreshCompletion: true,
    itemIdentity: "item-a",
    clientActionPresentation: "auto_prompt",
    proposedClientAction: CREATE,
    ...overrides,
  });
}

describe("OutlookEratoAppointmentRenderer — click semantics", () => {
  it("executes directly on click — the fully-described button IS the consent", async () => {
    prime({
      artifact: makeArtifact({ alwaysAskClientActions: [] }),
      currentItemIdentity: null,
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open appointment" }));
    });

    expect(mockOpenNewAppointmentForm).toHaveBeenCalledWith(DETAILS);
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opened!" })).toBeInTheDocument();
  });

  it("executes directly on click even under org-enforced always-ask — enforcement gates assistant-initiated runs, not clicks on a fully-disclosed payload", async () => {
    // The summary above the button already shows the whole payload, so the
    // click is the consent; client_actions_always_ask only clamps the
    // auto-prompt path (see the auto-prompt suite).
    prime({
      artifact: makeArtifact(),
      currentItemIdentity: null,
      decisions: { [`${FACET}/${CREATE}`]: "always" },
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open appointment" }));
    });

    expect(mockOpenNewAppointmentForm).toHaveBeenCalledWith(DETAILS);
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
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

describe("OutlookEratoAppointmentRenderer — confirmation card (auto-surfaced)", () => {
  it("allow-once opens the prefilled form; the card shows the time + attendees summary", async () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    const description = screen.getByTestId("confirmation-description");
    expect(description).toHaveTextContent("alice@example.com");
    expect(mockOpenNewAppointmentForm).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(mockOpenNewAppointmentForm).toHaveBeenCalledWith(DETAILS);
    // No persistent record: the card closes and the button shows the
    // transient "Opened!" swap (the add-in's standard success idiom).
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opened!" })).toBeInTheDocument();
  });

  it("closes the card on deny without opening anything", () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    fireEvent.click(screen.getByRole("button", { name: "deny" }));

    expect(mockOpenNewAppointmentForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open appointment" }),
    ).toBeEnabled();
  });

  it("closes the card when the form fails; the inline alert is the feedback", async () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
    });
    mockOpenNewAppointmentForm.mockRejectedValue(new Error("host says no"));
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to open the appointment form",
    );
    // No success swap on a failed open.
    expect(screen.queryByRole("button", { name: "Opened!" })).toBeNull();
  });
});

describe("OutlookEratoAppointmentRenderer — auto-prompt", () => {
  it("auto-surfaces the confirmation card for a fresh matching proposal", () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
    expect(mockOpenNewAppointmentForm).not.toHaveBeenCalled();
  });

  it("still cards under a stored grant when the deployment enforces always-ask — enforcement clamps the assistant-initiated path", () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
      decisions: { [`${FACET}/${CREATE}`]: "always" },
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
    expect(mockOpenNewAppointmentForm).not.toHaveBeenCalled();
  });

  it("auto-surfaces for a NEUTRAL-context send (no item open, sentinel identity)", () => {
    // The scheduling facet's flagship context: pinned pane, nothing selected.
    // The send recorded the no-item sentinel; at prompt time there is still
    // no item — that must count as a match, not as a failed capture.
    prime({
      artifact: makeAutoPromptArtifact({ itemIdentity: "no-item" }),
      currentItemIdentity: null,
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
  });

  it("auto-surfaces when the live item drifted from the send-time identity", () => {
    // create_appointment is item-independent: a mid-stream re-resolve that
    // re-mints an unsaved-compose identity (or a navigation to another item)
    // must not suppress the auto-prompt for a payload that lives in the fence.
    prime({
      artifact: makeAutoPromptArtifact({ itemIdentity: "compose:abc" }),
      currentItemIdentity: "compose:xyz",
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
  });

  it("never auto-surfaces for history messages", () => {
    prime({
      artifact: makeAutoPromptArtifact({
        isFreshCompletion: undefined,
        itemIdentity: undefined,
      }),
      currentItemIdentity: null,
    });
    render(<OutlookEratoAppointmentRenderer content={FENCE} />);

    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
    // The button remains as the manual path.
    expect(
      screen.getByRole("button", { name: "Open appointment" }),
    ).toBeInTheDocument();
  });
});
