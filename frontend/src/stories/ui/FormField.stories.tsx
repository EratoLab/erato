import { useState } from "react";

import { InfoTooltip } from "@/components/ui/Controls/InfoTooltip";
import { FormField } from "@/components/ui/Input/FormField";
import { Input } from "@/components/ui/Input/Input";
import { Textarea } from "@/components/ui/Input/Textarea";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/FormField",
  component: FormField,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="flex min-h-screen w-full items-start justify-center overflow-y-auto bg-theme-bg-secondary p-8">
        <div className="w-full max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  argTypes: {
    required: {
      control: "boolean",
    },
    error: {
      control: "text",
    },
    helpText: {
      control: "text",
    },
  },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

// With Input
export const WithInput: Story = {
  args: {
    label: "Full Name",
    children: null,
  },
  render: () => (
    <div className="w-96">
      <FormField label="Full Name" htmlFor="name-input">
        <Input id="name-input" placeholder="John Doe" />
      </FormField>
    </div>
  ),
};

// With Textarea
export const WithTextarea: Story = {
  args: {
    label: "Description",
    children: null,
  },
  render: () => (
    <div className="w-96">
      <FormField label="Description" htmlFor="description-textarea">
        <Textarea
          id="description-textarea"
          placeholder="Enter a description..."
          rows={4}
        />
      </FormField>
    </div>
  ),
};

// Required field
export const RequiredField: Story = {
  args: {
    label: "Email Address",
    children: null,
  },
  render: () => (
    <div className="w-96 space-y-4">
      <FormField label="Email Address" required htmlFor="email-input">
        <Input id="email-input" type="email" placeholder="you@example.com" />
      </FormField>
      <FormField label="Password" required htmlFor="password-input">
        <Input id="password-input" type="password" placeholder="••••••••" />
      </FormField>
    </div>
  ),
};

// With error
export const WithError: Story = {
  args: {
    label: "Email Address",
    children: null,
  },
  render: () => (
    <div className="w-96">
      <FormField
        label="Email Address"
        required
        error="Please enter a valid email address"
        htmlFor="email-error-input"
      >
        <Input
          id="email-error-input"
          type="email"
          value="invalid@"
          error="Please enter a valid email address"
        />
      </FormField>
    </div>
  ),
};

// With help text
export const WithHelpText: Story = {
  args: {
    label: "Username",
    children: null,
  },
  render: () => (
    <div className="w-96 space-y-4">
      <FormField
        label="Username"
        helpText="Must be 3-20 characters, alphanumeric only"
        htmlFor="username-input"
      >
        <Input id="username-input" placeholder="johndoe" />
      </FormField>
      <FormField
        label="Bio"
        helpText="Tell us a bit about yourself (max 500 characters)"
        htmlFor="bio-textarea"
      >
        <Textarea
          id="bio-textarea"
          placeholder="I'm a developer who..."
          rows={4}
        />
      </FormField>
    </div>
  ),
};

// Complete form example
const CompleteFormExampleComponent = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    description: "",
  });
  const [errors, setErrors] = useState({
    name: "",
    email: "",
    description: "",
  });

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData({ ...formData, name: value });
    if (value.length < 2) {
      setErrors({ ...errors, name: "Name must be at least 2 characters" });
    } else {
      setErrors({ ...errors, name: "" });
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData({ ...formData, email: value });
    if (!validateEmail(value) && value.length > 0) {
      setErrors({ ...errors, email: "Please enter a valid email address" });
    } else {
      setErrors({ ...errors, email: "" });
    }
  };

  const handleDescriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const value = e.target.value;
    setFormData({ ...formData, description: value });
    if (value.length > 0 && value.length < 10) {
      setErrors({
        ...errors,
        description: "Description must be at least 10 characters",
      });
    } else {
      setErrors({ ...errors, description: "" });
    }
  };

  return (
    <div className="w-[500px] space-y-4 rounded-lg border border-theme-border bg-theme-bg-primary p-6">
      <h2 className="text-xl font-semibold text-theme-fg-primary">
        Create Assistant
      </h2>

      <FormField
        label="Assistant Name"
        required
        error={errors.name}
        htmlFor="assistant-name"
      >
        <Input
          id="assistant-name"
          value={formData.name}
          onChange={handleNameChange}
          placeholder="My Helper Assistant"
          error={errors.name}
        />
      </FormField>

      <FormField
        label="Email Notifications"
        required
        error={errors.email}
        helpText="We'll send updates about your assistant"
        htmlFor="assistant-email"
      >
        <Input
          id="assistant-email"
          type="email"
          value={formData.email}
          onChange={handleEmailChange}
          placeholder="you@example.com"
          error={errors.email}
        />
      </FormField>

      <FormField
        label="Description"
        error={errors.description}
        helpText="Describe what your assistant does"
        htmlFor="assistant-description"
      >
        <Textarea
          id="assistant-description"
          value={formData.description}
          onChange={handleDescriptionChange}
          placeholder="This assistant helps with..."
          rows={4}
          error={errors.description}
        />
      </FormField>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          className="rounded-lg border border-theme-border bg-theme-bg-secondary px-4 py-2 text-sm font-medium text-theme-fg-secondary hover:bg-theme-bg-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Create Assistant
        </button>
      </div>
    </div>
  );
};

