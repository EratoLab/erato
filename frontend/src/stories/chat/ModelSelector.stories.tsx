import { useState } from "react";

import {
  ModelSelector,
  ModelSelectorOptionContent,
} from "@/components/ui/Chat/ModelSelector";

import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

const models: ChatModel[] = [
  {
    chat_provider_id: "display-only",
    model_display_name: "Display Name Only",
  },
  {
    chat_provider_id: "with-description",
    model_display_name: "Description Only",
    model_description:
      "Shows a translated or configured secondary description.",
  },
  {
    chat_provider_id: "with-icon",
    model_display_name: "Icon Only",
    model_icon: "simpleicons-anthropic",
  },
  {
    chat_provider_id: "with-icon-and-description",
    model_display_name: "Icon And Description",
    model_description: "Combines the model icon with a lighter secondary line.",
    model_icon: "builtin-chatgpt",
  },
];

const meta = {
  title: "Chat/ModelSelector",
  component: ModelSelector,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

function DropdownVariantsStory() {
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(
    models[0],
  );

  return (
    <div className="w-[720px] rounded-2xl border border-theme-border bg-theme-bg-primary p-6">
      <ModelSelector
        availableModels={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}

export const Variants: Story = {
  args: {
    availableModels: models,
    selectedModel: models[0],
    onModelChange: () => {},
  },
  render: () => (
    <div className="w-[720px] rounded-2xl border border-theme-border bg-theme-bg-primary p-6">
      <div className="grid gap-3 md:grid-cols-2">
        {models.map((model) => (
          <div
            key={model.chat_provider_id}
            className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4"
          >
            <ModelSelectorOptionContent model={model} />
          </div>
        ))}
      </div>
    </div>
  ),
};

export const DropdownVariants: Story = {
  args: {
    availableModels: models,
    selectedModel: models[0],
    onModelChange: () => {},
  },
  render: () => <DropdownVariantsStory />,
};
