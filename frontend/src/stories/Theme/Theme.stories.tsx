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
          tertiary: "#fae8fb",
          sidebar: "#fdf4ff",
          accent: "#fbcfe8",
          selected: "#f9a8d4",
          hover: "#f472b6",
        },
        foreground: {
          primary: "#831843",
          secondary: "#9d174d",
          muted: "#be185d",
          accent: "#d946ef",
        },
        border: {
          default: "#f0abfc",
          strong: "#e879f9",
          focus: "#d946ef",
        },
        status: {
          info: {
            foreground: "#3b82f6",
            background: "#eff6ff",
            border: "#93c5fd",
          },
          success: {
            foreground: "#10b981",
            background: "#ecfdf5",
            border: "#6ee7b7",
          },
          warning: {
            foreground: "#f59e0b",
            background: "#fffbeb",
            border: "#fcd34d",
          },
          error: {
            foreground: "#be123c",
            background: "#fecdd3",
            border: "#e11d48",
          },
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
        focus: {
          ring: "#d946ef",
        },
      },
    },
  },
};
