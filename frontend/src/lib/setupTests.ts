import "@testing-library/jest-dom";
import { i18n } from "@lingui/core";
import { beforeAll, afterEach, afterAll } from "vitest";


import { server } from "./mocks/server";

import type { Messages } from "@lingui/core";

import { messages as enMessages } from "@/locales/en/messages.json";

// Initialize i18n for all tests
i18n.load("en", enMessages as unknown as Messages);
i18n.activate("en");

// Polyfill ResizeObserver for tests
global.ResizeObserver = class ResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  cb: ResizeObserverCallback;
  observe() {
    // Mock implementation
  }
  unobserve() {
    // Mock implementation
  }
  disconnect() {
    // Mock implementation
  }
};

// Mock IntersectionObserver for tests
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (!global.IntersectionObserver) {
  // @ts-ignore - Mock for testing environment
  global.IntersectionObserver = class {
    observe = () => null;
    disconnect = () => null;
    unobserve = () => null;
  };
}

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock window.scrollTo
Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

// Establish API mocking before all tests.
beforeAll(() => server.listen());

// Reset any request handlers that we may add during the tests,
// so they don't affect other tests.
afterEach(() => server.resetHandlers());

// Clean up after the tests are finished.
afterAll(() => server.close());
