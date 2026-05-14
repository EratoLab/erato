import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  VoiceRuntimeProvider,
  __resetDefaultVoiceRuntimeAssetsForTests,
  useVoiceRuntimeAssets,
} from "./VoiceRuntimeProvider";

import type { ReactNode } from "react";

const renderHookWithProvider = (
  wrapperProps: Parameters<typeof VoiceRuntimeProvider>[0],
) =>
  renderHook(() => useVoiceRuntimeAssets(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <VoiceRuntimeProvider {...wrapperProps}>{children}</VoiceRuntimeProvider>
    ),
  });

describe("VoiceRuntimeProvider", () => {
  afterEach(() => {
    __resetDefaultVoiceRuntimeAssetsForTests();
  });

  it("exposes resolved assets via useVoiceRuntimeAssets", () => {
    const { result } = renderHookWithProvider({
      voiceRuntimeAssets: "/public/common/voice-runtime",
      children: null,
    });

    expect(result.current.ricky0123Vad.baseAssetPath).toBe(
      "/public/common/voice-runtime/ricky0123-vad-web/",
    );
    expect(result.current.ricky0123Vad.onnxWASMBasePath).toBe(
      "/public/common/voice-runtime/onnxruntime-web/",
    );
  });

  it("accepts an object override", () => {
    const { result } = renderHookWithProvider({
      voiceRuntimeAssets: {
        basePath: "/voice",
        ricky0123Vad: { onnxWASMBasePath: "/custom/ort/" },
      },
      children: null,
    });

    expect(result.current.basePath).toBe("/voice");
    expect(result.current.ricky0123Vad.onnxWASMBasePath).toBe("/custom/ort/");
  });

  it("returns a stable reference for the default fallback across renders", () => {
    const { result, rerender } = renderHook(() => useVoiceRuntimeAssets());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("returns the same default singleton across separate consumers", () => {
    const { result: a } = renderHook(() => useVoiceRuntimeAssets());
    const { result: b } = renderHook(() => useVoiceRuntimeAssets());
    expect(a.current).toBe(b.current);
  });

  it("re-resolves only when the overrides prop reference changes", () => {
    const overrides = { basePath: "/voice" };
    const { result, rerender } = renderHook(
      ({ assets }) => useVoiceRuntimeAssets(),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <VoiceRuntimeProvider voiceRuntimeAssets={overrides}>
            {children}
          </VoiceRuntimeProvider>
        ),
        initialProps: { assets: overrides },
      },
    );

    const first = result.current;
    rerender({ assets: overrides });
    expect(result.current).toBe(first);
  });
});
