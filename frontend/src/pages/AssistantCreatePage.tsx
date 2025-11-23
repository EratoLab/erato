import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AssistantForm } from "@/components/ui/Assistant/AssistantForm";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import {
  useAvailableModels,
  useCreateAssistant,
  listAssistantsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { AssistantFormData } from "@/components/ui/Assistant/AssistantForm";

export default function AssistantCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Fetch available models
  const { data: modelsData } = useAvailableModels({});
  const availableModels = modelsData ?? [];

  // Create assistant mutation
  const { mutateAsync: createAssistant, isPending } = useCreateAssistant();

  useEffect(() => {
    document.title = `${t`Create Assistant`} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const handleSubmit = async (formData: AssistantFormData) => {
    try {
      setErrorMessage("");
      setSuccessMessage("");

      // Build the request body with proper typing
      // Note: Generated types are incomplete, so we use type assertion
      const requestBody = {
        name: formData.name,
        prompt: formData.prompt,
        ...(formData.description && { description: formData.description }),
        ...(formData.defaultModel?.chat_provider_id && {
          default_chat_provider: formData.defaultModel.chat_provider_id,
        }),
        ...(formData.files.length > 0 && {
          file_ids: formData.files.map((f) => f.id),
        }),
        ...(formData.mcpServerIds.length > 0 && {
          mcp_server_ids: formData.mcpServerIds,
        }),
      } as unknown as Parameters<typeof createAssistant>[0]["body"];

      await createAssistant({
        body: requestBody,
      });

      setSuccessMessage(t`Assistant created successfully!`);

      // Invalidate assistants list query
      await queryClient.invalidateQueries({
        queryKey: listAssistantsQuery({}).queryKey,
      });

      // Navigate to assistants list after a short delay
      setTimeout(() => {
        navigate("/assistants");
      }, 1500);
    } catch (error) {
      console.error("Failed to create assistant:", error);
      setErrorMessage(t`Failed to create assistant. Please try again.`);
    }
  };

  const handleCancel = () => {
    navigate("/assistants");
  };

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      {/* Page Header */}
      <PageHeader
        title={t`Create Assistant`}
        subtitle={t`Configure a custom assistant with specific instructions and capabilities`}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-8">
            <AssistantForm
              mode="create"
              availableModels={availableModels}
              isSubmitting={isPending}
              successMessage={successMessage}
              errorMessage={errorMessage}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
