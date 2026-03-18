import { defaultTheme } from "../../config/theme";

import type { Theme } from "../../config/theme";
import type { Meta, StoryObj } from "@storybook/react";

type ThemeValue = string | number | Record<string, unknown>;

const getValue = (
  obj: Record<string, ThemeValue>,
  path: string[],
): ThemeValue =>
  path.reduce<Record<string, ThemeValue> | ThemeValue>(
    (acc, key) => (acc as Record<string, ThemeValue>)[key],
    obj,
  );

const getLeafTokenPaths = (value: ThemeValue, path: string[]): string[][] => {
  if (typeof value === "string" || typeof value === "number") {
    return [path];
  }

  return Object.entries(value as Record<string, ThemeValue>).flatMap(
    ([key, nestedValue]) => getLeafTokenPaths(nestedValue, [...path, key]),
  );
};

const TokenDisplay = ({
  theme,
  tokenPath,
}: {
  theme: Theme;
  tokenPath: string[];
}) => {
  const value = getValue(theme as Record<string, ThemeValue>, tokenPath);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.5rem",
        borderBottom: "1px solid #eee",
      }}
    >
      <div style={{ flex: 1 }}>{tokenPath.join(".")}</div>
      <div
        style={{
          width: "100px",
          height: "24px",
          background: typeof value === "string" ? value : undefined,
          border: "1px solid #ccc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.875rem",
        }}
      >
        {typeof value === "string" ? value : JSON.stringify(value)}
      </div>
    </div>
  );
};

const TokenSection = ({
  theme,
  title,
  tokenPath,
}: {
  theme: Theme;
  title: string;
  tokenPath: string[];
}) => {
  const sectionValue = getValue(theme as Record<string, ThemeValue>, tokenPath);
  const leafPaths = getLeafTokenPaths(sectionValue, tokenPath);

  return (
    <section style={{ marginBottom: "2rem" }}>
      <h3>{title}</h3>
      {leafPaths.map((path) => (
        <TokenDisplay
          key={path.join(".")}
          theme={theme}
          tokenPath={path}
        />
      ))}
    </section>
  );
};

const meta = {
  title: "Theme/Tokens",
  component: TokenDisplay,
} satisfies Meta<typeof TokenDisplay>;

export default meta;
type Story = StoryObj<typeof TokenDisplay>;

const colorSections = [
  { title: "Background Colors", tokenPath: ["colors", "background"] },
  { title: "Foreground Colors", tokenPath: ["colors", "foreground"] },
  { title: "Shell Colors", tokenPath: ["colors", "shell"] },
  { title: "Message Colors", tokenPath: ["colors", "message"] },
  { title: "Overlay Colors", tokenPath: ["colors", "overlay"] },
  { title: "Avatar Colors", tokenPath: ["colors", "avatar"] },
  { title: "Status Colors", tokenPath: ["colors", "status"] },
  { title: "Focus Colors", tokenPath: ["colors", "focus"] },
] as const;

const foundationSections = [
  { title: "Radius", tokenPath: ["radius"] },
  { title: "Spacing", tokenPath: ["spacing"] },
  { title: "Elevation", tokenPath: ["elevation"] },
  { title: "Layout", tokenPath: ["layout"] },
] as const;

const typographySections = [
  { title: "Font Families", tokenPath: ["typography", "fontFamily"] },
  { title: "Font Sizes", tokenPath: ["typography", "fontSize"] },
  { title: "Line Heights", tokenPath: ["typography", "lineHeight"] },
  { title: "Letter Spacing", tokenPath: ["typography", "letterSpacing"] },
  { title: "Font Weights", tokenPath: ["typography", "fontWeight"] },
] as const;

export const Colors: Story = {
  render: () => (
    <div>
      {colorSections.map((section) => (
        <TokenSection
          key={section.title}
          theme={defaultTheme}
          title={section.title}
          tokenPath={[...section.tokenPath]}
        />
      ))}
    </div>
  ),
};

export const Foundations: Story = {
  render: () => (
    <div>
      {foundationSections.map((section) => (
        <TokenSection
          key={section.title}
          theme={defaultTheme}
          title={section.title}
          tokenPath={[...section.tokenPath]}
        />
      ))}
    </div>
  ),
};

export const Typography: Story = {
  render: () => (
    <div>
      {typographySections.map((section) => (
        <TokenSection
          key={section.title}
          theme={defaultTheme}
          title={section.title}
          tokenPath={[...section.tokenPath]}
        />
      ))}
    </div>
  ),
};
