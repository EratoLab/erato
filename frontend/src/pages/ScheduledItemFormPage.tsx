import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Card } from "@/components/ui/Container/Card";
import { PageHeader } from "@/components/ui/Container/PageHeader";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import { ScheduledItemForm } from "@/components/ui/Scheduled/ScheduledItemForm";
import {
  SCHEDULED_ITEMS_QUERY_KEY,
  scheduledChannelStatus,
  scheduledNoChannelConnected,
  scheduledRefusalCode,
  scheduledRefusalMessage,
} from "@/components/ui/Scheduled/scheduledApi";
import {
  emptyScheduledFormValues,
  scheduledFormValuesForRepeat,
  scheduledFormValuesFromItem,
  scheduledFormValuesFromTemplate,
  scheduledItemRequestBody,
  scheduledRefusalPlacement,
} from "@/components/ui/Scheduled/scheduledForm";
import { toast } from "@/components/ui/Toast";
import { useScheduledTemplates } from "@/hooks/scheduled/useScheduledItems";
import { usePageAlignment } from "@/hooks/ui";
import {
  useCreateScheduledItem,
  useGetScheduledItem,
  useListScheduledItems,
  useRecentChats,
  useUpdateScheduledItem,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useScheduledFeature } from "@/providers/FeatureConfigProvider";
import { resolveRecentChatTitle } from "@/utils/chat/recentChatSession";

import type { ScheduledLinkableChat } from "@/components/ui/Scheduled/ScheduledItemForm";
import type {
  ScheduledFormErrors,
  ScheduledFormValues,
} from "@/components/ui/Scheduled/scheduledForm";

const LINKABLE_CHATS = 20;
const SAVE_TOAST_KEY = "scheduled-item-save";

/**
 * `/scheduled/new` and `/scheduled/:itemId/edit`. A new item can start from
 * a template (`?template=<id>`) or from an earlier item (`?from=<itemId>`,
 * "Schedule again"); `?type=` picks the type, of which only reminders exist.
 */
