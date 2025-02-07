export type ThemeColors = {
  background: {
    primary: string;
    secondary: string;
    accent: string;
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
      primary: '#ffffff',
      secondary: '#f9fafb',
      accent: '#f3f4f6',
    },
    foreground: {
      primary: '#111827',
      secondary: '#374151',
      muted: '#6b7280',
    },
    avatar: {
      user: {
        background: '#d1d5db',
        foreground: '#111827',
      },
      assistant: {
        background: '#0d9488',
        foreground: '#ffffff',
      },
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
      primary: '#1e293b',
      secondary: '#334155',
      accent: '#475569',
    },
    foreground: {
      primary: '#f8fafc',
      secondary: '#e2e8f0',
      muted: '#94a3b8',
    },
    avatar: {
      user: {
        background: '#0ea5e9',
        foreground: '#ffffff',
      },
      assistant: {
        background: '#0284c7',
        foreground: '#ffffff',
      },
    },
  },
}; 