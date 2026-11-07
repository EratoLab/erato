import { useState } from "react";

import { Input } from "@/components/ui/Input/Input";
import { Select } from "@/components/ui/Input/Select";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Input",
  component: Input,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    type: {
      control: "select",
      options: [
        "text",
        "email",
        "url",
        "password",
        "search",
        "tel",
        "date",
        "time",
      ],
    },
    geometry: {
      control: "inline-radio",
      options: ["input", "control"],
    },
    disabled: {
      control: "boolean",
    },
    error: {
      control: "text",
    },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default state
export const Default: Story = {
  args: {
    placeholder: "Enter text...",
  },
};

// With value
const WithValueComponent = () => {
  const [value, setValue] = useState("Hello World");
  return (
    <div className="w-80">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter text..."
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
    placeholder: "Enter your name...",
  },
  render: (args) => (
    <div className="w-80">
      <Input {...args} />
    </div>
  ),
};

// Error state
export const WithError: Story = {
  args: {
    value: "invalid@",
    placeholder: "Enter email...",
    error: "Please enter a valid email address",
    id: "email-input",
  },
  render: (args) => (
    <div className="w-80">
      <Input {...args} />
    </div>
  ),
};

// Disabled state
export const Disabled: Story = {
  args: {
    value: "Cannot edit this",
    disabled: true,
  },
  render: (args) => (
    <div className="w-80">
      <Input {...args} />
    </div>
  ),
};

// Email type
export const EmailType: Story = {
  args: {
    type: "email",
    placeholder: "you@example.com",
  },
  render: (args) => (
    <div className="w-80">
      <Input {...args} />
    </div>
  ),
};

// URL type
export const UrlType: Story = {
  args: {
    type: "url",
    placeholder: "https://example.com",
  },
  render: (args) => (
    <div className="w-80">
      <Input {...args} />
    </div>
  ),
};

// Password type
export const PasswordType: Story = {
  args: {
    type: "password",
    placeholder: "Enter password...",
    value: "secretpassword",
  },
  render: (args) => (
    <div className="w-80">
      <Input {...args} />
    </div>
  ),
};

// Date and time fields
export const DateAndTime: Story = {
  render: () => (
    <div className="flex gap-3">
      <div className="w-44">
        <Input type="date" aria-label="Date" defaultValue="2026-11-09" />
      </div>
      <div className="w-32">
        <Input type="time" aria-label="Time" defaultValue="09:00" />
      </div>
    </div>
  ),
};

// `geometry="control"` lines a field up with a Select in one row.
export const ControlGeometryNextToSelect: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-60">
        <Select aria-label="Trigger" defaultValue="once">
          <option value="once">At a date and time</option>
          <option value="repeat">On a repeating schedule</option>
        </Select>
      </div>
      <div className="w-44">
        <Input
          type="date"
          geometry="control"
          aria-label="Date"
          defaultValue="2026-11-09"
        />
      </div>
      <div className="w-32">
        <Input
          type="time"
          geometry="control"
          aria-label="Time"
          defaultValue="09:00"
        />
      </div>
    </div>
  ),
};

// Interactive demo
const InteractiveComponent = () => {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Simple validation
    if (newValue.length > 0 && newValue.length < 3) {
      setError("Must be at least 3 characters");
    } else {
      setError("");
    }
  };

  return (
    <div className="w-80 space-y-2">
      <Input
        value={value}
        onChange={handleChange}
        placeholder="Type something..."
        error={error}
        id="interactive-input"
      />
      <p className="text-sm text-theme-fg-secondary">
        Character count: {value.length}
      </p>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveComponent />,
};

// Different widths
export const DifferentWidths: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="w-40">
        <Input placeholder="Small width" />
      </div>
      <div className="w-64">
        <Input placeholder="Medium width" />
      </div>
      <div className="w-96">
        <Input placeholder="Large width" />
      </div>
      <div className="w-full max-w-2xl">
        <Input placeholder="Extra large width" />
      </div>
    </div>
  ),
};
