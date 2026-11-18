import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "@/app/env";

describe("env keepToolsDropdownOpen", () => {
  afterEach(() => {
    delete window.KEEP_TOOLS_DROPDOWN_OPEN;
    vi.unstubAllEnvs();
  });

  it("defaults to false", () => {
    expect(env().keepToolsDropdownOpen).toBe(false);
  });

  it.each([true, false])(
    "reads backend values and Vite overrides (%s)",
    (value) => {
      window.KEEP_TOOLS_DROPDOWN_OPEN = value;
      expect(env().keepToolsDropdownOpen).toBe(value);
      vi.stubEnv("VITE_KEEP_TOOLS_DROPDOWN_OPEN", String(!value));
      expect(env().keepToolsDropdownOpen).toBe(!value);
    },
  );
});

describe("env readAloudEnabled", () => {
  afterEach(() => {
    delete window.READ_ALOUD_ENABLED;
    vi.unstubAllEnvs();
  });

  it("defaults to off", () => {
    expect(env().readAloudEnabled).toBe(false);
  });

  it.each([true, false])(
    "reads the backend value and the Vite override (%s)",
    (value) => {
      window.READ_ALOUD_ENABLED = value;
      expect(env().readAloudEnabled).toBe(value);
      vi.stubEnv("VITE_READ_ALOUD_ENABLED", String(!value));
      expect(env().readAloudEnabled).toBe(!value);
    },
  );
});

describe("env speechEnabled", () => {
  afterEach(() => {
    delete window.SPEECH_ENABLED;
    vi.unstubAllEnvs();
  });

  it("defaults to off", () => {
    expect(env().speechEnabled).toBe(false);
  });

  it.each([true, false])(
    "reads the backend value and the Vite override (%s)",
    (value) => {
      window.SPEECH_ENABLED = value;
      expect(env().speechEnabled).toBe(value);
      vi.stubEnv("VITE_SPEECH_ENABLED", String(!value));
      expect(env().speechEnabled).toBe(!value);
    },
  );
});

describe("env approvalVoiceCommandsEnabled", () => {
  afterEach(() => {
    delete window.APPROVAL_VOICE_COMMANDS_ENABLED;
    vi.unstubAllEnvs();
  });

  it("defaults to off", () => {
    expect(env().approvalVoiceCommandsEnabled).toBe(false);
  });

  it.each([true, false])(
    "reads the backend value and the Vite override (%s)",
    (value) => {
      window.APPROVAL_VOICE_COMMANDS_ENABLED = value;
      expect(env().approvalVoiceCommandsEnabled).toBe(value);
      vi.stubEnv("VITE_APPROVAL_VOICE_COMMANDS_ENABLED", String(!value));
      expect(env().approvalVoiceCommandsEnabled).toBe(!value);
    },
  );
});

