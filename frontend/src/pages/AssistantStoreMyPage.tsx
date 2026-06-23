import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ArrowLeftIcon, EditIcon, PlusIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantStoreConfig,
  useGetAssistant,
  useListMyAssistantStoreVersions,
  useSetAssistantStoreVersionCurrent,
  useSetAssistantStoreVersionPublished,
  useWithdrawAssistantStoreVersion,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantStoreBreadcrumb,
  AssistantStoreCurrentPublishedIndicator,
  AssistantStoreDiff,
  AssistantStoreVersionCard,
  AssistantStoreVersionConfigurationSection,
  AssistantStoreVersionOverviewSection,
  EmptyAssistantStoreState,
  isAssistantStoreReviewAcceptedStatus,
} from "./assistantStoreUtils";

import type { AssistantStoreVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type AssistantSubmissionGroup = {
  storeAssistantId: string;
  sourceAssistantId: string;
  name: string;
  description?: string | null;
  versions: AssistantStoreVersion[];
};

const groupVersionsByAssistant = (
  versions: AssistantStoreVersion[],
): AssistantSubmissionGroup[] => {
  const groups = new Map<string, AssistantSubmissionGroup>();

  for (const version of versions) {
    const current = groups.get(version.store_assistant_id);
    if (current) {
      current.versions.push(version);
    } else {
      groups.set(version.store_assistant_id, {
        storeAssistantId: version.store_assistant_id,
        sourceAssistantId: version.source_assistant_id,
        name: version.assistant.name,
        description: version.assistant.description,
        versions: [version],
      });
    }
  }

  return [...groups.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

export default function AssistantStoreMyPage() {
  const navigate = useNavigate();
  const { versionId } = useParams<{ versionId?: string }>();
  const queryClient = useQueryClient();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config } = useAssistantStoreConfig({});
  const { data, isLoading, error } = useListMyAssistantStoreVersions({});
  const withdrawVersion = useWithdrawAssistantStoreVersion();
  const setPublished = useSetAssistantStoreVersionPublished();
  const setCurrent = useSetAssistantStoreVersionCurrent();

  useEffect(() => {
    document.title = `${t({
      id: "assistantStore.my.title",
      message: "My Store Submissions",
    })} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };

  const handleWithdraw = async (version: AssistantStoreVersion) => {
    await withdrawVersion.mutateAsync({
      pathParams: { versionId: version.version_id },
    });
    await refresh();
  };

  const handleSetPublished = async (
    version: AssistantStoreVersion,
    isPublished: boolean,
  ) => {
    await setPublished.mutateAsync({
      pathParams: { versionId: version.version_id },
      body: { is_published: isPublished },
    });
    await refresh();
  };

  const handleSetCurrent = async (version: AssistantStoreVersion) => {
    await setCurrent.mutateAsync({
      pathParams: { versionId: version.version_id },
    });
    await refresh();
  };

  const versions = useMemo(() => data?.versions ?? [], [data?.versions]);
  const groups = useMemo(() => groupVersionsByAssistant(versions), [versions]);
  const selectedVersion = useMemo(
    () => versions.find((version) => version.version_id === versionId),
    [versionId, versions],
  );
  const { data: assistantDetails } = useGetAssistant(
    selectedVersion
      ? { pathParams: { assistantId: selectedVersion.assistant_id } }
      : skipToken,
  );
  const selectedVersionSiblingCount = useMemo(() => {
    if (!selectedVersion) return 0;

    return versions.filter(
      (version) =>
        version.store_assistant_id === selectedVersion.store_assistant_id,
    ).length;
  }, [selectedVersion, versions]);

  const renderVersionActions = (
    version: AssistantStoreVersion,
    { includeViewSubmission = true }: { includeViewSubmission?: boolean } = {},
  ) => (
    <>
      {includeViewSubmission && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(`/assistant-store/my/${version.version_id}`)}
        >
          {t({
            id: "assistantStore.my.viewSubmission",
            message: "View submission",
          })}
        </Button>
      )}
      {version.status === "submitted" && (
        <Button
          variant="secondary"
          size="sm"
          loading={withdrawVersion.isPending}
          confirmAction
          confirmTitle={t({
            id: "assistantStore.my.withdrawConfirmTitle",
            message: "Withdraw submission",
          })}
          confirmMessage={t({
            id: "assistantStore.my.withdrawConfirmMessage",
            message: "Withdraw this submitted version from review?",
          })}
          onClick={() => {
            void handleWithdraw(version);
          }}
        >
          {t({
            id: "assistantStore.my.withdraw",
            message: "Withdraw",
          })}
        </Button>
      )}
      {isAssistantStoreReviewAcceptedStatus(version.status) && (
        <>
          <Button
            variant="secondary"
            size="sm"
            loading={setPublished.isPending}
            onClick={() => {
              void handleSetPublished(version, !version.is_published);
            }}
          >
            {version.is_published
              ? t({
                  id: "assistantStore.my.unpublish",
                  message: "Unpublish",
                })
              : t({
                  id: "assistantStore.my.publish",
                  message: "Publish",
                })}
          </Button>
          {version.is_published && !version.is_current_published_version && (
            <Button
              variant="secondary"
              size="sm"
              loading={setCurrent.isPending}
              onClick={() => {
                void handleSetCurrent(version);
              }}
            >
              {t({
                id: "assistantStore.my.makeCurrent",
                message: "Make current",
              })}
            </Button>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <PageHeader
        title={t({
          id: "assistantStore.my.title",
          message: "My Store Submissions",
        })}
        subtitle={t({
          id: "assistantStore.my.subtitle",
          message:
            "Review submitted, accepted, declined, and withdrawn assistant versions",
        })}
      />
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          <AssistantStoreBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() =>
              navigate(versionId ? "/assistant-store/my" : "/assistant-store")
            }
          >
            {versionId
              ? t({
                  id: "assistantStore.action.backToMySubmissions",
                  message: "Back to my submissions",
                })
              : t({
                  id: "assistantStore.action.backToStore",
                  message: "Back to store",
                })}
          </AssistantStoreBreadcrumb>

          {config?.can_review && !versionId && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/assistant-store/review")}
              >
                {t({
                  id: "assistantStore.action.reviewQueue",
                  message: "Review queue",
                })}
              </Button>
            </div>
          )}

          {[
            error,
            withdrawVersion.error,
            setPublished.error,
            setCurrent.error,
          ].some(Boolean) && (
            <Alert type="error">
              {t({
                id: "assistantStore.my.error",
                message: "Failed to update store submissions.",
              })}
            </Alert>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.my.loading",
                    message: "Loading submissions...",
                  })}
                </p>
              </div>
            </div>
          )}

          {!isLoading && versions.length === 0 && (
            <EmptyAssistantStoreState
              title={t({
                id: "assistantStore.my.empty.title",
                message: "No submitted versions",
              })}
              description={t({
                id: "assistantStore.my.empty.description",
                message:
                  "Submit one of your assistants to create a reviewed store version.",
              })}
              action={
                <Button
                  variant="primary"
                  onClick={() => navigate("/assistants")}
                >
                  {t({
                    id: "assistantStore.my.chooseAssistant",
                    message: "Choose assistant",
                  })}
                </Button>
              }
            />
          )}

          {!isLoading && versionId && !selectedVersion && (
            <EmptyAssistantStoreState
              title={t({
                id: "assistantStore.my.notFound.title",
                message: "Submission not found",
              })}
              description={t({
                id: "assistantStore.my.notFound.description",
                message: "This assistant store submission is not available.",
              })}
            />
          )}

          {!isLoading && selectedVersion && (
            <div className="space-y-6">
              <AssistantStoreVersionOverviewSection
                version={selectedVersion}
                categories={config?.categories ?? []}
                onStartChat={() =>
                  navigate(`/a/${selectedVersion.assistant_id}`)
                }
              />

              <AssistantStoreVersionConfigurationSection
                version={selectedVersion}
                assistantDetails={assistantDetails}
              />

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(() => {
                        const versionNumber = selectedVersion.version_number;

                        return (
                          <h2 className="text-lg font-semibold text-theme-fg-primary">
                            {t`Version ${versionNumber}`}
                          </h2>
                        );
                      })()}
                      {selectedVersion.is_current_published_version && (
                        <AssistantStoreCurrentPublishedIndicator />
                      )}
                    </div>
                    {selectedVersion.version_comment && (
                      <div className="mt-3">
                        <h3 className="mb-2 text-sm font-semibold text-theme-fg-primary">
                          {t({
                            id: "assistantStore.my.versionComment",
                            message: "Version comment",
                          })}
                        </h3>
                        <p className="whitespace-pre-wrap text-sm text-theme-fg-secondary">
                          {selectedVersion.version_comment}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<EditIcon className="size-4" />}
                      onClick={() =>
                        navigate(
                          `/assistants/${selectedVersion.source_assistant_id}/edit`,
                        )
                      }
                    >
                      {t({
                        id: "assistantStore.my.editDraft",
                        message: "Edit draft",
                      })}
                    </Button>
                    {renderVersionActions(selectedVersion, {
                      includeViewSubmission: false,
                    })}
                  </div>
                </div>

                <div className="space-y-5">
                  {selectedVersion.creator_review_comment && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-theme-fg-primary">
                        {t({
                          id: "assistantStore.my.creatorReviewComment",
                          message: "Note to reviewer",
                        })}
                      </h3>
                      <p className="whitespace-pre-wrap rounded border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                        {selectedVersion.creator_review_comment}
                      </p>
                    </div>
                  )}
                  {selectedVersion.reviewer_review_comment && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-theme-fg-primary">
                        {t({
                          id: "assistantStore.my.reviewerReviewComment",
                          message: "Reviewer response",
                        })}
                      </h3>
                      <p className="whitespace-pre-wrap rounded border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                        {selectedVersion.reviewer_review_comment}
                      </p>
                    </div>
                  )}
                  {selectedVersionSiblingCount > 1 && (
                    <details open>
                      <summary className="focus-ring theme-transition cursor-pointer text-lg font-semibold text-theme-fg-primary hover:text-theme-fg-secondary">
                        {t({
                          id: "assistantStore.my.diff",
                          message: "Changes from previous version",
                        })}
                      </summary>
                      <div className="mt-4">
                        <AssistantStoreDiff
                          diffSummary={selectedVersion.diff_summary}
                        />
                      </div>
                    </details>
                  )}
                  {selectedVersionSiblingCount <= 1 && (
                    <p className="text-sm text-theme-fg-secondary">
                      {t({
                        id: "assistantStore.diff.firstVersion",
                        message:
                          "No previous version exists for this assistant.",
                      })}
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          {!isLoading &&
            !versionId &&
            groups.map((group) => (
              <section
                key={group.storeAssistantId}
                className="rounded-lg border border-theme-border bg-theme-bg-primary p-4"
              >
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-theme-fg-primary">
                      {group.name}
                    </h2>
                    {group.description && (
                      <p className="mt-1 text-sm text-theme-fg-secondary">
                        {group.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<EditIcon className="size-4" />}
                      onClick={() =>
                        navigate(`/assistants/${group.sourceAssistantId}/edit`)
                      }
                    >
                      {t({
                        id: "assistantStore.my.editDraft",
                        message: "Edit draft",
                      })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<PlusIcon className="size-4" />}
                      onClick={() =>
                        navigate(
                          `/assistant-store/submit/${group.sourceAssistantId}`,
                        )
                      }
                    >
                      {t({
                        id: "assistantStore.my.submitNewVersion",
                        message: "Submit new version",
                      })}
                    </Button>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.versions.map((version) => (
                    <AssistantStoreVersionCard
                      key={version.version_id}
                      version={version}
                      categories={config?.categories ?? []}
                      showStatusBadge
                      showCurrentPublishedIndicator
                      onOpen={() =>
                        navigate(`/assistant-store/my/${version.version_id}`)
                      }
                      actions={renderVersionActions(version)}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
