import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useWordIncludeDocumentByDefault,
  WORD_PREFERENCES_KEY,
} from "../wordPreferences";

import type { PersistedStateOptions } from "@erato/frontend/library";

vi.mock("@erato/frontend/library", () => ({
  usePersistedState: <T,>(
    key: string,
    defaultValue: T,
    options: PersistedStateOptions<T>,
  ) => {
    const read = (): T => {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      try {
        return options.parse(JSON.parse(raw)) ?? defaultValue;
      } catch {
        return defaultValue;
      }
    };
    const [value, setValue] = useState(read);
    const update = (next: T | ((previous: T) => T)) => {
      const resolved =
        typeof next === "function"
          ? (next as (previous: T) => T)(read())
          : next;
      localStorage.setItem(key, JSON.stringify(resolved));
      setValue(read());
    };
    return [value, update];
  },
}));

const deploymentDefault = (word_include_document?: boolean) => {
  window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS =
    word_include_document === undefined ? undefined : { word_include_document };
};

const includeDocument = () =>
  renderHook(() => useWordIncludeDocumentByDefault()).result.current[0];

describe("useWordIncludeDocumentByDefault", () => {
  afterEach(() => {
    localStorage.removeItem(WORD_PREFERENCES_KEY);
    delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  });

  it("includes the document when the deployment sets no default", () => {
    expect(includeDocument()).toBe(true);
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = { mode: "ask" };
    expect(includeDocument()).toBe(true);
  });

  it.each([true, false])(
    "follows a deployment default of %s until the user chooses",
    (configured) => {
      deploymentDefault(configured);
      expect(includeDocument()).toBe(configured);
    },
  );

  it("persists the user's choice over the deployment default", () => {
    deploymentDefault(true);
    const { result } = renderHook(() => useWordIncludeDocumentByDefault());

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(JSON.parse(localStorage.getItem(WORD_PREFERENCES_KEY)!)).toEqual({
      includeDocumentByDefault: false,
    });
    expect(includeDocument()).toBe(false);

    deploymentDefault(false);
    act(() => result.current[1](true));
    expect(includeDocument()).toBe(true);
  });

  it.each([
    ["not JSON", "{"],
    ["null", "null"],
    ["an array", "[false]"],
    ["a bare boolean", "false"],
    ["a non-boolean value", '{"includeDocumentByDefault":"no"}'],
  ])("falls back to the deployment default when storage holds %s", (_, raw) => {
    deploymentDefault(false);
    localStorage.setItem(WORD_PREFERENCES_KEY, raw);
    expect(includeDocument()).toBe(false);

    deploymentDefault(true);
    expect(includeDocument()).toBe(true);
  });
});
