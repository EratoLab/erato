import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

import { LocaleDetectionTest } from "@/components/ui/Settings/LocaleDetectionTest";

import type { Meta, StoryObj } from "@storybook/react";

// Initialize i18n for Storybook
try {
  // Try to load English messages for Storybook
  import("@/locales/en/messages")
    .then(({ messages }) => {
      i18n.load("en", messages);
      i18n.activate("en");
    })
    .catch(() => {
      // If locales don't exist yet, activate with empty messages
      i18n.load("en", {});
      i18n.activate("en");
    });
} catch {
  // Fallback for any import errors
  i18n.load("en", {});
  i18n.activate("en");
}

const meta: Meta<typeof LocaleDetectionTest> = {
  title: "Dev Tools/Locale Detection Test",
  component: LocaleDetectionTest,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
## Locale Detection Test Component

This is a development tool to test the Lingui locale detection functionality.

### What it tests:
- Browser locale detection from navigator.language
- Session-only locale switching (no persistence)
- Fallback to default locale when needed
- Real-time locale switching
- Validation of locale codes against supported locales

### How to use:
1. Open browser dev tools to see the console
2. Try changing your browser language settings
3. Refresh the page to see detection results
4. Click locale buttons to test switching (session only)
5. Use "Reset to Browser Detection" to test fresh detection
6. Verify that UI text updates immediately when locale changes

**Note:** This component is for development/testing only and should not be included in production builds.

**Important:** Locale changes are NOT persisted and will reset to browser detection on page refresh.
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <I18nProvider i18n={i18n}>
        <div className="max-w-2xl">
          <Story />
        </div>
      </I18nProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LocaleDetectionTest>;

export const Default: Story = {
  name: "Locale Detection Test",
  args: {},
  parameters: {
    docs: {
      description: {
        story:
          "Interactive test component showing current locale detection state and allowing manual testing of session-only locale switching.",
      },
    },
  },
};

export const WithInstructions: Story = {
  name: "With Testing Instructions",
  args: {},
  render: () => (
    <div className="space-y-6">
      <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
        <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">
          Testing Instructions
        </h3>
        <ol className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li>1. Check your current browser language in settings</li>
          <li>
            2. Look at &quot;Browser Language&quot; and &quot;Detected
            Locale&quot; below
          </li>
          <li>3. Click locale buttons to test switching (session only)</li>
          <li>
            4. Use &quot;Reset to Browser Detection&quot; to test fresh
            detection
          </li>
          <li>5. Change browser language and refresh to test detection</li>
          <li>6. Verify UI updates immediately when locale changes</li>
          <li>
            <strong>
              7. Note: Locale changes are NOT saved and reset on refresh
            </strong>
          </li>
        </ol>
      </div>
      <LocaleDetectionTest />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Complete testing setup with instructions for manually verifying session-only locale detection functionality.",
      },
    },
  },
};
