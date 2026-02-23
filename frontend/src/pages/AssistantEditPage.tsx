import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import * as reactQuery from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AssistantForm } from "@/components/ui/Assistant/AssistantForm";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SharingDialog, SharingErrorBoundary } from "@/components/ui/Sharing";
import { ShareIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAvailableModels,
  useGetAssistant,
  useUpdateAssistant,
  listAssistantsQuery,
  getAssistantQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { AssistantFormData } from "@/components/ui/Assistant/AssistantForm";

export default function AssistantEditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSharingDialogOpen, setIsSharingDialogOpen] = useState(false);

  // Fetch assistant data
  const {
    data: assistant,
    isLoading: isLoadingAssistant,
    error: loadError,
  } = useGetAssistant(
    id ? { pathParams: { assistantId: id } } : reactQuery.skipToken,
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

      // Build the request body with proper typing
      // Note: Generated types are incomplete, so we use type assertion
      const requestBody = {
        name: formData.name,
        prompt: formData.prompt,
        ...(formData.description && { description: formData.description }),
        ...(formData.defaultModel?.chat_provider_id && {
          default_chat_provider: formData.defaultModel.chat_provider_id,
        }),
        // Always include file_ids to allow clearing files when empty
        file_ids: formData.files.map((f) => f.id),
        ...(formData.mcpServerIds.length > 0 && {
          mcp_server_ids: formData.mcpServerIds,
        }),
      } as unknown as Parameters<typeof updateAssistant>[0]["body"];

      await updateAssistant({
        pathParams: { assistantId: id },
        body: requestBody,
      });

      setSuccessMessage(t`Assistant updated successfully!`);

      // Invalidate queries
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: listAssistantsQuery({}).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: getAssistantQuery({ pathParams: { assistantId: id } })
            .queryKey,
        }),
      ]);

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

  // Check if user has permission to edit
  if (!assistant.can_edit) {
    return (
      <div className="flex h-full flex-col bg-theme-bg-secondary">
        <PageHeader title={t`Edit Assistant`} />
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl p-6">
            <Alert type="error">
              {t`You don't have permission to edit this assistant. Only the owner can modify assistant settings.`}
            </Alert>
            <div className="mt-4">
              <Button variant="secondary" onClick={handleCancel}>
                {t`Back to Assistants`}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Find the selected model from available models
  const defaultChatProvider = assistant.default_chat_provider;
  const selectedModel =
    defaultChatProvider != null
      ? (availableModels.find(
          (m: { chat_provider_id: string }) =>
            m.chat_provider_id === defaultChatProvider,
        ) ?? null)
      : null;

  // Prepare initial form data
  const initialData: Partial<AssistantFormData> = {
    name: assistant.name,
    description: assistant.description ?? "",
    prompt: assistant.prompt,
    defaultModel: selectedModel,
    files: assistant.files,
    mcpServerIds: assistant.mcp_server_ids ?? [],
  };

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      {/* Page Header */}
      <PageHeader
        title={t`Edit Assistant`}
        subtitle={t`Update your assistant's configuration and settings`}
      />

      {/* Content */}
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("py-6", containerClasses)}>
          {/* Share button - always shown since we only reach this code if can_edit is true */}
          <div className="mb-4 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              icon={<ShareIcon className="size-4" />}
              onClick={() => setIsSharingDialogOpen(true)}
            >
              {t({ id: "sharing.button.share", message: "Share" })}
            </Button>
          </div>

          <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-8">
            <AssistantForm
              mode="edit"
              assistantId={id}
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

      {/* Sharing dialog */}
      {id && (
        <SharingErrorBoundary onReset={() => setIsSharingDialogOpen(false)}>
          <SharingDialog
            isOpen={isSharingDialogOpen}
            onClose={() => setIsSharingDialogOpen(false)}
            resourceType="assistant"
            resourceId={id}
            resourceName={assistant.name}
          />
        </SharingErrorBoundary>
      )}
    </div>
  );
}
