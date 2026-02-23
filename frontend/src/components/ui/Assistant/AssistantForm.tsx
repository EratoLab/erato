import { t } from "@lingui/core/macro";
import { MagicWand } from "iconoir-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";

import { env } from "@/app/env";
import { ModelSelector } from "@/components/ui/Chat/ModelSelector";
import { Button } from "@/components/ui/Controls/Button";
import { InfoTooltip } from "@/components/ui/Controls/InfoTooltip";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import {
  FileAttachmentsPreview,
  AssistantFileUploadSelector,
} from "@/components/ui/FileUpload";
import { FormField } from "@/components/ui/Input/FormField";
import { Input } from "@/components/ui/Input/Input";
import { Textarea } from "@/components/ui/Input/Textarea";
import { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
import { useTokenUsageEstimation } from "@/hooks/chat/useTokenUsageEstimation";
import { useFilePreviewModal } from "@/hooks/ui";
import { usePromptOptimizer } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";
import type {
  ChatModel,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const CONTEXT_WARNING_THRESHOLD = 0.5;

export interface AssistantFormData {
  name: string;
  description: string;
  prompt: string;
  defaultModel: ChatModel | null;
  files: FileUploadItem[];
  mcpServerIds: string[];
}

export interface AssistantFormProps {
  /**
   * Initial data for editing an existing assistant
   */
  initialData?: Partial<AssistantFormData>;
  /**
   * Available models for selection
   */
  availableModels?: ChatModel[];
  /**
   * Whether the form is in a submitting state
   */
  isSubmitting?: boolean;
  /**
   * Success message to display
   */
  successMessage?: string;
  /**
   * Error message to display
   */
  errorMessage?: string;
  /**
   * Callback when form is submitted
   */
  onSubmit: (data: AssistantFormData) => void | Promise<void>;
  /**
   * Callback when form is cancelled
   */
  onCancel?: () => void;
  /**
   * Mode: create or edit
   * @default "create"
   */
  mode?: "create" | "edit";
  /** Assistant ID when editing an existing assistant */
  assistantId?: string;
  /** Optional override for token usage estimation display (storybook/testing) */
  tokenUsageEstimationOverride?: TokenUsageEstimationResult | null;
  /** Disable live token usage estimation requests (storybook/testing) */
  disableLiveTokenUsageEstimation?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * AssistantForm component for creating and editing assistants
 *
 * A complete form with all fields needed to configure an assistant:
 * - Name (required)
 * - Description (optional)
 * - System Prompt (required)
 * - Default Model (optional)
 * - Default Files (optional)
 *
 * @example
 * ```tsx
 * <AssistantForm
 *   mode="create"
 *   availableModels={models}
 *   onSubmit={handleCreate}
 *   onCancel={() => navigate('/assistants')}
 * />
 * ```
 */
export const AssistantForm: React.FC<AssistantFormProps> = ({
  initialData,
  availableModels = [],
  isSubmitting = false,
  successMessage,
  errorMessage,
  onSubmit,
  onCancel,
  mode = "create",
  assistantId,
  tokenUsageEstimationOverride = null,
  disableLiveTokenUsageEstimation = false,
  className,
}) => {
  const [formData, setFormData] = useState<AssistantFormData>({
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    prompt: initialData?.prompt ?? "",
    defaultModel: initialData?.defaultModel ?? null,
    files: initialData?.files ?? [],
    mcpServerIds: initialData?.mcpServerIds ?? [],
  });

  const [errors, setErrors] = useState<
    Partial<Record<keyof AssistantFormData, string>>
  >({});
  const [touched, setTouched] = useState<
    Partial<Record<keyof AssistantFormData, boolean>>
  >({});

  const {
    isPreviewModalOpen,
    fileToPreview,
    openPreviewModal,
    closePreviewModal,
  } = useFilePreviewModal();
  const promptOptimizer = usePromptOptimizer();
  const {
    estimateTokenUsageFromParts,
    lastEstimation,
    clearLastEstimation,
    isLoading: isEstimatingTokenUsage,
  } = useTokenUsageEstimation();
  const isPromptOptimizerEnabled = env().promptOptimizerEnabled;
  const isOptimizingPrompt = promptOptimizer.isPending;
  const [debouncedPrompt] = useDebounce(formData.prompt, 600);
  const [debouncedName] = useDebounce(formData.name, 600);
  const [debouncedDescription] = useDebounce(formData.description, 600);
  const fileIds = useMemo(
    () => formData.files.map((file) => file.id),
    [formData.files],
  );
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTokenEstimateRequestKeyRef = useRef<string | null>(null);
  /* eslint-disable lingui/no-unlocalized-strings */
  const insertTextCommand = "insertText";
  const inputEventName = "input";
  const insertReplacementInputType = "insertReplacementText";
  /* eslint-enable lingui/no-unlocalized-strings */

  // Validation
  const validateField = useCallback(
    (
      field: keyof AssistantFormData,
      value: string | ChatModel | null | FileUploadItem[] | string[],
    ): string => {
      switch (field) {
        case "name": {
          const nameValue = value as string;
          if (!nameValue || nameValue.trim().length === 0) {
            return t({
              id: "assistant.form.validation.name.required",
              message: "Name is required",
            });
          }
          if (nameValue.trim().length < 2) {
            return t({
              id: "assistant.form.validation.name.tooShort",
              message: "Name must be at least 2 characters",
            });
          }
          if (nameValue.length > 100) {
            return t({
              id: "assistant.form.validation.name.tooLong",
              message: "Name must be less than 100 characters",
            });
          }
          return "";
        }

        case "description": {
          const descValue = value as string;
          if (descValue && descValue.length > 500) {
            return t({
              id: "assistant.form.validation.description.tooLong",
              message: "Description must be less than 500 characters",
            });
          }
          return "";
        }

        case "prompt": {
          const promptValue = value as string;
          if (!promptValue || promptValue.trim().length === 0) {
            return t({
              id: "assistant.form.validation.prompt.required",
              message: "System prompt is required",
            });
          }
          if (promptValue.trim().length < 10) {
            return t({
              id: "assistant.form.validation.prompt.tooShort",
              message: "System prompt must be at least 10 characters",
            });
          }
          if (promptValue.length > 5000) {
            return t({
              id: "assistant.form.validation.prompt.tooLong",
              message: "System prompt must be less than 5000 characters",
            });
          }
          return "";
        }

        default:
          return "";
      }
    },
    [],
  );

  const validateForm = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof AssistantFormData, string>> = {};

    newErrors.name = validateField("name", formData.name);
    newErrors.description = validateField("description", formData.description);
    newErrors.prompt = validateField("prompt", formData.prompt);

    setErrors(newErrors);

    return !Object.values(newErrors).some((error) => error !== "");
  }, [formData, validateField]);

  // Field change handlers
  const handleFieldChange = useCallback(
    (
      field: keyof AssistantFormData,
      value: string | ChatModel | null | FileUploadItem[] | string[],
    ) => {
      setFormData((prev) => ({ ...prev, [field]: value }));

      // Validate on change if field has been touched
      if (touched[field]) {
        const error = validateField(field, value);
        setErrors((prev) => ({ ...prev, [field]: error }));
      }
    },
    [touched, validateField],
  );

  const handleFieldBlur = useCallback(
    (field: keyof AssistantFormData) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const error = validateField(field, formData[field]);
      setErrors((prev) => ({ ...prev, [field]: error }));
    },
    [formData, validateField],
  );

  // File handling
  const handleFilesUploaded = useCallback((files: FileUploadItem[]) => {
    setFormData((prev) => ({
      ...prev,
      files: [...prev.files, ...files],
    }));
  }, []);

  const handleFileRemove = useCallback((fileId: string) => {
    setFormData((prev) => ({
      ...prev,
      files: prev.files.filter((f) => f.id !== fileId),
    }));
  }, []);

  // Model selection
  const handleModelSelect = useCallback((model: ChatModel | null) => {
    setFormData((prev) => ({ ...prev, defaultModel: model }));
  }, []);

  const handleOptimizePrompt = useCallback(async () => {
    if (!formData.prompt.trim().length || isOptimizingPrompt) {
      return;
    }

    try {
      const response = await promptOptimizer.mutateAsync({
        body: { prompt: formData.prompt },
      });
      if (response.optimized_prompt) {
        const promptTextarea = promptTextareaRef.current;
        if (promptTextarea) {
          promptTextarea.focus();
          promptTextarea.select();
          const execCommandSucceeded =
            typeof document !== "undefined" &&
            typeof document.execCommand === "function" &&
            document.execCommand(
              insertTextCommand,
              false,
              response.optimized_prompt,
            );
          if (!execCommandSucceeded) {
            const existingValue = promptTextarea.value;
            promptTextarea.setRangeText(
              response.optimized_prompt,
              0,
              existingValue.length,
              "end",
            );
            const inputEvent =
              typeof InputEvent !== "undefined"
                ? new InputEvent(inputEventName, {
                    bubbles: true,
                    inputType: insertReplacementInputType,
                    data: response.optimized_prompt,
                  })
                : new Event(inputEventName, { bubbles: true });
            promptTextarea.dispatchEvent(inputEvent);
          }
          if (promptTextarea.value !== response.optimized_prompt) {
            handleFieldChange("prompt", response.optimized_prompt);
          }
        } else {
          handleFieldChange("prompt", response.optimized_prompt);
        }
      }
    } catch {
      // No-op: errors are handled by existing page-level error handling.
    }
  }, [formData.prompt, handleFieldChange, isOptimizingPrompt, promptOptimizer]);

  // Form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Mark all fields as touched
      setTouched({
        name: true,
        description: true,
        prompt: true,
        defaultModel: true,
        files: true,
        mcpServerIds: true,
      });

      // Validate
      if (!validateForm()) {
        return;
      }

      // Submit
      void onSubmit(formData);
    },
    [formData, onSubmit, validateForm],
  );

  const isFormValid =
    !Object.values(errors).some((error) => error !== "") &&
    formData.name.trim().length > 0 &&
    formData.prompt.trim().length > 0;
  const effectiveEstimation = tokenUsageEstimationOverride ?? lastEstimation;
  const showLiveEstimationSpinner =
    tokenUsageEstimationOverride == null && isEstimatingTokenUsage;
  const shouldShowEstimationPlaceholder =
    showLiveEstimationSpinner && fileIds.length > 0;
  const rawUsedContextPercentage =
    effectiveEstimation?.tokenUsage != null
      ? Math.max(
          0,
          Math.round(
            (effectiveEstimation.tokenUsage.stats.total_tokens /
              effectiveEstimation.tokenUsage.stats.max_tokens) *
              100,
          ),
        )
      : 0;
  const usedContextPercentage = Math.min(100, rawUsedContextPercentage);
  const remainingContextPercentage = Math.max(
    0,
    100 - rawUsedContextPercentage,
  );
  const isContextExceeded = rawUsedContextPercentage > 100;
  const biggestFileContributors = useMemo(() => {
    const tokenUsage = effectiveEstimation?.tokenUsage;
    if (!tokenUsage) {
      return [];
    }

    const maxTokens = tokenUsage.stats.max_tokens;
    if (maxTokens <= 0) {
      return [];
    }

    return tokenUsage.file_details
      .map((fileDetail) => {
        const percentage = (fileDetail.token_count / maxTokens) * 100;
        return {
          filename: fileDetail.filename,
          percentage,
        };
      })
      .filter((file) => file.percentage > 5)
      .sort((a, b) => b.percentage - a.percentage);
  }, [effectiveEstimation]);
  const showContextWarning =
    usedContextPercentage >= CONTEXT_WARNING_THRESHOLD * 100;

  useEffect(() => {
    if (
      isSubmitting ||
      disableLiveTokenUsageEstimation ||
      tokenUsageEstimationOverride != null
    ) {
      return;
    }

    const hasPrompt = debouncedPrompt.trim().length > 0;
    const hasFiles = fileIds.length > 0;
    const hasAdditionalText =
      debouncedName.trim().length > 0 || debouncedDescription.trim().length > 0;
    if (!hasPrompt && !hasFiles && !hasAdditionalText) {
      lastTokenEstimateRequestKeyRef.current = null;
      clearLastEstimation();
      return;
    }

    const requestBody: Record<string, unknown> = {
      new_chat: assistantId ? { assistant_id: assistantId } : {},
      system_prompt: debouncedPrompt,
    };

    const additionalContentParts = [
      debouncedName.trim(),
      debouncedDescription.trim(),
    ].filter((value) => value.length > 0);
    if (additionalContentParts.length > 0) {
      requestBody.new_message_content = additionalContentParts.join("\n");
    }
    if (fileIds.length > 0) {
      requestBody.file = { input_files_ids: fileIds };
    }
    if (formData.defaultModel?.chat_provider_id) {
      requestBody.chat_provider_id = formData.defaultModel.chat_provider_id;
    }

    const requestKey = JSON.stringify(requestBody);
    if (requestKey === lastTokenEstimateRequestKeyRef.current) {
      return;
    }
    lastTokenEstimateRequestKeyRef.current = requestKey;

    void estimateTokenUsageFromParts(requestBody);
  }, [
    assistantId,
    clearLastEstimation,
    debouncedDescription,
    debouncedName,
    debouncedPrompt,
    estimateTokenUsageFromParts,
    fileIds,
    formData.defaultModel?.chat_provider_id,
    isSubmitting,
    disableLiveTokenUsageEstimation,
    tokenUsageEstimationOverride,
  ]);

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="space-y-6">
        {/* Success message */}
        {successMessage && <Alert type="success">{successMessage}</Alert>}

        {/* Error message */}
        {errorMessage && <Alert type="error">{errorMessage}</Alert>}

        {/* Name field */}
        <FormField
          label={t`Name`}
          required
          error={touched.name ? errors.name : undefined}
          htmlFor="assistant-name"
        >
          <Input
            id="assistant-name"
            value={formData.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
            onBlur={() => handleFieldBlur("name")}
            placeholder={t`My Assistant`}
            error={touched.name ? errors.name : undefined}
            disabled={isSubmitting}
          />
        </FormField>

        {/* Description field */}
        <FormField
          label={t`Description`}
          error={touched.description ? errors.description : undefined}
          helpText={t({
            id: "assistant.form.description.helpText",
            message: "Optional: Describe what this assistant does",
          })}
          htmlFor="assistant-description"
        >
          <Textarea
            id="assistant-description"
            value={formData.description}
            onChange={(e) => handleFieldChange("description", e.target.value)}
            onBlur={() => handleFieldBlur("description")}
            placeholder={t({
              id: "assistant.form.description.placeholder",
              message: "This assistant helps with...",
            })}
            rows={3}
            error={touched.description ? errors.description : undefined}
            disabled={isSubmitting}
          />
        </FormField>

        {/* System Prompt field */}
        <FormField
          label={t`System Prompt`}
          required
          error={touched.prompt ? errors.prompt : undefined}
          helpText={t`Define how the assistant should behave and respond`}
          htmlFor="assistant-prompt"
          labelInlineAction={
            <InfoTooltip translationId="assistant.form.systemPrompt.tooltip" />
          }
          labelAction={
            isPromptOptimizerEnabled ? (
              <Button
                type="button"
                variant="icon-only"
                size="sm"
                icon={
                  isOptimizingPrompt ? (
                    <SpinnerIcon size="sm" />
                  ) : (
                    <MagicWand className="size-4" />
                  )
                }
                disabled={
                  isSubmitting ||
                  isOptimizingPrompt ||
                  formData.prompt.trim().length === 0
                }
                onClick={() => void handleOptimizePrompt()}
                aria-label={t({
                  id: "assistant.form.prompt-optimizer.tooltip",
                  message: "Optimize prompt",
                })}
                title={t({
                  id: "assistant.form.prompt-optimizer.tooltip",
                  message: "Optimize prompt",
                })}
              />
            ) : undefined
          }
        >
          <Textarea
            id="assistant-prompt"
            ref={promptTextareaRef}
            value={formData.prompt}
            onChange={(e) => handleFieldChange("prompt", e.target.value)}
            onBlur={() => handleFieldBlur("prompt")}
            placeholder={t({
              id: "assistant.form.prompt.placeholder",
              message: "You are a helpful assistant that...",
            })}
            rows={8}
            monospace
            error={touched.prompt ? errors.prompt : undefined}
            disabled={isSubmitting}
          />
        </FormField>
        {/* Model selection */}
        {availableModels.length > 0 && (
          <FormField
            label={t`Default Model`}
            helpText={t({
              id: "assistant.form.model.helpText",
              message:
                "Optional: Choose which model this assistant should use by default",
            })}
            htmlFor="assistant-model"
            labelInlineAction={
              <InfoTooltip translationId="assistant.form.defaultModel.tooltip" />
            }
          >
            <ModelSelector
              availableModels={availableModels}
              selectedModel={formData.defaultModel}
              onModelChange={handleModelSelect}
              disabled={isSubmitting}
            />
          </FormField>
        )}

        {/* File uploads */}
        <FormField
          label={t`Default Files`}
          helpText={t({
            id: "assistant.form.files.helpText",
            message:
              "Optional: Upload files from your computer or OneDrive that will be available to this assistant in every chat",
          })}
          htmlFor="assistant-files"
          labelInlineAction={
            <InfoTooltip translationId="assistant.form.defaultFiles.tooltip" />
          }
        >
          <div className="space-y-3">
            <AssistantFileUploadSelector
              onFilesUploaded={handleFilesUploaded}
              disabled={isSubmitting}
              maxFiles={5}
            />
            {formData.files.length > 0 && (
              <FileAttachmentsPreview
                attachedFiles={formData.files}
                maxFiles={5}
                onRemoveFile={handleFileRemove}
                onRemoveAllFiles={() =>
                  setFormData((prev) => ({ ...prev, files: [] }))
                }
                onFilePreview={openPreviewModal}
                showFileTypes
              />
            )}
          </div>
        </FormField>

        {/* Form actions */}
        <div className="border-t border-theme-border pt-5">
          {shouldShowEstimationPlaceholder ? (
            <div className="mb-4">
              <div className="rounded-md border border-theme-border bg-theme-bg-tertiary p-3 text-sm text-theme-fg-secondary">
                {t`Estimating token usage...`}
              </div>
            </div>
          ) : (
            effectiveEstimation &&
            showContextWarning && (
              <div className="mb-4">
                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-theme-fg-secondary">
                    <span>{t`Used context: ${usedContextPercentage}%`}</span>
                    <span>{t`Remaining context: ${remainingContextPercentage}%`}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-theme-bg-tertiary">
                    <div
                      className="h-full rounded-full bg-theme-warning-fg transition-all"
                      style={{ width: `${usedContextPercentage}%` }}
                      role="progressbar"
                      aria-label={t`Context usage`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={usedContextPercentage}
                    />
                  </div>
                </div>
                <Alert
                  type={isContextExceeded ? "error" : "warning"}
                  className="mb-0"
                >
                  {isContextExceeded
                    ? t`Context usage exceeds model capacity. The assistant can't be created like this.`
                    : t`Using this much context may limit the chat session and reduce room for uploading additional files.`}
                  {biggestFileContributors.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 font-medium">
                        {t`Largest file context contributors:`}
                      </p>
                      <ul className="list-inside list-disc">
                        {biggestFileContributors.map((file) => {
                          const fileName = file.filename;
                          const filePercentage = file.percentage.toFixed(1);
                          return (
                            <li key={`${file.filename}-${file.percentage}`}>
                              {t`${fileName}: ${filePercentage}%`}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </Alert>
              </div>
            )
          )}
          <div className="flex justify-end gap-3">
            {onCancel && (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {t`Cancel`}
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={!isFormValid || isSubmitting || isContextExceeded}
            >
              {isSubmitting
                ? t`Saving...`
                : mode === "create"
                  ? t`Create Assistant`
                  : t({
                      id: "assistant.form.button.save",
                      message: "Save Changes",
                    })}
            </Button>
          </div>
        </div>
      </div>

      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={closePreviewModal}
        file={fileToPreview}
      />
    </form>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantForm.displayName = "AssistantForm";
