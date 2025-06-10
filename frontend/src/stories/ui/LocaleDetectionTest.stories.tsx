import { LocaleDetectionTest } from "@/components/ui/Settings/LocaleDetectionTest";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof LocaleDetectionTest> = {
  title: "Dev Tools/Locale Detection Test",
  component: LocaleDetectionTest,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
## Locale Detection Test Component

This is a development tool to test the Lingui locale detection functionality in Storybook.

### What it tests:
- Browser locale detection from navigator.language (mocked in Storybook)
- Session-only locale switching (no persistence)
- Fallback to default locale when needed
- Real-time locale switching
- Validation of locale codes against supported locales

### How to use in Storybook:
1. Use the **Locale** toolbar control (🌐) at the top to switch languages
2. The component will automatically update to show the current detected locale
3. Click locale buttons to test manual switching
4. Use "Reset to Browser Detection" to revert to the Storybook-selected locale
5. Check that UI text updates immediately when locale changes

**Storybook Features:**
- **Global Locale Control**: Use the 🌐 icon in Storybook toolbar
- **Mocked navigator.language**: Automatically set based on selected locale
- **Proper I18n Context**: Fully integrated with Lingui

**Note:** This component is for development/testing only and should not be included in production builds.
        `,
      },
    },
  },
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
          "Interactive test component showing current locale detection state. Use the Locale toolbar control (🌐) to switch languages and test the detection.",
      },
    },
  },
};

export const EnglishLocale: Story = {
  name: "English Locale",
  args: {},
  parameters: {
    locale: "en",
    docs: {
      description: {
        story:
          "Test component with English locale explicitly set. The navigator.language is mocked to 'en'.",
      },
    },
  },
};

export const GermanLocale: Story = {
  name: "German Locale",
  args: {},
  parameters: {
    locale: "de",
    docs: {
      description: {
        story:
          "Test component with German locale explicitly set. The navigator.language is mocked to 'de'.",
      },
    },
  },
};

export const FrenchLocale: Story = {
  name: "French Locale",
  args: {},
  parameters: {
    locale: "fr",
    docs: {
      description: {
        story:
          "Test component with French locale explicitly set. The navigator.language is mocked to 'fr'.",
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
          Storybook Testing Instructions
        </h3>
        <ol className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li>
            1. <strong>Use Locale Toolbar</strong>: Click the 🌐 icon at the top
            to switch languages
          </li>
          <li>
            2. <strong>Check Detection</strong>: Watch how &quot;Browser
            Language&quot; and &quot;Detected Locale&quot; update
          </li>
          <li>
            3. <strong>Test Manual Switch</strong>: Click locale buttons to test
            manual switching
          </li>
          <li>
            4. <strong>Reset Function</strong>: Use &quot;Reset to Browser
            Detection&quot; to revert to toolbar selection
          </li>
          <li>
            5. <strong>UI Updates</strong>: Verify that all text updates
            immediately when locale changes
          </li>
          <li>
            6. <strong>Mocked Environment</strong>: navigator.language is
            automatically mocked in Storybook
          </li>
        </ol>
        <div className="mt-3 rounded bg-blue-100 p-2 text-xs dark:bg-blue-800">
          <strong>💡 Pro tip:</strong> This setup properly mocks browser APIs
          and provides the same experience as real browser locale detection!
        </div>
      </div>
      <LocaleDetectionTest />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Complete testing setup with instructions for using Storybook's locale controls to test locale detection functionality.",
      },
    },
  },
};
