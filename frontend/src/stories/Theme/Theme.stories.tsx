import type { Meta, StoryObj } from "@storybook/react";
import { defaultTheme, darkTheme, Theme } from "../../config/theme";

// Create a component to display theme colors
const ThemeDisplay = ({ theme }: { theme: Theme }) => (
  <div style={{ padding: "2rem" }}>
    <h2 style={{ marginBottom: "1rem" }}>Theme Preview</h2>
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h3>Background Colors</h3>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          {Object.entries(theme.colors.background).map(([key, color]) => (
            <div key={key}>
              <div
                style={{
                  width: "100px",
                  height: "100px",
                  backgroundColor: color,
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                }}
              />
              <p style={{ marginTop: "0.5rem" }}>{key}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3>Foreground Colors</h3>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          {Object.entries(theme.colors.foreground).map(([key, color]) => (
            <div key={key}>
              <div
                style={{
                  width: "100px",
                  height: "100px",
                  backgroundColor: color,
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                }}
              />
              <p style={{ marginTop: "0.5rem" }}>{key}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const meta = {
  title: "Theme",
  component: ThemeDisplay,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ThemeDisplay>;

export default meta;
type Story = StoryObj<typeof ThemeDisplay>;

// Default story will use the theme from the toolbar
export const Default: Story = {
  args: {
    theme: defaultTheme,
  },
};

// Force dark theme for this story
export const Dark: Story = {
  args: {
    theme: darkTheme,
  },
  parameters: {
    themes: { theme: "dark" },
  },
};

// Custom branded theme
export const Branded: Story = {
  args: {
    theme: {
      ...defaultTheme,
      colors: {
        background: {
          primary: "#fdf2f8",
          secondary: "#fce7f3",
          accent: "#fbcfe8",
        },
        foreground: {
          primary: "#831843",
          secondary: "#9d174d",
          muted: "#be185d",
        },
        avatar: {
          user: {
            background: "#db2777",
            foreground: "#ffffff",
          },
          assistant: {
            background: "#be185d",
            foreground: "#ffffff",
          },
        },
      },
    },
  },
};
