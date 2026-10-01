import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import {
  fetchProfile,
  fetchUpdateProfilePreferences,
  useProfile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { SidecarToolDecisions } from "./SidecarToolDecisions";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
  fetchUpdateProfilePreferences: vi.fn(),
  useProfile: vi.fn(),
  profileQuery: () => ({ queryKey: ["profile"] }),
}));

const stored = {
  "desktop/search_sidecar_index": "never_allow",
  "desktop/list_sidecar_mailboxes": "ask",
} as const;

beforeEach(() => {
  vi.mocked(fetchUpdateProfilePreferences).mockReset();
  vi.mocked(fetchProfile).mockResolvedValue({
    client_tool_decisions: stored,
  } as unknown as UserProfile);
  vi.mocked(useProfile).mockReturnValue({
    data: { client_tool_decisions: stored },
  } as ReturnType<typeof useProfile>);
});

function setup(supported: string[]) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const client = {
    supports: (method: string) => supported.includes(method),
  } as unknown as DesktopSidecarClient;
  render(
    <QueryClientProvider client={queryClient}>
      <SidecarToolDecisions client={client} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Available tools/ }));
  return { invalidate };
}

it("lists only the tools this sidecar supports, with their stored decision", () => {
  setup(["search.query.v1", "outlook.get_conversation.v1"]);
  expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
  const [search, conversation] = screen.getAllByRole("radiogroup");
  expect(search).toHaveAccessibleName("Search local emails and files");
  expect(
    within(search).getByRole("radio", { name: "Never allow" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(conversation).toHaveAccessibleName("Read an email conversation");
  expect(
    within(conversation).getByRole("radio", {
      name: "Always allow (policy default)",
    }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    screen.queryByRole("radiogroup", { name: "List mailboxes on this device" }),
  ).not.toBeInTheDocument();
});

it("merges the new decision into the stored ones and refreshes the profile", async () => {
  const { invalidate } = setup(["outlook.get_conversation.v1"]);
  fireEvent.click(screen.getByRole("radio", { name: "Ask each time" }));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["profile"] }),
  );
  expect(fetchUpdateProfilePreferences).toHaveBeenCalledWith({
    body: {
      client_tool_decisions: {
        ...stored,
        "desktop/read_sidecar_conversation": "ask",
      },
    },
  });
});

it("reports a failed save", async () => {
  vi.mocked(fetchUpdateProfilePreferences).mockRejectedValue(
    new Error("offline"),
  );
  setup(["outlook.get_conversation.v1"]);
  fireEvent.click(screen.getByRole("radio", { name: "Never allow" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save this choice",
  );
});
