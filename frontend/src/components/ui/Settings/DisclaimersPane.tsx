import { t } from "@lingui/core/macro";

import { useListDisclaimers } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { ReadOnlyMarkdown } from "../Markdown/ReadOnlyMarkdown";

export function DisclaimersPane() {
  const { data, isPending, isError, isFetching, refetch } = useListDisclaimers(
    {},
    { retry: false, staleTime: 5 * 60 * 1000 },
  );

  if (isPending) {
    return (
      <p role="status" className="text-sm text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.disclaimers.loading",
          message: "Loading disclaimers…",
        })}
      </p>
    );
  }

  if (isError && !data) {
    return (
      <Alert type="error">
        <p>
          {t({
            id: "preferences.dialog.disclaimers.loadError",
            message: "Could not load disclaimers.",
          })}
        </p>
        <Button
          className="mt-2"
          size="sm"
          variant="secondary"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t({
            id: "preferences.dialog.disclaimers.retry",
            message: "Retry",
          })}
        </Button>
      </Alert>
    );
  }

  if (!data.disclaimers.length) {
    return (
      <p className="text-sm text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.disclaimers.empty",
          message: "No disclaimers are configured.",
        })}
      </p>
    );
  }

  return (
    <div className="space-y-6 break-words">
      {data.disclaimers.map(({ id, title, content }) => (
        <section key={id} className="space-y-2">
          <h2 className="text-base font-semibold text-theme-fg-primary">
            {title}
          </h2>
          <div className="text-sm text-theme-fg-primary">
            <ReadOnlyMarkdown>{content}</ReadOnlyMarkdown>
          </div>
        </section>
      ))}
    </div>
  );
}
