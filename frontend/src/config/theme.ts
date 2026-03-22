import {
  DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  type PrismCodeThemePreset,
} from "./codeHighlightThemes";

const colors = {
  neutral: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },
  green: {
    50: "#ecfdf5",
    300: "#6ee7b7",
    500: "#10b981",
    700: "#047857",
    800: "#065f46",
    900: "#064e3b",
  },
  red: {
    50: "#fef2f2",
    300: "#fca5a5",
    500: "#ef4444",
    700: "#b91c1c",
    800: "#991b1b",
    900: "#7f1d1d",
  },
  amber: {
    50: "#fffbeb",
    300: "#fcd34d",
    500: "#f59e0b",
    700: "#b45309",
    800: "#92400e",
    900: "#78350f",
  },
  blue: {
    50: "#eff6ff",
    300: "#93c5fd",
    500: "#3b82f6",
    700: "#1d4ed8",
    800: "#1e40af",
  },
} as const;

const stateColors = {
  focus: {
    light: colors.neutral[500],
    dark: colors.neutral[400],
  },
  focusError: {
    light: "rgba(239, 68, 68, 0.2)",
    dark: "rgba(239, 68, 68, 0.2)",
  },
  selection: {
    light: colors.neutral[200],
    dark: colors.neutral[700],
  },
  hover: {
    light: colors.neutral[200],
    dark: colors.neutral[600],
  },
};

export type ThemeColors = {
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    sidebar: string;
    accent: string;
    hover: string;
    selected: string;
  };
  foreground: {
    primary: string;
    secondary: string;
    muted: string;
    accent: string;
  };
  action: {
    primary: {
      background: string;
      foreground: string;
      hover: string;
    };
  };
  border: {
    default: string;
    primary: string;
    subtle: string;
    strong: string;
    divider: string;
    focus: string;
  };
  shell: {
    app: string;
    page: string;
    sidebar: string;
    sidebarHover: string;
    sidebarSelected: string;
    chatHeader: string;
    chatBody: string;
    chatInput: string;
    modal: string;
    dropdown: string;
  };
  message: {
    user: string;
    assistant: string;
    hover: string;
    controls: string;
  };
  code: {
    inline: {
      background: string;
      foreground: string;
      border: string;
    };
    block: {
      background: string;
      foreground: string;
      border: string;
    };
    syntax: {
      comment: string;
      keyword: string;
      string: string;
      function: string;
      number: string;
    };
  };
  overlay: {
    modal: string;
  };
  avatar: {
    user: {
      background: string;
      foreground: string;
    };
    assistant: {
      background: string;
      foreground: string;
    };
  };
  status: {
    info: {
      foreground: string;
      background: string;
      border: string;
    };
    success: {
      foreground: string;
      background: string;
      border: string;
    };
    warning: {
      foreground: string;
      background: string;
      border: string;
    };
    error: {
      foreground: string;
      background: string;
      border: string;
    };
  };
  focus: {
    ring: string;
    errorRing: string;
  };
};

export type ThemeRadius = {
  base: string;
  shell: string;
  input: string;
  control: string;
  message: string;
  modal: string;
  pill: string;
};

export type ThemeSpacing = {
  shell: {
    paddingX: string;
    paddingY: string;
    gap: string;
    compactPaddingX: string;
    compactPaddingY: string;
  };
  message: {
    paddingX: string;
    paddingY: string;
    gap: string;
  };
  control: {
    gap: string;
    paddingX: string;
    paddingY: string;
    minHeight: string;
  };
  sidebar: {
    rowHeight: string;
  };
  input: {
    compactPaddingX: string;
    compactPaddingY: string;
    paddingX: string;
    paddingY: string;
    gap: string;
    minHeight: string;
  };
  dropdown: {
    paddingX: string;
    paddingY: string;
  };
  modal: {
    padding: string;
  };
};

export type ThemeElevation = {
  shell: string;
  input: string;
  modal: string;
  dropdown: string;
};

export type ThemeLayout = {
  chat: {
    contentMaxWidth: string;
    inputMaxWidth: string;
  };
  sidebar: {
    width: string;
    slimWidth: string;
  };
};

export type ThemeTypographyScale = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";

export type ThemeTypography = {
  fontFamily: {
    body: string;
    heading: string;
    semibold: string;
    headingBold: string;
    mono: string;
  };
  fontSize: Record<ThemeTypographyScale, string>;
  lineHeight: Record<ThemeTypographyScale, string>;
  letterSpacing: Record<ThemeTypographyScale, string>;
  fontWeight: {
    normal: string;
    medium: string;
    semibold: string;
    bold: string;
  };
};

