import { t } from "@lingui/core/macro";
import { useState, useCallback } from "react";

import { ModelSelector } from "@/components/ui/Chat/ModelSelector";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import {
  FileAttachmentsPreview,
  AssistantFileUploadSelector,
} from "@/components/ui/FileUpload";
import { FormField } from "@/components/ui/Input/FormField";
import { Input } from "@/components/ui/Input/Input";
import { Textarea } from "@/components/ui/Input/Textarea";

import type {
  ChatModel,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

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
            return t`Name is required`;
          }
          if (nameValue.trim().length < 2) {
            return t`Name must be at least 2 characters`;
          }
          if (nameValue.length > 100) {
            return t`Name must be less than 100 characters`;
          }
          return "";
        }

        case "description": {
          const descValue = value as string;
          if (descValue && descValue.length > 500) {
            return t`Description must be less than 500 characters`;
          }
          return "";
        }

        case "prompt": {
          const promptValue = value as string;
          if (!promptValue || promptValue.trim().length === 0) {
            return t`System prompt is required`;
          }
          if (promptValue.trim().length < 10) {
            return t`System prompt must be at least 10 characters`;
          }
          if (promptValue.length > 5000) {
            return t`System prompt must be less than 5000 characters`;
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

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="space-y-5">
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
          helpText={t`Optional: Describe what this assistant does`}
          htmlFor="assistant-description"
        >
          <Textarea
            id="assistant-description"
            value={formData.description}
            onChange={(e) => handleFieldChange("description", e.target.value)}
            onBlur={() => handleFieldBlur("description")}
            placeholder={t`This assistant helps with...`}
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
        >
          <Textarea
            id="assistant-prompt"
            value={formData.prompt}
            onChange={(e) => handleFieldChange("prompt", e.target.value)}
            onBlur={() => handleFieldBlur("prompt")}
            placeholder={t`You are a helpful assistant that...`}
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
            helpText={t`Optional: Choose which model this assistant should use by default`}
            htmlFor="assistant-model"
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
          helpText={t`Optional: Upload files from your computer or OneDrive that will be available to this assistant in every chat`}
          htmlFor="assistant-files"
        >
          <div className="space-y-3">
            <AssistantFileUploadSelector
              onFilesUploaded={handleFilesUploaded}
              disabled={isSubmitting}
              acceptedFileTypes={[
                "pdf",
                "document",
                "text",
                "spreadsheet",
                "image",
              ]}
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
                showFileTypes
              />
            )}
          </div>
        </FormField>

        {/* Form actions */}
        <div className="flex justify-end gap-3 border-t border-theme-border pt-5">
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
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting
              ? t`Saving...`
              : mode === "create"
                ? t`Create Assistant`
                : t`Save Changes`}
          </Button>
        </div>
      </div>
    </form>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantForm.displayName = "AssistantForm";