export default function ScheduledItemFormPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");

  const mode = itemId ? "edit" : "create";
  const fromId = itemId ? null : searchParams.get("from");
  const templateId = itemId || fromId ? null : searchParams.get("template");
  const sourceId = itemId ?? fromId;

  // The list carries the user's zone and the channels' state; the list page
  // has usually loaded it already.
  const list = useListScheduledItems({ queryParams: { tab: "upcoming" } });
  const source = useGetScheduledItem(
    sourceId ? { pathParams: { itemId: sourceId } } : skipToken,
  );
  const { templates, isLoading: templatesLoading } = useScheduledTemplates();
  const { teamsAppName } = useScheduledFeature();
  const recentChats = useRecentChats({
    queryParams: { limit: LINKABLE_CHATS },
  });

  const timeZone = list.data?.time_zone;
  const template = templateId
    ? templates.find((entry) => entry.id === templateId)
    : undefined;

  const isLoading =
    list.isLoading ||
    (sourceId != null && source.isLoading) ||
    (templateId != null && templatesLoading);

  const [initialValues, setInitialValues] =
    useState<ScheduledFormValues | null>(null);
  useEffect(() => {
    if (isLoading || initialValues) return;
    if (sourceId && !source.data) return;
    const now = new Date();
    setInitialValues(
      source.data
        ? mode === "edit"
          ? scheduledFormValuesFromItem(source.data, now, timeZone)
          : scheduledFormValuesForRepeat(source.data, now, timeZone)
        : template
          ? scheduledFormValuesFromTemplate(template, now, timeZone)
          : emptyScheduledFormValues(now, timeZone),
    );
  }, [
    isLoading,
    initialValues,
    sourceId,
    source.data,
    mode,
    template,
    timeZone,
  ]);

  const chats = useMemo<ScheduledLinkableChat[]>(() => {
    const listed = (recentChats.data?.chats ?? []).map((chat) => ({
      id: chat.id,
      title:
        resolveRecentChatTitle(chat.title_resolved) ??
        t({ id: "chat.newChat.title", message: "New Chat" }),
    }));
    // The chat an item links to can be older than the recent ones.
    const linked = source.data?.linked_chat;
    return linked && !listed.some((chat) => chat.id === linked.id)
      ? [linked, ...listed]
      : listed;
  }, [recentChats.data, source.data]);

  const create = useCreateScheduledItem();
  const save = useUpdateScheduledItem();
  const isSubmitting = create.isPending || save.isPending;
  const [serverErrors, setServerErrors] = useState<ScheduledFormErrors>();
  const [formError, setFormError] = useState<string | null>(null);

  const title =
    mode === "edit"
      ? t({ id: "scheduled.form.title.edit", message: "Edit reminder" })
      : t({ id: "scheduled.form.title.new", message: "New reminder" });

  useEffect(() => {
    document.title = `${title} - ${t({ id: "branding.page_title_suffix" })}`;
  }, [title]);

  const subtitle = (() => {
    if (mode === "edit") {
      return t({
        id: "scheduled.form.subtitle.edit",
        message: "Changes apply to what has not happened yet.",
      });
    }
    if (source.data) {
      const name = source.data.name;
      return t({
        id: "scheduled.form.subtitle.again",
        message: `Filled in from “${name}”. Pick when it should happen again.`,
      });
    }
    if (template) {
      const templateTitle = template.title;
      return t({
        id: "scheduled.form.subtitle.template",
        message: `Filled in from the template “${templateTitle}”. Change anything you like.`,
      });
    }
    return t({
      id: "scheduled.form.subtitle.new",
      message: "Choose when it happens and what you receive.",
    });
  })();

  const backToList = () => {
    toast.dismissKey(SAVE_TOAST_KEY);
    navigate("/scheduled");
  };

  const handleSubmit = async (values: ScheduledFormValues) => {
    setServerErrors(undefined);
    setFormError(null);
    const body = scheduledItemRequestBody(values);
    try {
      if (mode === "edit" && itemId) {
        await save.mutateAsync({ pathParams: { itemId }, body });
      } else {
        await create.mutateAsync({ body });
      }
    } catch (error) {
      const code = scheduledRefusalCode(error);
      const message = scheduledRefusalMessage(code);
      const placement = scheduledRefusalPlacement(code);
      if ("field" in placement) {
        setServerErrors({ [placement.field]: message });
      } else {
        setFormError(message);
      }
      return;
    }
    void queryClient.invalidateQueries({ queryKey: SCHEDULED_ITEMS_QUERY_KEY });
    const name = values.name.trim();
    toast.success({
      dedupeKey: SAVE_TOAST_KEY,
      title:
        mode === "edit"
          ? t({
              id: "scheduled.form.saved",
              message: `Changes to “${name}” saved`,
            })
          : t({
              id: "scheduled.form.created",
              message: `“${name}” is scheduled`,
            }),
    });
    navigate("/scheduled");
  };

  let content: React.ReactNode;
  if (sourceId && source.error) {
    content = (
      <Alert
        type="error"
        action={
          <Button variant="secondary" size="sm" onClick={backToList}>
            {t({
              id: "scheduled.form.backToList",
              message: "Back to the list",
            })}
          </Button>
        }
      >
        {scheduledRefusalMessage(scheduledRefusalCode(source.error))}
      </Alert>
    );
  } else if (!initialValues) {
    content = (
      <div className="flex justify-center py-12">
        <SpinnerIcon
          size="xl"
          label={t({ id: "scheduled.form.loading", message: "Loading..." })}
        />
      </div>
    );
  } else {
    const channelStatus = list.data
      ? scheduledChannelStatus(list.data.channels, initialValues.channel)
      : (source.data?.channel_status ?? "connected");
    content = (
      <Card variant="surface" size="xl">
        <ScheduledItemForm
          mode={mode}
          initialValues={initialValues}
          timeZone={timeZone}
          channelStatus={channelStatus}
          teamsAppName={teamsAppName}
          // Without a channel nothing can be scheduled, so the setup hint in
          // the delivery settings shows before the first try.
          initialAdvancedOpen={
            list.data
              ? scheduledNoChannelConnected(list.data.channels)
              : channelStatus !== "connected"
          }
          snoozedUntil={
            mode === "edit" && source.data?.status === "snoozed"
              ? source.data.next_occurrence?.at
              : null
          }
          chats={chats}
          isSubmitting={isSubmitting}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={(values) => void handleSubmit(values)}
          onCancel={backToList}
        />
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col bg-theme-bg-secondary">
      <PageHeader density="compact" title={title} subtitle={subtitle} />
      <div className={clsx("flex-1 overflow-auto", horizontalPadding)}>
        <div className={clsx("py-6", containerClasses)}>{content}</div>
      </div>
    </div>
  );
}