export const CompleteFormExample: Story = {
  args: {
    label: "Assistant Name",
    children: null,
  },
  render: () => <CompleteFormExampleComponent />,
};

// Multiple fields
export const MultipleFields: Story = {
  args: {
    label: "First Name",
    children: null,
  },
  render: () => (
    <div className="w-[500px] space-y-4">
      <FormField label="First Name" required htmlFor="first-name">
        <Input id="first-name" placeholder="John" />
      </FormField>

      <FormField label="Last Name" required htmlFor="last-name">
        <Input id="last-name" placeholder="Doe" />
      </FormField>

      <FormField
        label="Email"
        required
        helpText="We'll never share your email"
        htmlFor="email"
      >
        <Input id="email" type="email" placeholder="john@example.com" />
      </FormField>

      <FormField label="Phone" htmlFor="phone">
        <Input id="phone" type="tel" placeholder="+1 (555) 123-4567" />
      </FormField>

      <FormField
        label="Additional Notes"
        helpText="Optional: Add any additional information"
        htmlFor="notes"
      >
        <Textarea id="notes" placeholder="Enter notes..." rows={3} />
      </FormField>
    </div>
  ),
};

// With disabled input
export const WithDisabledInput: Story = {
  args: {
    label: "Account ID",
    children: null,
  },
  render: () => (
    <div className="w-96 space-y-4">
      <FormField label="Account ID" htmlFor="account-id">
        <Input id="account-id" value="ACC-12345" disabled />
      </FormField>

      <FormField
        label="System Generated"
        helpText="This field is automatically generated"
        htmlFor="system-field"
      >
        <Input id="system-field" value="auto-generated-value" disabled />
      </FormField>
    </div>
  ),
};

// Monospace textarea in form
export const MonospaceInForm: Story = {
  args: {
    label: "System Prompt",
    children: null,
  },
  render: () => (
    <div className="w-[600px]">
      <FormField
        label="System Prompt"
        required
        helpText="Define how the assistant should behave"
        htmlFor="system-prompt"
      >
        <Textarea
          id="system-prompt"
          monospace
          rows={8}
          placeholder="You are a helpful assistant that..."
        />
      </FormField>
    </div>
  ),
};

// With label action (InfoTooltip)
export const WithLabelAction: Story = {
  args: {
    label: "System Prompt",
    children: null,
  },
  render: () => (
    <div className="w-[600px] space-y-4">
      <FormField
        label="System Prompt"
        required
        helpText="Define how the assistant should behave"
        htmlFor="system-prompt-1"
        labelAction={<InfoTooltip translationId="story.tooltip.systemPrompt" />}
      >
        <Textarea
          id="system-prompt-1"
          monospace
          rows={6}
          placeholder="You are a helpful assistant that..."
        />
      </FormField>

      <FormField
        label="Default Model"
        helpText="Choose which model to use by default"
        htmlFor="model-select"
        labelAction={<InfoTooltip translationId="story.tooltip.model" />}
      >
        <Input id="model-select" placeholder="GPT-4" disabled />
      </FormField>

      <FormField
        label="Default Files"
        helpText="Files available to the assistant in every chat"
        htmlFor="file-upload"
        labelAction={<InfoTooltip translationId="story.tooltip.files" />}
      >
        <Input id="file-upload" placeholder="No files uploaded" disabled />
      </FormField>
    </div>
  ),
};
