import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { AssistantForm } from "@/components/ui/Assistant/AssistantForm";
import { ASSISTANT_SAVE_TOAST_KEY } from "@/components/ui/Assistant/assistantSaveToast";
import { Card } from "@/components/ui/Container/Card";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { toast } from "@/components/ui/Toast";
import { usePageErrorToast } from "@/components/ui/Toast/usePageErrorToast";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAvailableModels,
  useCreateAssistant,
  listAssistantsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { AssistantFormData } from "@/components/ui/Assistant/AssistantForm";

export default function AssistantCreatePage() {
  const showError = usePageErrorToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");

  // Fetch available models
  const { data: modelsData } = useAvailableModels({});
  const availableModels = modelsData ?? [];

  // Create assistant mutation
  const { mutateAsync: createAssistant, isPending } = useCreateAssistant();

  useEffect(() => {
    document.title = `${t({ id: "assistant.create.title", message: "Create Assistant" })} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const handleSubmit = async (formData: AssistantFormData) => {
    toast.dismissKey(ASSISTANT_SAVE_TOAST_KEY);
    try {
      // Build the request body with proper typing
      // Note: Generated types are incomplete, so we use type assertion
      const requestBody = {
        name: formData.name,
        prompt: formData.prompt,
        welcome_message: formData.welcomeMessage,
        starter_prompts: formData.starterPrompts,
        ...(formData.description && { description: formData.description }),
        default_chat_provider: formData.defaultModel?.chat_provider_id ?? null,
        ...(formData.facetIds.length > 0 && {
          facet_ids: formData.facetIds,
        }),
        enforce_facet_settings: formData.enforceFacetSettings,
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

      // The list page refetches the invalidated query when it mounts, so
      // there is nothing to wait for before leaving.
      void queryClient.invalidateQueries({
        queryKey: listAssistantsQuery({}).queryKey,
      });

      toast.success({
        dedupeKey: ASSISTANT_SAVE_TOAST_KEY,
        title: t({
          id: "assistant.create.success",
          message: "Assistant created successfully!",
        }),
      });
      navigate("/assistants/created");
    } catch (error) {
      console.error("Failed to create assistant:", error);
      showError({
        dedupeKey: ASSISTANT_SAVE_TOAST_KEY,
        title: t({
          id: "assistant.create.error",
          message: "Failed to create assistant. Please try again.",
        }),
      });
    }
  };

  const handleCancel = () => {
    toast.dismissKey(ASSISTANT_SAVE_TOAST_KEY);
    navigate("/assistants/created");
  };

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      {/* Page Header */}
      <PageHeader
        density="compact"
        title={t({ id: "assistant.create.title", message: "Create Assistant" })}
        subtitle={t({
          id: "assistant.create.subtitle",
          message:
            "Configure a custom assistant with specific instructions and capabilities",
        })}
      />

      {/* Content */}
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("py-6", containerClasses)}>
          <Card variant="surface" size="xl">
            <AssistantForm
              mode="create"
              availableModels={availableModels}
              isSubmitting={isPending}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
