import { Preview } from "@storybook/react";
import "../src/styles/globals.css";
import { ThemeProvider } from "../src/components/providers/ThemeProvider";
import { defaultTheme, darkTheme, Theme } from "../src/config/theme";
import { withThemeFromJSXProvider } from "@storybook/addon-themes";

// Add type checking for themes
declare module "@storybook/react" {
  interface Parameters {
    theme?: Theme;
  }
}

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
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    themes: {
      default: "light",
      list: [
        {
          name: "light",
          color: "#ffffff",
          class: "light",
          background: { default: "#ffffff" },
        },
        {
          name: "dark",
          color: "#000000",
          class: "dark",
          background: { default: "#1a1a1a" },
        },
      ],
    },
    viewport: {
      viewports: VIEWPORTS,
      defaultViewport: "desktop",
    },
  },
  decorators: [
    withThemeFromJSXProvider({
      themes: {
        light: defaultTheme,
        dark: darkTheme,
      },
      defaultTheme: "light",
      Provider: ThemeProvider,
    }),
  ],
};

export default preview;
