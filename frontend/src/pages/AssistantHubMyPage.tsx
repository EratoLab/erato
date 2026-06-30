import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Star } from "iconoir-react";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ArrowLeftIcon, EditIcon, PlusIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantHubConfig,
  useGetAssistant,
  useListAssistantHubReviews,
  useListMyAssistantHubVersions,
  useSetAssistantHubVersionCurrent,
  useSetAssistantHubVersionPublished,
  useWithdrawAssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantHubBreadcrumb,
  AssistantHubCurrentPublishedIndicator,
  AssistantHubDiff,
  AssistantHubVersionCard,
  AssistantHubVersionConfigurationSection,
  AssistantHubVersionOverviewSection,
  EmptyAssistantHubState,
  isAssistantHubReviewAcceptedStatus,
} from "./assistantHubUtils";

import type {
  AssistantHubUserReview,
  AssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type AssistantSubmissionGroup = {
  hubAssistantId: string;
  sourceAssistantId: string;
  name: string;
  description?: string | null;
  versions: AssistantHubVersion[];
};

const groupVersionsByAssistant = (
  versions: AssistantHubVersion[],
): AssistantSubmissionGroup[] => {
  const groups = new Map<string, AssistantSubmissionGroup>();

  for (const version of versions) {
    const current = groups.get(version.hub_assistant_id);
    if (current) {
      current.versions.push(version);
    } else {
      groups.set(version.hub_assistant_id, {
        hubAssistantId: version.hub_assistant_id,
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

const REVIEW_SCORE_VALUES = Array.from({ length: 10 }, (_, index) => index + 1);

function ReviewScoreStars({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5" aria-hidden="true">
      {REVIEW_SCORE_VALUES.map((value) => {
        const isSelected = value <= Math.round(score);

        return (
          <Star
            key={value}
            className={clsx(
              "size-4 text-theme-fg-muted",
              isSelected && "fill-current text-theme-warning-fg",
            )}
          />
        );
      })}
    </div>
  );
}

function AssistantHubSubmittedReviewItem({
  review,
}: {
  review: AssistantHubUserReview;
}) {
  const score = review.score;
  const versionNumber = review.version_number;
  const reviewerName = review.reviewer.display_name;

  return (
    <article className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-theme-fg-primary">
          {reviewerName}
        </span>
        <ReviewScoreStars score={score} />
        <span className="text-theme-fg-muted">
          {t({
            id: "assistantHub.my.submittedReviews.scoreValue",
            message: `${score} / 10`,
          })}
        </span>
        <span className="text-theme-fg-muted">
          {t({
            id: "assistantHub.my.submittedReviews.versionValue",
            message: `Version ${versionNumber}`,
          })}
        </span>
      </div>
      {review.comment && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-theme-fg-secondary">
          {review.comment}
        </p>
      )}
    </article>
  );
}

function AssistantHubSubmittedReviewsSection({
  reviews,
  isLoading,
}: {
  reviews: AssistantHubUserReview[];
  isLoading: boolean;
}) {
  return (
    <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
      <h2 className="text-lg font-semibold text-theme-fg-primary">
        {t({
          id: "assistantHub.my.submittedReviews.title",
          message: "Submitted reviews",
        })}
      </h2>
      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "assistantHub.my.submittedReviews.loading",
              message: "Loading reviews...",
            })}
          </p>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "assistantHub.my.submittedReviews.empty",
              message: "No reviews submitted yet.",
            })}
          </p>
        ) : (
          <div className="divide-y divide-theme-border rounded-lg border border-theme-border">
            {reviews.map((review) => (
              <AssistantHubSubmittedReviewItem
                key={review.id}
                review={review}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function AssistantHubMyPage() {
  const navigate = useNavigate();
  const { versionId } = useParams<{ versionId?: string }>();
  const queryClient = useQueryClient();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config } = useAssistantHubConfig({});
  const { data, isLoading, error } = useListMyAssistantHubVersions({});
  const withdrawVersion = useWithdrawAssistantHubVersion();
  const setPublished = useSetAssistantHubVersionPublished();
  const setCurrent = useSetAssistantHubVersionCurrent();

  useEffect(() => {
    document.title = `${t({
      id: "assistantHub.my.title",
      message: "My Hub Submissions",
    })} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };

  const handleWithdraw = async (version: AssistantHubVersion) => {
    await withdrawVersion.mutateAsync({
      pathParams: { versionId: version.version_id },
    });
    await refresh();
  };

  const handleSetPublished = async (
    version: AssistantHubVersion,
    isPublished: boolean,
  ) => {
    await setPublished.mutateAsync({
      pathParams: { versionId: version.version_id },
      body: { is_published: isPublished },
    });
    await refresh();
  };

  const handleSetCurrent = async (version: AssistantHubVersion) => {
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
  const { data: selectedVersionReviewsData, isLoading: isLoadingReviews } =
    useListAssistantHubReviews(
      selectedVersion
        ? {
            pathParams: { hubAssistantId: selectedVersion.hub_assistant_id },
          }
        : skipToken,
    );
  const selectedVersionReviews = useMemo(
    () => selectedVersionReviewsData?.reviews ?? [],
    [selectedVersionReviewsData?.reviews],
  );
  const selectedVersionSiblingCount = useMemo(() => {
    if (!selectedVersion) return 0;

    return versions.filter(
      (version) =>
        version.hub_assistant_id === selectedVersion.hub_assistant_id,
    ).length;
  }, [selectedVersion, versions]);

  const renderVersionActions = (
    version: AssistantHubVersion,
    { includeViewSubmission = true }: { includeViewSubmission?: boolean } = {},
  ) => (
    <>
      {includeViewSubmission && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(`/assistant-hub/my/${version.version_id}`)}
        >
          {t({
            id: "assistantHub.my.viewSubmission",
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
            id: "assistantHub.my.withdrawConfirmTitle",
            message: "Withdraw submission",
          })}
          confirmMessage={t({
            id: "assistantHub.my.withdrawConfirmMessage",
            message: "Withdraw this submitted version from review?",
          })}
          onClick={() => {
            void handleWithdraw(version);
          }}
        >
          {t({
            id: "assistantHub.my.withdraw",
            message: "Withdraw",
          })}
        </Button>
      )}
      {isAssistantHubReviewAcceptedStatus(version.status) && (
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
                  id: "assistantHub.my.unpublish",
                  message: "Unpublish",
                })
              : t({
                  id: "assistantHub.my.publish",
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
                id: "assistantHub.my.makeCurrent",
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
          id: "assistantHub.my.title",
          message: "My Hub Submissions",
        })}
        subtitle={t({
          id: "assistantHub.my.subtitle",
          message:
            "Review submitted, accepted, declined, and withdrawn assistant versions",
        })}
      />
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          <AssistantHubBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() =>
              navigate(versionId ? "/assistant-hub/my" : "/assistant-hub")
            }
          >
            {versionId
              ? t({
                  id: "assistantHub.action.backToMySubmissions",
                  message: "Back to my submissions",
                })
              : t({
                  id: "assistantHub.action.backToHub",
                  message: "Back to hub",
                })}
          </AssistantHubBreadcrumb>

          {config?.can_review && !versionId && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/assistant-hub/review")}
              >
                {t({
                  id: "assistantHub.action.reviewQueue",
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
                id: "assistantHub.my.error",
                message: "Failed to update hub submissions.",
              })}
            </Alert>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.my.loading",
                    message: "Loading submissions...",
                  })}
                </p>
              </div>
            </div>
          )}

          {!isLoading && versions.length === 0 && (
            <EmptyAssistantHubState
              title={t({
                id: "assistantHub.my.empty.title",
                message: "No submitted versions",
              })}
              description={t({
                id: "assistantHub.my.empty.description",
                message:
                  "Submit one of your assistants to create a reviewed hub version.",
              })}
              action={
                <Button
                  variant="primary"
                  onClick={() => navigate("/assistants")}
                >
                  {t({
                    id: "assistantHub.my.chooseAssistant",
                    message: "Choose assistant",
                  })}
                </Button>
              }
            />
          )}

          {!isLoading && versionId && !selectedVersion && (
            <EmptyAssistantHubState
              title={t({
                id: "assistantHub.my.notFound.title",
                message: "Submission not found",
              })}
              description={t({
                id: "assistantHub.my.notFound.description",
                message: "This assistant hub submission is not available.",
              })}
            />
          )}

          {!isLoading && selectedVersion && (
            <div className="space-y-6">
              <AssistantHubVersionOverviewSection
                version={selectedVersion}
                categories={config?.categories ?? []}
                onStartChat={() =>
                  navigate(`/a/${selectedVersion.assistant_id}`)
                }
              />

              <AssistantHubVersionConfigurationSection
                version={selectedVersion}
                assistantDetails={assistantDetails}
              />

              <AssistantHubSubmittedReviewsSection
                reviews={selectedVersionReviews}
                isLoading={isLoadingReviews}
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
                        <AssistantHubCurrentPublishedIndicator />
                      )}
                    </div>
                    {selectedVersion.version_comment && (
                      <div className="mt-3">
                        <h3 className="mb-2 text-sm font-semibold text-theme-fg-primary">
                          {t({
                            id: "assistantHub.my.versionComment",
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
                        id: "assistantHub.my.editDraft",
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
                          id: "assistantHub.my.creatorReviewComment",
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
                          id: "assistantHub.my.reviewerReviewComment",
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
                          id: "assistantHub.my.diff",
                          message: "Changes from previous version",
                        })}
                      </summary>
                      <div className="mt-4">
                        <AssistantHubDiff
                          diffSummary={selectedVersion.diff_summary}
                        />
                      </div>
                    </details>
                  )}
                  {selectedVersionSiblingCount <= 1 && (
                    <p className="text-sm text-theme-fg-secondary">
                      {t({
                        id: "assistantHub.diff.firstVersion",
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
                key={group.hubAssistantId}
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
                        id: "assistantHub.my.editDraft",
                        message: "Edit draft",
                      })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<PlusIcon className="size-4" />}
                      onClick={() =>
                        navigate(
                          `/assistant-hub/submit/${group.sourceAssistantId}`,
                        )
                      }
                    >
                      {t({
                        id: "assistantHub.my.submitNewVersion",
                        message: "Submit new version",
                      })}
                    </Button>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.versions.map((version) => (
                    <AssistantHubVersionCard
                      key={version.version_id}
                      version={version}
                      categories={config?.categories ?? []}
                      showStatusBadge
                      showCurrentPublishedIndicator
                      onOpen={() =>
                        navigate(`/assistant-hub/my/${version.version_id}`)
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
