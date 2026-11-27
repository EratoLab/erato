import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";

import {
  BUDGET_REFRESH_INTERVAL,
  useBudgetStatus,
} from "@/hooks/budget/useBudgetStatus";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

export function BudgetPane() {
  const { i18n } = useLingui();
  const { data, isPending, isError, isFetching, refetch } = useBudgetStatus({
    refetchInterval: BUDGET_REFRESH_INTERVAL,
    refreshOnMount: true,
  });

  if (isPending) {
    return (
      <p role="status" className="text-sm text-theme-fg-secondary">
        {t({ id: "preferences.budget.loading", message: "Loading budget…" })}
      </p>
    );
  }

  const settings = data?.user_settings;
  const retry = (
    <Button
      variant="secondary"
      type="button"
      disabled={isFetching}
      onClick={() => void refetch()}
    >
      {t({ id: "preferences.budget.retry", message: "Retry" })}
    </Button>
  );

  if (
    !data?.enabled ||
    !settings ||
    data.current_spending === null ||
    data.budget_limit === null ||
    data.budget_period_days === null
  ) {
    return (
      <Alert type="error" action={retry}>
        {t({
          id: "preferences.budget.error",
          message: "Could not load your budget.",
        })}
      </Alert>
    );
  }

  const {
    current_spending: spending,
    budget_limit: limit,
    budget_period_days: days,
  } = data;
  const { pricing_complete: complete, allowance_freed_next_24h: freeingUp } =
    settings;
  const unavailable = t({
    id: "preferences.budget.unavailable",
    message: "Unavailable",
  });
  const partial = t({ id: "preferences.budget.partial", message: "Partial" });
  const browserLocale = navigator.language;
  const locale =
    browserLocale.split("-")[0] === i18n.locale
      ? browserLocale
      : i18n.locale || undefined;
  const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: data.budget_currency ?? "USD",
  });
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const start = date.format(new Date(settings.window_start));
  const end = date.format(new Date(settings.as_of));
  const totals = [
    {
      label: t({ id: "preferences.budget.spent", message: "Spent" }),
      value: currency.format(spending),
      note: complete ? undefined : partial,
    },
    {
      label: t({ id: "preferences.budget.limit", message: "Limit" }),
      value: currency.format(limit),
    },
    {
      label: t({
        id: "preferences.budget.remaining",
        message: "Remaining allowance",
      }),
      value: complete
        ? currency.format(Math.max(0, limit - spending))
        : unavailable,
    },
    {
      label: t({ id: "preferences.budget.used", message: "Budget used" }),
      value: complete ? percent.format(spending / limit) : unavailable,
    },
  ];

  return (
    <div className="space-y-4 pb-2 text-sm">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-theme-fg-primary">
          {t({
            id: "preferences.budget.window",
            message: plural(days, {
              one: "Spending over the last day",
              other: "Spending over the last # days",
            }),
          })}
        </h2>
        <p className="text-theme-fg-secondary">
          {t({
            id: "preferences.budget.windowDates",
            message: `${start} to ${end}`,
          })}
        </p>
      </div>

      {isError ? (
        <Alert type="warning" action={retry}>
          {t({
            id: "preferences.budget.stale",
            message:
              "Could not refresh your budget. These figures may be out of date.",
          })}
        </Alert>
      ) : null}
      {!complete ? (
        <Alert type="info">
          {t({
            id: "preferences.budget.incompletePricing",
            message: "Some usage has no configured price.",
          })}
        </Alert>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-theme-border p-4">
        {totals.map(({ label, value, note }) => (
          <div key={label} className="space-y-1">
            <dt className="text-theme-fg-secondary">{label}</dt>
            <dd className="break-words text-base font-semibold tabular-nums text-theme-fg-primary">
              {value}
              {note ? (
                <span className="ml-2 text-xs font-medium text-theme-fg-secondary">
                  {note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
        <div className="col-span-2 space-y-1 border-t border-theme-border pt-3">
          <dt className="text-theme-fg-secondary">
            {t({
              id: "preferences.budget.freeingUp",
              message: "Budget freeing up in the next 24 hours",
            })}
          </dt>
          <dd className="text-base font-semibold tabular-nums text-theme-fg-primary">
            {freeingUp === null ? unavailable : currency.format(freeingUp)}
          </dd>
          <dd className="text-theme-fg-secondary">
            {t({
              id: "preferences.budget.noNewSpend",
              message: "Assumes no new spending.",
            })}
          </dd>
        </div>
      </dl>

      <table className="w-full text-left">
        <caption className="pb-2 text-left font-semibold text-theme-fg-primary">
          {t({
            id: "preferences.budget.modelBreakdown",
            message: "Spending by model",
          })}
        </caption>
        <thead className="border-b border-theme-border text-theme-fg-secondary">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t({
                id: "preferences.budget.model",
                message: "Model or deployment",
              })}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t({ id: "preferences.budget.spent", message: "Spent" })}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-theme-border text-theme-fg-primary">
          {settings.models.length === 0 ? (
            <tr>
              <td colSpan={2} className="py-2 text-theme-fg-secondary">
                {t({
                  id: "preferences.budget.noUsage",
                  message: "No usage in this window.",
                })}
              </td>
            </tr>
          ) : (
            settings.models.map((model) => (
              <tr key={model.identifier}>
                <th scope="row" className="break-all py-2 pr-3 font-medium">
                  {model.label}
                </th>
                <td className="py-2 text-right tabular-nums">
                  {model.spending === null
                    ? unavailable
                    : currency.format(model.spending)}
                  {model.spending !== null && !model.pricing_complete ? (
                    <span className="ml-2 text-xs text-theme-fg-secondary">
                      {partial}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
