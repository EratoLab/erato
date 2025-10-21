import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as useBudgetStatusModule from "@/hooks/budget/useBudgetStatus";
import * as useBudgetWarningModule from "@/hooks/budget/useBudgetWarning";

import { BudgetWarning } from "../BudgetWarning";

import type { BudgetStatusResponse } from "@/hooks/budget/useBudgetStatus";
import type { BudgetWarningResult } from "@/hooks/budget/useBudgetWarning";

// Mock the hooks
vi.mock("@/hooks/budget/useBudgetStatus");
vi.mock("@/hooks/budget/useBudgetWarning");

describe("BudgetWarning", () => {
  const mockUseBudgetStatus = vi.spyOn(useBudgetStatusModule, "useBudgetStatus");
  const mockUseBudgetWarning = vi.spyOn(
    useBudgetWarningModule,
    "useBudgetWarning",
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render nothing when budget is disabled", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: false,
      budget_period_days: null,
      current_spending: null,
      warn_threshold: null,
      budget_limit: null,
      budget_currency: null,
    };

    const warningResult: BudgetWarningResult = {
      isWarning: false,
      isError: false,
      percentUsed: 0,
      hasData: false,
      formattedSpending: "$0.00",
      formattedLimit: "$0.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    const { container } = render(<BudgetWarning />);

    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when no warning or error state", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 500,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const warningResult: BudgetWarningResult = {
      isWarning: false,
      isError: false,
      percentUsed: 50,
      hasData: true,
      formattedSpending: "$500.00",
      formattedLimit: "$1,000.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    const { container } = render(<BudgetWarning />);

    expect(container.firstChild).toBeNull();
  });

  it("should render warning alert when approaching budget limit", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 750,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const warningResult: BudgetWarningResult = {
      isWarning: true,
      isError: false,
      percentUsed: 75,
      hasData: true,
      formattedSpending: "$750.00",
      formattedLimit: "$1,000.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    render(<BudgetWarning />);

    // Check for warning title
    expect(screen.getByText(/Approaching Budget Limit/i)).toBeInTheDocument();

    // Check for percentage in message
    expect(screen.getByText(/75%/)).toBeInTheDocument();

    // Check for formatted spending and limit
    expect(screen.getByText(/\$750\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,000\.00/)).toBeInTheDocument();

    // Check for budget period
    expect(screen.getByText(/30-day/)).toBeInTheDocument();
  });

  it("should render error alert when budget limit exceeded", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 1050,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const warningResult: BudgetWarningResult = {
      isWarning: false,
      isError: true,
      percentUsed: 105,
      hasData: true,
      formattedSpending: "$1,050.00",
      formattedLimit: "$1,000.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    render(<BudgetWarning />);

    // Check for error title
    expect(screen.getByText(/Budget Limit Reached/i)).toBeInTheDocument();

    // Check for exceeded message
    expect(screen.getByText(/reached or exceeded/i)).toBeInTheDocument();

    // Check for formatted values
    expect(screen.getByText(/\$1,050\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,000\.00/)).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 750,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const warningResult: BudgetWarningResult = {
      isWarning: true,
      isError: false,
      percentUsed: 75,
      hasData: true,
      formattedSpending: "$750.00",
      formattedLimit: "$1,000.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    const { container } = render(
      // eslint-disable-next-line tailwindcss/no-custom-classname
      <BudgetWarning className="custom-class-name" />,
    );

    // Check if custom class is applied (Alert component adds it to the wrapper)
    const alertElement = container.querySelector(".custom-class-name");
    expect(alertElement).toBeInTheDocument();
  });

  it("should not show budget period when not available", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: null, // No budget period
      current_spending: 750,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const warningResult: BudgetWarningResult = {
      isWarning: true,
      isError: false,
      percentUsed: 75,
      hasData: true,
      formattedSpending: "$750.00",
      formattedLimit: "$1,000.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    render(<BudgetWarning />);

    // Should not mention budget period
    expect(screen.queryByText(/-day/)).not.toBeInTheDocument();
  });

  it("should handle EUR currency formatting", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 800,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "EUR",
    };

    const warningResult: BudgetWarningResult = {
      isWarning: true,
      isError: false,
      percentUsed: 80,
      hasData: true,
      formattedSpending: "€800.00",
      formattedLimit: "€1,000.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: budgetStatus,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    render(<BudgetWarning />);

    // Check for EUR formatting
    expect(screen.getByText(/€800\.00/)).toBeInTheDocument();
    expect(screen.getByText(/€1,000\.00/)).toBeInTheDocument();
  });

  it("should handle undefined budget status data", () => {
    const warningResult: BudgetWarningResult = {
      isWarning: false,
      isError: false,
      percentUsed: 0,
      hasData: false,
      formattedSpending: "$0.00",
      formattedLimit: "$0.00",
    };

    mockUseBudgetStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useBudgetStatusModule.useBudgetStatus>);

    mockUseBudgetWarning.mockReturnValue(warningResult);

    const { container } = render(<BudgetWarning />);

    expect(container.firstChild).toBeNull();
  });
});
