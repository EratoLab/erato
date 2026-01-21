import { Preview } from "@storybook/react";
import React, { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles/globals.css";
import {
  ThemeProvider,
  ThemeMode,
  useTheme,
} from "../src/components/providers/ThemeProvider";
import { FeatureConfigProvider } from "../src/providers/FeatureConfigProvider";
import { defaultTheme, darkTheme } from "../src/config/theme";
import { themes as storybookThemes } from "@storybook/theming";
import type { Decorator } from "@storybook/react";

// I18n imports
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

// Add type checking for themes
declare module "@storybook/react" {
  interface Parameters {
    theme?: any;
    locale?: string;
  }
}

// Supported locales for Storybook
const SUPPORTED_LOCALES = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  pl: "Polski",
  es: "Español",
};

// Mock navigator.language for Storybook
const mockNavigatorLanguage = (locale: string) => {
  // Store original navigator if it exists
  const originalNavigator = window.navigator;

  // Create a new navigator object with mocked language
  Object.defineProperty(window, "navigator", {
    value: {
      ...originalNavigator,
      language: locale,
      languages: [locale, "en"],
    },
    writable: true,
    configurable: true,
  });
};

// I18n Provider Component for Storybook
const I18nProviderWrapper: React.FC<{
  children: React.ReactNode;
  locale: string;
}> = ({ children, locale }) => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadLocale = async () => {
      setIsLoading(true);

      // Mock navigator.language for the selected locale
      mockNavigatorLanguage(locale);

      try {
        // Load the selected locale messages (compiled .ts files)
        const { messages } = await import(
          /* @vite-ignore */ `../src/locales/${locale}/messages`
        );
        i18n.load(locale, messages);
        i18n.activate(locale);
      } catch {
        console.warn(`Failed to load locale ${locale}, falling back to en`);
        try {
          const { messages } = await import(
            /* @vite-ignore */ `../src/locales/en/messages`
          );
          i18n.load("en", messages);
          i18n.activate("en");
        } catch {
          // If all else fails, use empty messages
          i18n.load("en", {});
          i18n.activate("en");
        }
      }

      setIsLoading(false);
    };

    loadLocale();
  }, [locale]);

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <div className="text-lg text-gray-600">
          Loading locale:{" "}
          {SUPPORTED_LOCALES[locale as keyof typeof SUPPORTED_LOCALES]}...
        </div>
      </div>
    );
  }

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
};

// I18n Decorator for Storybook
const withI18n: Decorator = (Story, context) => {
  const { globals } = context;
  const locale = globals.locale || "en";

  return (
    <I18nProviderWrapper locale={locale}>
      <Story />
    </I18nProviderWrapper>
  );
};

// Component to sync Storybook's theme selection with ThemeProvider
const ThemeSynchronizer: React.FC<{
  children: React.ReactNode;
  storybookTheme: ThemeMode;
}> = ({ children, storybookTheme }) => {
  const { setThemeMode } = useTheme();

  // Sync Storybook theme with ThemeProvider
  useEffect(() => {
    // Set the theme mode
    setThemeMode(storybookTheme);
  }, [storybookTheme, setThemeMode]);

  return <>{children}</>;
};

// This component syncs the background with the selected theme
const ThemeBackground: React.FC<{
  children: React.ReactNode;
  selectedTheme: string;
}> = ({ children, selectedTheme }) => {
  // Apply styles directly to the root element
  useEffect(() => {
    const storyRoot = document.querySelector("#storybook-root");
    if (storyRoot) {
      // Apply theme-specific background and text colors
      if (selectedTheme === "dark") {
        (storyRoot as HTMLElement).style.background =
          darkTheme.colors.background.primary;
        (storyRoot as HTMLElement).style.color =
          darkTheme.colors.foreground.primary;
      } else {
        (storyRoot as HTMLElement).style.background =
          defaultTheme.colors.background.primary;
        (storyRoot as HTMLElement).style.color =
          defaultTheme.colors.foreground.primary;
      }
    }

    // Fix scrolling in Storybook by overriding the global overflow: hidden
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
  }, [selectedTheme]);

  return <>{children}</>;
};

