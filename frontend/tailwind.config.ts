import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'theme': {
          'bg': {
            'primary': 'var(--theme-bg-primary)',
            'secondary': 'var(--theme-bg-secondary)',
            'accent': 'var(--theme-bg-accent)',
          },
          'fg': {
            'primary': 'var(--theme-fg-primary)',
            'secondary': 'var(--theme-fg-secondary)',
            'muted': 'var(--theme-fg-muted)',
          },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
