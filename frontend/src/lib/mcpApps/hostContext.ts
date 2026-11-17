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

/**
 * The theme's tokens under the variable names of the MCP Apps standard, so a
 * view can match the message it sits in and keep its contrast: the assistant
 * message's background, the text colours, the border and the body font.
 */
export const viewStyleVariables = (theme: Theme): Partial<McpUiStyles> => ({
  "--color-background-primary": theme.colors.message.assistant,
  "--color-text-primary": theme.colors.foreground.primary,
  "--color-text-secondary": theme.colors.foreground.secondary,
  "--color-text-tertiary": theme.colors.foreground.muted,
  "--color-border-primary": theme.colors.border.default,
  ...(theme.typography
    ? {
        "--font-sans": `${theme.typography.fontFamily.body}, ${SANS_SERIF_FALLBACK}`,
      }
    : {}),
});

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
