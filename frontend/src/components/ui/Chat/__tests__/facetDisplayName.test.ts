import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { getFacetDisplayName } from "../facetDisplayName";

const schedule = {
  id: "schedule",
  display_name: "Schedule",
  default_enabled: false,
};

describe("getFacetDisplayName", () => {
  afterEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
  });

  it("translates the built-in schedule facet's name", () => {
    i18n.load("de", { "facets.builtin.schedule.displayName": "Planen" });
    i18n.activate("de");

    expect(getFacetDisplayName(schedule)).toBe("Planen");
  });

  it("keeps a deployment's own name for the schedule facet", () => {
    i18n.load("de", { "facets.builtin.schedule.displayName": "Planen" });
    i18n.activate("de");

    expect(getFacetDisplayName({ ...schedule, display_name: "Termine" })).toBe(
      "Termine",
    );
  });

  it("prefers a configured translation for the facet id", () => {
    i18n.load("de", {
      "facets.schedule.display_name": "Erinnern",
      "facets.builtin.schedule.displayName": "Planen",
    });
    i18n.activate("de");

    expect(getFacetDisplayName(schedule)).toBe("Erinnern");
  });
});
