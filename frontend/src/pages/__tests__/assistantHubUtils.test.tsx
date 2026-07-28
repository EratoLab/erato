import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import {
  AssistantHubVersionCard,
  AssistantHubVersionOverviewSection,
} from "../assistantHubUtils";

import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const acceptedVersion: AssistantHubVersion = {
  assistant: {
    created_at: "2026-01-01T00:00:00Z",
    description: "Assistant description",
    enforce_facet_settings: false,
    id: "assistant-snapshot",
    name: "Accepted assistant",
    prompt: "Assistant prompt",
    updated_at: "2026-01-02T00:00:00Z",
  },
  assistant_id: "assistant-snapshot",
  category_ids: ["marketing"],
  created_at: "2026-01-01T00:00:00Z",
  creator: {
    display_name: "Assistant creator",
    id: "creator",
  },
  diff_summary: {},
  featured: false,
  hub_assistant_id: "hub-assistant",
  is_current_published_version: true,
  is_published: true,
  keywords: [],
  long_description: "Long assistant description",
  review_average_score: 8.4,
  review_count: 3,
  source_assistant_id: "source-assistant",
  status: "review_accepted",
  submitted_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  version_id: "version",
  version_number: "1.0.0",
};

const categories = [
  {
    display_name: "Marketing",
    icon: "megaphone",
    id: "marketing",
  },
];

const renderCard = (
  showStatusBadge = false,
  version: AssistantHubVersion = acceptedVersion,
) =>
  render(
    <I18nProvider i18n={i18n}>
      <AssistantHubVersionCard
        version={version}
        categories={categories}
        onOpen={vi.fn()}
        showStatusBadge={showStatusBadge}
      />
    </I18nProvider>,
  );

describe("AssistantHubVersionCard", () => {
  beforeEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("renders the simplified public Hub card layout", () => {
    renderCard();

    expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
    expect(screen.queryByText("Version 1.0.0")).not.toBeInTheDocument();

    const header = document.querySelector<HTMLElement>(
      '[data-ui="assistant-hub-card-header"]',
    );
    expect(header).toContainElement(screen.getByText("A"));
    expect(header).toContainElement(screen.getByText("Accepted assistant"));
    expect(header).toContainElement(screen.getByText("by Assistant creator"));

    const rating = document.querySelector<HTMLElement>(
      '[data-ui="assistant-hub-card-rating"]',
    );
    expect(rating).toHaveTextContent("8.4");
    const ratingIcon = document.querySelector<SVGElement>(
      '[data-ui="assistant-hub-card-rating-icon"]',
    );
    expect(rating).toContainElement(ratingIcon);
    expect(ratingIcon?.previousSibling?.textContent).toBe("8.4");
    expect(rating).not.toHaveTextContent("/ 10");
    expect(rating).not.toHaveTextContent("ratings");
    expect(
      document.querySelector<HTMLElement>(
        '[data-ui="assistant-hub-card-category"]',
      ),
    ).toHaveTextContent("Marketing");
  });

  it("keeps version and status metadata on management cards", () => {
    renderCard(true);

    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Version 1.0.0")).toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-ui="assistant-hub-management-card-category"]',
      ),
    ).toHaveClass("rounded-full", "bg-theme-bg-secondary");

    const rating = document.querySelector<HTMLElement>(
      '[data-ui="assistant-hub-management-card-rating"]',
    );
    const ratingIcon = document.querySelector<SVGElement>(
      '[data-ui="assistant-hub-management-card-rating-icon"]',
    );
    expect(rating).toHaveTextContent("8.4");
    expect(rating).toContainElement(ratingIcon);
    expect(ratingIcon?.previousSibling?.textContent).toBe("8.4");
    expect(rating).not.toHaveTextContent("/ 10");
    expect(rating).not.toHaveTextContent("ratings");
  });

  it("shows secondary text when the public card has no ratings", () => {
    renderCard(false, {
      ...acceptedVersion,
      review_average_score: null,
      review_count: 0,
    });

    expect(screen.getByText("No ratings yet")).toHaveClass(
      "text-theme-fg-secondary",
    );
    expect(
      document.querySelector('[data-ui="assistant-hub-card-rating-icon"]'),
    ).not.toBeInTheDocument();
  });
});

describe("AssistantHubVersionOverviewSection", () => {
  beforeEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("renders the Hub detail identity, rating, and description hierarchy", () => {
    render(
      <I18nProvider i18n={i18n}>
        <AssistantHubVersionOverviewSection
          version={acceptedVersion}
          categories={categories}
        />
      </I18nProvider>,
    );

    const header = document.querySelector<HTMLElement>(
      '[data-ui="assistant-hub-overview-header"]',
    );
    expect(header).toContainElement(screen.getByText("A"));
    expect(header).toContainElement(screen.getByText("Accepted assistant"));
    expect(header).toContainElement(screen.getByText("by Assistant creator"));
    expect(
      document.querySelector('[data-ui="assistant-hub-overview-category"]'),
    ).toHaveClass("rounded-full", "bg-theme-bg-secondary");

    const rating = document.querySelector<HTMLElement>(
      '[data-ui="assistant-hub-overview-rating"]',
    );
    const ratingIcon = document.querySelector<SVGElement>(
      '[data-ui="assistant-hub-overview-rating-icon"]',
    );
    expect(rating).toContainElement(ratingIcon);
    expect(rating).toHaveTextContent("8.4Rating");
    expect(ratingIcon?.previousSibling?.textContent).toBe("8.4");

    const description = document.querySelector<HTMLElement>(
      '[data-ui="assistant-hub-overview-description"]',
    );
    expect(description).toContainElement(
      screen.getByRole("heading", { name: "Description" }),
    );
    expect(description).toHaveTextContent("Long assistant description");
  });
});
