import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Card } from "@/components/ui/Container/Card";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import {
  FormField,
  Input,
  MarkdownPreviewInput,
  Textarea,
} from "@/components/ui/Input";
import { SubjectSelector } from "@/components/ui/Sharing/SubjectSelector";
import { toast } from "@/components/ui/Toast";
import { usePageErrorToast } from "@/components/ui/Toast/usePageErrorToast";
import { usePageAlignment } from "@/hooks/ui";
import {
  listMyAssistantHubVersionsQuery,
  listReviewAssistantHubVersionsQuery,
  useAssistantHubConfig,
  useGetAssistant,
  useListMyAssistantHubVersions,
  useListShareGrants,
  usePreviewAssistantHubSubmissionDiff,
  useSubmitAssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  ORGANIZATION_SUBJECT_ID,
  ORGANIZATION_SUBJECT_ID_TYPE,
  type OrganizationMember,
} from "@/types/sharing";

import {
  ASSISTANT_HUB_CATEGORY_IDS_DIFF_FIELD,
  AssistantHubDiff,
} from "./assistantHubUtils";

import type {
  AssistantHubAudienceGrantInput,
  AssistantHubSubmissionRequest,
  AssistantHubVersionsResponse,
  ShareGrant,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Error toasts stay until dismissed, so the next attempt has to replace them. */
const SUBMIT_TOAST_KEY = "assistant-hub-submit";

const toKeywordList = (value: string) =>
  value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

const toAudienceGrantInput = (
  subject: OrganizationMember & { shareRole?: string },
): AssistantHubAudienceGrantInput => ({
  subject_type:
    subject.type === "user"
      ? "user"
      : subject.type === "organization"
        ? "organization"
        : // eslint-disable-next-line lingui/no-unlocalized-strings -- API discriminator value
          "organization_group",
  subject_id_type: subject.subject_type_id,
  subject_id: subject.id,
  role: subject.shareRole ?? "viewer",
});

type AudienceSubject = OrganizationMember & { shareRole?: string };

const toAudienceSubject = (grant: ShareGrant): AudienceSubject => {
  if (grant.subject_type === "organization") {
    return {
      id: ORGANIZATION_SUBJECT_ID,
      display_name: t({
        id: "sharing.target.fullOrganization",
        message: "Full organization",
      }),
      subject_type_id: ORGANIZATION_SUBJECT_ID_TYPE,
      type: "organization",
      shareRole: grant.role,
    };
  }

  if (grant.subject_type === "organization_group") {
    return {
      id: grant.subject_id,
      display_name: grant.group_profile?.display_name ?? grant.subject_id,
      subject_type_id: grant.subject_id_type,
      type: "group",
      shareRole: grant.role,
    };
  }

  return {
    id: grant.subject_id,
    display_name: grant.user_profile?.display_name ?? grant.subject_id,
    subject_type_id: grant.subject_id_type,
    type: "user",
    shareRole: grant.role,
  };
};

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

const parseStrictVersion = (label: string) => {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(
    label,
  );
  if (match?.[0] !== label) return undefined;

  return {
    label,
    components: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])] as const,
  };
};

type StrictVersion = NonNullable<ReturnType<typeof parseStrictVersion>>;

const compareVersions = (left: StrictVersion, right: StrictVersion) => {
  for (const [index, component] of left.components.entries()) {
    const other = right.components[index];
    if (component < other) return -1;
    if (component > other) return 1;
  }
  return 0;
};

