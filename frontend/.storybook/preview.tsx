import { Preview } from "@storybook/react";
import React, { useEffect } from "react";
import "../src/styles/globals.css";
import {
  ThemeProvider,
  ThemeMode,
  useTheme,
} from "../src/components/providers/ThemeProvider";
import { defaultTheme, darkTheme } from "../src/config/theme";
import { themes as storybookThemes } from "@storybook/theming";
import type { Decorator } from "@storybook/react";

// Add type checking for themes
declare module "@storybook/react" {
  interface Parameters {
    theme?: any;
  }
}

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
    // Apply theme background based on selected theme
    withThemeBackground,

    // Main theme decorator that properly integrates with your ThemeProvider
    withThemeDecorator,
  ],
};

export default preview;
