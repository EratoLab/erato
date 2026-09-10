import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { Card } from "@/components/ui/Container/Card";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Alert } from "@/components/ui/Feedback/Alert";
import { useGetAssistantUsage } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useAssistantsFeature } from "@/providers/FeatureConfigProvider";

import type { UsageBucket } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

function UsageChart({
  buckets,
  invocationsLabel,
  usersLabel,
}: {
  buckets: UsageBucket[];
  invocationsLabel: string;
  usersLabel: string;
}) {
  const maximum = Math.max(
    2,
    Math.ceil(Math.max(0, ...buckets.map((point) => point.invocations)) / 2) *
      2,
  );
  const x = (index: number) =>
    55 + (index * 710) / Math.max(1, buckets.length - 1);
  const y = (value: number) => 210 - (value * 180) / maximum;
  const points = (metric: "invocations" | "unique_users") =>
    buckets.map((point, index) => `${x(index)},${y(point[metric])}`).join(" ");
  return (
    <Card variant="surface" size="md" bodyClassName="overflow-x-auto">
      <div className="mb-3 flex flex-wrap gap-6 text-sm">
        <span className="flex items-center gap-2 text-theme-fg-primary">
          <span aria-hidden="true" className="w-6 border-t-2 border-current" />
          {invocationsLabel}
        </span>
        <span className="flex items-center gap-2 text-theme-fg-muted">
          <span
            aria-hidden="true"
            className="w-6 border-t-2 border-dashed border-current"
          />
          {usersLabel}
        </span>
      </div>
      <svg
        viewBox="0 0 800 250"
        role="img"
        aria-label={`${invocationsLabel}, ${usersLabel}`}
        className="min-w-96 text-theme-fg-primary"
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="55"
              x2="765"
              y1={y(maximum * fraction)}
              y2={y(maximum * fraction)}
              stroke="currentColor"
              opacity="0.15"
            />
            <text
              x="45"
              y={y(maximum * fraction) + 4}
              textAnchor="end"
              fill="currentColor"
              fontSize="12"
            >
              {Math.ceil(maximum * fraction).toLocaleString()}
            </text>
          </g>
        ))}
        <polyline
          points={points("invocations")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <polyline
          points={points("unique_users")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="6 4"
          opacity="0.5"
        />
        {buckets.map((point, index) => (
          <circle
            key={point.date}
            cx={x(index)}
            cy={y(point.invocations)}
            r="3"
            fill="currentColor"
          >
            <title>{`${point.date}: ${invocationsLabel} ${point.invocations}, ${usersLabel} ${point.unique_users}`}</title>
          </circle>
        ))}
        <text x="55" y="238" fill="currentColor" fontSize="12">
          {buckets[0]?.date}
        </text>
        <text
          x="765"
          y="238"
          textAnchor="end"
          fill="currentColor"
          fontSize="12"
        >
          {buckets.at(-1)?.date}
        </text>
      </svg>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer">
          {t({ id: "assistant.usage.table", message: "View data table" })}
        </summary>
        <table className="mt-3 w-full text-left">
          <thead>
            <tr>
              <th scope="col">
                {t({
                  id: "assistant.usage.date",
                  message: "Bucket start (UTC)",
                })}
              </th>
              <th scope="col">{invocationsLabel}</th>
              <th scope="col">{usersLabel}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((point) => (
              <tr key={point.date}>
                <th scope="row" className="py-1 font-normal">
                  {point.date}
                </th>
                <td>{point.invocations.toLocaleString()}</td>
                <td>{point.unique_users.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

export default function AssistantUsagePage() {
  const { id } = useParams<{ id: string }>();
  const { enabled, usageViewEnabled } = useAssistantsFeature();
  const [weeks, setWeeks] = useState(4);
  const { data, isPending, error } = useGetAssistantUsage(
    enabled && usageViewEnabled && id
      ? { pathParams: { assistantId: id }, queryParams: { weeks } }
      : skipToken,
  );
  const title = t({
    id: "assistant.usage.title",
    message: "Assistants usage view",
  });
  const invocationsLabel = t({
    id: "assistant.usage.invocations",
    message: "Assistant invocations",
  });
  const usersLabel = t({
    id: "assistant.usage.users",
    message: "Unique users",
  });
  useEffect(() => {
    document.title = title;
  }, [title]);
  if (!enabled || !usageViewEnabled)
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route
    return <Navigate to="/assistants" replace />;
  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      <PageHeader
        density="compact"
        title={title}
        subtitle={data?.assistant_name}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route */}
          <Link to="/assistants/created" className="text-sm underline">
            {t({ id: "assistant.usage.back", message: "Back to assistants" })}
          </Link>
          <div>
            <label className="flex items-center gap-3 text-sm">
              {t({ id: "assistant.usage.timeframe", message: "Timeframe" })}
              <select
                value={weeks}
                onChange={(event) => setWeeks(Number(event.target.value))}
                className="rounded-md border border-theme-border bg-theme-bg-primary px-3 py-2 text-theme-fg-primary"
              >
                <option value={1}>
                  {t({ id: "assistant.usage.week", message: "Last week" })}
                </option>
                <option value={4}>
                  {t({
                    id: "assistant.usage.fourWeeks",
                    message: "Last 4 weeks",
                  })}
                </option>
                <option value={12}>
                  {t({
                    id: "assistant.usage.twelveWeeks",
                    message: "Last 12 weeks",
                  })}
                </option>
                <option value={52}>
                  {t({ id: "assistant.usage.year", message: "Last 52 weeks" })}
                </option>
              </select>
            </label>
          </div>
          {error ? (
            <Alert type="error">
              {t({
                id: "assistant.usage.error",
                message:
                  "Usage could not be loaded. This view is only available to assistant editors.",
              })}
            </Alert>
          ) : isPending ? (
            <p role="status">
              {t({ id: "common.loadingEllipsis", message: "Loading..." })}
            </p>
          ) : (
            data && (
              <>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[
                    { label: invocationsLabel, value: data.total_invocations },
                    { label: usersLabel, value: data.total_unique_users },
                  ].map(({ label, value }) => (
                    // Not a Card: the frame would wrap these in its body
                    // element, and a dl group may only hold dt and dd.
                    <div
                      key={label}
                      className="rounded-lg border border-theme-border bg-theme-bg-primary p-5"
                    >
                      <dt className="text-sm text-theme-fg-secondary">
                        {label}
                      </dt>
                      <dd className="mt-2 text-3xl font-semibold text-theme-fg-primary">
                        {value.toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-theme-fg-secondary">
                  {data.bucket_days === 1
                    ? t({
                        id: "assistant.usage.daily",
                        message: "Daily usage · UTC · Includes today",
                      })
                    : t({
                        id: "assistant.usage.weekly",
                        message: "Weekly usage · UTC · Includes today",
                      })}
                </p>
                {data.total_invocations === 0 && (
                  <p>
                    {t({
                      id: "assistant.usage.empty",
                      message: "No usage in this timeframe.",
                    })}
                  </p>
                )}
                <UsageChart
                  buckets={data.buckets}
                  invocationsLabel={invocationsLabel}
                  usersLabel={usersLabel}
                />
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
