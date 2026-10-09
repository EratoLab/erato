import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "@/app/env";

describe("env faviconPath", () => {
  afterEach(() => {
    delete window.FAVICON_PATH;
    vi.unstubAllEnvs();
  });

  it("defaults to the existing favicon route", () => {
    expect(env().faviconPath).toBe("/favicon.svg");
  });

  it("reads backend configuration and prefers the Vite override", () => {
    window.FAVICON_PATH = "/public/common/custom-theme/acme/icon.png";
    expect(env().faviconPath).toBe(window.FAVICON_PATH);
    vi.stubEnv("VITE_FAVICON_PATH", "/local-icon.ico");
    expect(env().faviconPath).toBe("/local-icon.ico");
  });
});

describe("env chatInputEmptyStateLayout", () => {
  afterEach(() => {
    delete window.CHAT_INPUT_EMPTY_STATE_LAYOUT;
  });

  it("defaults to centered", () => {
    expect(env().chatInputEmptyStateLayout).toBe("centered");
  });

  it("keeps an explicit bottom override", () => {
    window.CHAT_INPUT_EMPTY_STATE_LAYOUT = "bottom";
    expect(env().chatInputEmptyStateLayout).toBe("bottom");
  });

  it("falls back to centered for unknown values", () => {
    window.CHAT_INPUT_EMPTY_STATE_LAYOUT = "sideways";
    expect(env().chatInputEmptyStateLayout).toBe("centered");
  });
});

describe("env MCP visibility", () => {
  afterEach(() => {
    delete window.MCP_SERVERS_TAB_ENABLED;
    delete window.MCP_SERVERS_IN_CHAT_INPUT_ENABLED;
    delete window.MCP_SERVERS_IN_ASSISTANT_EDITOR_ENABLED;
    vi.unstubAllEnvs();
  });

  for (const parent of [false, true]) {
    for (const chat of [undefined, false, true]) {
      for (const assistant of [undefined, false, true]) {
        it(`resolves tab=${parent}, chat=${chat}, assistant=${assistant}`, () => {
          window.MCP_SERVERS_TAB_ENABLED = parent;
          window.MCP_SERVERS_IN_CHAT_INPUT_ENABLED = chat;
          window.MCP_SERVERS_IN_ASSISTANT_EDITOR_ENABLED = assistant;
          expect(env()).toMatchObject({
            mcpServersTabEnabled: parent,
            mcpServersInChatInputEnabled: chat ?? parent,
            mcpServersInAssistantEditorEnabled: assistant ?? parent,
          });
        });
      }
    }
  }

  it.each([true, false])(
    "honors explicit Vite %s over window values",
    (value) => {
      window.MCP_SERVERS_IN_CHAT_INPUT_ENABLED = !value;
      window.MCP_SERVERS_IN_ASSISTANT_EDITOR_ENABLED = !value;
      vi.stubEnv("VITE_MCP_SERVERS_IN_CHAT_INPUT_ENABLED", String(value));
      vi.stubEnv("VITE_MCP_SERVERS_IN_ASSISTANT_EDITOR_ENABLED", String(value));
      expect(env()).toMatchObject({
        mcpServersInChatInputEnabled: value,
        mcpServersInAssistantEditorEnabled: value,
      });
    },
  );
});

describe("env reduced UI controls", () => {
  afterEach(() => {
    delete window.MESSAGE_EDITING_ENABLED;
    delete window.MESSAGE_REGENERATION_ENABLED;
    delete window.CHAT_HISTORY_FILTERS_ENABLED;
    vi.unstubAllEnvs();
  });
  it("preserves the existing defaults when no flags are supplied", () => {
    expect(env()).toMatchObject({
      messageEditingEnabled: true,
      messageRegenerationEnabled: true,
      chatHistoryFiltersEnabled: true,
    });
  });
  it.each([true, false])(
    "honors backend values and explicit Vite overrides (%s)",
    (value) => {
      window.MESSAGE_EDITING_ENABLED = value;
      window.MESSAGE_REGENERATION_ENABLED = value;
      window.CHAT_HISTORY_FILTERS_ENABLED = value;
      expect(env()).toMatchObject({
        messageEditingEnabled: value,
        messageRegenerationEnabled: value,
        chatHistoryFiltersEnabled: value,
      });
      for (const key of [
        "MESSAGE_EDITING_ENABLED",
        "MESSAGE_REGENERATION_ENABLED",
        "CHAT_HISTORY_FILTERS_ENABLED",
      ])
        vi.stubEnv(`VITE_${key}`, String(!value));
      expect(env()).toMatchObject({
        messageEditingEnabled: !value,
        messageRegenerationEnabled: !value,
        chatHistoryFiltersEnabled: !value,
      });
    },
  );
});
