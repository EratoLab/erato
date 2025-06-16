import { useState } from "react";

import { Button } from "../../../components/ui/Controls/Button";
import {
  CopyIcon,
  EditIcon,
  ThumbUpIcon,
  ThumbDownIcon,
  RerunIcon,
  MoreVertical,
  InfoIcon,
  Trash,
  SidebarToggleIcon,
  LogOutIcon,
  SunIcon,
  MoonIcon,
  ComputerIcon,
  PlusIcon,
  CheckIcon,
  LoadingIcon,
  CloseIcon,
  ErrorIcon,
  WarningIcon,
  ArrowUpIcon,
  WarningCircleIcon,
  CheckCircleIcon,
  CodeIcon,
} from "../../../components/ui/icons";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Icons",
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#1a1a1a" },
        { name: "gray", value: "#f5f5f5" },
      ],
    },
    docs: {
      description: {
        component: `
# Icon System

Our comprehensive icon system built on Iconoir, providing 1,600+ consistent, beautiful icons.

## Features
- **Consistent Design**: 24x24 viewBox (Iconoir design system)
- **Theme Aware**: Inherits current text color via \`currentColor\`
- **Flexible Sizing**: Configurable via className and props
- **Tree Shakeable**: Performance optimized imports
- **Accessibility**: Proper ARIA attributes and semantic usage
- **TypeScript**: Full type safety with IconProps interface

## Usage

\`\`\`tsx
import { CopyIcon, PlusIcon } from "@/components/ui/icons";

// Basic usage
<CopyIcon className="size-6" />

// With custom props
<PlusIcon width={24} height={24} strokeWidth={2} color="#0066cc" />

// In buttons
<Button icon={<CopyIcon />}>Copy Text</Button>
\`\`\`

## Best Practices

1. **Use semantic sizes**: Prefer \`size-4\`, \`size-6\`, \`size-8\` over arbitrary values
2. **Maintain contrast**: Ensure 4.5:1 contrast ratio for accessibility
3. **Icon buttons**: Always provide \`aria-label\` for icon-only buttons
4. **Loading states**: Use \`LoadingIcon\` with appropriate animations
5. **Consistent spacing**: Use standard padding/margin classes

## Technical Notes
- Icons inherit color from parent text color
- Default stroke-width is 1.5 (Iconoir standard)
- Optimized for 16px, 20px, 24px, 32px display sizes
- SVG-based for crisp rendering at all scales
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary text-theme-fg-primary">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    width: {
      control: "select",
      options: [12, 16, 20, 24, 32, 48],
      description: "Icon width in pixels",
    },
    height: {
      control: "select",
      options: [12, 16, 20, 24, 32, 48],
      description: "Icon height in pixels",
    },
    color: {
      control: "color",
      description: "Icon color (overrides currentColor)",
    },
    strokeWidth: {
      control: { type: "range", min: 1, max: 3, step: 0.1 },
      description: "Stroke width for line-based icons",
    },
  },
} satisfies Meta<typeof CopyIcon>;

export default meta;
type Story = StoryObj<typeof CopyIcon>;

// All available icons for comprehensive testing
const ALL_ICONS = {
  // Primary Actions
  CopyIcon,
  EditIcon,
  PlusIcon,
  CheckIcon,
  CloseIcon,
  ArrowUpIcon,

  // Feedback & Status
  ThumbUpIcon,
  ThumbDownIcon,
  InfoIcon,
  WarningIcon,
  ErrorIcon,
  WarningCircleIcon,
  CheckCircleIcon,
  LoadingIcon,

  // Navigation & UI
  MoreVertical,
  SidebarToggleIcon,
  LogOutIcon,
  Trash,
  RerunIcon,

  // Theme & Settings
  SunIcon,
  MoonIcon,
  ComputerIcon,
  CodeIcon,
} as const;

const IconGrid = ({
  iconSize = 24,
  showNames = true,
  color,
  strokeWidth,
  spacing = "gap-4",
}: {
  iconSize?: number;
  showNames?: boolean;
  color?: string;
  strokeWidth?: number;
  spacing?: string;
}) => (
  <div
    className={`grid grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 ${spacing} p-6`}
  >
    {Object.entries(ALL_ICONS).map(([name, IconComponent]) => (
      <div
        key={name}
        className="flex flex-col items-center justify-center rounded-lg bg-theme-bg-secondary p-3 transition-colors duration-200 hover:bg-theme-bg-hover"
        title={name}
      >
        <IconComponent
          width={iconSize}
          height={iconSize}
          color={color}
          strokeWidth={strokeWidth}
          className="mb-2"
        />
        {showNames && (
          <span className="text-center text-xs leading-tight text-theme-fg-muted">
            {name.replace("Icon", "")}
          </span>
        )}
      </div>
    ))}
  </div>
);

// Story: Complete Icon Overview
export const AllIcons: Story = {
  render: (args) => (
    <div className="min-h-screen">
      <div className="border-b border-theme-border p-6">
        <h2 className="mb-2 text-2xl font-bold text-theme-fg-primary">
          Icon System Overview
        </h2>
        <p className="text-theme-fg-secondary">
          {Object.keys(ALL_ICONS).length} icons available • Click any icon to
          see details
        </p>
      </div>
      <IconGrid
        iconSize={typeof args.width === "number" ? args.width : 24}
        color={args.color}
        strokeWidth={
          typeof args.strokeWidth === "number" ? args.strokeWidth : undefined
        }
      />
    </div>
  ),
  args: {
    width: 24,
    height: 24,
  },
};

// Story: Size Variations
export const SizeVariations: Story = {
  render: () => (
    <div className="space-y-8 p-6">
      <div>
        <h3 className="mb-4 text-lg font-medium">Icon Sizes</h3>
        <div className="flex items-end gap-8">
          {[12, 16, 20, 24, 32, 48].map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <CopyIcon width={size} height={size} />
              <span className="text-sm text-theme-fg-muted">{size}px</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium">Tailwind Size Classes</h3>
        <div className="flex items-end gap-8">
          {[
            { class: "size-3", size: "12px" },
            { class: "size-4", size: "16px" },
            { class: "size-5", size: "20px" },
            { class: "size-6", size: "24px" },
            { class: "size-8", size: "32px" },
            { class: "size-12", size: "48px" },
          ].map(({ class: className, size }) => (
            <div key={className} className="flex flex-col items-center gap-2">
              <CopyIcon className={className} />
              <span className="text-sm text-theme-fg-muted">{className}</span>
              <span className="text-xs text-theme-fg-muted">{size}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};

// Theme component to avoid hook issues in render function
const ThemeAwarenessComponent = () => {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        theme === "dark" ? "bg-gray-900 text-white" : "bg-white text-gray-900"
      }`}
    >
      <div className="p-6">
        <div className="mb-8 flex items-center justify-between">
          <h3 className="text-xl font-medium">Theme Awareness Test</h3>
          <Button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            icon={theme === "light" ? <MoonIcon /> : <SunIcon />}
          >
            Switch to {theme === "light" ? "Dark" : "Light"} Mode
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="space-y-4">
            <h4 className="font-medium">Default (currentColor)</h4>
            <div className="flex gap-2">
              <CopyIcon className="size-6" />
              <EditIcon className="size-6" />
              <PlusIcon className="size-6" />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">Semantic Colors</h4>
            <div className="flex gap-2">
              <CheckIcon className="size-6 text-green-600" />
              <WarningIcon className="size-6 text-yellow-600" />
              <ErrorIcon className="size-6 text-red-600" />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">Interactive States</h4>
            <div className="flex gap-2">
              <CopyIcon className="size-6 cursor-pointer transition-colors hover:text-blue-600" />
              <EditIcon className="size-6 cursor-pointer transition-colors hover:text-green-600" />
              <Trash className="size-6 cursor-pointer transition-colors hover:text-red-600" />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">Muted/Secondary</h4>
            <div className="flex gap-2 opacity-60">
              <MoreVertical className="size-6" />
              <InfoIcon className="size-6" />
              <CodeIcon className="size-6" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Story: Theme Awareness
export const ThemeAwareness: Story = {
  render: () => <ThemeAwarenessComponent />,
};

// Story: Button Integration
export const ButtonIntegration: Story = {
  render: () => (
    <div className="space-y-8 p-6">
      <div>
        <h3 className="mb-4 text-lg font-medium">Icon Buttons - Variants</h3>
        <div className="flex flex-wrap gap-4">
          <Button variant="primary" icon={<PlusIcon />}>
            Primary
          </Button>
          <Button variant="secondary" icon={<EditIcon />}>
            Secondary
          </Button>
          <Button variant="ghost" icon={<CopyIcon />}>
            Ghost
          </Button>
          <Button variant="danger" icon={<Trash />}>
            Danger
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium">Icon-Only Buttons</h3>
        <div className="flex flex-wrap gap-4">
          <Button variant="icon-only" icon={<CopyIcon />} aria-label="Copy" />
          <Button variant="icon-only" icon={<EditIcon />} aria-label="Edit" />
          <Button variant="icon-only" icon={<Trash />} aria-label="Delete" />
          <Button
            variant="icon-only"
            icon={<MoreVertical />}
            aria-label="More options"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium">Button Sizes with Icons</h3>
        <div className="flex items-end gap-4">
          <Button size="sm" icon={<PlusIcon />}>
            Small
          </Button>
          <Button size="md" icon={<PlusIcon />}>
            Medium
          </Button>
          <Button size="lg" icon={<PlusIcon />}>
            Large
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium">Interactive States</h3>
        <div className="space-y-4">
          <div className="flex gap-4">
            <Button icon={<ThumbUpIcon />}>Normal</Button>
            <Button icon={<ThumbUpIcon />} disabled>
              Disabled
            </Button>
            <Button icon={<ThumbUpIcon />} aria-pressed={true}>
              Pressed
            </Button>
          </div>
          <div className="flex gap-4">
            <Button
              variant="icon-only"
              icon={<LoadingIcon className="animate-spin" />}
              aria-label="Loading"
            />
            <Button
              variant="icon-only"
              icon={<CheckIcon />}
              aria-label="Success"
              className="text-green-600"
            />
            <Button
              variant="icon-only"
              icon={<ErrorIcon />}
              aria-label="Error"
              className="text-red-600"
            />
          </div>
        </div>
      </div>
    </div>
  ),
};

// Story: Spacing and Layout
export const SpacingAndLayout: Story = {
  render: () => (
    <div className="space-y-8 p-6">
      <div>
        <h3 className="mb-4 text-lg font-medium">Icon Spacing in Containers</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Compact (gap-2)</h4>
            <div className="flex items-center gap-2">
              <CopyIcon className="size-4" />
              <EditIcon className="size-4" />
              <Trash className="size-4" />
            </div>
          </div>

          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Standard (gap-4)</h4>
            <div className="flex items-center gap-4">
              <CopyIcon className="size-5" />
              <EditIcon className="size-5" />
              <Trash className="size-5" />
            </div>
          </div>

          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Spacious (gap-6)</h4>
            <div className="flex items-center gap-6">
              <CopyIcon className="size-6" />
              <EditIcon className="size-6" />
              <Trash className="size-6" />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium">Icon Alignment</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded bg-theme-bg-secondary p-3">
            <CopyIcon className="size-5" />
            <span>Leading icon with text</span>
          </div>
          <div className="flex items-center justify-between rounded bg-theme-bg-secondary p-3">
            <span>Text with trailing icon</span>
            <ArrowUpIcon className="size-5" />
          </div>
          <div className="flex items-center gap-3 rounded bg-theme-bg-secondary p-3">
            <CheckIcon className="size-5 text-green-600" />
            <span>Success message with status icon</span>
            <MoreVertical className="ml-auto size-5" />
          </div>
        </div>
      </div>
    </div>
  ),
};

// Story: Accessibility Testing
export const AccessibilityTesting: Story = {
  render: () => (
    <div className="space-y-8 p-6">
      <div>
        <h3 className="mb-4 text-lg font-medium">
          Accessibility Best Practices
        </h3>

        <div className="space-y-6">
          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Decorative Icons (aria-hidden)</h4>
            <div className="flex items-center gap-3">
              <CopyIcon className="size-5" aria-hidden="true" />
              <span>Copy this text</span>
            </div>
            <p className="mt-2 text-sm text-theme-fg-muted">
              Icons that don&apos;t add meaning should be hidden from screen
              readers
            </p>
          </div>

          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Semantic Icons (with labels)</h4>
            <div className="flex gap-4">
              <Button
                variant="icon-only"
                icon={<CopyIcon />}
                aria-label="Copy to clipboard"
              />
              <Button
                variant="icon-only"
                icon={<EditIcon />}
                aria-label="Edit item"
              />
              <Button
                variant="icon-only"
                icon={<Trash />}
                aria-label="Delete item"
              />
            </div>
            <p className="mt-2 text-sm text-theme-fg-muted">
              Icon-only buttons must have descriptive aria-labels
            </p>
          </div>

          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Status Icons (with roles)</h4>
            <div className="space-y-2">
              <div
                className="flex items-center gap-2"
                role="status"
                aria-live="polite"
              >
                <LoadingIcon className="size-4 animate-spin" />
                <span>Loading...</span>
              </div>
              <div className="flex items-center gap-2" role="alert">
                <ErrorIcon className="size-4 text-red-600" />
                <span>Error occurred</span>
              </div>
              <div className="flex items-center gap-2" role="status">
                <CheckIcon className="size-4 text-green-600" />
                <span>Success!</span>
              </div>
            </div>
            <p className="mt-2 text-sm text-theme-fg-muted">
              Status icons should use appropriate ARIA roles and live regions
            </p>
          </div>
        </div>
      </div>
    </div>
  ),
};

// Story: Performance Testing
export const PerformanceTesting: Story = {
  render: () => (
    <div className="space-y-8 p-6">
      <div>
        <h3 className="mb-4 text-lg font-medium">
          Performance Characteristics
        </h3>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Large Icon Grid (100 icons)</h4>
            <div className="grid h-32 grid-cols-10 gap-1 overflow-hidden">
              {Array.from({ length: 100 }).map((_, i) => {
                const IconComponent =
                  Object.values(ALL_ICONS)[i % Object.values(ALL_ICONS).length];
                return <IconComponent key={i} className="size-6" />;
              })}
            </div>
            <p className="mt-2 text-sm text-theme-fg-muted">
              Tests rendering performance with many icons
            </p>
          </div>

          <div className="rounded-lg border border-theme-border p-4">
            <h4 className="mb-3 font-medium">Animation Performance</h4>
            <div className="flex gap-4">
              <LoadingIcon className="size-8 animate-spin" />
              <LoadingIcon className="size-6 animate-spin" />
              <LoadingIcon className="size-4 animate-spin" />
            </div>
            <p className="mt-2 text-sm text-theme-fg-muted">
              Smooth animations at different sizes
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h4 className="mb-2 font-medium text-blue-900">Bundle Size Impact</h4>
          <ul className="space-y-1 text-sm text-blue-800">
            <li>
              • Icons are tree-shakeable - only imported icons are bundled
            </li>
            <li>• Iconoir icons are lightweight SVG components</li>
            <li>• No icon fonts or large sprite sheets required</li>
            <li>• Optimal for modern bundlers (Vite, Webpack 5+)</li>
          </ul>
        </div>
      </div>
    </div>
  ),
};

// Individual Icon Stories (for detailed testing)
export const Individual: Story = {
  render: (args) => (
    <div className="p-6">
      <h3 className="mb-4 text-lg font-medium">Individual Icon Testing</h3>
      <div className="flex items-center gap-4">
        <CopyIcon {...args} />
        <span>Use the controls below to test icon properties</span>
      </div>
    </div>
  ),
  args: {
    width: 24,
    height: 24,
    strokeWidth: 1.5,
  },
};
