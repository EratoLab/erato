import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert } from "@/components/ui/Feedback/Alert";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantStoreConfig,
  useGetAssistant,
  useGetAssistantStoreAssistant,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantStoreBreadcrumb,
  AssistantStoreDiff,
  AssistantStoreVersionConfigurationSection,
  AssistantStoreVersionOverviewSection,
} from "./assistantStoreUtils";

export default function AssistantStoreDetailPage() {
  const navigate = useNavigate();
  const { storeAssistantId } = useParams<{ storeAssistantId: string }>();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const { data: config } = useAssistantStoreConfig({});
  const { data, isLoading, error } = useGetAssistantStoreAssistant(
    storeAssistantId ? { pathParams: { storeAssistantId } } : skipToken,
  );
  const version = data?.version;
  const { data: assistantDetails } = useGetAssistant(
    version ? { pathParams: { assistantId: version.assistant_id } } : skipToken,
  );

  useEffect(() => {
    document.title = `${
      version?.assistant.name ??
      t({
        id: "assistantStore.detail.title",
        message: "Assistant Store",
      })
    } - ${t({ id: "branding.page_title_suffix" })}`;
  }, [version?.assistant.name]);

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("space-y-6 py-6", containerClasses)}>
          <AssistantStoreBreadcrumb
            icon={<ArrowLeftIcon className="size-4" />}
            onClick={() => navigate("/assistant-store")}
          >
            {t({
              id: "assistantStore.action.backToStore",
              message: "Back to store",
            })}
          </AssistantStoreBreadcrumb>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "assistantStore.detail.loading",
                    message: "Loading store assistant...",
                  })}
                </p>
              </div>
            </div>
          )}

          {error && (
            <Alert type="error">
              {t({
                id: "assistantStore.detail.error",
                message: "Failed to load store assistant.",
              })}
            </Alert>
          )}

          {version && (
            <>
              <AssistantStoreVersionOverviewSection
                version={version}
                categories={config?.categories ?? []}
                onStartChat={() => navigate(`/a/${version.assistant_id}`)}
              />

              <AssistantStoreVersionConfigurationSection
                version={version}
                assistantDetails={assistantDetails}
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
                          id: "assistantStore.detail.versionComment",
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
                        id: "assistantStore.detail.diff",
                        message: "Changes from previous version",
                      })}
                    </summary>
                    <div className="mt-4">
                      <AssistantStoreDiff diffSummary={version.diff_summary} />
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
