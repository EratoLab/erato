import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { SpokenLanguagesSetting } from "./SpokenLanguagesSetting";

import type { SpokenLanguageResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const BASE: SpokenLanguageResponse = {
  follow_speaker: true,
  candidates: [],
  main: "en",
  allowed: [],
  offered: ["de", "en", "hi", "tr"],
  own: [],
  app_language: "en",
  source: "deployment",
  user_choice: true,
};

const api = vi.hoisted(() => ({
  spoken: null as SpokenLanguageResponse | null,
  update: vi.fn(async () => ({})),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useSpokenLanguage: () => ({ data: api.spoken }),
  spokenLanguageQuery: () => ({ queryKey: ["spoken-language"] }),
  fetchUpdateProfilePreferences: api.update,
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  api.update.mockClear();
  api.spoken = { ...BASE };
});

const renderSetting = () =>
  render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <SpokenLanguagesSetting />
      </QueryClientProvider>
    </I18nProvider>,
  );

const listed = () =>
  screen
    .getByRole("list", { name: "Languages I speak" })
    .querySelectorAll("li");

describe("languages I speak", () => {
  it("shows the app language until the person adds one", async () => {
    renderSetting();
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toHaveTextContent("English");
    expect(listed()[0]).toHaveTextContent("Main language");

    fireEvent.change(screen.getByRole("combobox", { name: "Add a language" }), {
      target: { value: "hi" },
    });
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_spoken_languages: ["en", "hi"] },
      }),
    );
  });

  it("loads the saved list and saves a new order", async () => {
    api.spoken = { ...BASE, own: ["en", "hi"], source: "user" };
    renderSetting();
    expect(listed()[0]).toHaveTextContent("English");
    expect(listed()[1]).toHaveTextContent("Hindi");

    fireEvent.click(screen.getByRole("button", { name: "Move Hindi up" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_spoken_languages: ["hi", "en"] },
      }),
    );
  });

  it("removes a language and goes back to the app language", async () => {
    api.spoken = { ...BASE, own: ["hi"], source: "user" };
    renderSetting();
    fireEvent.click(screen.getByRole("button", { name: "Remove Hindi" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_spoken_languages: null },
      }),
    );
  });

  it("offers no more than three languages", () => {
    api.spoken = { ...BASE, own: ["en", "hi", "tr"], source: "user" };
    renderSetting();
    expect(
      screen.queryByRole("combobox", { name: "Add a language" }),
    ).not.toBeInTheDocument();
  });

  it("starts from the language the voice falls back to", async () => {
    api.spoken = {
      ...BASE,
      main: "de",
      candidates: ["de", "fr"],
      allowed: ["fr", "de"],
      offered: ["fr", "de"],
    };
    renderSetting();
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toHaveTextContent("German");
    expect(listed()[0]).toHaveTextContent("Main language");
    expect(
      screen.queryByText("Your app language, until you add another."),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Add a language" }), {
      target: { value: "fr" },
    });
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_spoken_languages: ["de", "fr"] },
      }),
    );
  });

  it("says which language the voice uses when none of the person's is allowed", () => {
    api.spoken = {
      ...BASE,
      own: ["hi"],
      main: "de",
      allowed: ["de", "fr"],
      offered: ["de", "fr"],
      source: "user",
    };
    renderSetting();
    expect(listed()[0]).toHaveTextContent("Not used here");
    expect(
      screen.getByText(
        "None of these is used here, so the voice speaks German.",
      ),
    ).toBeInTheDocument();
  });

  it("is read-only where the organization decides", () => {
    api.spoken = {
      ...BASE,
      main: "en",
      own: ["hi"],
      user_choice: false,
      allowed: ["de", "en"],
      offered: ["de", "en"],
      source: "audience",
    };
    renderSetting();
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toHaveTextContent("English");
    expect(screen.getByText("Set by your organization")).toBeInTheDocument();
    expect(
      screen.getByText("Your organization allows: German, English."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("marks a language the organization does not allow", () => {
    api.spoken = {
      ...BASE,
      own: ["hi", "de"],
      allowed: ["de", "fr"],
      offered: ["de", "fr"],
      source: "user",
    };
    renderSetting();
    expect(listed()[0]).toHaveTextContent("Not used here");
    expect(listed()[0]).not.toHaveTextContent("Main language");
    expect(listed()[1]).not.toHaveTextContent("Not used here");
    expect(listed()[1]).toHaveTextContent("Main language");
    expect(
      screen.queryByText(/None of these is used here/),
    ).not.toBeInTheDocument();
  });
});