describe("env audioConversationalEndOfTurnSilenceMs", () => {
  afterEach(() => {
    delete window.AUDIO_CONVERSATIONAL_END_OF_TURN_SILENCE_MS;
    vi.unstubAllEnvs();
  });

  it("is unset by default, so the recorder keeps 1.8 s", () => {
    expect(env().audioConversationalEndOfTurnSilenceMs).toBeUndefined();
  });

  it("reads backend configuration and prefers the Vite override", () => {
    window.AUDIO_CONVERSATIONAL_END_OF_TURN_SILENCE_MS = 1500;
    expect(env().audioConversationalEndOfTurnSilenceMs).toBe(1500);
    vi.stubEnv("VITE_AUDIO_CONVERSATIONAL_END_OF_TURN_SILENCE_MS", "1200");
    expect(env().audioConversationalEndOfTurnSilenceMs).toBe(1200);
  });

  it("reads the minimum speech and the voice's start buffer", () => {
    expect(env().audioConversationalMinSpeechMs).toBeUndefined();
    window.AUDIO_CONVERSATIONAL_MIN_SPEECH_MS = 300;
    window.AUDIO_CONVERSATIONAL_CARD_MIN_SPEECH_MS = 96;
    window.AUDIO_CONVERSATIONAL_VOICE_START_BUFFER_MS = 0;
    window.AUDIO_CONVERSATIONAL_VOICE_START_MAX_WAIT_MS = 500;
    expect(env()).toMatchObject({
      audioConversationalMinSpeechMs: 300,
      audioConversationalCardMinSpeechMs: 96,
      audioConversationalVoiceStartBufferMs: 0,
      audioConversationalVoiceStartMaxWaitMs: 500,
    });
    vi.stubEnv("VITE_AUDIO_CONVERSATIONAL_CARD_MIN_SPEECH_MS", "128");
    expect(env().audioConversationalCardMinSpeechMs).toBe(128);
    delete window.AUDIO_CONVERSATIONAL_MIN_SPEECH_MS;
    delete window.AUDIO_CONVERSATIONAL_CARD_MIN_SPEECH_MS;
    delete window.AUDIO_CONVERSATIONAL_VOICE_START_BUFFER_MS;
    delete window.AUDIO_CONVERSATIONAL_VOICE_START_MAX_WAIT_MS;
  });

  it("reads the card's own silence beside it", () => {
    expect(env().audioConversationalCardEndOfTurnSilenceMs).toBeUndefined();
    window.AUDIO_CONVERSATIONAL_CARD_END_OF_TURN_SILENCE_MS = 900;
    expect(env().audioConversationalCardEndOfTurnSilenceMs).toBe(900);
    vi.stubEnv("VITE_AUDIO_CONVERSATIONAL_CARD_END_OF_TURN_SILENCE_MS", "700");
    expect(env().audioConversationalCardEndOfTurnSilenceMs).toBe(700);
    delete window.AUDIO_CONVERSATIONAL_CARD_END_OF_TURN_SILENCE_MS;
  });
});

describe("env audioConversationalTalkOverVoice", () => {
  afterEach(() => {
    delete window.AUDIO_CONVERSATIONAL_TALK_OVER_VOICE;
    delete window.AUDIO_CONVERSATIONAL_TALK_OVER_VOICE_MIN_SPEECH_MS;
    vi.unstubAllEnvs();
  });

  it("is off by default, with no minimum of its own", () => {
    expect(env().audioConversationalTalkOverVoice).toBe(false);
    expect(env().audioConversationalTalkOverVoiceMinSpeechMs).toBeUndefined();
  });

  it.each([true, false])(
    "reads the backend value and the Vite override (%s)",
    (value) => {
      window.AUDIO_CONVERSATIONAL_TALK_OVER_VOICE = value;
      expect(env().audioConversationalTalkOverVoice).toBe(value);
      vi.stubEnv("VITE_AUDIO_CONVERSATIONAL_TALK_OVER_VOICE", String(!value));
      expect(env().audioConversationalTalkOverVoice).toBe(!value);
    },
  );

  it("reads the minimum speech and prefers the Vite override", () => {
    window.AUDIO_CONVERSATIONAL_TALK_OVER_VOICE_MIN_SPEECH_MS = 700;
    expect(env().audioConversationalTalkOverVoiceMinSpeechMs).toBe(700);
    vi.stubEnv(
      "VITE_AUDIO_CONVERSATIONAL_TALK_OVER_VOICE_MIN_SPEECH_MS",
      "300",
    );
    expect(env().audioConversationalTalkOverVoiceMinSpeechMs).toBe(300);
  });
});

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

describe("env teamsAppName", () => {
  afterEach(() => {
    delete window.TEAMS_APP_NAME;
    vi.unstubAllEnvs();
  });

  it("reads the name the backend sends", () => {
    window.TEAMS_APP_NAME = "Hugo";
    expect(env().teamsAppName).toBe("Hugo");
  });

  it("treats a missing or blank name as unknown", () => {
    expect(env().teamsAppName).toBeNull();
    window.TEAMS_APP_NAME = "   ";
    expect(env().teamsAppName).toBeNull();
  });

  it("prefers the Vite override", () => {
    window.TEAMS_APP_NAME = "Hugo";
    vi.stubEnv("VITE_TEAMS_APP_NAME", "Erato Dev");
    expect(env().teamsAppName).toBe("Erato Dev");
  });
});
