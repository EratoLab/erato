import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { EditIcon, PlusIcon } from "@/components/ui/icons";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import { useListAssistants } from "@/lib/generated/v1betaApi/v1betaApiComponents";

export default function AssistantsListPage() {
  const navigate = useNavigate();
  
  // Fetch all assistants
  const { data, isLoading, error } = useListAssistants({});

  useEffect(() => {
    document.title = `${t`Assistants`} - ${t({ id: "branding.page_title_suffix" })}`;
  }, []);

  const assistants = data ?? [];

  // Handle navigation to create page
  const handleCreateNew = () => {
    navigate("/assistants/new");
  };

  // Handle navigation to edit page
  const handleEdit = (assistantId: string) => {
    navigate(`/assistants/${assistantId}/edit`);
  };

  // Handle creating chat with assistant
  const handleStartChat = (assistantId: string) => {
    // TODO: Implement in next phase
    console.log("Start chat with assistant:", assistantId);
  };

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      {/* Page Header */}
      <PageHeader
        title={t`Assistants`}
        subtitle={t`Create and manage custom assistants with specific instructions and capabilities`}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
                <p className="text-sm text-theme-fg-secondary">{t`Loading assistants...`}</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <Alert type="error">
              {t`Failed to load assistants. Please try again.`}
            </Alert>
          )}

          {/* Empty state */}
          {!isLoading && !error && assistants.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <EditIcon className="mx-auto mb-4 size-12 text-theme-fg-muted" />
                <h2 className="mb-2 text-xl font-semibold text-theme-fg-primary">
                  {t`No assistants yet`}
                </h2>
                <p className="mb-6 text-theme-fg-secondary">
                  {t`Create your first assistant to get started`}
                </p>
                <Button variant="primary" icon={<PlusIcon />} onClick={handleCreateNew}>
                  {t`Create Your First Assistant`}
                </Button>
              </div>
            </div>
          )}

          {/* Assistants list */}
          {!isLoading && !error && assistants.length > 0 && (
            <div className="space-y-3">
              {/* List header with count and create button */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-theme-fg-primary">
                  {t`Your Assistants`}
                </h2>
                <Button variant="primary" size="sm" icon={<PlusIcon />} onClick={handleCreateNew}>
                  {t`Create Assistant`}
                </Button>
              </div>

              {/* Assistants grid */}
              <div className="grid gap-3">
                {assistants.map((assistant: { id: string; name: string; description?: string | null; updated_at: string }) => (
                  <div
                    key={assistant.id}
                    className="block cursor-pointer rounded-lg border border-theme-border bg-theme-bg-primary p-4 transition-all hover:border-theme-border-focus hover:bg-theme-bg-hover focus:bg-theme-bg-hover focus:outline-none focus:ring-2 focus:ring-theme-focus"
                  >
                    <div className="flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="mb-1 font-medium text-theme-fg-primary">
                          {assistant.name}
                        </h3>
                        {assistant.description && (
                          <p className="mb-2 line-clamp-2 text-sm text-theme-fg-secondary">
                            {assistant.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-theme-fg-muted">
                          <span>
                            {t`Updated`}{" "}
                            <MessageTimestamp createdAt={new Date(assistant.updated_at)} />
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleStartChat(assistant.id)}
                        >
                          {t`New Chat`}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<EditIcon />}
                          onClick={() => handleEdit(assistant.id)}
                          aria-label={t`Edit assistant`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

