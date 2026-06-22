import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FormField, Input, Textarea } from "@/components/ui/Input";
import { SubjectSelector } from "@/components/ui/Sharing/SubjectSelector";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantStoreConfig,
  useGetAssistant,
  useListMyAssistantStoreVersions,
  usePreviewAssistantStoreSubmissionDiff,
  useSubmitAssistantStoreVersion,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { AssistantStoreDiff } from "./assistantStoreUtils";

import type {
  AssistantStoreAudienceGrantInput,
  AssistantStoreSubmissionRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

const toKeywordList = (value: string) =>
  value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

const toAudienceGrantInput = (
  subject: OrganizationMember,
): AssistantStoreAudienceGrantInput => ({
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API discriminator values
  subject_type: subject.type === "user" ? "user" : "organization_group",
  subject_id_type: subject.subject_type_id,
  subject_id: subject.id,
  role: "viewer",
});

const incrementVersionNumber = (versionNumber: string) => {
  const trimmedVersionNumber = versionNumber.trim();
  const singleNumberMatch = /^(\d+)$/.exec(trimmedVersionNumber);
  if (singleNumberMatch) {
    return `${Number(singleNumberMatch[1]) + 1}`;
  }

  const semverMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmedVersionNumber);
  if (semverMatch) {
    const major = Number(semverMatch[1]);
    const minor = Number(semverMatch[2]);
    return `${major}.${minor + 1}.0`;
  }

  return "1.0.0";
};

const suggestNextVersionNumber = (
  baseVersionNumber: string | undefined,
  existingVersionNumbers: string[],
) => {
  const existing = new Set(
    existingVersionNumbers.map((versionNumber) => versionNumber.trim()),
  );
  let candidate = baseVersionNumber
    ? incrementVersionNumber(baseVersionNumber)
    : "1.0.0";

  while (existing.has(candidate)) {
    candidate = incrementVersionNumber(candidate);
  }

  return candidate;
};

