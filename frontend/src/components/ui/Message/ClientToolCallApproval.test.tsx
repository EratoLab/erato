import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useClientToolCallApproval } from "@/hooks/chat/useClientToolCallApproval";
import {
  fetchProfile,
  fetchUpdateProfilePreferences,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { ClientToolCallApprovals } from "./ClientToolCallApproval";

import type { SidecarToolCallDecision } from "@/lib/desktopSidecar/chatTools";
import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
  fetchUpdateProfilePreferences: vi.fn(),
  profileQuery: () => ({ queryKey: ["profile"] }),
}));

const QUALIFIED = "desktop/search_sidecar_index";
const context = { chatId: "chat", messageId: "message", toolCallId: "call" };
let decideCall: ReturnType<typeof useClientToolCallApproval>["decideCall"];
function Harness() {
  decideCall = useClientToolCallApproval().decideCall;
  return <ClientToolCallApprovals messageId="message" />;
}
function renderHarness() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
}
const profileWith = (decision?: string) =>
  ({
    client_tool_decisions: decision ? { [QUALIFIED]: decision } : {},
  }) as unknown as UserProfile;

beforeEach(() => {
  vi.mocked(fetchProfile).mockReset();
  vi.mocked(fetchUpdateProfilePreferences).mockReset();
  vi.mocked(fetchUpdateProfilePreferences).mockResolvedValue({} as UserProfile);
});

it.each([
  [undefined, "allowed"],
  ["always_allow", "allowed"],
  ["never_allow", "disabled"],
] as const)(
  "decides %s without asking",
  async (stored, expected: SidecarToolCallDecision) => {
    vi.mocked(fetchProfile).mockResolvedValue(profileWith(stored));
    renderHarness();
    expect(await decideCall(QUALIFIED, {}, context)).toBe(expected);
    expect(
      screen.queryByTestId("client-tool-call-approval"),
    ).not.toBeInTheDocument();
  },
);

it("asks with the call's parameters and returns the choice", async () => {
  vi.mocked(fetchProfile).mockResolvedValue(profileWith("ask"));
  renderHarness();
  let result!: Promise<SidecarToolCallDecision>;
  await act(async () => {
    result = decideCall(QUALIFIED, { query: "quarterly report" }, context);
  });
  expect(
    screen.getAllByText(
      'Allow "Search local emails and files" on this device?',
    ),
  ).not.toHaveLength(0);
  expect(screen.getByText(/quarterly report/)).toBeInTheDocument();
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Deny once" }));
  expect(await result).toBe("declined");
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(
    false,
  );
  expect(fetchUpdateProfilePreferences).not.toHaveBeenCalled();
});

it("remembers Always allow while approving the current call", async () => {
  vi.mocked(fetchProfile).mockResolvedValue(profileWith("ask"));
  renderHarness();
  let result!: Promise<SidecarToolCallDecision>;
  await act(async () => {
    result = decideCall(QUALIFIED, {}, context);
  });
  fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
  expect(await result).toBe("allowed");
  await vi.waitFor(() =>
    expect(fetchUpdateProfilePreferences).toHaveBeenCalledWith({
      body: { client_tool_decisions: { [QUALIFIED]: "always_allow" } },
    }),
  );
});

it("declines when the turn is stopped while asking", async () => {
  vi.mocked(fetchProfile).mockResolvedValue(profileWith("ask"));
  renderHarness();
  const controller = new AbortController();
  let result!: Promise<SidecarToolCallDecision>;
  await act(async () => {
    result = decideCall(
      QUALIFIED,
      {},
      { ...context, signal: controller.signal },
    );
  });
  await act(async () => controller.abort());
  expect(await result).toBe("declined");
  expect(
    screen.queryByTestId("client-tool-call-approval"),
  ).not.toBeInTheDocument();
});
