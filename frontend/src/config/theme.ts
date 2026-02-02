// Color palette definition with semantic naming
const colors = {
  neutral: {
    50: "#f9fafb", // Lightest background
    100: "#f3f4f6", // Light background
    200: "#e5e7eb", // Light border
    300: "#d1d5db", // Medium-light border
    400: "#9ca3af", // Muted text
    500: "#6b7280", // Medium text
    600: "#4b5563", // Medium-dark text
    700: "#374151", // Dark text / Light mode hover
    800: "#1f2937", // Dark background
    900: "#111827", // Darkest background
  },
  blue: {
    50: "#eff6ff", // Lightest blue background
    100: "#dbeafe", // Light blue background
    200: "#bfdbfe", // Accent blue
    300: "#93c5fd", // Light blue text
    400: "#60a5fa", // Medium blue
    500: "#3b82f6", // Primary blue
    600: "#2563eb", // Darker blue / Hover
    700: "#1d4ed8", // Dark blue
    800: "#1e40af", // Darker blue for text
    900: "#1e3a8a", // Darkest blue
  },
  green: {
    50: "#ecfdf5", // Lightest green background
    100: "#d1fae5", // Light green background
    200: "#a7f3d0", // Accent green
    300: "#6ee7b7", // Light green text
    400: "#34d399", // Medium green
    500: "#10b981", // Primary blue
    600: "#059669", // Darker green / Hover
    700: "#047857", // Dark green
    800: "#065f46", // Darker green for text
    900: "#064e3b", // Darkest green
  },
  red: {
    50: "#fef2f2", // Lightest red background
    100: "#fee2e2", // Light red background
    200: "#fecaca", // Accent red
    300: "#fca5a5", // Light red text
    400: "#f87171", // Medium red
    500: "#ef4444", // Primary red
    600: "#dc2626", // Darker red / Hover
    700: "#b91c1c", // Dark red
    800: "#991b1b", // Darker red for text
    900: "#7f1d1d", // Darkest red
  },
  amber: {
    50: "#fffbeb",
    100: "#fef3c7",
    200: "#fde68a",
    300: "#fcd34d",
    400: "#fbbf24",
    500: "#f59e0b",
    600: "#d97706",
    700: "#b45309",
    800: "#92400e",
    900: "#78350f",
  },
  indigo: {
    50: "#eef2ff",
    100: "#e0e7ff",
    500: "#6366f1",
    600: "#4f46e5",
    700: "#4338ca",
  },
} as const;

// Add new state colors for focus, selection, hover
const stateColors = {
  focus: {
    light: colors.neutral[500], // Monochrome focus for light theme
    dark: colors.neutral[400], // Monochrome focus for dark theme
  },
  selection: {
    light: colors.neutral[200], // Monochrome selection for light theme
    dark: colors.neutral[700], // Monochrome selection for dark theme
  },
  hover: {
    light: colors.neutral[200], // Monochrome hover for light theme
    dark: colors.neutral[600], // Monochrome hover for dark theme
  },
};

export type ThemeColors = {
  background: {
    primary: string; // Main background
    secondary: string; // Card, sidebar backgrounds
    tertiary: string; // Input backgrounds, alternate rows
    sidebar: string; // Dedicated sidebar background
    accent: string; // Highlighted, selected or focus areas
    hover: string; // Hover state backgrounds
    selected: string; // Selected item background
  };
  foreground: {
    primary: string; // Main text color
    secondary: string; // Secondary text, labels
    muted: string; // Placeholder, disabled text
    accent: string; // Links, highlighted text
  };
  border: {
    default: string; // Default border
    strong: string; // Emphasized borders
    focus: string; // Focus state borders
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
    ring: string; // Focus ring color
  };
};

export type Theme = {
  colors: ThemeColors;
  borderRadius: string;
  spacing: {
    message: {
      padding: string;
      gap: string;
    };
  };
  typography?: {
    fontFamily?: {
      body?: string;
      heading?: string;
      semibold?: string;
      headingBold?: string;
    };
  };
};

export const defaultTheme: Theme = {
  colors: {
    background: {
      primary: colors.neutral[50], // Main background
      secondary: colors.neutral[100], // Cards, containers
      tertiary: "#ffffff", // Input fields, form elements
      sidebar: colors.neutral[200], // Darker sidebar background
      accent: colors.neutral[200], // Subtle accent color (monochrome)
      hover: stateColors.hover.light, // Using stateColors for hover
      selected: stateColors.selection.light, // Using stateColors for selected
    },
    foreground: {
      primary: colors.neutral[900], // Main text color - increased contrast
      secondary: colors.neutral[700], // Subheadings, labels
      muted: colors.neutral[500], // Placeholders, disabled
      accent: colors.neutral[800], // Links, buttons - monochrome accent
    },
    border: {
      default: colors.neutral[300], // Default border color - increased contrast
      strong: colors.neutral[400], // Strong borders - improved contrast
      focus: stateColors.focus.light, // Using stateColors for focus
    },
    avatar: {
      user: {
        background: colors.neutral[700], // User avatar with good contrast
        foreground: colors.neutral[50], // Text on user avatar
      },
      assistant: {
        background: colors.neutral[500], // Assistant avatar with good contrast
        foreground: colors.neutral[50], // Text on assistant avatar
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
      ring: stateColors.focus.light, // Using stateColors for focus ring
    },
  },
  borderRadius: "0.375rem",
  spacing: {
    message: {
      padding: "1.5rem 1rem",
      gap: "1.5rem",
    },
  },
};

export const darkTheme: Theme = {
  ...defaultTheme,
  colors: {
    background: {
      primary: colors.neutral[900], // Main background
      secondary: colors.neutral[800], // Cards, containers
      tertiary: colors.neutral[700], // Input fields, form elements
      sidebar: colors.neutral[900], // Sidebar background (less extreme than before)
      accent: colors.neutral[700], // Subtle accent - monochrome
      hover: stateColors.hover.dark, // Using stateColors for hover state
      selected: colors.neutral[700], // Selected items - monochrome
    },
    foreground: {
      primary: colors.neutral[50], // Main text color
      secondary: colors.neutral[200], // Subheadings, labels
      muted: colors.neutral[400], // Placeholders, disabled
      accent: colors.neutral[200], // Links, buttons - monochrome
    },
    border: {
      default: colors.neutral[600], // Default border
      strong: colors.neutral[500], // Strong borders
      focus: colors.neutral[400], // Focus state borders - monochrome
    },
    avatar: {
      user: {
        background: colors.neutral[500], // User avatar - monochrome
        foreground: colors.neutral[50], // Text on user avatar
      },
      assistant: {
        background: colors.neutral[600], // Assistant avatar - monochrome
        foreground: colors.neutral[50], // Text on assistant avatar
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
      ring: stateColors.focus.dark, // Using stateColors for focus ring
    },
  },
};
