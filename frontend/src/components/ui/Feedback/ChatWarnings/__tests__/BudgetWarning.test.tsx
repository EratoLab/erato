import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useBudgetStatus } from "@/hooks/budget/useBudgetStatus";
import { ProfileContext } from "@/providers/ProfileProvider";

import { BudgetWarning } from "../BudgetWarning";

import type { BudgetStatusResponse } from "@/hooks/budget/useBudgetStatus";
import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/hooks/budget/useBudgetStatus");

const approaching: BudgetStatusResponse = {
  enabled: true,
  budget_period_days: 30,
  current_spending: 750,
  warn_threshold: 0.7,
  budget_limit: 1000,
  budget_currency: "USD",
  user_settings: null,
};
const limitReached = { ...approaching, current_spending: 1000 };
const belowThreshold = { ...approaching, current_spending: 500 };
const disabled = { ...approaching, enabled: false };
const incomplete = { ...approaching, current_spending: null };

function mockBudget(
  data: BudgetStatusResponse | undefined,
  state: Partial<ReturnType<typeof useBudgetStatus>> = {},
) {
  vi.mocked(useBudgetStatus).mockReturnValue({
    data,
    isSuccess: data !== undefined,
    fetchStatus: "idle",
    ...state,
  } as ReturnType<typeof useBudgetStatus>);
}

function banner(userId?: string, onDismiss?: () => void) {
  return (
    <ProfileContext.Provider
      value={
        userId
          ? {
              profile: { id: userId } as UserProfile,
              isLoading: false,
              error: null,
            }
          : undefined
      }
    >
      <ThemeProvider enableCustomTheme={false}>
        {/* eslint-disable-next-line tailwindcss/no-custom-classname */}
        <BudgetWarning className="custom-class-name" onDismiss={onDismiss} />
      </ThemeProvider>
    </ProfileContext.Provider>
  );
}

const dismiss = () =>
  fireEvent.click(
    within(screen.getByRole("alert")).getByRole("button", { name: "Dismiss" }),
  );

describe("BudgetWarning", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockBudget(approaching);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["disabled tracking", disabled],
    ["spending below threshold", belowThreshold],
    ["missing data", undefined],
    ["incomplete data", incomplete],
  ])("renders no alert with %s", (_label, status) => {
    mockBudget(status);
    render(banner());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the current percentage, amounts and rolling window in the warning", () => {
    render(banner());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("custom-class-name");
    expect(alert).toHaveTextContent("Approaching Budget Limit");
    expect(alert).toHaveTextContent(/75%.*\$750\.00 of \$1,000\.00/);
    expect(alert).toHaveTextContent(/spending over the last 30 days/);
  });

  it("formats the configured currency and omits an unspecified window", () => {
    mockBudget({
      ...approaching,
      budget_currency: "EUR",
      budget_period_days: null,
    });
    render(banner());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/€750\.00 of €1,000\.00/);
    expect(alert).not.toHaveTextContent(/spending over the last/);
  });

  it.each([
    ["Approaching Budget Limit", approaching],
    ["Budget Limit Reached", limitReached],
  ])("dismisses %s immediately and notifies the composer", (title, status) => {
    mockBudget(status);
    const onDismiss = vi.fn();
    render(banner(undefined, onDismiss));
    expect(screen.getByRole("alert")).toHaveTextContent(title);
    dismiss();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps dismissal across refreshes and remounts and shows the limit at 100%", () => {
    const userId = "same-severity";
    const { rerender, unmount } = render(banner(userId));
    dismiss();
    mockBudget({ ...approaching, current_spending: 820 });
    rerender(banner(userId));
    expect(screen.queryByRole("alert")).toBeNull();

    unmount();
    const remount = render(banner(userId));
    expect(screen.queryByRole("alert")).toBeNull();

    mockBudget(limitReached);
    remount.rerender(banner(userId));
    expect(screen.getByRole("alert")).toHaveTextContent("Budget Limit Reached");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You have reached or exceeded your personal budget limit of $1,000.00. Current spending: $1,000.00.",
    );
    expect(
      sessionStorage.getItem(`erato:budget-warning-dismissed:${userId}`),
    ).toBeNull();
    dismiss();

    mockBudget({ ...limitReached, current_spending: 1050 });
    remount.rerender(banner(userId));
    expect(screen.queryByRole("alert")).toBeNull();

    mockBudget(approaching);
    remount.rerender(banner(userId));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Approaching Budget Limit",
    );
  });

  it.each([
    ["recovery", belowThreshold],
    ["disabled tracking", disabled],
  ])("shows the warning again after confirmed %s", (userId, status) => {
    const { rerender } = render(banner(userId));
    dismiss();
    mockBudget(status);
    rerender(banner(userId));
    expect(screen.queryByRole("alert")).toBeNull();

    mockBudget(approaching);
    rerender(banner(userId));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Approaching Budget Limit",
    );
  });

  it("retains dismissal through missing, loading and failed responses", () => {
    const userId = "unconfirmed";
    const { rerender } = render(banner(userId));
    dismiss();

    mockBudget(undefined);
    rerender(banner(userId));
    mockBudget(incomplete);
    rerender(banner(userId));
    mockBudget(belowThreshold, { fetchStatus: "fetching" });
    rerender(banner(userId));
    mockBudget(disabled, { isSuccess: false, isError: true });
    rerender(banner(userId));
    mockBudget(approaching);
    rerender(banner(userId));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers retry for a stale warning while keeping a dismissed warning hidden", () => {
    const refetch = vi.fn();
    const { rerender } = render(banner());
    mockBudget(approaching, { isSuccess: false, isError: true, refetch });
    rerender(banner());

    const alert = within(screen.getByRole("alert"));
    expect(alert.getByText(/figures may be out of date/)).toBeVisible();
    fireEvent.click(alert.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();

    dismiss();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stores the dismissal for the signed-in account and reads it on first mount", () => {
    const storedUser = "returning-user";
    const returnedKey = `erato:budget-warning-dismissed:${storedUser}`;
    sessionStorage.setItem(returnedKey, "warning");
    const { rerender } = render(banner(storedUser));
    expect(screen.queryByRole("alert")).toBeNull();

    const otherUser = "other-user";
    rerender(banner(otherUser));
    expect(screen.getByRole("alert")).toBeVisible();
    dismiss();
    expect(
      sessionStorage.getItem(`erato:budget-warning-dismissed:${otherUser}`),
    ).toBe("warning");
    expect(sessionStorage.getItem(returnedKey)).toBe("warning");
  });

  it("retains a signed-in dismissal across remounts when storage is blocked", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    const { unmount } = render(banner("blocked-storage"));
    dismiss();
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    render(banner("blocked-storage"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps dismissals local to the mounted banner while identity is unavailable", () => {
    const { unmount } = render(banner());
    dismiss();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sessionStorage).toHaveLength(0);
    unmount();

    render(banner());
    expect(screen.getByRole("alert")).toBeVisible();
  });
});
