import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageContent } from "./MessageContent";

import type {
  KnownSearchCoverage,
  SearchCoverageSource,
} from "@/lib/desktopSidecar/searchCoverage";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const day = (iso: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso));

const outlook: SearchCoverageSource = {
  sourceId: "outlook-jane",
  label: "Outlook · jane@example.com",
  kinds: ["email", "file"],
  from: "2025-03-14T08:30:01Z",
  to: "2026-09-15T12:00:00Z",
  status: "indexing",
  partialCache: false,
  requestedFromBeforeCoverage: false,
};

const teams: SearchCoverageSource = {
  sourceId: "teams-contoso",
  label: "Teams · Contoso Ltd",
  kinds: ["teams_message"],
  from: "2026-06-02T09:15:00Z",
  to: "2026-09-15T11:40:00Z",
  status: "newest_pending",
  partialCache: true,
  requestedFromBeforeCoverage: false,
};

function coverage(
  sources: SearchCoverageSource[],
  overrides: Partial<KnownSearchCoverage> = {},
): KnownSearchCoverage {
  return {
    v: 1,
    asOf: "2026-09-15T12:00:00Z",
    basis: "index",
    requested: { from: null, to: null },
    requestedFromBeforeCoverage: false,
    limitReached: false,
    sources,
    notice: "…",
    ...overrides,
  };
}

const searchPart = (
  result: Record<string, unknown>,
  toolCallId = "call-search",
): ContentPart =>
  ({
    content_type: "tool_use",
    tool_call_id: toolCallId,
    tool_name: "search_sidecar_index",
    status: "success",
    input: { text: "offer" },
    output: { status: "success", result: { hits: [], ...result } },
  }) as unknown as ContentPart;

const answer: ContentPart = {
  content_type: "text",
  text: "Jane sent the offer on 14 September.",
};

const renderContent = (content: ContentPart[], showRaw = false) =>
  render(
    <I18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider>
        <ThemeProvider enableCustomTheme={false}>
          <QueryClientProvider client={new QueryClient()}>
            <MessageContent
              content={content}
              messageId="message-1"
              showRaw={showRaw}
            />
          </QueryClientProvider>
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </I18nProvider>,
  );

