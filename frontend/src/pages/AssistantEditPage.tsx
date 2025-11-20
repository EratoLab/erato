import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AssistantForm } from "@/components/ui/Assistant/AssistantForm";
import { Alert } from "@/components/ui/Feedback/Alert";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import {
  useAvailableModels,
  useGetAssistant,
  useUpdateAssistant,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import type { UpdateAssistantRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

import type { AssistantFormData } from "@/components/ui/Assistant/AssistantForm";

export default function AssistantEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Fetch assistant data
  const {
    data: assistant,
    isLoading: isLoadingAssistant,
    error: loadError,
  } = useGetAssistant(
    id ? { pathParams: { assistantId: id } } : { skip: true } as any,
  );

  // Fetch available models
  const { data: modelsData } = useAvailableModels({});
  const availableModels = modelsData ?? [];

  // Update assistant mutation
  const { mutateAsync: updateAssistant, isPending } = useUpdateAssistant();

  useEffect(() => {
    document.title = `${t`Edit Assistant`} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  // Handle form submission
  const handleSubmit = async (formData: AssistantFormData) => {
    if (!id) return;

    try {
      setErrorMessage("");
      setSuccessMessage("");

      await updateAssistant({
        pathParams: { assistantId: id },
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

      setSuccessMessage(t`Assistant updated successfully!`);
      
      // Navigate back to assistants list after a short delay
      setTimeout(() => {
        navigate("/assistants");
      }, 1500);
    } catch (error) {
      console.error("Failed to update assistant:", error);
      setErrorMessage(t`Failed to update assistant. Please try again.`);
    }
  };

  const handleCancel = () => {
    navigate("/assistants");
  };

  // Loading state
  if (isLoadingAssistant) {
    return (
      <div className="flex h-full flex-col bg-theme-bg-secondary">
        <PageHeader title={t`Edit Assistant`} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
            <p className="text-sm text-theme-fg-secondary">{t`Loading assistant...`}</p>
          </div>
        </div>
      </div>
    );
  }

  // Error loading assistant
  if (loadError || !assistant) {
    return (
      <div className="flex h-full flex-col bg-theme-bg-secondary">
        <PageHeader title={t`Edit Assistant`} />
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl p-6">
            <Alert type="error">
              {t`Failed to load assistant. Please try again.`}
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  // Find the selected model from available models
  const defaultChatProvider = assistant.default_chat_provider;
  const selectedModel = defaultChatProvider != null && defaultChatProvider != undefined
    ? availableModels.find((m: { chat_provider_id: string }) => 
        m.chat_provider_id === defaultChatProvider
      ) ?? null
    : null;

  // Prepare initial form data
  const initialData: Partial<AssistantFormData> = {
    name: assistant.name,
    description: assistant.description || "",
    prompt: assistant.prompt,
    defaultModel: selectedModel,
    files: assistant.files || [],
    mcpServerIds: assistant.mcp_server_ids || [],
  };

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      {/* Page Header */}
      <PageHeader
        title={t`Edit Assistant`}
        subtitle={t`Update your assistant's configuration and settings`}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-8">
            <AssistantForm
              mode="edit"
              initialData={initialData}
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

