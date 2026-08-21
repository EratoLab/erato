import { afterEach, describe, expect, it, vi } from "vitest";

import { injectFrontendEnv } from "../env";

const FLAG_WINDOW_KEYS = [
  "ASSISTANTS_ENABLED",
  "ASSISTANTS_DELEGATION_ENABLED",
  "ASSISTANTS_DELEGATION_ALLOW_BACKGROUND",
] as const;

describe("injectFrontendEnv assistants flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of FLAG_WINDOW_KEYS) {
      Reflect.deleteProperty(window, key);
    }
  });

  it("mirrors enabled flags onto window for a bundle packed without them", () => {
    vi.stubEnv("VITE_ASSISTANTS_ENABLED", "true");
    vi.stubEnv("VITE_ASSISTANTS_DELEGATION_ENABLED", "true");
    vi.stubEnv("VITE_ASSISTANTS_DELEGATION_ALLOW_BACKGROUND", "true");

    injectFrontendEnv();

    expect(window.ASSISTANTS_ENABLED).toBe(true);
    expect(window.ASSISTANTS_DELEGATION_ENABLED).toBe(true);
    expect(window.ASSISTANTS_DELEGATION_ALLOW_BACKGROUND).toBe(true);
  });

  it("leaves flags unset when the env does not enable them", () => {
    // The test process inherits the developer's real .env.local; force the
    // disabled case explicitly.
    vi.stubEnv("VITE_ASSISTANTS_ENABLED", "");
    vi.stubEnv("VITE_ASSISTANTS_DELEGATION_ENABLED", "");
    vi.stubEnv("VITE_ASSISTANTS_DELEGATION_ALLOW_BACKGROUND", "");

    injectFrontendEnv();

    for (const key of FLAG_WINDOW_KEYS) {
      expect(window[key]).toBeUndefined();
    }
  });

  it("never overrides values the serving backend already injected", () => {
    vi.stubEnv("VITE_ASSISTANTS_DELEGATION_ENABLED", "true");
    window.ASSISTANTS_DELEGATION_ENABLED = false;

    injectFrontendEnv();

    expect(window.ASSISTANTS_DELEGATION_ENABLED).toBe(false);
  });
});