describe("LocalSearchCoverageNotice", () => {
  it.each([false, true])(
    "states the searched period under the reply (raw: %s)",
    (showRaw) => {
      renderContent(
        [searchPart({ coverage: coverage([outlook, teams]) }), answer],
        showRaw,
      );
      const notice = screen.getByTestId("local-search-coverage-notice");
      expect(notice).toHaveAttribute("data-tone", "info");
      expect(notice).toHaveTextContent(
        `Searched on this device: Outlook · jane@example.com: ${day(outlook.from!)} – ${day(outlook.to!)}`,
      );
      expect(notice).toHaveTextContent(
        "Teams keeps only part of its history on this device",
      );
      expect(notice).not.toHaveTextContent("mailbox keeps only part");

      const more = within(notice).getByRole("button", { name: "and 1 more" });
      const teamsLine = `Teams · Contoso Ltd: ${day(teams.from!)} – ${day(teams.to!)}`;
      expect(within(notice).getByText(teamsLine)).not.toBeVisible();
      fireEvent.click(more);
      expect(more).toHaveAttribute("aria-expanded", "true");
      expect(within(notice).getByText(teamsLine)).toBeVisible();
    },
  );

  it("says a cached mailbox may miss older emails, and names Teams only for Teams", () => {
    const newOutlook = { ...outlook, partialCache: true };
    renderContent([searchPart({ coverage: coverage([newOutlook]) }), answer]);
    const notice = screen.getByTestId("local-search-coverage-notice");
    expect(notice).toHaveTextContent(
      "This mailbox keeps only part of its mail on this device, so older emails may be missing.",
    );
    expect(notice).not.toHaveTextContent("Teams keeps only part");
  });

  it("renders nothing without a reported local search", () => {
    renderContent([answer]);
    expect(
      screen.queryByTestId("local-search-coverage-notice"),
    ).not.toBeInTheDocument();

    renderContent([searchPart({ contentNotice: "…" }), answer], true);
    expect(
      screen.queryByTestId("local-search-coverage-notice"),
    ).not.toBeInTheDocument();
  });

  it("warns when the search asked for an earlier start than it covered", () => {
    renderContent([
      searchPart({
        coverage: coverage(
          [outlook, { ...teams, requestedFromBeforeCoverage: true }],
          {
            requested: { from: "2026-01-01T12:00:00Z", to: null },
            requestedFromBeforeCoverage: true,
          },
        ),
      }),
      answer,
    ]);
    const notice = screen.getByTestId("local-search-coverage-notice");
    expect(notice).toHaveAttribute("data-tone", "warning");
    expect(notice).toHaveTextContent(
      `Searched on this device: Teams · Contoso Ltd: ${day(teams.from!)}`,
    );
    expect(notice).toHaveTextContent(
      `The search asked for items from ${day("2026-01-01T12:00:00Z")}, but the searched period starts later.`,
    );
  });

  it("shows the requested start as the UTC day the model asked for", () => {
    renderContent([
      searchPart({
        coverage: coverage([{ ...teams, requestedFromBeforeCoverage: true }], {
          requested: { from: "2026-03-01T23:30:00Z", to: null },
          requestedFromBeforeCoverage: true,
        }),
      }),
    ]);
    const utcDay = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date("2026-03-01T23:30:00Z"));
    expect(
      screen.getByTestId("local-search-coverage-notice"),
    ).toHaveTextContent(`The search asked for items from ${utcDay},`);
  });

  it("keeps leading with the flagged source after a later search", () => {
    renderContent([
      searchPart(
        {
          coverage: coverage(
            [outlook, { ...teams, requestedFromBeforeCoverage: true }],
            {
              asOf: "2026-09-15T11:00:00Z",
              requested: { from: "2026-01-01T12:00:00Z", to: null },
              requestedFromBeforeCoverage: true,
            },
          ),
        },
        "call-dated",
      ),
      searchPart({ coverage: coverage([outlook, teams]) }, "call-undated"),
      answer,
    ]);
    const notice = screen.getByTestId("local-search-coverage-notice");
    expect(notice).toHaveAttribute("data-tone", "warning");
    expect(notice).toHaveTextContent(
      `Searched on this device: Teams · Contoso Ltd: ${day(teams.from!)}`,
    );
  });

  it("numbers sources that share a label", () => {
    renderContent([
      searchPart(
        { coverage: coverage([{ ...teams, sourceId: "teams-b" }]) },
        "call-b",
      ),
      searchPart(
        { coverage: coverage([{ ...teams, sourceId: "teams-a" }]) },
        "call-a",
      ),
    ]);
    const notice = screen.getByTestId("local-search-coverage-notice");
    expect(notice).toHaveTextContent(
      `Searched on this device: Teams · Contoso Ltd (2): ${day(teams.from!)}`,
    );
    expect(
      within(notice).getByText(
        `Teams · Contoso Ltd (1): ${day(teams.from!)} – ${day(teams.to!)}`,
      ),
    ).not.toBeVisible();
  });

  it("names a source that is not searchable yet", () => {
    renderContent([
      searchPart({
        coverage: coverage([
          {
            ...outlook,
            from: null,
            to: null,
            status: "unavailable",
            reason: "not_enumerated",
          },
        ]),
      }),
    ]);
    expect(
      screen.getByTestId("local-search-coverage-notice"),
    ).toHaveTextContent(
      "Searched on this device: Outlook · jane@example.com: not searchable yet",
    );
  });

  it("says when no indexed source matched the search", () => {
    renderContent([searchPart({ coverage: coverage([]) }), answer]);
    expect(
      screen.getByTestId("local-search-coverage-notice"),
    ).toHaveTextContent(
      "Searched on this device: no indexed source matched this search.",
    );
  });

  it("says the period is unknown for a sidecar that does not report it", () => {
    renderContent([
      searchPart({ coverage: { v: 1, status: "unknown", notice: "…" } }),
      answer,
    ]);
    expect(
      screen.getByTestId("local-search-coverage-notice"),
    ).toHaveTextContent(
      "Searched on this device. The searched period is unknown.",
    );
  });
});