// Create the decorator function using our component
const withThemeBackground: Decorator = (Story, context) => {
  // Get the current selected theme from Storybook globals
  const { globals } = context;
  const selectedTheme = globals.theme || "light";

  return (
    <ThemeBackground selectedTheme={selectedTheme}>
      <Story />
    </ThemeBackground>
  );
};

// Router decorator to provide React Router context
const withRouter: Decorator = (Story) => {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <Story />
    </MemoryRouter>
  );
};

// QueryClient decorator to provide React Query context
const withQueryClient: Decorator = (Story) => {
  // Create a new QueryClient instance for each story to avoid caching issues
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Disable retries in Storybook for faster feedback
        staleTime: 0, // Don't cache data in Storybook
        gcTime: 0, // Don't keep data in garbage collection
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <Story />
    </QueryClientProvider>
  );
};

// FeatureConfig decorator to provide feature flags context
const withFeatureConfig: Decorator = (Story) => {
  return (
    <FeatureConfigProvider>
      <Story />
    </FeatureConfigProvider>
  );
};

// Main theme decorator that ties everything together
const withThemeDecorator: Decorator = (Story, context) => {
  const { globals } = context;
  const selectedTheme = (globals.theme || "light") as ThemeMode;

  return (
    <ThemeProvider>
      <ThemeSynchronizer storybookTheme={selectedTheme}>
        <Story />
      </ThemeSynchronizer>
    </ThemeProvider>
  );
};

const VIEWPORTS = {
  mobile: {
    name: "Mobile",
    styles: {
      width: "320px",
      height: "568px",
    },
  },
  tablet: {
    name: "Tablet",
    styles: {
      width: "768px",
      height: "1024px",
    },
  },
  desktop: {
    name: "Desktop",
    styles: {
      width: "1024px",
      height: "768px",
    },
  },
};

const preview: Preview = {
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme for components",
      defaultValue: "light",
      toolbar: {
        // The icon for the toolbar item
        icon: "circlehollow",
        // Array of options
        items: [
          { value: "light", icon: "circlehollow", title: "Light Theme" },
          { value: "dark", icon: "circle", title: "Dark Theme" },
        ],
        // Property that specifies if the name of the item will be displayed
        showName: true,
      },
    },
    locale: {
      name: "Locale",
      description: "Global locale for internationalization",
      defaultValue: "en",
      toolbar: {
        icon: "globe",
        items: [
          { value: "en", title: "🇺🇸 English" },
          { value: "de", title: "🇩🇪 Deutsch" },
          { value: "fr", title: "🇫🇷 Français" },
          { value: "pl", title: "🇵🇱 Polski" },
          { value: "es", title: "🇪🇸 Español" },
        ],
        showName: true,
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Keep the themes parameter to enable native Storybook theme controls
    themes: {
      default: "light",
      list: [
        {
          name: "light",
          color: defaultTheme.colors.foreground.primary,
          background: { default: defaultTheme.colors.background.primary },
        },
        {
          name: "dark",
          color: darkTheme.colors.foreground.primary,
          background: { default: darkTheme.colors.background.primary },
        },
      ],
    },
    docs: {
      theme: storybookThemes.light,
    },
    viewport: {
      viewports: VIEWPORTS,
    },
    backgrounds: {
      disable: true, // Disable the backgrounds addon as we'll handle it with themes
    },
  },
  decorators: [
    // Apply Router context first (needed for components using useNavigate)
    withRouter,

    // Apply QueryClient context second (needed for React Query hooks)
    withQueryClient,

    // Apply FeatureConfig context third (needed for feature flags)
    withFeatureConfig,

    // Apply i18n context fourth (before theme)
    withI18n,

    // Apply theme background based on selected theme
    withThemeBackground,

    // Main theme decorator that properly integrates with your ThemeProvider
    withThemeDecorator,
  ],
};

export default preview;
