import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ArrowLeftIcon, FileTextIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui";
import {
  useAssistantStoreConfig,
  useGetAssistant,
  useGetAssistantStoreAssistant,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  AssistantStoreBreadcrumb,
  AssistantStoreDiff,
  getAssistantStoreStatusClassName,
  getAssistantStoreStatusLabel,
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

  const categoryNames =
    version?.category_ids
      .map((categoryId) =>
        config?.categories.find((category) => category.id === categoryId),
      )
      .filter(Boolean)
      .map((category) => category?.display_name) ?? [];

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <PageHeader
        title={version?.assistant.name ?? t`Assistant Store`}
        subtitle={version?.assistant.description ?? undefined}
      />

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
              <div className="flex justify-center">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => navigate(`/a/${version.assistant_id}`)}
                >
                  {t({
                    id: "assistantStore.action.startChat",
                    message: "Start chat",
                  })}
                </Button>
              </div>

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <div className="mb-4 flex flex-wrap gap-2">
                  {(() => {
                    const versionNumber = version.version_number;

                    return (
                      <span className="inline-flex items-center rounded-full border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-secondary">
                        {t`Version ${versionNumber}`}
                      </span>
                    );
                  })()}
                  <span
                    className={getAssistantStoreStatusClassName(version.status)}
                  >
                    {getAssistantStoreStatusLabel(version.status)}
                  </span>
                  {categoryNames.map((categoryName) => (
                    <span
                      key={categoryName}
                      className="inline-flex items-center rounded-full border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-secondary"
                    >
                      {categoryName}
                    </span>
                  ))}
                </div>
                <p className="whitespace-pre-wrap text-theme-fg-primary">
                  {version.long_description}
                </p>
                {version.version_comment && (
                  <div className="mt-4 rounded-lg border border-theme-border bg-theme-bg-secondary p-4">
                    <h2 className="mb-2 text-sm font-semibold text-theme-fg-primary">
                      {t({
                        id: "assistantStore.detail.versionComment",
                        message: "Version comment",
                      })}
                    </h2>
                    <p className="whitespace-pre-wrap text-sm text-theme-fg-secondary">
                      {version.version_comment}
                    </p>
                  </div>
                )}
                {version.keywords.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {version.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded border border-theme-border bg-theme-bg-secondary px-2 py-1 text-xs text-theme-fg-secondary"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
                <h2 className="mb-4 text-lg font-semibold text-theme-fg-primary">
                  {t({
                    id: "assistantStore.detail.configuration",
                    message: "Configuration",
                  })}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm font-medium text-theme-fg-primary">
                      {t({
                        id: "assistantStore.detail.model",
                        message: "Default model",
                      })}
                    </div>
                    <p className="text-sm text-theme-fg-secondary">
                      {version.assistant.default_chat_provider ?? t`Not set`}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-theme-fg-primary">
                      {t({
                        id: "assistantStore.detail.tools",
                        message: "Tools",
                      })}
                    </div>
                    <p className="text-sm text-theme-fg-secondary">
                      {(version.assistant.mcp_server_ids ?? []).length > 0
                        ? version.assistant.mcp_server_ids?.join(", ")
                        : t`None`}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-theme-fg-primary">
                      {t({
                        id: "assistantStore.detail.facets",
                        message: "Facets",
                      })}
                    </div>
                    <p className="text-sm text-theme-fg-secondary">
                      {(version.assistant.facet_ids ?? []).length > 0
                        ? version.assistant.facet_ids?.join(", ")
                        : t`None`}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-theme-fg-primary">
                      {t({
                        id: "assistantStore.detail.files",
                        message: "Files",
                      })}
                    </div>
                    {assistantDetails?.files.length ? (
                      <ul className="space-y-1 text-sm text-theme-fg-secondary">
                        {assistantDetails.files.map((file) => (
                          <li key={file.id} className="flex items-center gap-2">
                            <FileTextIcon className="size-4 shrink-0" />
                            <span>{file.filename}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-theme-fg-secondary">{t`None`}</p>
                    )}
                  </div>
                </div>
                <div className="mt-6">
                  <div className="mb-2 text-sm font-medium text-theme-fg-primary">
                    {t({
                      id: "assistantStore.detail.prompt",
                      message: "System prompt",
                    })}
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-theme-border bg-theme-bg-secondary p-4 text-sm text-theme-fg-primary">
                    {version.assistant.prompt}
                  </pre>
                </div>
              </section>

              {version.diff_summary.baseline_version_id && (
                <section className="rounded-lg border border-theme-border bg-theme-bg-primary p-6">
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
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
