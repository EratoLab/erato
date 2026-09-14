import * as realLibrary from "@erato/frontend/library";
import * as realShared from "@erato/frontend/shared";
import { describe, expect, it } from "vitest";

import { createEratoLibraryMock, DEFAULT_STUBS } from "../eratoLibraryMock";

// The only file in the add-in that loads the real barrels. Everywhere else
// they are mocked wholesale, which is exactly why the stub set needs an
// independent check: nothing else here would notice a host export arriving,
// leaving, or changing value.

const stubbed = new Set(Object.keys(DEFAULT_STUBS));
const library = realLibrary as unknown as Record<string, unknown>;
const shared = realShared as unknown as Record<string, unknown>;

/** Recursive key set, so a record stub is checked for nesting, not just depth 1. */
const keyShape = (value: unknown): unknown =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .map(([key, nested]) => [key, keyShape(nested)] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    : typeof value;

describe("createEratoLibraryMock", () => {
  it("stubs every runtime name on the declared kit surface", () => {
    // `ERATO_KIT_SURFACE_EXPORTS` names types as well as values. Membership in
    // the real module namespace is the runtime oracle, so the type-only half
    // drops out without a hand-kept exclusion list.
    const runtimeNames = realShared.ERATO_KIT_SURFACE_EXPORTS.filter(
      (name) => name in shared,
    );

    expect(runtimeNames.length).toBeGreaterThan(0);
    expect(runtimeNames.filter((name) => !stubbed.has(name))).toEqual([]);
  });

  it("stubs nothing the host does not export", () => {
    expect([...stubbed].filter((name) => !(name in library))).toEqual([]);
  });

  it("gives class-name stubs the host's own value", () => {
    const strings = [...stubbed].filter(
      (name) =>
        typeof DEFAULT_STUBS[name as keyof typeof DEFAULT_STUBS] === "string",
    );

    expect(strings).toContain("sidebarInsetClassName");
    for (const name of strings) {
      expect(DEFAULT_STUBS[name as keyof typeof DEFAULT_STUBS]).toBe(
        library[name],
      );
    }
  });

  it("gives style-record stubs the host's own nesting", () => {
    // The values are Tailwind bundles the add-in only ever pastes into
    // `className`, so the stub mirrors the shape and leaves the strings empty;
    // a consumer reading `FILE_PREVIEW_STYLES.progress.container` still gets a
    // string rather than a crash.
    for (const name of ["messageStyles", "FILE_PREVIEW_STYLES"] as const) {
      expect(keyShape(DEFAULT_STUBS[name])).toEqual(keyShape(library[name]));
    }
  });

  it("tracks the surface major, which kits compare with a strict inequality", () => {
    expect(DEFAULT_STUBS.ERATO_SHARED_SURFACE_VERSION).toBe(
      realShared.ERATO_SHARED_SURFACE_VERSION,
    );
  });

  it("lets an override replace a default outright", () => {
    const ownButton = () => null;
    const mock = createEratoLibraryMock({ Button: ownButton });

    expect(mock.Button).toBe(ownButton);
    expect(mock.ModalBase).toBe(DEFAULT_STUBS.ModalBase);
    // Shallow: a partial `toast` must not inherit the default's other methods.
    expect(
      createEratoLibraryMock({ toast: { error: ownButton } }),
    ).toHaveProperty("toast", { error: ownButton });
  });

  it("builds store state fresh on every read", () => {
    const first = DEFAULT_STUBS.useFileUploadStore.getState();

    expect(DEFAULT_STUBS.useFileUploadStore.getState()).not.toBe(first);
    expect(
      DEFAULT_STUBS.useFileUploadStore((state) => state.silentChatId),
    ).toBe(null);
  });
});