export default function AssistantStoreSubmitPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sourceAssistantId } = useParams<{ sourceAssistantId: string }>();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config, isLoading: isLoadingConfig } = useAssistantStoreConfig(
    {},
  );
  const {
    data: assistant,
    isLoading: isLoadingAssistant,
    error: assistantError,
  } = useGetAssistant(
    sourceAssistantId
      ? { pathParams: { assistantId: sourceAssistantId } }
      : skipToken,
  );
  const { data: myVersions, isLoading: isLoadingMyVersions } =
    useListMyAssistantStoreVersions(sourceAssistantId ? {} : skipToken);
  const previewDiff = usePreviewAssistantStoreSubmissionDiff();
  const submitVersion = useSubmitAssistantStoreVersion();
  const [longDescription, setLongDescription] = useState("");
  const [versionNumber, setVersionNumber] = useState("");
  const [versionComment, setVersionComment] = useState("");
  const [creatorReviewComment, setCreatorReviewComment] = useState("");
  const [keywords, setKeywords] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [selectedAudience, setSelectedAudience] = useState<
    OrganizationMember[]
  >([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [prefilledFromVersionId, setPrefilledFromVersionId] = useState<
    string | null
  >(null);
  const [
    prefilledVersionNumberForSourceId,
    setPrefilledVersionNumberForSourceId,
  ] = useState<string | null>(null);

  const sourceVersions = useMemo(() => {
    if (!sourceAssistantId || !myVersions) return undefined;

    return [...myVersions.versions]
      .filter((version) => version.source_assistant_id === sourceAssistantId)
      .sort(
        (left, right) =>
          new Date(right.submitted_at).getTime() -
          new Date(left.submitted_at).getTime(),
      );
  }, [myVersions, sourceAssistantId]);
  const latestSubmittedVersion = sourceVersions?.[0];
  const currentPublishedVersion = useMemo(() => {
    return sourceVersions?.find(
      (version) => version.is_published && version.is_current_published_version,
    );
  }, [sourceVersions]);
  const latestPublishedVersion = useMemo(() => {
    return [...(sourceVersions ?? [])]
      .filter((version) => version.is_published)
      .sort((left, right) => {
        const leftTime = left.published_at
          ? new Date(left.published_at).getTime()
          : new Date(left.submitted_at).getTime();
        const rightTime = right.published_at
          ? new Date(right.published_at).getTime()
          : new Date(right.submitted_at).getTime();

        return rightTime - leftTime;
      })
      .at(0);
  }, [sourceVersions]);
  const suggestedVersionNumber = useMemo(
    () =>
      suggestNextVersionNumber(
        currentPublishedVersion?.version_number ??
          latestPublishedVersion?.version_number ??
          latestSubmittedVersion?.version_number,
        sourceVersions?.map((version) => version.version_number) ?? [],
      ),
    [
      currentPublishedVersion?.version_number,
      latestPublishedVersion?.version_number,
      latestSubmittedVersion?.version_number,
      sourceVersions,
    ],
  );
  const versionNumberHelpText = currentPublishedVersion
    ? `${t({
        id: "assistantStore.submit.currentPublishedVersion",
        message: "Current published version:",
      })} ${currentPublishedVersion.version_number}`
    : latestPublishedVersion
      ? `${t({
          id: "assistantStore.submit.latestPublishedVersion",
          message:
            "No current published version is selected. Latest published version:",
        })} ${latestPublishedVersion.version_number}`
      : t({
          id: "assistantStore.submit.noPublishedVersion",
          message: "No published version exists for this assistant yet.",
        });

  useEffect(() => {
    document.title = `${t({
      id: "assistantStore.submit.title",
      message: "Submit to Store",
    })} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  useEffect(() => {
    if (assistant && longDescription.length === 0) {
      setLongDescription(assistant.description ?? "");
    }
  }, [assistant, longDescription.length]);

  useEffect(() => {
    if (!latestSubmittedVersion || prefilledFromVersionId !== null) {
      return;
    }

    setLongDescription(latestSubmittedVersion.long_description);
    setKeywords(latestSubmittedVersion.keywords.join(", "));
    setCategoryIds([...latestSubmittedVersion.category_ids]);
    setPrefilledFromVersionId(latestSubmittedVersion.version_id);
  }, [latestSubmittedVersion, prefilledFromVersionId]);

  useEffect(() => {
    if (
      isLoadingMyVersions ||
      !sourceVersions ||
      !sourceAssistantId ||
      prefilledVersionNumberForSourceId === sourceAssistantId
    ) {
      return;
    }

    setVersionNumber(suggestedVersionNumber);
    setPrefilledVersionNumberForSourceId(sourceAssistantId);
  }, [
    prefilledVersionNumberForSourceId,
    isLoadingMyVersions,
    sourceAssistantId,
    sourceVersions,
    suggestedVersionNumber,
  ]);

  const requestBody = useMemo<AssistantStoreSubmissionRequest>(() => {
    const trimmedVersionComment = versionComment.trim();
    const trimmedCreatorReviewComment = creatorReviewComment.trim();

    return {
      long_description: longDescription,
      version_number: versionNumber,
      version_comment:
        trimmedVersionComment.length > 0 ? trimmedVersionComment : null,
      creator_review_comment:
        trimmedCreatorReviewComment.length > 0
          ? trimmedCreatorReviewComment
          : null,
      category_ids: categoryIds,
      keywords: toKeywordList(keywords),
      audience_grants: selectedAudience.map(toAudienceGrantInput),
    };
  }, [
    categoryIds,
    creatorReviewComment,
    keywords,
    longDescription,
    selectedAudience,
    versionComment,
    versionNumber,
  ]);

  const toggleCategory = (categoryId: string) => {
    setCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const toggleAudienceSubject = (subject: OrganizationMember) => {
    setSelectedAudience((current) =>
      current.some((item) => item.id === subject.id)
        ? current.filter((item) => item.id !== subject.id)
        : [...current, subject],
    );
  };

  const validate = () => {
    if (longDescription.trim().length === 0) {
      return t({
        id: "assistantStore.submit.validation.description",
        message: "Add a store description before submitting.",
      });
    }
    if (versionNumber.trim().length === 0) {
      return t({
        id: "assistantStore.submit.validation.version",
        message: "Add a version number before submitting.",
      });
    }
    if (categoryIds.length === 0) {
      return t({
        id: "assistantStore.submit.validation.category",
        message: "Select at least one store category.",
      });
    }
    return "";
  };

  const handlePreview = async () => {
    if (!sourceAssistantId) return;
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage("");
    await previewDiff.mutateAsync({
      pathParams: { sourceAssistantId },
      body: requestBody,
    });
  };

  const handleSubmit = async () => {
    if (!sourceAssistantId) return;
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage("");
    await submitVersion.mutateAsync({
      pathParams: { sourceAssistantId },
      body: requestBody,
    });
    await queryClient.invalidateQueries();
    navigate("/assistant-store/my");
  };

  const isLoading =
    isLoadingConfig || isLoadingAssistant || isLoadingMyVersions;

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      <PageHeader
        title={t({
          id: "assistantStore.submit.title",
          message: "Submit to Store",
        })}
        subtitle={t({
          id: "assistantStore.submit.subtitle",
          message:
            "Create an immutable reviewed version from the current assistant draft",
        })}
      />

      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.submit.loading",
                    message: "Loading assistant...",
                  })}
                </p>
              </div>
            </div>
          )}

          {assistantError && (
            <Alert type="error">
              {t({
                id: "assistantStore.submit.error.load",
                message: "Failed to load assistant.",
              })}
            </Alert>
          )}

          {config && !config.enabled && (
            <Alert type="info">
              {t({
                id: "assistantStore.disabled",
                message: "The assistant store is not enabled.",
              })}
            </Alert>
          )}

          {errorMessage && <Alert type="error">{errorMessage}</Alert>}
          {previewDiff.error && (
            <Alert type="error">
              {t({
                id: "assistantStore.submit.error.preview",
                message: "Failed to preview the submission diff.",
              })}
            </Alert>
          )}
          {submitVersion.error && (
            <Alert type="error">
              {t({
                id: "assistantStore.submit.error.submit",
                message: "Failed to submit the assistant version.",
              })}
            </Alert>
          )}

          {!isLoading && assistant && config?.enabled && (
            <>
              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <h2 className="mb-2 text-lg font-semibold text-theme-fg-primary">
                  {assistant.name}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.submit.snapshotNotice",
                    message:
                      "Submission clones the assistant into an immutable snapshot. Future edits to the draft assistant will not change this store version.",
                  })}
                </p>
              </section>

              <section className="space-y-5 rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <FormField
                  label={t({
                    id: "assistantStore.submit.description",
                    message: "Store description",
                  })}
                  htmlFor="assistant-store-long-description"
                  required
                >
                  <Textarea
                    id="assistant-store-long-description"
                    value={longDescription}
                    rows={5}
                    onChange={(event) => setLongDescription(event.target.value)}
                  />
                </FormField>

                <div className="grid gap-5 md:grid-cols-2">
                  <FormField
                    label={t({
                      id: "assistantStore.submit.versionNumber",
                      message: "Version number",
                    })}
                    htmlFor="assistant-store-version-number"
                    required
                  >
                    <Input
                      id="assistant-store-version-number"
                      aria-describedby="assistant-store-version-number-help"
                      value={versionNumber}
                      onChange={(event) => setVersionNumber(event.target.value)}
                    />
                    <p
                      id="assistant-store-version-number-help"
                      className="mt-2 text-sm text-theme-fg-secondary"
                    >
                      {versionNumberHelpText}
                    </p>
                  </FormField>
                  <FormField
                    label={t({
                      id: "assistantStore.submit.keywords",
                      message: "Keywords",
                    })}
                    htmlFor="assistant-store-keywords"
                    helpText={t({
                      id: "assistantStore.submit.keywordsHelp",
                      message: "Separate keywords with commas.",
                    })}
                  >
                    <Input
                      id="assistant-store-keywords"
                      value={keywords}
                      onChange={(event) => setKeywords(event.target.value)}
                    />
                  </FormField>
                </div>

                <div>
                  <div className="mb-2 text-base font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantStore.submit.categories",
                      message: "Categories",
                    })}
                    <span className="ml-1 text-theme-error-fg">*</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {config.categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={clsx(
                          "focus-ring theme-transition rounded border px-3 py-2 text-sm",
                          categoryIds.includes(category.id)
                            ? "border-theme-border-focus bg-theme-bg-selected text-theme-fg-primary"
                            : "border-theme-border bg-theme-bg-secondary text-theme-fg-secondary hover:bg-theme-bg-hover",
                        )}
                        onClick={() => toggleCategory(category.id)}
                      >
                        {category.display_name}
                      </button>
                    ))}
                  </div>
                </div>

                <FormField
                  label={t({
                    id: "assistantStore.submit.versionComment",
                    message: "Version comment",
                  })}
                  htmlFor="assistant-store-version-comment"
                >
                  <Textarea
                    id="assistant-store-version-comment"
                    value={versionComment}
                    rows={3}
                    onChange={(event) => setVersionComment(event.target.value)}
                  />
                </FormField>

                <FormField
                  label={t({
                    id: "assistantStore.submit.reviewComment",
                    message: "Note for reviewer",
                  })}
                  htmlFor="assistant-store-review-comment"
                >
                  <Textarea
                    id="assistant-store-review-comment"
                    value={creatorReviewComment}
                    rows={3}
                    onChange={(event) =>
                      setCreatorReviewComment(event.target.value)
                    }
                  />
                </FormField>
              </section>

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <h2 className="mb-2 text-lg font-semibold text-theme-fg-primary">
                  {t({
                    id: "assistantStore.submit.audience",
                    message: "Store audience",
                  })}
                </h2>
                <p className="mb-4 text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.submit.audienceHelp",
                    message:
                      "These share grants are attached to this store version and become effective only when the accepted version is published.",
                  })}
                </p>
                <SubjectSelector
                  selectedIds={selectedAudience.map((subject) => subject.id)}
                  onToggleSubject={toggleAudienceSubject}
                />
              </section>

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantStore.submit.diffPreview",
                      message: "Diff preview",
                    })}
                  </h2>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={previewDiff.isPending}
                    onClick={() => {
                      void handlePreview();
                    }}
                  >
                    {t({
                      id: "assistantStore.submit.preview",
                      message: "Preview changes",
                    })}
                  </Button>
                </div>
                {previewDiff.data ? (
                  <AssistantStoreDiff
                    diffSummary={previewDiff.data.diff_summary}
                  />
                ) : (
                  <p className="text-sm text-theme-fg-secondary">
                    {t({
                      id: "assistantStore.submit.previewEmpty",
                      message:
                        "Preview the submission to compare it with the previous accepted version.",
                    })}
                  </p>
                )}
              </section>

              <div className="flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => navigate("/assistants")}
                >
                  {t({ id: "common.cancel", message: "Cancel" })}
                </Button>
                <Button
                  variant="primary"
                  loading={submitVersion.isPending}
                  onClick={() => {
                    void handleSubmit();
                  }}
                >
                  {t({
                    id: "assistantStore.submit.submit",
                    message: "Submit version",
                  })}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
