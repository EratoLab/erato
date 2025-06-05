import { useState, useEffect } from "react";

export interface ToolCallSettings {
  /**
   * Whether to show tool calls by default
   */
  showToolCalls: boolean;
  /**
   * Whether tool calls should be expanded by default
   */
  defaultExpanded: boolean;
}

const DEFAULT_SETTINGS: ToolCallSettings = {
  showToolCalls: true,
  defaultExpanded: false,
};

const STORAGE_KEY = "llmchat-tool-call-settings";

/**
 * Hook to manage user preferences for tool call display
 */
export function useToolCallSettings() {
  const [settings, setSettings] = useState<ToolCallSettings>(DEFAULT_SETTINGS);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ToolCallSettings>;
        setSettings({
          ...DEFAULT_SETTINGS,
          ...parsed,
        });
      }
    } catch (error) {
      console.warn(
        "Failed to load tool call settings from localStorage:",
        error,
      );
    }
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn("Failed to save tool call settings to localStorage:", error);
    }
  }, [settings]);

  const updateSettings = (updates: Partial<ToolCallSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...updates,
    }));
  };

  const toggleShowToolCalls = () => {
    updateSettings({ showToolCalls: !settings.showToolCalls });
  };

  const toggleDefaultExpanded = () => {
    updateSettings({ defaultExpanded: !settings.defaultExpanded });
  };

  return {
    settings,
    updateSettings,
    toggleShowToolCalls,
    toggleDefaultExpanded,
  };
}
