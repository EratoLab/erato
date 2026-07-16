import type { Plugin, PluginOption } from "vite";

/** Applies the frontend's React and Lingui transforms to live kit sources. */
export function eratoComponentKitLiveStorybook(): PluginOption[];

export interface EratoComponentKitStorybookOptions {
  /** Directory containing the built component kit entry, styles, and assets. */
  componentKitDirectory: string;
  /** Public directory used inside the Storybook preview. */
  publicPath?: string;
}

/**
 * Supplies the frontend-owned shared-module import map to Storybook and loads
 * a built component kit as an untransformed browser module.
 */
export function eratoComponentKitStorybook(
  options: EratoComponentKitStorybookOptions,
): Plugin;
