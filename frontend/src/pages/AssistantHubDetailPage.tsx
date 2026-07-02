import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Star } from "iconoir-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FormField, Textarea } from "@/components/ui/Input";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantHubConfig,
  useGetAssistant,
  useGetAssistantHubAssistant,
  useListAssistantHubReviews,
  useProfile,
  useSubmitAssistantHubReview,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantHubBreadcrumb,
  AssistantHubDiff,
  getAssistantHubRatingLabel,
  AssistantHubVersionConfigurationSection,
  AssistantHubVersionOverviewSection,
} from "./assistantHubUtils";

import type {
  AssistantHubUserReview,
  AssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

function AssistantHubReviewsSection({
  hubAssistantId,
  version,
}: {
  hubAssistantId: string;
  version: AssistantHubVersion;
}) {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile({});
  const { data: reviewsData, isLoading } = useListAssistantHubReviews({
    pathParams: { hubAssistantId },
  });
  const submitReview = useSubmitAssistantHubReview();
  const reviews = useMemo(
    () => reviewsData?.reviews ?? [],
    [reviewsData?.reviews],
  );
  const myReview = useMemo(
    () => reviews.find((review) => review.reviewer.id === profile?.id) ?? null,
    [profile?.id, reviews],
  );
  const [score, setScore] = useState(10);
  const [comment, setComment] = useState("");
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    if (!myReview) return;
    setScore(myReview.score);
    setComment(myReview.comment ?? "");
  }, [myReview]);

  const canSubmit = Number.isInteger(score) && score >= 1 && score <= 10;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitError(false);
    try {
      await submitReview.mutateAsync({
        pathParams: { hubAssistantId },
        body: {
          score,
          comment: comment.trim().length > 0 ? comment.trim() : null,
        },
      });
      await queryClient.invalidateQueries();
    } catch {
      setSubmitError(true);
    }
  };

  return (
    <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-theme-fg-primary">
          {t({
            id: "assistantHub.reviews.title",
            message: "Reviews",
          })}
        </h2>
        <div className="mt-3 rounded-lg border border-theme-border bg-theme-bg-secondary p-4">
          <div className="text-sm font-medium text-theme-fg-primary">
            {t({
              id: "assistantHub.reviews.aggregateScore",
              message: "Aggregated score",
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ScoreStars score={version.review_average_score ?? 0} />
            <span className="text-sm text-theme-fg-secondary">
              {getAssistantHubRatingLabel(version)}
            </span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-theme-fg-primary">
          {t({
            id: "assistantHub.reviews.visibleComments",
            message: "Visible comments",
          })}
        </h3>
        {isLoading ? (
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "assistantHub.reviews.loading",
              message: "Loading reviews...",
            })}
          </p>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "assistantHub.reviews.empty",
              message: "No visible review comments yet.",
            })}
          </p>
        ) : (
          <div className="divide-y divide-theme-border rounded-lg border border-theme-border">
            {reviews.map((review) => (
              <ReviewComment key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="mt-6 grid gap-4 border-t border-theme-border pt-6"
      >
        {submitError && (
          <Alert type="error">
            {t({
              id: "assistantHub.reviews.error.submit",
              message: "Failed to submit review.",
            })}
          </Alert>
        )}

        <FormField
          label={t({
            id: "assistantHub.reviews.score",
            message: "Score",
          })}
          required
        >
          <StarScoreSelector score={score} onChange={setScore} />
        </FormField>
        <FormField
          label={t({
            id: "assistantHub.reviews.comment",
            message: "Comment",
          })}
          htmlFor="assistant-hub-review-comment"
          helpText={t({
            id: "assistantHub.reviews.commentHelp",
            message: "Optional: add context for your score.",
          })}
        >
          <Textarea
            id="assistant-hub-review-comment"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </FormField>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={submitReview.isPending}
            disabled={!canSubmit || submitReview.isPending}
          >
            {myReview
              ? t({
                  id: "assistantHub.reviews.update",
                  message: "Update review",
                })
              : t({
                  id: "assistantHub.reviews.submit",
                  message: "Submit review",
                })}
          </Button>
        </div>
      </form>
    </section>
  );
}

const REVIEW_SCORE_VALUES = Array.from({ length: 10 }, (_, index) => index + 1);

function StarScoreSelector({
  score,
  onChange,
}: {
  score: number;
  onChange: (score: number) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1"
      role="radiogroup"
      aria-label={t({
        id: "assistantHub.reviews.scoreSelector",
        message: "Review score",
      })}
    >
      {REVIEW_SCORE_VALUES.map((value) => {
        const isSelected = value <= score;
        const scoreLabel = value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={t({
              id: "assistantHub.reviews.scoreOption",
              message: `${scoreLabel} out of 10`,
            })}
            onClick={() => onChange(value)}
            className={clsx(
              "focus-ring theme-transition flex size-8 items-center justify-center rounded text-theme-fg-muted hover:bg-theme-bg-hover",
              isSelected && "text-theme-warning-fg",
            )}
          >
            <Star
              className={clsx("size-6", isSelected && "fill-current")}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

function ScoreStars({ score }: { score: number }) {
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

function ReviewComment({ review }: { review: AssistantHubUserReview }) {
  const score = review.score;
  const versionNumber = review.version_number;

  return (
    <article className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <ScoreStars score={score} />
        <span className="text-theme-fg-muted">
          {t({
            id: "assistantHub.reviews.scoreValue",
            message: `${score} / 10`,
          })}
        </span>
        <span className="text-theme-fg-muted">
          {t({
            id: "assistantHub.reviews.versionValue",
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

export default function AssistantHubDetailPage() {
  const navigate = useNavigate();
  const { hubAssistantId } = useParams<{ hubAssistantId: string }>();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config } = useAssistantHubConfig({});
  const { data, isLoading, error } = useGetAssistantHubAssistant(
    hubAssistantId ? { pathParams: { hubAssistantId } } : skipToken,
  );
  const version = data?.version;
  const { data: assistantDetails } = useGetAssistant(
    version ? { pathParams: { assistantId: version.assistant_id } } : skipToken,
  );

  useEffect(() => {
    document.title = `${
      version?.assistant.name ??
      t({
        id: "assistantHub.detail.title",
        message: "Assistant Hub",
      })
    } - ${t({ id: "branding.page_title_suffix" })}`;
  }, [version?.assistant.name]);

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          <AssistantHubBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() => navigate("/assistant-hub")}
          >
            {t({
              id: "assistantHub.action.backToHub",
              message: "Back to hub",
            })}
          </AssistantHubBreadcrumb>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantHub.detail.loading",
                    message: "Loading hub assistant...",
                  })}
                </p>
              </div>
            </div>
          )}

          {error && (
            <Alert type="error">
              {t({
                id: "assistantHub.detail.error",
                message: "Failed to load hub assistant.",
              })}
            </Alert>
          )}

          {version && (
            <>
              <AssistantHubVersionOverviewSection
                version={version}
                categories={config?.categories ?? []}
                onStartChat={() => navigate(`/a/${version.assistant_id}`)}
              />

              <AssistantHubVersionConfigurationSection
                version={version}
                assistantDetails={assistantDetails}
              />

              <AssistantHubReviewsSection
                hubAssistantId={version.hub_assistant_id}
                version={version}
              />

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <div className="mb-5">
                  {(() => {
                    const versionNumber = version.version_number;

                    return (
                      <h2 className="text-lg font-semibold text-theme-fg-primary">
                        {t`Version ${versionNumber}`}
                      </h2>
                    );
                  })()}
                  {version.version_comment && (
                    <div className="mt-3">
                      <h3 className="mb-2 text-sm font-semibold text-theme-fg-primary">
                        {t({
                          id: "assistantHub.detail.versionComment",
                          message: "Version comment",
                        })}
                      </h3>
                      <p className="whitespace-pre-wrap text-sm text-theme-fg-secondary">
                        {version.version_comment}
                      </p>
                    </div>
                  )}
                </div>

                {version.diff_summary.baseline_version_id && (
                  <details>
                    <summary className="focus-ring theme-transition cursor-pointer text-lg font-semibold text-theme-fg-primary hover:text-theme-fg-secondary">
                      {t({
                        id: "assistantHub.detail.diff",
                        message: "Changes from previous version",
                      })}
                    </summary>
                    <div className="mt-4">
                      <AssistantHubDiff diffSummary={version.diff_summary} />
                    </div>
                  </details>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
