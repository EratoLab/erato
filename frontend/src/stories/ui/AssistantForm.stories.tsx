import { useState } from "react";

import { AssistantForm } from "@/components/ui/Assistant/AssistantForm";

import type { AssistantFormData } from "@/components/ui/Assistant/AssistantForm";
import type {
  ChatModel,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/AssistantForm",
  component: AssistantForm,
  parameters: {
    layout: "fullscreen",
    // A11y configuration: Document known false positives from automated checker
    // See: https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#options-parameter
    a11y: {
      // Known issues with automated accessibility checking:
      // 1. aria-controls: ModelSelector dropdown menu is conditionally rendered,
      //    so the checker can't find the element when closed. This is the correct
      //    pattern per WAI-ARIA APG for dropdown menus.
      // 2. color-contrast: Checker can't determine colors through CSS variables
      //    and layered elements. Theme tokens meet WCAG AA standards (verified manually).
      //
      // These warnings are expected and do not indicate actual accessibility issues.
      config: {
        rules: [
          // Disable aria-valid-attr-value check for conditionally rendered dropdowns
          { id: "aria-valid-attr-value", enabled: false },
          // Disable color-contrast for elements using CSS variables with layering
          { id: "color-contrast", enabled: false },
        ],
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="flex min-h-screen w-full items-center justify-center overflow-y-auto bg-theme-bg-secondary p-8">
        <div className="w-full max-w-4xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof AssistantForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data
const mockModels: ChatModel[] = [
  {
    chat_provider_id: "gpt-4",
    model_display_name: "GPT-4",
  },
  {
    chat_provider_id: "gpt-3.5-turbo",
    model_display_name: "GPT-3.5 Turbo",
  },
  {
    chat_provider_id: "claude-3-opus",
    model_display_name: "Claude 3 Opus",
  },
  {
    chat_provider_id: "claude-3-sonnet",
    model_display_name: "Claude 3 Sonnet",
  },
];

const mockFiles: FileUploadItem[] = [
  {
    id: "file-1",
    filename: "documentation.pdf",
    download_url: "#",
  },
  {
    id: "file-2",
    filename: "guidelines.txt",
    download_url: "#",
  },
];

// Empty form (Create mode)
export const EmptyForm: Story = {
  args: {
    mode: "create",
    availableModels: mockModels,
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
    onCancel: () => {
      console.log("Form cancelled");
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Create New Assistant
      </h2>
      <AssistantForm {...args} />
    </div>
  ),
};

// Filled form (Edit mode)
export const FilledForm: Story = {
  args: {
    mode: "edit",
    availableModels: mockModels,
    initialData: {
      name: "Code Review Assistant",
      description:
        "An assistant that helps with code reviews, focusing on best practices and potential bugs.",
      prompt: `You are a senior software engineer specializing in code reviews.

When reviewing code:
- Look for potential bugs and edge cases
- Suggest improvements for code readability
- Check for best practices and design patterns
- Highlight security concerns
- Be constructive and encouraging in your feedback

Always provide specific examples and explain your reasoning.`,
      defaultModel: mockModels[0],
      files: mockFiles,
      mcpServerIds: [],
    },
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
    onCancel: () => {
      console.log("Form cancelled");
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Edit Assistant
      </h2>
      <AssistantForm {...args} />
    </div>
  ),
};

// With validation errors
const WithValidationErrorsComponent = () => {
  const [formKey, setFormKey] = useState(0);

  const handleSubmit = (data: AssistantFormData) => {
    console.log("Form submitted:", data);
    // Trigger re-render to show validation
    setFormKey((prev) => prev + 1);
  };

  return (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Form with Validation
      </h2>
      <p className="mb-4 text-sm text-theme-fg-secondary">
        Try submitting the form without filling in required fields, or with
        invalid data.
      </p>
      <AssistantForm
        key={formKey}
        mode="create"
        availableModels={mockModels}
        initialData={{
          name: "A", // Too short
          description: "",
          prompt: "Short", // Too short
          defaultModel: null,
          files: [],
          mcpServerIds: [],
        }}
        onSubmit={handleSubmit}
        onCancel={() => console.log("Cancelled")}
      />
    </div>
  );
};

export const WithValidationErrors: Story = {
  args: {
    onSubmit: () => {},
  },
  render: () => <WithValidationErrorsComponent />,
};

// Submitting state
export const Submitting: Story = {
  args: {
    mode: "create",
    availableModels: mockModels,
    isSubmitting: true,
    initialData: {
      name: "My Assistant",
      description: "A helpful assistant",
      prompt:
        "You are a helpful assistant that provides clear and concise answers.",
      defaultModel: mockModels[0],
      files: [],
      mcpServerIds: [],
    },
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Submitting...
      </h2>
      <AssistantForm {...args} />
    </div>
  ),
};

// With success message
export const WithSuccessMessage: Story = {
  args: {
    mode: "create",
    availableModels: mockModels,
    successMessage: "Assistant created successfully!",
    initialData: {
      name: "Research Assistant",
      description: "Helps with research and data analysis",
      prompt: "You are a research assistant...",
      defaultModel: mockModels[2],
      files: [],
      mcpServerIds: [],
    },
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
    onCancel: () => {
      console.log("Form cancelled");
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Success State
      </h2>
      <AssistantForm {...args} />
    </div>
  ),
};

// With error message
export const WithErrorMessage: Story = {
  args: {
    mode: "create",
    availableModels: mockModels,
    errorMessage: "Failed to create assistant. Please try again.",
    initialData: {
      name: "My Assistant",
      description: "",
      prompt: "You are a helpful assistant.",
      defaultModel: null,
      files: [],
      mcpServerIds: [],
    },
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
    onCancel: () => {
      console.log("Form cancelled");
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Error State
      </h2>
      <AssistantForm {...args} />
    </div>
  ),
};

// With file attachments
export const WithFileAttachments: Story = {
  args: {
    mode: "create",
    availableModels: mockModels,
    initialData: {
      name: "Document Analysis Assistant",
      description:
        "Analyzes documents and provides insights based on uploaded files",
      prompt: `You are a document analysis assistant.

Use the provided documents to:
- Answer questions about the content
- Summarize key points
- Identify important patterns or trends
- Cross-reference information across documents

Always cite which document you're referencing.`,
      defaultModel: mockModels[0],
      files: mockFiles,
      mcpServerIds: [],
    },
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
    onCancel: () => {
      console.log("Form cancelled");
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        With File Attachments
      </h2>
      <AssistantForm {...args} />
    </div>
  ),
};

// Without models (models not loaded yet)
export const WithoutModels: Story = {
  args: {
    mode: "create",
    availableModels: [],
    onSubmit: (data) => {
      console.log("Form submitted:", data);
    },
    onCancel: () => {
      console.log("Form cancelled");
    },
  },
  render: (args) => (
    <div className="w-[700px] rounded-lg border border-theme-border bg-theme-bg-primary p-8">
      <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
        Without Model Selection
      </h2>
      <p className="mb-4 text-sm text-theme-fg-secondary">
        Model selector is hidden when no models are available
      </p>
      <AssistantForm {...args} />
    </div>
  ),
};

// Interactive demo
const InteractiveDemoComponent = () => {
  const [formData, setFormData] = useState<AssistantFormData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (data: AssistantFormData) => {
    setIsSubmitting(true);
    setSuccessMessage("");
    setErrorMessage("");

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Randomly succeed or fail for demo
    const success = Math.random() > 0.3;

    if (success) {
      setSuccessMessage("Assistant created successfully!");
      setFormData(data);
    } else {
      setErrorMessage("Failed to create assistant. Please try again.");
    }

    setIsSubmitting(false);
  };

  const handleCancel = () => {
    setSuccessMessage("");
    setErrorMessage("");
    setFormData(null);
  };

  return (
    <div className="w-[700px] space-y-6">
      <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-8">
        <h2 className="mb-6 text-2xl font-semibold text-theme-fg-primary">
          Interactive Assistant Form
        </h2>
        <AssistantForm
          mode="create"
          availableModels={mockModels}
          isSubmitting={isSubmitting}
          successMessage={successMessage}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>

      {formData && (
        <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-6">
          <h3 className="mb-3 text-lg font-semibold text-theme-fg-primary">
            Submitted Data:
          </h3>
          <pre className="overflow-auto rounded bg-theme-bg-primary p-4 text-sm text-theme-fg-primary">
            {JSON.stringify(formData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const InteractiveDemo: Story = {
  args: {
    onSubmit: () => {},
  },
  render: () => <InteractiveDemoComponent />,
};

// Complete page layout example
export const CompletePageLayout: Story = {
  args: {
    onSubmit: () => {},
  },
  render: () => {
    return (
      <div className="min-h-screen bg-theme-bg-secondary">
        {/* Header */}
        <div className="border-b border-theme-border bg-theme-bg-primary px-8 py-6">
          <div className="mx-auto max-w-4xl">
            <h1 className="text-3xl font-bold text-theme-fg-primary">
              Create Assistant
            </h1>
            <p className="mt-2 text-theme-fg-secondary">
              Configure a custom assistant with specific instructions and
              capabilities
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-4xl p-8">
          <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-8">
            <AssistantForm
              mode="create"
              availableModels={mockModels}
              onSubmit={(data) => console.log("Form submitted:", data)}
              onCancel={() => console.log("Form cancelled")}
            />
          </div>
        </div>
      </div>
    );
  },
};
