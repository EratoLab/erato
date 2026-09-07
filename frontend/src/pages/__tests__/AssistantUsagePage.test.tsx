import { skipToken } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AssistantUsagePage from "../AssistantUsagePage";

const { query, feature } = vi.hoisted(() => ({
  query: vi.fn(),
  feature: { enabled: true, usageViewEnabled: true },
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useGetAssistantUsage: query,
}));
vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: () => feature,
}));
vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("@/components/ui/Container/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/assistants/test/usage"]}>
      <Routes>
        <Route path="/assistants/:id/usage" element={<AssistantUsagePage />} />
        <Route path="/assistants" element={<p>Assistant list</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("assistant usage", () => {
  beforeEach(() => {
    feature.usageViewEnabled = true;
    query.mockReset().mockReturnValue({
      data: {
        assistant_name: "Example",
        total_invocations: 12,
        total_unique_users: 3,
        bucket_days: 1,
        buckets: [
          { date: "2026-09-06", invocations: 7, unique_users: 3 },
          { date: "2026-09-07", invocations: 5, unique_users: 2 },
        ],
      },
      isPending: false,
      error: null,
    });
  });
  it("shows range totals independently of bucket users and changes timeframe", () => {
    renderPage();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getAllByText("3")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "52" } });
    expect(query).toHaveBeenLastCalledWith({
      pathParams: { assistantId: "test" },
      queryParams: { weeks: 52 },
    });
  });
  it("does not request usage when disabled", () => {
    feature.usageViewEnabled = false;
    renderPage();
    expect(query).toHaveBeenCalledWith(skipToken);
    expect(screen.getByText("Assistant list")).toBeInTheDocument();
  });
  it("shows access errors without analytics", () => {
    query.mockReturnValue({ error: { status: 403 }, isPending: false });
    renderPage();
    expect(
      screen.getByText(/only available to assistant editors/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("shows an empty timeframe with zero totals", () => {
    query.mockReturnValue({
      data: {
        assistant_name: "Example",
        total_invocations: 0,
        total_unique_users: 0,
        bucket_days: 1,
        buckets: [],
      },
      isPending: false,
    });
    renderPage();
    expect(screen.getByText("No usage in this timeframe.")).toBeInTheDocument();
  });
});
