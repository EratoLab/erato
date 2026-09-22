import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import {
  fetchUpdateProfilePreferences,
  useProfile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { ClientToolFileApprovalSetting } from "./ClientToolFileApprovalSetting";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchUpdateProfilePreferences: vi.fn(),
  useProfile: vi.fn(),
  profileQuery: () => ({ queryKey: ["profile"] }),
}));
beforeEach(() => {
  vi.mocked(fetchUpdateProfilePreferences).mockReset();
  vi.mocked(useProfile).mockReturnValue({
    data: { client_tool_file_approval: "ask" },
  } as ReturnType<typeof useProfile>);
});
function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ClientToolFileApprovalSetting />
    </QueryClientProvider>,
  );
  return { invalidate };
}
it("saves the decision to Erato and refreshes the profile", async () => {
  const { invalidate } = setup();
  const control = screen.getByRole("radiogroup", {
    name: "How to handle uploads for files retrieved by sidecar?",
  });
  expect(
    screen.getByRole("radio", { name: "Ask each time (policy default)" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(control).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Never allow" }));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["profile"] }),
  );
  expect(fetchUpdateProfilePreferences).toHaveBeenCalledWith({
    body: { client_tool_file_approval: "never_allow" },
  });
});
it("keeps the saved decision and reports a failed update", async () => {
  vi.mocked(fetchUpdateProfilePreferences).mockRejectedValue(
    new Error("offline"),
  );
  setup();
  fireEvent.click(screen.getByRole("radio", { name: "Always allow" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save preferences",
  );
  expect(
    screen.getByRole("radio", { name: "Ask each time (policy default)" }),
  ).toHaveAttribute("aria-checked", "true");
});
