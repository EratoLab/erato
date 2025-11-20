import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AssistantForm } from "@/components/ui/Assistant/AssistantForm";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import {
  useAvailableModels,
  useCreateAssistant,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import type { CreateAssistantRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

import type { AssistantFormData } from "@/components/ui/Assistant/AssistantForm";

export default function AssistantCreatePage() {
  const navigate = useNavigate();
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

      await createAssistant({
        body: {
          name: formData.name,
          prompt: formData.prompt,
          description: formData.description || undefined,
          default_chat_provider: formData.defaultModel?.chat_provider_id || undefined,
          file_ids: formData.files.length > 0 
            ? formData.files.map(f => f.id) 
            : undefined,
          mcp_server_ids: formData.mcpServerIds.length > 0 
            ? formData.mcpServerIds 
            : undefined,
        } as any,
      });

      setSuccessMessage(t`Assistant created successfully!`);
      
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

