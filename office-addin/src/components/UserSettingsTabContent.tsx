import {
  Alert,
  Button,
  FormField,
  Input,
  Textarea,
  fetchUpdateProfilePreferences,
  profileQuery,
  useProfile,
  type UpdateProfilePreferencesRequest,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

interface UserSettingsTabContentProps {
  onClose: () => void;
}

const toNullableValue = (value: string) => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export function UserSettingsTabContent({ onClose }: UserSettingsTabContentProps) {
  const { profile } = useProfile();
  const queryClient = useQueryClient();

  const [nickname, setNickname] = useState(profile?.preference_nickname ?? "");
  const [jobTitle, setJobTitle] = useState(profile?.preference_job_title ?? "");
  const [customInstructions, setCustomInstructions] = useState(
    profile?.preference_assistant_custom_instructions ?? "",
  );
  const [additionalInformation, setAdditionalInformation] = useState(
    profile?.preference_assistant_additional_information ?? "",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges = useMemo(
    () =>
      nickname !== (profile?.preference_nickname ?? "") ||
      jobTitle !== (profile?.preference_job_title ?? "") ||
      customInstructions !==
        (profile?.preference_assistant_custom_instructions ?? "") ||
      additionalInformation !==
        (profile?.preference_assistant_additional_information ?? ""),
    [additionalInformation, customInstructions, jobTitle, nickname, profile],
  );

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      // The generated schema currently drops the string branch for these optional patch fields.
      const requestBody = {
        preference_nickname: toNullableValue(nickname),
        preference_job_title: toNullableValue(jobTitle),
        preference_assistant_custom_instructions:
          toNullableValue(customInstructions),
        preference_assistant_additional_information: toNullableValue(
          additionalInformation,
        ),
      } as unknown as UpdateProfilePreferencesRequest;

      await fetchUpdateProfilePreferences({ body: requestBody });
      await queryClient.invalidateQueries({
        queryKey: profileQuery({}).queryKey,
      });
      onClose();
    } catch {
      setSaveError(
        t({
          id: "officeAddin.settings.user.save.error",
          message: "Could not save preferences. Please try again.",
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {saveError ? <Alert type="error">{saveError}</Alert> : null}

        <FormField
          label={t({
            id: "officeAddin.settings.user.nickname.label",
            message: "Nickname",
          })}
          htmlFor="addin-settings-nickname"
        >
          <Input
            id="addin-settings-nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder={t({
              id: "officeAddin.settings.user.nickname.placeholder",
              message:
                "What should the assistant call you? e.g. Max Mustermann",
            })}
          />
        </FormField>

        <FormField
          label={t({
            id: "officeAddin.settings.user.jobTitle.label",
            message: "Job title",
          })}
          htmlFor="addin-settings-job-title"
        >
          <Input
            id="addin-settings-job-title"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder={t({
              id: "officeAddin.settings.user.jobTitle.placeholder",
              message: "What is your role? e.g. Product Manager",
            })}
          />
        </FormField>

        <FormField
          label={t({
            id: "officeAddin.settings.user.customInstructions.label",
            message: "Custom instructions for the assistant",
          })}
          htmlFor="addin-settings-custom-instructions"
        >
          <Textarea
            id="addin-settings-custom-instructions"
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value)}
            rows={4}
            autoResize={true}
            placeholder={t({
              id: "officeAddin.settings.user.customInstructions.placeholder",
              message:
                "How should the assistant behave? e.g. Prefer concise bullet points",
            })}
          />
        </FormField>

        <FormField
          label={t({
            id: "officeAddin.settings.user.additionalInformation.label",
            message: "Additional information",
          })}
          htmlFor="addin-settings-additional-information"
        >
          <Textarea
            id="addin-settings-additional-information"
            value={additionalInformation}
            onChange={(event) => setAdditionalInformation(event.target.value)}
            rows={4}
            autoResize={true}
            placeholder={t({
              id: "officeAddin.settings.user.additionalInformation.placeholder",
              message:
                "Any extra context for the assistant, e.g. I work with enterprise customers",
            })}
          />
        </FormField>
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-theme-border pt-3">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={isSaving}
          type="button"
        >
          {t({
            id: "officeAddin.settings.user.actions.cancel",
            message: "Cancel",
          })}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving || !hasChanges}
          type="button"
        >
          {isSaving
            ? t({
                id: "officeAddin.settings.user.actions.saving",
                message: "Saving...",
              })
            : t({
                id: "officeAddin.settings.user.actions.save",
                message: "Save",
              })}
        </Button>
      </div>
    </div>
  );
}
