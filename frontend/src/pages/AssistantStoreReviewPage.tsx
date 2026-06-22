import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Textarea } from "@/components/ui/Input";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantStoreConfig,
  useListReviewAssistantStoreVersions,
  useReviewAssistantStoreVersion,
  useSetAssistantStoreVersionCurrent,
  useSetAssistantStoreVersionFeatured,
  useSetAssistantStoreVersionPublished,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantStoreBreadcrumb,
  AssistantStoreDiff,
  AssistantStoreVersionCard,
  EmptyAssistantStoreState,
  isAssistantStoreReviewAcceptedStatus,
} from "./assistantStoreUtils";

import type { AssistantStoreVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export default function AssistantStoreReviewPage() {
  const navigate = useNavigate();
  const { versionId } = useParams<{ versionId?: string }>();
  const queryClient = useQueryClient();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config, isLoading: isLoadingConfig } = useAssistantStoreConfig(
    {},
  );
  const { data, isLoading, error } = useListReviewAssistantStoreVersions({});
  const reviewVersion = useReviewAssistantStoreVersion();
  const setPublished = useSetAssistantStoreVersionPublished();
  const setCurrent = useSetAssistantStoreVersionCurrent();
  const setFeatured = useSetAssistantStoreVersionFeatured();
  const [reviewComments, setReviewComments] = useState<
    Partial<Record<string, string>>
  >({});

  useEffect(() => {
    document.title = `${t({
      id: "assistantStore.review.title",
      message: "Assistant Store Review",
    })} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };

  const handleReview = async (
    version: AssistantStoreVersion,
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

  const handleSetFeatured = async (
    version: AssistantStoreVersion,
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

  const renderAcceptedVersionActions = (version: AssistantStoreVersion) =>
    isAssistantStoreReviewAcceptedStatus(version.status) ? (
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
                id: "assistantStore.review.unpublish",
                message: "Unpublish",
              })
            : t({
                id: "assistantStore.review.publish",
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
              id: "assistantStore.review.makeCurrent",
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
                id: "assistantStore.review.unfeature",
                message: "Unfeature",
              })
            : t({
                id: "assistantStore.review.feature",
                message: "Feature",
              })}
        </Button>
      </>
    ) : null;

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <PageHeader
        title={t({
          id: "assistantStore.review.title",
          message: "Assistant Store Review",
        })}
        subtitle={t({
          id: "assistantStore.review.subtitle",
          message:
            "Review immutable assistant versions before they can be published",
        })}
      />

      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          <AssistantStoreBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() =>
              navigate(
                versionId ? "/assistant-store/review" : "/assistant-store",
              )
            }
          >
            {versionId
              ? t({
                  id: "assistantStore.action.backToReviewQueue",
                  message: "Back to review queue",
                })
              : t({
                  id: "assistantStore.action.backToStore",
                  message: "Back to store",
                })}
          </AssistantStoreBreadcrumb>

          {!versionId && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/assistant-store/my")}
              >
                {t({
                  id: "assistantStore.action.mySubmissions",
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
                    id: "assistantStore.review.loadingConfig",
                    message: "Loading review permissions...",
                  })}
                </p>
              </div>
            </div>
          )}

          {config && !config.can_review && (
            <Alert type="error">
              {t({
                id: "assistantStore.review.notAllowed",
                message:
                  "You do not have permission to review assistant store submissions.",
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
                id: "assistantStore.review.error",
                message: "Failed to update assistant store review state.",
              })}
            </Alert>
          )}

          {config?.can_review && isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.review.loading",
                    message: "Loading review queue...",
                  })}
                </p>
              </div>
            </div>
          )}

          {config?.can_review && !isLoading && versions.length === 0 && (
            <EmptyAssistantStoreState
              title={t({
                id: "assistantStore.review.empty.title",
                message: "No versions to review",
              })}
              description={t({
                id: "assistantStore.review.empty.description",
                message:
                  "Submitted assistant versions will appear here for review.",
              })}
            />
          )}

          {config?.can_review &&
            !isLoading &&
            versionId &&
            !selectedVersion && (
              <EmptyAssistantStoreState
                title={t({
                  id: "assistantStore.review.notFound.title",
                  message: "Review item not found",
                })}
                description={t({
                  id: "assistantStore.review.notFound.description",
                  message: "This assistant store review item is not available.",
                })}
              />
            )}

          {config?.can_review && !isLoading && selectedVersion && (
            <div className="space-y-4">
              <AssistantStoreVersionCard
                version={selectedVersion}
                categories={config.categories}
                actions={renderAcceptedVersionActions(selectedVersion)}
              />

              <div className="space-y-4 rounded-lg border border-theme-border bg-theme-bg-primary p-4">
                <div className="space-y-3">
                  {selectedVersion.creator_review_comment && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-theme-fg-primary">
                        {t({
                          id: "assistantStore.review.creatorComment",
                          message: "Creator note",
                        })}
                      </h3>
                      <p className="whitespace-pre-wrap rounded border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                        {selectedVersion.creator_review_comment}
                      </p>
                    </div>
                  )}
                  <h3 className="mb-3 text-sm font-semibold text-theme-fg-primary">
                    {t({
                      id: "assistantStore.review.diff",
                      message: "Changes from previous version",
                    })}
                  </h3>
                  <AssistantStoreDiff
                    diffSummary={selectedVersion.diff_summary}
                  />
                </div>
                <div>
                  {selectedVersion.status === "submitted" ? (
                    <div className="space-y-3">
                      <label
                        htmlFor="assistant-store-reviewer-comment"
                        className="block text-sm font-semibold text-theme-fg-primary"
                      >
                        {t({
                          id: "assistantStore.review.comment",
                          message: "Reviewer comment",
                        })}
                      </label>
                      <Textarea
                        id="assistant-store-reviewer-comment"
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
                            id: "assistantStore.review.decline",
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
                            id: "assistantStore.review.accept",
                            message: "Accept",
                          })}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    selectedVersion.reviewer_review_comment && (
                      <div>
                        <h3 className="mb-1 text-sm font-semibold text-theme-fg-primary">
                          {t({
                            id: "assistantStore.review.reviewerComment",
                            message: "Reviewer comment",
                          })}
                        </h3>
                        <p className="whitespace-pre-wrap rounded border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-secondary">
                          {selectedVersion.reviewer_review_comment}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {config?.can_review &&
            !isLoading &&
            !versionId &&
            versions.map((version) => (
              <AssistantStoreVersionCard
                key={version.version_id}
                version={version}
                categories={config.categories}
                onOpen={() =>
                  navigate(`/assistant-store/review/${version.version_id}`)
                }
                actions={
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/assistant-store/review/${version.version_id}`,
                        )
                      }
                    >
                      {t({
                        id: "assistantStore.review.viewDetails",
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