export default function AssistantHubSubmitPage() {
  const showError = usePageErrorToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sourceAssistantId } = useParams<{ sourceAssistantId: string }>();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config, isLoading: isLoadingConfig } = useAssistantHubConfig(
    {},
  );
  const forceWholeOrganizationAudience =
    config?.force_whole_organization_audience ?? false;
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
    useListMyAssistantHubVersions(sourceAssistantId ? {} : skipToken);
  const previewDiff = usePreviewAssistantHubSubmissionDiff();
  const submitVersion = useSubmitAssistantHubVersion();
  const [longDescription, setLongDescription] = useState("");
  const [versionNumber, setVersionNumber] = useState("");
  const [versionFieldTouched, setVersionFieldTouched] = useState(false);
  const [rejectedVersionNumber, setRejectedVersionNumber] = useState<string>();
  const [serverVersion, setServerVersion] = useState<{
    sourceAssistantId: string;
    version: StrictVersion;
  }>();
  const [versionComment, setVersionComment] = useState("");
  const [creatorReviewComment, setCreatorReviewComment] = useState("");
  const [keywords, setKeywords] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [selectedAudience, setSelectedAudience] = useState<AudienceSubject[]>(
    [],
  );
  const [prefilledFromVersionId, setPrefilledFromVersionId] = useState<
    string | null
  >(null);
  const [
    prefilledVersionNumberForSourceId,
    setPrefilledVersionNumberForSourceId,
  ] = useState<string | null>(null);
  const [prefilledAudienceForVersionId, setPrefilledAudienceForVersionId] =
    useState<string | null>(null);

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
  const { data: previousShareGrants, isLoading: isLoadingPreviousShareGrants } =
    useListShareGrants(
      config?.enabled &&
        !forceWholeOrganizationAudience &&
        latestSubmittedVersion
        ? {
            queryParams: {
              resource_type: "assistant",
              resource_id: latestSubmittedVersion.assistant_id,
            },
          }
        : skipToken,
    );
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
  const serverHighestVersion =
    serverVersion?.sourceAssistantId === sourceAssistantId
      ? serverVersion?.version
      : undefined;
  const strictVersionValidation =
    config?.validate_version_semver_format === true ||
    serverHighestVersion !== undefined ||
    rejectedVersionNumber !== undefined;
  const highestVersion = useMemo(() => {
    if (!strictVersionValidation) return undefined;

    let highest = serverHighestVersion;
    for (const { version_number } of sourceVersions ?? []) {
      const version = parseStrictVersion(version_number);
      if (version && (!highest || compareVersions(version, highest) > 0)) {
        highest = version;
      }
    }
    return highest;
  }, [strictVersionValidation, sourceVersions, serverHighestVersion]);
  const suggestedVersionNumber = useMemo(
    () =>
      strictVersionValidation
        ? highestVersion
          ? `${highestVersion.components[0]}.${highestVersion.components[1]}.${highestVersion.components[2] + BigInt(1)}`
          : "1.0.0"
        : suggestNextVersionNumber(
            currentPublishedVersion?.version_number ??
              latestPublishedVersion?.version_number ??
              latestSubmittedVersion?.version_number,
            sourceVersions?.map((version) => version.version_number) ?? [],
          ),
    [
      currentPublishedVersion?.version_number,
      highestVersion,
      latestPublishedVersion?.version_number,
      latestSubmittedVersion?.version_number,
      sourceVersions,
      strictVersionValidation,
    ],
  );
  const versionNumberHelpText = currentPublishedVersion
    ? `${t({
        id: "assistantHub.submit.currentPublishedVersion",
        message: "Current published version:",
      })} ${currentPublishedVersion.version_number}`
    : latestPublishedVersion
      ? `${t({
          id: "assistantHub.submit.latestPublishedVersion",
          message:
            "No current published version is selected. Latest published version:",
        })} ${latestPublishedVersion.version_number}`
      : t({
          id: "assistantHub.submit.noPublishedVersion",
          message: "No published version exists for this assistant yet.",
        });
  const versionFormatHelp = strictVersionValidation
    ? t({
        id: "assistantHub.submit.versionFormatHelp",
        message:
          "Use MAJOR.MINOR.PATCH format, for example 1.0.0, with no leading zeros.",
      })
    : "";
  let versionError = "";
  if (strictVersionValidation) {
    // Unicode White_Space matches the server's str::trim.
    const enteredVersion = parseStrictVersion(
      versionNumber.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, ""),
    );
    if (!enteredVersion || rejectedVersionNumber === versionNumber) {
      versionError = t({
        id: "assistantHub.submit.validation.versionFormat",
        message: "Enter a version in MAJOR.MINOR.PATCH format.",
      });
    } else if (
      highestVersion &&
      compareVersions(enteredVersion, highestVersion) <= 0
    ) {
      versionError = i18n._({
        id: "assistantHub.submit.validation.versionNotIncreasing",
        message: "Enter a version greater than {version}.",
        values: { version: highestVersion.label },
      });
    }
  }
  const versionFieldError =
    versionNumber || versionFieldTouched ? versionError : "";

  useEffect(() => {
    document.title = `${t({
      id: "assistantHub.submit.title",
      message: "Submit to Hub",
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
      !config ||
      forceWholeOrganizationAudience ||
      isLoadingMyVersions ||
      prefilledAudienceForVersionId !== null
    ) {
      return;
    }

    if (latestSubmittedVersion) {
      if (isLoadingPreviousShareGrants || !previousShareGrants) {
        return;
      }

      setSelectedAudience(previousShareGrants.grants.map(toAudienceSubject));
      setPrefilledAudienceForVersionId(latestSubmittedVersion.version_id);
      return;
    }

    setSelectedAudience(
      config.default_share_with_whole_organization
        ? [
            {
              id: ORGANIZATION_SUBJECT_ID,
              display_name: t({
                id: "sharing.target.fullOrganization",
                message: "Full organization",
              }),
              subject_type_id: ORGANIZATION_SUBJECT_ID_TYPE,
              type: "organization",
            },
          ]
        : [],
    );
    setPrefilledAudienceForVersionId("new");
  }, [
    config,
    forceWholeOrganizationAudience,
    isLoadingMyVersions,
    isLoadingPreviousShareGrants,
    latestSubmittedVersion,
    prefilledAudienceForVersionId,
    previousShareGrants,
  ]);

  useEffect(() => {
    if (
      !config ||
      isLoadingMyVersions ||
      !sourceVersions ||
      !sourceAssistantId ||
      prefilledVersionNumberForSourceId === sourceAssistantId
    ) {
      return;
    }

    setVersionNumber(suggestedVersionNumber);
    setRejectedVersionNumber(undefined);
    setVersionFieldTouched(false);
    setPrefilledVersionNumberForSourceId(sourceAssistantId);
  }, [
    config,
    prefilledVersionNumberForSourceId,
    isLoadingMyVersions,
    sourceAssistantId,
    sourceVersions,
    suggestedVersionNumber,
  ]);

  const requestBody = useMemo<AssistantHubSubmissionRequest>(() => {
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
      audience_grants: forceWholeOrganizationAudience
        ? undefined
        : selectedAudience.map(toAudienceGrantInput),
    };
  }, [
    categoryIds,
    creatorReviewComment,
    forceWholeOrganizationAudience,
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
        : [...current, { ...subject, shareRole: "viewer" }],
    );
  };

  const handleVersionError = (error: unknown) => {
    if (typeof error !== "object" || !error || !("code" in error)) {
      return false;
    }
    if (error.code === "invalid_version_format") {
      setRejectedVersionNumber(versionNumber);
      return true;
    }
    if (
      error.code === "version_not_increasing" &&
      "current_version" in error &&
      typeof error.current_version === "string" &&
      sourceAssistantId
    ) {
      const version = parseStrictVersion(error.current_version);
      if (version) {
        setServerVersion({ sourceAssistantId, version });
        return true;
      }
    }
    return false;
  };

  const validate = () => {
    if (longDescription.trim().length === 0) {
      return t({
        id: "assistantHub.submit.validation.description",
        message: "Add a hub description before submitting.",
      });
    }
    if (versionNumber.trim().length === 0) {
      return t({
        id: "assistantHub.submit.validation.version",
        message: "Add a version number before submitting.",
      });
    }
    if (config?.enable_categories && categoryIds.length === 0) {
      return t({
        id: "assistantHub.submit.validation.category",
        message: "Select at least one hub category.",
      });
    }
    return "";
  };

  const handlePreview = async () => {
    if (!sourceAssistantId) return;
    toast.dismissKey(SUBMIT_TOAST_KEY);
    setVersionFieldTouched(true);
    if (versionError) return;
    const validationError = validate();
    if (validationError) {
      showError({ dedupeKey: SUBMIT_TOAST_KEY, title: validationError });
      return;
    }
    try {
      await previewDiff.mutateAsync({
        pathParams: { sourceAssistantId },
        body: requestBody,
      });
    } catch (error) {
      if (handleVersionError(error)) return;
      showError({
        dedupeKey: SUBMIT_TOAST_KEY,
        title: t({
          id: "assistantHub.submit.error.preview",
          message: "Failed to preview the submission diff.",
        }),
      });
    }
  };

  const handleSubmit = async () => {
    if (!sourceAssistantId) return;
    toast.dismissKey(SUBMIT_TOAST_KEY);
    setVersionFieldTouched(true);
    if (versionError) return;
    const validationError = validate();
    if (validationError) {
      showError({ dedupeKey: SUBMIT_TOAST_KEY, title: validationError });
      return;
    }
    try {
      const { version } = await submitVersion.mutateAsync({
        pathParams: { sourceAssistantId },
        body: requestBody,
      });

      // Leaving aborts refetches this page observes, so the new version is
      // seeded and the lists refetch when they next mount.
      const myVersionsKey = listMyAssistantHubVersionsQuery({}).queryKey;
      queryClient.setQueryData<AssistantHubVersionsResponse>(
        myVersionsKey,
        (current) =>
          current && { ...current, versions: [version, ...current.versions] },
      );
      for (const queryKey of [
        myVersionsKey,
        listReviewAssistantHubVersionsQuery({}).queryKey,
      ]) {
        void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
      }

      toast.success({
        dedupeKey: SUBMIT_TOAST_KEY,
        title: t({
          id: "assistantHub.submit.success",
          message: "Version submitted for review.",
        }),
      });
      navigate("/assistant-hub/my");
    } catch (error) {
      if (handleVersionError(error)) return;
      showError({
        dedupeKey: SUBMIT_TOAST_KEY,
        title: t({
          id: "assistantHub.submit.error.submit",
          message: "Failed to submit the assistant version.",
        }),
      });
    }
  };

  const handleCancel = () => {
    toast.dismissKey(SUBMIT_TOAST_KEY);
    navigate("/assistants/created");
  };

  // Share grants only prefill the audience once; a newer submission arriving
  // later must not swap the form for a spinner.
  const isLoading =
    isLoadingConfig ||
    isLoadingAssistant ||
    isLoadingMyVersions ||
    (isLoadingPreviousShareGrants && prefilledAudienceForVersionId === null);

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      <PageHeader
        title={t({
          id: "assistantHub.submit.title",
          message: "Submit to Hub",
        })}
        subtitle={t({
          id: "assistantHub.submit.subtitle",
          message:
            "Create an immutable reviewed version from the current assistant draft",
        })}
      />

      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <SpinnerIcon
                  size="xl"
                  label={t({
                    id: "assistantHub.submit.loading",
                    message: "Loading assistant...",
                  })}
                />
              </div>
            </div>
          )}

          {assistantError && (
            <Alert type="error">
              {t({
                id: "assistantHub.submit.error.load",
                message: "Failed to load assistant.",
              })}
            </Alert>
          )}

          {config && !config.enabled && (
            <Alert type="info">
              {t({
                id: "assistantHub.disabled",
                message: "The assistant hub is not enabled.",
              })}
            </Alert>
          )}

          {!isLoading && assistant && config?.enabled && (
            <>
              <Card variant="surface" as="section" size="lg">
                <h2 className="mb-2 text-lg font-semibold text-theme-fg-primary">
                  {assistant.name}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.submit.snapshotNotice",
                    message:
                      "Submission clones the assistant into an immutable snapshot. Future edits to the draft assistant will not change this hub version.",
                  })}
                </p>
              </Card>

              <Card
                variant="surface"
                as="section"
                size="lg"
                bodyClassName="space-y-5"
              >
                <FormField
                  label={t({
                    id: "assistantHub.submit.description",
                    message: "Hub description",
                  })}
                  htmlFor="assistant-hub-long-description"
                  required
                >
                  <MarkdownPreviewInput
                    id="assistant-hub-long-description"
                    value={longDescription}
                    rows={5}
                    onChange={(event) => setLongDescription(event.target.value)}
                    tablistLabel={t({
                      id: "common.markdownEditor",
                      message: "Markdown editor",
                    })}
                    markdownTabLabel={t({
                      id: "common.markdown",
                      message: "Markdown",
                    })}
                    previewTabLabel={t({
                      id: "common.preview",
                      message: "Preview",
                    })}
                    emptyPreviewMessage={t({
                      id: "common.markdownPreviewEmpty",
                      message: "Nothing to preview yet.",
                    })}
                  />
                </FormField>

                <div className="grid gap-5 md:grid-cols-2">
                  <FormField
                    label={t({
                      id: "assistantHub.submit.versionNumber",
                      message: "Version number",
                    })}
                    htmlFor="assistant-hub-version-number"
                    required
                  >
                    <Input
                      id="assistant-hub-version-number"
                      aria-describedby="assistant-hub-version-number-help"
                      error={versionFieldError}
                      value={versionNumber}
                      onChange={(event) => {
                        setRejectedVersionNumber(undefined);
                        setVersionFieldTouched(true);
                        setVersionNumber(event.target.value);
                      }}
                    />
                    <p
                      id="assistant-hub-version-number-help"
                      className="mt-2 text-sm text-theme-fg-secondary"
                    >
                      {versionFormatHelp && (
                        <>
                          {versionFormatHelp}
                          <br />
                        </>
                      )}
                      {versionNumberHelpText}
                    </p>
                  </FormField>
                  <FormField
                    label={t({
                      id: "assistantHub.submit.keywords",
                      message: "Keywords",
                    })}
                    htmlFor="assistant-hub-keywords"
                    helpText={t({
                      id: "assistantHub.submit.keywordsHelp",
                      message: "Separate keywords with commas.",
                    })}
                  >
                    <Input
                      id="assistant-hub-keywords"
                      value={keywords}
                      onChange={(event) => setKeywords(event.target.value)}
                    />
                  </FormField>
                </div>

                {config.enable_categories && (
                  <div>
                    <div className="mb-2 text-base font-semibold text-theme-fg-primary">
                      {t({
                        id: "assistantHub.submit.categories",
                        message: "Categories",
                      })}
                      <span className="ml-1 text-theme-error-fg">*</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {config.categories.map((category) => {
                        const selected = categoryIds.includes(category.id);

                        return (
                          <Card
                            key={category.id}
                            variant="selectable"
                            control="none"
                            as="button"
                            selected={selected}
                            onClick={() => toggleCategory(category.id)}
                            // A chip is padded by its text, not by an inset the
                            // family has a step for.
                            size="none"
                            className={
                              selected
                                ? "text-theme-fg-primary"
                                : "text-theme-fg-secondary"
                            }
                            bodyClassName="px-3 py-2 text-sm"
                          >
                            {category.display_name}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                <FormField
                  label={t({
                    id: "assistantHub.submit.versionComment",
                    message: "Version comment",
                  })}
                  htmlFor="assistant-hub-version-comment"
                  helpText={t({
                    id: "assistantHub.submit.versionCommentHelp",
                    message:
                      "Explain what changed in this version for users browsing the Assistant Hub.",
                  })}
                >
                  <MarkdownPreviewInput
                    id="assistant-hub-version-comment"
                    value={versionComment}
                    rows={3}
                    onChange={(event) => setVersionComment(event.target.value)}
                    tablistLabel={t({
                      id: "common.markdownEditor",
                      message: "Markdown editor",
                    })}
                    markdownTabLabel={t({
                      id: "common.markdown",
                      message: "Markdown",
                    })}
                    previewTabLabel={t({
                      id: "common.preview",
                      message: "Preview",
                    })}
                    emptyPreviewMessage={t({
                      id: "common.markdownPreviewEmpty",
                      message: "Nothing to preview yet.",
                    })}
                  />
                </FormField>

                <FormField
                  label={t({
                    id: "assistantHub.submit.reviewComment",
                    message: "Note for reviewer",
                  })}
                  htmlFor="assistant-hub-review-comment"
                  helpText={t({
                    id: "assistantHub.submit.reviewCommentHelp",
                    message:
                      "Share context or specific details that will help the reviewer evaluate this submission.",
                  })}
                >
                  <Textarea
                    id="assistant-hub-review-comment"
                    value={creatorReviewComment}
                    rows={3}
                    onChange={(event) =>
                      setCreatorReviewComment(event.target.value)
                    }
                  />
                </FormField>
              </Card>

              {!forceWholeOrganizationAudience && (
                <Card variant="surface" as="section" size="lg">
                  <h2 className="mb-2 text-lg font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantHub.submit.audience",
                      message: "Hub audience",
                    })}
                  </h2>
                  <p className="mb-4 text-sm text-theme-fg-secondary">
                    {t({
                      id: "assistantHub.submit.audienceHelp",
                      message:
                        "These share grants are attached to this hub version and become effective only when the accepted version is published.",
                    })}
                  </p>
                  <SubjectSelector
                    selectedIds={selectedAudience.map((subject) => subject.id)}
                    onToggleSubject={toggleAudienceSubject}
                  />
                </Card>
              )}

              <Card variant="surface" as="section" size="lg">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantHub.submit.diffPreview",
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
                      id: "assistantHub.submit.preview",
                      message: "Preview changes",
                    })}
                  </Button>
                </div>
                {previewDiff.data ? (
                  <AssistantHubDiff
                    diffSummary={previewDiff.data.diff_summary}
                    hiddenFields={
                      config.enable_categories
                        ? []
                        : [ASSISTANT_HUB_CATEGORY_IDS_DIFF_FIELD]
                    }
                  />
                ) : (
                  <p className="text-sm text-theme-fg-secondary">
                    {t({
                      id: "assistantHub.submit.previewEmpty",
                      message:
                        "Preview the submission to compare it with the previous accepted version.",
                    })}
                  </p>
                )}
              </Card>

              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={handleCancel}>
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
                    id: "assistantHub.submit.submit",
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
