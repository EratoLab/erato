// The entry injects the window globals the library's `env()` reads before
// anything renders (src/app/env.ts); tests mirror that invariant.
import "../app/env";

// jsdom has no matchMedia; the library's ThemeProvider queries it in
// "system" mode. A static light preference is enough for rendering.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
