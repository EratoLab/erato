import type { Theme } from "@/config/theme";
import type {
  McpUiHostContext,
  McpUiStyles,
} from "@modelcontextprotocol/ext-apps/app-bridge";

/** The tallest a view may make its frame, in CSS pixels. */
export const MAX_VIEW_HEIGHT = 6000;

/**
 * After the theme's own font, which the view cannot load from the app, the
 * system's sans-serif.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS font families
const SANS_SERIF_FALLBACK = "ui-sans-serif, system-ui, sans-serif";

/** Keywords that are no colour of their own, or none at all. */
const NOT_A_COLOR = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
]);

/**
 * Whether a theme colour is a concrete, opaque colour: a hex value, a colour
 * function without an alpha below 1, or a named colour. A transparent or
 * translucent colour, or one the view cannot resolve, such as a `var()`,
 * is not.
 */
const isOpaqueColor = (color: string): boolean => {
  const value = color.trim().toLowerCase();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(value)?.[1];
  if (hex) {
    if (hex.length === 4) return hex.endsWith("f");
    return hex.length !== 8 || hex.endsWith("ff");
  }
  const args = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(([^()]*)\)$/.exec(
    value,
  )?.[1];
  if (args !== undefined) {
    const alpha = args.includes("/")
      ? args.split("/").at(1)
      : args.split(",").at(3);
    if (alpha === undefined) return true;
    const amount = parseFloat(alpha);
    return alpha.trim().endsWith("%") ? amount >= 100 : amount >= 1;
  }
  return /^[a-z]+$/.test(value) && !NOT_A_COLOR.has(value);
};

/**
 * The colour behind a view: the assistant message's when it is opaque,
 * otherwise that of the chat body, the page or the app the message sits on,
 * whichever paints first. None when no surface has a concrete colour.
 */
export const viewBackgroundColor = (theme: Theme): string | undefined =>
  [
    theme.colors.message.assistant,
    theme.colors.shell.chatBody,
    theme.colors.shell.page,
    theme.colors.shell.app,
    theme.colors.background.primary,
  ].find(isOpaqueColor);

/**
 * The theme's tokens under the variable names of the MCP Apps standard, so a
 * view can match the message it sits in and keep its contrast: the colour
 * behind the view, the text colours, the border and the body font.
 */
export const viewStyleVariables = (theme: Theme): Partial<McpUiStyles> => {
  const background = viewBackgroundColor(theme);
  return {
    ...(background ? { "--color-background-primary": background } : {}),
    "--color-text-primary": theme.colors.foreground.primary,
    "--color-text-secondary": theme.colors.foreground.secondary,
    "--color-text-tertiary": theme.colors.foreground.muted,
    "--color-border-primary": theme.colors.border.default,
    ...(theme.typography
      ? {
          "--font-sans": `${theme.typography.fontFamily.body}, ${SANS_SERIF_FALLBACK}`,
        }
      : {}),
  };
};

export interface ViewHostContextInput {
  /** The app's light or dark mode. */
  theme: "light" | "dark";
  /** The app's theme, whose tokens the view gets as style variables. */
  appTheme?: Theme;
  /** The width the message column gives the view, once measured. */
  width?: number;
  /** The user's UI language. */
  locale?: string;
  /** The user's time zone. */
  timeZone?: string;
}

/**
 * What a view is told about where it is shown (`ui/initialize`, then
 * `ui/notifications/host-context-changed`): inline in the web app, as wide
 * as the message column and at most `MAX_VIEW_HEIGHT` tall, in the app's
 * theme, colours, font, language and time zone.
 */
export const viewHostContext = ({
  theme,
  appTheme,
  width,
  locale,
  timeZone,
}: ViewHostContextInput): McpUiHostContext => ({
  theme,
  platform: "web",
  displayMode: "inline",
  availableDisplayModes: ["inline"],
  containerDimensions:
    width === undefined
      ? { maxHeight: MAX_VIEW_HEIGHT }
      : { width, maxHeight: MAX_VIEW_HEIGHT },
  ...(appTheme
    ? {
        styles: {
          // The standard lists every variable; a host sends those it has.
          variables: viewStyleVariables(appTheme) as McpUiStyles,
        },
      }
    : {}),
  ...(locale ? { locale } : {}),
  ...(timeZone ? { timeZone } : {}),
});
