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

import { OfficeAppsToolDecisions } from "./OfficeAppsToolDecisions";

import type {
  ApprovalToolInfo,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
  fetchUpdateProfilePreferences: vi.fn(),
  useProfile: vi.fn(),
  useFacets: vi.fn(() => ({ data: undefined })),
  profileQuery: () => ({ queryKey: ["profile"] }),
}));

const stored = { "desktop/search_sidecar_index": "never_allow" } as const;

const tools: ApprovalToolInfo[] = [
  {
    qualified_name: "word/apply_document_plan",
    title: "Change the open Word document",
    approval: "user_decision",
  },
  {
    qualified_name: "powerpoint/apply_changes",
    title: "Change the open presentation",
    approval: "every_call",
  },
];

beforeEach(() => {
  vi.mocked(fetchUpdateProfilePreferences).mockReset();
  vi.mocked(fetchProfile).mockResolvedValue({
    client_tool_decisions: stored,
  } as unknown as UserProfile);
  vi.mocked(useProfile).mockReturnValue({
    data: { client_tool_decisions: stored },
  } as ReturnType<typeof useProfile>);
});

const setup = (list: ApprovalToolInfo[] = tools) => {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OfficeAppsToolDecisions tools={list} />
    </QueryClientProvider>,
  );
  return { invalidate, view };
};

const open = () => {
  fireEvent.click(screen.getByRole("button", { name: /Office apps/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Changes/ }));
};

it("shows nothing where the deployment has no change tools", () => {
  const { view } = setup([]);
  expect(view.container).toBeEmptyDOMElement();
});

it("asks by default and locks Always for a tool that asks every time", () => {
  setup();
  open();
  const [document, presentation] = screen.getAllByRole("radiogroup");
  expect(document).toHaveAccessibleName("Change the open Word document");
  expect(
    within(document).getByRole("radio", {
      name: "Ask each time (policy default)",
    }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    within(document).getByRole("radio", { name: "Always allow" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  expect(
    within(presentation).getByRole("radio", { name: /Always allow/ }),
  ).toHaveAttribute("aria-disabled", "true");
});

it("saves a choice into the stored decisions, for every device", async () => {
  const { invalidate } = setup();
  open();
  const [document] = screen.getAllByRole("radiogroup");
  fireEvent.click(
    within(document).getByRole("radio", { name: "Always allow" }),
  );
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["profile"] }),
  );
  expect(fetchUpdateProfilePreferences).toHaveBeenCalledWith({
    body: {
      client_tool_decisions: {
        ...stored,
        "word/apply_document_plan": "always_allow",
      },
    },
  });
});
