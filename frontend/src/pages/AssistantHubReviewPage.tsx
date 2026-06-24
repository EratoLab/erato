import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Textarea } from "@/components/ui/Input";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantHubConfig,
  useGetAssistant,
  useListReviewAssistantHubVersions,
  useReviewAssistantHubVersion,
  useSetAssistantHubVersionCurrent,
  useSetAssistantHubVersionFeatured,
  useSetAssistantHubVersionPublished,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantHubBreadcrumb,
  AssistantHubDiff,
  AssistantHubVersionCard,
  AssistantHubVersionConfigurationSection,
  AssistantHubVersionOverviewSection,
  EmptyAssistantHubState,
  isAssistantHubReviewAcceptedStatus,
} from "./assistantHubUtils";

import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export default function AssistantHubReviewPage() {
  const navigate = useNavigate();
  const { versionId } = useParams<{ versionId?: string }>();
  const queryClient = useQueryClient();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config, isLoading: isLoadingConfig } = useAssistantHubConfig(
    {},
  );
  const { data, isLoading, error } = useListReviewAssistantHubVersions({});
  const reviewVersion = useReviewAssistantHubVersion();
  const setPublished = useSetAssistantHubVersionPublished();
  const setCurrent = useSetAssistantHubVersionCurrent();
  const setFeatured = useSetAssistantHubVersionFeatured();
  const [reviewComments, setReviewComments] = useState<
    Partial<Record<string, string>>
  >({});

  useEffect(() => {
    document.title = `${t({
      id: "assistantHub.review.title",
      message: "Assistant Hub Review",
    })} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };

  const handleReview = async (
    version: AssistantHubVersion,
    accepted: boolean,
  ) => {
    const reviewerReviewComment = reviewComments[version.version_id]?.trim();

    await reviewVersion.mutateAsync({
      pathParams: { versionId: version.version_id },
      body: {
        accepted,
        reviewer_review_comment:
          reviewerReviewComment && reviewerReviewComment.length > 0
            ? reviewerReviewComment
            : null,
      },
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

  const handleSetFeatured = async (
    version: AssistantHubVersion,
    featured: boolean,
  ) => {
    await setFeatured.mutateAsync({
      pathParams: { versionId: version.version_id },
      body: { featured },
    });
    await refresh();
  };

  const versions = useMemo(() => data?.versions ?? [], [data?.versions]);
  const selectedVersion = useMemo(
    () => versions.find((version) => version.version_id === versionId),
    [versionId, versions],
  );
  const { data: assistantDetails } = useGetAssistant(
    selectedVersion
      ? { pathParams: { assistantId: selectedVersion.assistant_id } }
      : skipToken,
  );

  const renderAcceptedVersionActions = (version: AssistantHubVersion) =>
    isAssistantHubReviewAcceptedStatus(version.status) ? (
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
                id: "assistantHub.review.unpublish",
                message: "Unpublish",
              })
            : t({
                id: "assistantHub.review.publish",
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
              id: "assistantHub.review.makeCurrent",
              message: "Make current",
            })}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={setFeatured.isPending}
          onClick={() => {
            void handleSetFeatured(version, !version.featured);
          }}
        >
          {version.featured
            ? t({
                id: "assistantHub.review.unfeature",
                message: "Unfeature assistant",
              })
            : t({
                id: "assistantHub.review.feature",
                message: "Feature assistant",
              })}
        </Button>
      </>
    ) : null;

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          <AssistantHubBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() =>
              navigate(versionId ? "/assistant-hub/review" : "/assistant-hub")
            }
          >
            {versionId
              ? t({
                  id: "assistantHub.action.backToReviewQueue",
                  message: "Back to review queue",
                })
              : t({
                  id: "assistantHub.action.backToHub",
                  message: "Back to hub",
                })}
          </AssistantHubBreadcrumb>

          {!versionId && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/assistant-hub/my")}
              >
                {t({
                  id: "assistantHub.action.mySubmissions",
                  message: "My submissions",
                })}
              </Button>
            </div>
          )}

          {isLoadingConfig && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.review.loadingConfig",
                    message: "Loading review permissions...",
                  })}
                </p>
              </div>
            </div>
          )}

          {config && !config.can_review && (
            <Alert type="error">
              {t({
                id: "assistantHub.review.notAllowed",
                message:
                  "You do not have permission to review assistant hub submissions.",
              })}
            </Alert>
          )}

          {[
            error,
            reviewVersion.error,
            setPublished.error,
            setCurrent.error,
            setFeatured.error,
          ].some(Boolean) && (
            <Alert type="error">
              {t({
                id: "assistantHub.review.error",
                message: "Failed to update assistant hub review state.",
              })}
            </Alert>
          )}

          {config?.can_review && isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.review.loading",
                    message: "Loading review queue...",
                  })}
                </p>
              </div>
            </div>
          )}

          {config?.can_review && !isLoading && versions.length === 0 && (
            <EmptyAssistantHubState
              title={t({
                id: "assistantHub.review.empty.title",
                message: "No versions to review",
              })}
              description={t({
                id: "assistantHub.review.empty.description",
                message:
                  "Submitted assistant versions will appear here for review.",
              })}
            />
          )}

          {config?.can_review &&
            !isLoading &&
            versionId &&
            !selectedVersion && (
              <EmptyAssistantHubState
                title={t({
                  id: "assistantHub.review.notFound.title",
                  message: "Review item not found",
                })}
                description={t({
                  id: "assistantHub.review.notFound.description",
                  message: "This assistant hub review item is not available.",
                })}
              />
            )}

          {config?.can_review && !isLoading && selectedVersion && (
            <div className="space-y-6">
              <AssistantHubVersionOverviewSection
                version={selectedVersion}
                categories={config.categories}
                onStartChat={() =>
                  navigate(`/a/${selectedVersion.assistant_id}`)
                }
              />

              <AssistantHubVersionConfigurationSection
                version={selectedVersion}
                assistantDetails={assistantDetails}
              />

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <div className="mb-5">
                  {(() => {
                    const versionNumber = selectedVersion.version_number;

                    return (
                      <h2 className="text-lg font-semibold text-theme-fg-primary">
                        {t`Version ${versionNumber}`}
                      </h2>
                    );
                  })()}
                  {selectedVersion.version_comment && (
                    <div className="mt-3">
                      <h3 className="mb-2 text-sm font-semibold text-theme-fg-primary">
                        {t({
                          id: "assistantHub.detail.versionComment",
                          message: "Version comment",
                        })}
                      </h3>
                      <p className="whitespace-pre-wrap text-sm text-theme-fg-secondary">
                        {selectedVersion.version_comment}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-5">
                  {selectedVersion.creator_review_comment && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-theme-fg-primary">
                        {t({
                          id: "assistantHub.review.creatorComment",
                          message: "Creator note",
                        })}
                      </h3>
                      <p className="whitespace-pre-wrap rounded border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                        {selectedVersion.creator_review_comment}
                      </p>
                    </div>
                  )}

                  <details open>
                    <summary className="focus-ring theme-transition cursor-pointer text-lg font-semibold text-theme-fg-primary hover:text-theme-fg-secondary">
                      {t({
                        id: "assistantHub.review.diff",
                        message: "Changes from previous version",
                      })}
                    </summary>
                    <div className="mt-4">
                      <AssistantHubDiff
                        diffSummary={selectedVersion.diff_summary}
                      />
                    </div>
                  </details>

                  {selectedVersion.status === "submitted" ? (
                    <div className="space-y-3 border-t border-theme-border pt-5">
                      <label
                        htmlFor="assistant-hub-reviewer-comment"
                        className="block text-sm font-semibold text-theme-fg-primary"
                      >
                        {t({
                          id: "assistantHub.review.comment",
                          message: "Reviewer comment",
                        })}
                      </label>
                      <Textarea
                        id="assistant-hub-reviewer-comment"
                        rows={4}
                        value={reviewComments[selectedVersion.version_id] ?? ""}
                        onChange={(event) =>
                          setReviewComments((current) => ({
                            ...current,
                            [selectedVersion.version_id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={reviewVersion.isPending}
                          onClick={() => {
                            void handleReview(selectedVersion, false);
                          }}
                        >
                          {t({
                            id: "assistantHub.review.decline",
                            message: "Decline",
                          })}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={reviewVersion.isPending}
                          onClick={() => {
                            void handleReview(selectedVersion, true);
                          }}
                        >
                          {t({
                            id: "assistantHub.review.accept",
                            message: "Accept",
                          })}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 border-t border-theme-border pt-5">
                      {selectedVersion.reviewer_review_comment && (
                        <div>
                          <h3 className="mb-1 text-sm font-semibold text-theme-fg-primary">
                            {t({
                              id: "assistantHub.review.reviewerComment",
                              message: "Reviewer comment",
                            })}
                          </h3>
                          <p className="whitespace-pre-wrap rounded border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                            {selectedVersion.reviewer_review_comment}
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap justify-end gap-2">
                        {renderAcceptedVersionActions(selectedVersion)}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {config?.can_review &&
            !isLoading &&
            !versionId &&
            versions.map((version) => (
              <AssistantHubVersionCard
                key={version.version_id}
                version={version}
                categories={config.categories}
                showStatusBadge
                onOpen={() =>
                  navigate(`/assistant-hub/review/${version.version_id}`)
                }
                actions={
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigate(`/assistant-hub/review/${version.version_id}`)
                      }
                    >
                      {t({
                        id: "assistantHub.review.viewDetails",
                        message: "View details",
                      })}
                    </Button>
                    {renderAcceptedVersionActions(version)}
                  </>
                }
              />
            ))}
        </div>
      </div>
    </div>
  );
}
