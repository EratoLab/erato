// Color palette definition with semantic naming
const colors = {
  neutral: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  primary: {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    300: '#5eead4',
    400: '#2dd4bf',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
    800: '#115e59',
    900: '#134e4a',
  },
  blue: {
    400: '#0ea5e9',
    500: '#0284c7',
  },
  red: {
    50: '#fef2f2',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    900: '#1e293b',
  },
} as const;

export type ThemeColors = {
  background: {
    primary: string;
    secondary: string;
    accent: string;
    selected: string;
    hover: string;
  };
  foreground: {
    primary: string;
    secondary: string;
    muted: string;
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
  border: string;
  danger: {
    text: string;
    hover: string;
    bg: string;
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
};

export const defaultTheme: Theme = {
  colors: {
    background: {
      primary: colors.neutral[50],    // Using semantic color tokens
      secondary: colors.neutral[100],
      accent: colors.neutral[200],
      selected: colors.neutral[200],
      hover: colors.neutral[100],
    },
    foreground: {
      primary: colors.neutral[900],
      secondary: colors.neutral[700],
      muted: colors.neutral[600],
    },
    avatar: {
      user: {
        background: colors.neutral[600],
        foreground: colors.neutral[50],
      },
      assistant: {
        background: colors.primary[700],
        foreground: colors.neutral[50],
      },
    },
    border: colors.neutral[200],
    danger: {
      text: colors.red[500],
      hover: colors.red[600],
      bg: colors.red[50],
    },
  },
  borderRadius: '0.375rem',
  spacing: {
    message: {
      padding: '1.5rem 1rem',
      gap: '1.5rem',
    },
  },
};

export const darkTheme: Theme = {
  ...defaultTheme,
  colors: {
    background: {
      primary: colors.neutral[800],
      secondary: colors.neutral[700],
      accent: colors.neutral[600],
      selected: colors.neutral[700],
      hover: '#323842', // Could be standardized to a neutral token
    },
    foreground: {
      primary: colors.neutral[50],
      secondary: colors.neutral[200],
      muted: colors.neutral[400],
    },
    avatar: {
      user: {
        background: colors.blue[400],
        foreground: colors.neutral[50],
      },
      assistant: {
        background: colors.blue[500],
        foreground: colors.neutral[50],
      },
    },
    border: colors.neutral[700],
    danger: {
      text: colors.red[400],
      hover: colors.red[300],
      bg: colors.red[900],
    },
  },
};