export type ThemeCodeHighlightBlockStyle = {
  backgroundColor: string;
  color: string;
  border: string;
  borderRadius: string;
  padding: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
};

export type ThemeCodeHighlight = {
  preset: PrismCodeThemePreset;
  blockStyle?: Partial<ThemeCodeHighlightBlockStyle>;
};

export type Theme = {
  colors: ThemeColors;
  borderRadius: string;
  radius: ThemeRadius;
  spacing: ThemeSpacing;
  elevation: ThemeElevation;
  layout: ThemeLayout;
  codeHighlight: ThemeCodeHighlight;
  typography?: ThemeTypography;
};

export type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends readonly (infer U)[]
    ? U[]
    : NonNullable<T[K]> extends Record<string, unknown>
      ? DeepPartial<NonNullable<T[K]>>
      : T[K];
};

export type ThemeOverride = DeepPartial<Theme> & {
  colors?: DeepPartial<ThemeColors> & {
    messageItem?: {
      hover?: string;
    };
  };
};

const baseRadius = "0.375rem";

const defaultTypography: ThemeTypography = {
  fontFamily: {
    body: "Geist Variable",
    heading: "Geist Variable",
    semibold: "Geist Variable",
    headingBold: "Geist Variable",
    mono: "Geist Mono Variable",
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
  },
  lineHeight: {
    xs: "1rem",
    sm: "1.25rem",
    base: "1.5rem",
    lg: "1.75rem",
    xl: "1.75rem",
    "2xl": "2rem",
  },
  letterSpacing: {
    xs: "0em",
    sm: "0em",
    base: "0em",
    lg: "0em",
    xl: "0em",
    "2xl": "0em",
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
};

export const defaultTheme: Theme = {
  colors: {
    background: {
      primary: colors.neutral[50],
      secondary: colors.neutral[100],
      tertiary: "#ffffff",
      sidebar: colors.neutral[200],
      accent: colors.neutral[200],
      hover: stateColors.hover.light,
      selected: stateColors.selection.light,
    },
    foreground: {
      primary: colors.neutral[900],
      secondary: colors.neutral[700],
      muted: colors.neutral[500],
      accent: colors.neutral[800],
    },
    action: {
      primary: {
        background: colors.neutral[800],
        foreground: colors.neutral[50],
        hover: colors.neutral[700],
      },
    },
    border: {
      default: colors.neutral[300],
      primary: colors.neutral[300],
      subtle: colors.neutral[200],
      strong: colors.neutral[400],
      divider: colors.neutral[300],
      focus: stateColors.focus.light,
    },
    shell: {
      app: colors.neutral[50],
      page: colors.neutral[100],
      sidebar: colors.neutral[200],
      sidebarHover: stateColors.hover.light,
      sidebarSelected: stateColors.selection.light,
      chatHeader: colors.neutral[100],
      chatBody: colors.neutral[100],
      chatInput: "#ffffff",
      modal: colors.neutral[50],
      dropdown: colors.neutral[50],
    },
    message: {
      user: colors.neutral[50],
      assistant: colors.neutral[100],
      hover: stateColors.hover.light,
      controls: colors.neutral[100],
    },
    code: {
      inline: {
        background: colors.neutral[100],
        foreground: colors.neutral[800],
        border: colors.neutral[200],
      },
      block: {
        background: "#ffffff",
        foreground: colors.neutral[800],
        border: colors.neutral[200],
      },
      syntax: {
        comment: colors.neutral[500],
        keyword: colors.blue[700],
        string: colors.green[700],
        function: colors.amber[800],
        number: colors.red[700],
      },
    },
    overlay: {
      modal: "rgba(17, 24, 39, 0.6)",
    },
    avatar: {
      user: {
        background: colors.neutral[700],
        foreground: colors.neutral[50],
      },
      assistant: {
        background: colors.neutral[500],
        foreground: colors.neutral[50],
      },
    },
    status: {
      info: {
        foreground: colors.neutral[800],
        background: colors.neutral[100],
        border: colors.neutral[300],
      },
      success: {
        foreground: colors.green[800],
        background: colors.green[50],
        border: colors.green[300],
      },
      warning: {
        foreground: colors.amber[800],
        background: colors.amber[50],
        border: colors.amber[300],
      },
      error: {
        foreground: colors.red[800],
        background: colors.red[50],
        border: colors.red[300],
      },
    },
    focus: {
      ring: stateColors.focus.light,
      errorRing: stateColors.focusError.light,
    },
  },
  borderRadius: baseRadius,
  radius: {
    base: baseRadius,
    shell: "0.75rem",
    input: "1rem",
    control: "0.5rem",
    message: "0.5rem",
    modal: "0.5rem",
    pill: "9999px",
  },
  spacing: {
    shell: {
      paddingX: "1rem",
      paddingY: "1rem",
      gap: "1rem",
      compactPaddingX: "0.5rem",
      compactPaddingY: "0.5rem",
    },
    message: {
      paddingX: "1rem",
      paddingY: "1rem",
      gap: "1.5rem",
    },
    control: {
      gap: "0.5rem",
      paddingX: "0.75rem",
      paddingY: "0.5rem",
      minHeight: "2.5rem",
    },
    sidebar: {
      rowHeight: "2.75rem",
    },
    input: {
      compactPaddingX: "0.5rem",
      compactPaddingY: "0.5rem",
      paddingX: "0.75rem",
      paddingY: "0.75rem",
      gap: "0.5rem",
      minHeight: "2rem",
    },
    dropdown: {
      paddingX: "1rem",
      paddingY: "0.5rem",
    },
    modal: {
      padding: "1rem",
    },
  },
  elevation: {
    shell: "none",
    input: "0 0 15px rgba(0, 0, 0, 0.1)",
    modal:
      "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
    dropdown:
      "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  },
  layout: {
    chat: {
      contentMaxWidth: "48rem",
      inputMaxWidth: "56rem",
    },
    sidebar: {
      width: "17.5rem",
      slimWidth: "4rem",
    },
  },
  codeHighlight: {
    preset: DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  },
  typography: defaultTypography,
};

export const darkTheme: Theme = {
  ...defaultTheme,
  colors: {
    background: {
      primary: colors.neutral[900],
      secondary: colors.neutral[800],
      tertiary: colors.neutral[700],
      sidebar: colors.neutral[900],
      accent: colors.neutral[700],
      hover: stateColors.hover.dark,
      selected: colors.neutral[700],
    },
    foreground: {
      primary: colors.neutral[50],
      secondary: colors.neutral[200],
      muted: colors.neutral[400],
      accent: colors.neutral[200],
    },
    action: {
      primary: {
        background: colors.neutral[800],
        foreground: colors.neutral[50],
        hover: colors.neutral[700],
      },
    },
    border: {
      default: colors.neutral[600],
      primary: colors.neutral[600],
      subtle: colors.neutral[700],
      strong: colors.neutral[500],
      divider: colors.neutral[600],
      focus: colors.neutral[400],
    },
    shell: {
      app: colors.neutral[900],
      page: colors.neutral[800],
      sidebar: colors.neutral[900],
      sidebarHover: stateColors.hover.dark,
      sidebarSelected: colors.neutral[700],
      chatHeader: colors.neutral[800],
      chatBody: colors.neutral[800],
      chatInput: colors.neutral[700],
      modal: colors.neutral[900],
      dropdown: colors.neutral[900],
    },
    message: {
      user: colors.neutral[900],
      assistant: colors.neutral[800],
      hover: colors.neutral[700],
      controls: colors.neutral[800],
    },
    code: {
      inline: {
        background: colors.neutral[700],
        foreground: colors.neutral[100],
        border: colors.neutral[600],
      },
      block: {
        background: colors.neutral[700],
        foreground: colors.neutral[100],
        border: colors.neutral[600],
      },
      syntax: {
        comment: colors.neutral[400],
        keyword: colors.blue[300],
        string: colors.green[300],
        function: colors.amber[300],
        number: colors.red[300],
      },
    },
    overlay: {
      modal: "rgba(0, 0, 0, 0.7)",
    },
    avatar: {
      user: {
        background: colors.neutral[500],
        foreground: colors.neutral[50],
      },
      assistant: {
        background: colors.neutral[600],
        foreground: colors.neutral[50],
      },
    },
    status: {
      info: {
        foreground: colors.neutral[200],
        background: colors.neutral[800],
        border: colors.neutral[600],
      },
      success: {
        foreground: colors.green[300],
        background: colors.green[900],
        border: colors.green[700],
      },
      warning: {
        foreground: colors.amber[300],
        background: colors.amber[900],
        border: colors.amber[700],
      },
      error: {
        foreground: colors.red[300],
        background: colors.red[900],
        border: colors.red[700],
      },
    },
    focus: {
      ring: stateColors.focus.dark,
      errorRing: stateColors.focusError.dark,
    },
  },
  elevation: {
    shell: "none",
    input: "0 8px 24px rgba(0, 0, 0, 0.25)",
    modal: "0 24px 48px rgba(0, 0, 0, 0.45)",
    dropdown: "0 12px 24px rgba(0, 0, 0, 0.35)",
  },
  codeHighlight: {
    preset: DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  },
};
