import { useState } from "react";

import { Textarea } from "@/components/ui/Input/Textarea";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    rows: {
      control: { type: "number", min: 1, max: 20 },
    },
    monospace: {
      control: "boolean",
    },
    autoResize: {
      control: "boolean",
    },
    disabled: {
      control: "boolean",
    },
    error: {
      control: "text",
    },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default state
export const Default: Story = {
  args: {
    placeholder: "Enter text...",
    rows: 3,
  },
  render: (args) => (
    <div className="w-96">
      <Textarea {...args} />
    </div>
  ),
};

// With value
const WithValueComponent = () => {
  const [value, setValue] = useState(
    "This is a textarea with some content.\nIt spans multiple lines.\nYou can edit it!",
  );
  return (
    <div className="w-96">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
      />
    </div>
  );
};

export const WithValue: Story = {
  render: () => <WithValueComponent />,
};

// With placeholder
export const WithPlaceholder: Story = {
  args: {
    placeholder: "Enter your description here...\nYou can write multiple lines.",
    rows: 4,
  },
  render: (args) => (
    <div className="w-96">
      <Textarea {...args} />
    </div>
  ),
};

// Error state
export const WithError: Story = {
  args: {
    value: "Too short",
    placeholder: "Enter description...",
    error: "Description must be at least 20 characters",
    rows: 4,
    id: "description-textarea",
  },
  render: (args) => (
    <div className="w-96">
      <Textarea {...args} />
    </div>
  ),
};

// Disabled state
export const Disabled: Story = {
  args: {
    value:
      "This textarea is disabled.\nYou cannot edit this content.\nIt's read-only.",
    disabled: true,
    rows: 4,
  },
  render: (args) => (
    <div className="w-96">
      <Textarea {...args} />
    </div>
  ),
};

// Monospace variant (for code/prompts)
export const Monospace: Story = {
  args: {
    value: `You are a helpful assistant that specializes in answering questions about React and TypeScript.

When responding:
- Be concise and clear
- Provide code examples when helpful
- Explain complex concepts step-by-step`,
    monospace: true,
    rows: 8,
    placeholder: "Enter system prompt...",
  },
  render: (args) => (
    <div className="w-[600px]">
      <Textarea {...args} />
    </div>
  ),
};

// Auto-resize
const AutoResizeComponent = () => {
  const [value, setValue] = useState("Start typing...\n");
  return (
    <div className="w-96 space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="This textarea will grow as you type..."
        autoResize
        rows={3}
        maxRows={10}
      />
      <p className="text-sm text-theme-fg-secondary">
        Lines: {value.split("\n").length}
      </p>
    </div>
  );
};

export const AutoResize: Story = {
  render: () => <AutoResizeComponent />,
};

// Different row counts
export const DifferentRows: Story = {
  render: () => (
    <div className="w-96 space-y-4">
      <div>
        <p className="mb-2 text-sm text-theme-fg-secondary">2 rows</p>
        <Textarea placeholder="Small textarea..." rows={2} />
      </div>
      <div>
        <p className="mb-2 text-sm text-theme-fg-secondary">5 rows</p>
        <Textarea placeholder="Medium textarea..." rows={5} />
      </div>
      <div>
        <p className="mb-2 text-sm text-theme-fg-secondary">10 rows</p>
        <Textarea placeholder="Large textarea..." rows={10} />
      </div>
    </div>
  ),
};

// Interactive demo
const InteractiveComponent = () => {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Simple validation
    if (newValue.length > 0 && newValue.length < 10) {
      setError("Must be at least 10 characters");
    } else {
      setError("");
    }
  };

  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const charCount = value.length;

  return (
    <div className="w-96 space-y-2">
      <Textarea
        value={value}
        onChange={handleChange}
        placeholder="Type something..."
        rows={5}
        error={error}
        id="interactive-textarea"
      />
      <div className="flex justify-between text-sm text-theme-fg-secondary">
        <span>Words: {wordCount}</span>
        <span>Characters: {charCount}</span>
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveComponent />,
};

// Code/Prompt example
const CodePromptExampleComponent = () => {
  const [prompt, setPrompt] = useState(
    `You are an AI assistant specialized in helping developers write better code.

Your responsibilities:
1. Review code for potential bugs
2. Suggest improvements and best practices
3. Explain complex programming concepts
4. Help with debugging issues

Always be clear, concise, and provide working examples when possible.`,
  );
  return (
    <div className="w-[600px]">
      <label
        htmlFor="prompt-textarea"
        className="mb-2 block text-sm font-medium text-theme-fg-primary"
      >
        System Prompt
      </label>
      <Textarea
        id="prompt-textarea"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        monospace
        rows={10}
        placeholder="Enter system prompt..."
      />
    </div>
  );
};

export const CodePromptExample: Story = {
  render: () => <CodePromptExampleComponent />,
};

