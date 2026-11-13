import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  SCHEDULED_CHANNEL_INPUT_NAME,
  ScheduledDeliverySettings,
} from "./ScheduledDeliverySettings";
import {
  ScheduledTriggerSummary,
  weekdayName,
} from "./ScheduledTriggerSummary";
import {
  SCHEDULED_WEEKDAYS,
  scheduledTriggerUnchanged,
  validateScheduledForm,
  weekdayOfDateKey,
} from "./scheduledForm";
import { scheduledTypeLabel } from "./scheduledItems";
import { localDateKey } from "./scheduledTime";
import { Button } from "../Controls/Button";
import { COLLAPSE_DURATION_MS } from "../Controls/Collapse";
import { Alert } from "../Feedback/Alert";
import { FormField } from "../Input/FormField";
import { Input } from "../Input/Input";
import { Select } from "../Input/Select";
import { Textarea } from "../Input/Textarea";

import type {
  ScheduledEndKind,
  ScheduledFormErrors,
  ScheduledFormField,
  ScheduledFormValues,
  ScheduledFrequency,
  ScheduledTriggerKind,
} from "./scheduledForm";
import type { DeliveryChannelStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

export interface ScheduledLinkableChat {
  id: string;
  title: string;
}

export interface ScheduledItemFormProps {
  mode: "create" | "edit";
  initialValues: ScheduledFormValues;
  /** Whether the chosen channel reaches the user, from the API. */
  channelStatus: DeliveryChannelStatus;
  /** What the deployment's Teams app is called, for the channel's hints. */
  teamsAppName?: string | null;
  /** The user's recent chats, to link one. */
  chats: ScheduledLinkableChat[];
  /** The zone dates and times are entered in; the browser's when omitted. */
  timeZone?: string;
  /** Reference time for validation and the summary; now when omitted. */
  now?: Date;
  isSubmitting?: boolean;
  /** API refusals placed on a field; each clears when its field changes. */
  serverErrors?: ScheduledFormErrors;
  /** An API refusal for the form as a whole. */
  formError?: string | null;
  /**
   * Edit of a snoozed item: the ISO time the snooze moved it to. The fields
   * keep the item's own schedule; the summary says the snooze until the
   * schedule is changed.
   */
  snoozedUntil?: string | null;
  /** Show the field errors from the start, as after a submit. */
  initialShowErrors?: boolean;
  initialAdvancedOpen?: boolean;
  onSubmit: (values: ScheduledFormValues) => void;
  onCancel: () => void;
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-t border-theme-border pt-5">
      <h2 id={id} className="text-lg font-semibold text-theme-fg-primary">
        {title}
      </h2>
      <p className="mt-1 text-sm text-theme-fg-secondary">{description}</p>
    </div>
  );
}

/* eslint-disable lingui/no-unlocalized-strings -- selectors */
/**
 * Scrolls a refusal into view and focuses it: the channel when the delivery
 * settings were refused, else the first invalid field, else the form's alert.
 */
function revealRefusal(
  form: HTMLFormElement,
  formAlert: HTMLElement | null,
  channelRefused: boolean,
) {
  let target: HTMLElement | null;
  let shown: HTMLElement | null;
  if (channelRefused) {
    const settings = form.querySelector<HTMLElement>(
      '[data-ui="scheduled-delivery-settings"]',
    );
    target =
      settings?.querySelector<HTMLElement>(
        `input[name="${SCHEDULED_CHANNEL_INPUT_NAME}"]:checked`,
      ) ?? null;
    shown = settings?.querySelector<HTMLElement>('[role="alert"]') ?? target;
  } else {
    target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? formAlert;
    shown = target;
  }
  if (!target || !shown) return;
  shown.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
}
/* eslint-enable lingui/no-unlocalized-strings */

function RowError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="-mt-3 text-sm text-theme-error-fg">
      {children}
    </p>
  );
}

/**
 * The one form for creating and editing a scheduled item: name and type,
 * the trigger, what arrives, and where it is delivered. Times are local to
 * the user's stored zone, which the form never names.
 */
export function ScheduledItemForm({
  mode,
  initialValues,
  channelStatus,
  teamsAppName = null,
  chats,
  timeZone,
  now,
  isSubmitting = false,
  serverErrors,
  formError,
  snoozedUntil,
  initialShowErrors = false,
  initialAdvancedOpen = false,
  onSubmit,
  onCancel,
}: ScheduledItemFormProps) {
  const { i18n } = useLingui();
  const locale = i18n.locale || undefined;
  const baseId = useId();
  /* eslint-disable lingui/no-unlocalized-strings -- element ids */
  const ids = {
    name: `${baseId}-name`,
    nameHelp: `${baseId}-name-help`,
    type: `${baseId}-type`,
    typeHelp: `${baseId}-type-help`,
    trigger: `${baseId}-trigger`,
    triggerError: `${baseId}-trigger-error`,
    weekdaysError: `${baseId}-weekdays-error`,
    repeatError: `${baseId}-repeat-error`,
    message: `${baseId}-message`,
    chat: `${baseId}-chat`,
    chatHelp: `${baseId}-chat-help`,
  };
  /* eslint-enable lingui/no-unlocalized-strings */

  const [values, setValues] = useState(initialValues);
  const [showErrors, setShowErrors] = useState(initialShowErrors);
  const [apiErrors, setApiErrors] = useState<ScheduledFormErrors>(
    serverErrors ?? {},
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    initialAdvancedOpen || Boolean(serverErrors?.channel),
  );

  const formRef = useRef<HTMLFormElement>(null);
  const formAlertRef = useRef<HTMLDivElement>(null);
  // A refusal comes back while the busy submit button had focus, so focus is
  // lost and the error can sit below the fold.
  const refusalToReveal = useRef(false);

  useEffect(() => {
    setApiErrors(serverErrors ?? {});
    if (serverErrors?.channel) setAdvancedOpen(true);
    if (serverErrors && Object.keys(serverErrors).length > 0) {
      refusalToReveal.current = true;
    }
  }, [serverErrors]);

  useEffect(() => {
    if (formError) refusalToReveal.current = true;
  }, [formError]);

  const channelRefused = Boolean(serverErrors?.channel);
  useEffect(() => {
    if (!refusalToReveal.current || isSubmitting) return;
    // Disabled fields cannot take focus, and the delivery settings unfold
    // first, so wait for both.
    const timer = window.setTimeout(
      () => {
        const form = formRef.current;
        if (!form) return;
        refusalToReveal.current = false;
        revealRefusal(form, formAlertRef.current, channelRefused);
      },
      channelRefused ? COLLAPSE_DURATION_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [serverErrors, formError, isSubmitting, channelRefused]);

  const reference = now ?? new Date();
  const loaded = mode === "edit" ? initialValues : undefined;
  const clientErrors = useMemo(
    () =>
      showErrors
        ? validateScheduledForm(values, reference, timeZone, loaded)
        : {},
    // `reference` is a fresh Date per render when `now` is omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showErrors, values, now, timeZone, loaded],
  );
  const errors: ScheduledFormErrors = { ...apiErrors, ...clientErrors };

  const update = <K extends keyof ScheduledFormValues>(
    field: K,
    value: ScheduledFormValues[K],
    clears: ScheduledFormField[] = [],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    const cleared = [field as ScheduledFormField, ...clears];
    setApiErrors((current) => {
      if (!cleared.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of cleared) delete next[key];
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    const found = validateScheduledForm(
      values,
      now ?? new Date(),
      timeZone,
      loaded,
    );
    if (Object.keys(found).length > 0) return;
    onSubmit(values);
  };

  const todayKey = localDateKey(reference, timeZone);
  const startsLabel = t({ id: "scheduled.form.starts", message: "Starts" });
  const endsLabel = t({ id: "scheduled.form.ends", message: "Ends" });
  const isOnce = values.triggerKind === "once";
  const triggerRowError = isOnce ? (errors.date ?? errors.time) : errors.time;
  const repeatRowError = isOnce
    ? undefined
    : (errors.date ?? errors.endDate ?? errors.endCount);

  const timeInput = (
    <div className="w-32 flex-none">
      <Input
        type="time"
        geometry="control"
        required
        value={values.time}
        onChange={(event) => update("time", event.target.value, ["date"])}
        aria-label={t({ id: "scheduled.form.time", message: "Time" })}
        aria-describedby={triggerRowError ? ids.triggerError : undefined}
        error={errors.time}
        disabled={isSubmitting}
      />
    </div>
  );

  const linkedChatMissing =
    values.linkedChatId !== "" &&
    !chats.some((chat) => chat.id === values.linkedChatId);

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6"
    >
      <FormField
        label={t({ id: "scheduled.form.name", message: "Name" })}
        required
        htmlFor={ids.name}
        helpText={t({
          id: "scheduled.form.name.help",
          message: "Shown in your list and as the title when it arrives.",
        })}
        helpTextId={ids.nameHelp}
        error={errors.name}
      >
        <Input
          id={ids.name}
          value={values.name}
          onChange={(event) => update("name", event.target.value)}
          aria-describedby={errors.name ? undefined : ids.nameHelp}
          error={errors.name}
          required
          disabled={isSubmitting}
        />
      </FormField>

      <FormField
        label={t({ id: "scheduled.form.type", message: "Type" })}
        htmlFor={ids.type}
        helpText={t({
          id: "scheduled.form.type.help",
          message: "A reminder sends you a message. It never runs anything.",
        })}
        helpTextId={ids.typeHelp}
      >
        <div className="max-w-sm">
          <Select
            id={ids.type}
            aria-describedby={ids.typeHelp}
            value={values.type}
            onChange={() => update("type", "reminder")}
            disabled={isSubmitting}
          >
            <option value="reminder">{scheduledTypeLabel("reminder")}</option>
            <option value="scheduled_task" disabled>
              {t({
                id: "scheduled.form.type.scheduledTaskLater",
                message: "Scheduled task (coming later)",
              })}
            </option>
          </Select>
        </div>
      </FormField>

      <SectionHeading
        id={ids.trigger}
        title={t({ id: "scheduled.form.trigger", message: "Trigger" })}
        description={t({
          id: "scheduled.form.trigger.description",
          message: "What makes it happen.",
        })}
      />

      <div
        role="group"
        aria-labelledby={ids.trigger}
        className="flex flex-wrap items-center gap-3"
        data-ui="scheduled-trigger-row"
      >
        <div className="w-60 max-w-full flex-none">
          <Select
            aria-label={t({ id: "scheduled.form.trigger", message: "Trigger" })}
            value={values.triggerKind}
            onChange={(event) =>
              update(
                "triggerKind",
                event.target.value as ScheduledTriggerKind,
                ["date"],
              )
            }
            disabled={isSubmitting}
          >
            <option value="once">
              {t({
                id: "scheduled.form.trigger.once",
                message: "At a date and time",
              })}
            </option>
            <option value="repeat">
              {t({
                id: "scheduled.form.trigger.repeat",
                message: "On a repeating schedule",
              })}
            </option>
          </Select>
        </div>
        {isOnce ? (
          <>
            <div className="w-44 flex-none">
              <Input
                type="date"
                geometry="control"
                required
                min={todayKey}
                value={values.date}
                onChange={(event) => update("date", event.target.value)}
                aria-label={t({ id: "scheduled.form.date", message: "Date" })}
                aria-describedby={
                  triggerRowError ? ids.triggerError : undefined
                }
                error={errors.date}
                disabled={isSubmitting}
              />
            </div>
            {timeInput}
          </>
        ) : (
          <>
            <div className="w-64 max-w-full flex-none">
              <Select
                aria-label={t({
                  id: "scheduled.form.frequency",
                  message: "Repeats",
                })}
                value={values.frequency}
                onChange={(event) =>
                  update(
                    "frequency",
                    event.target.value as ScheduledFrequency,
                    ["date", "weekdays"],
                  )
                }
                disabled={isSubmitting}
              >
                <option value="daily">
                  {t({
                    id: "scheduled.form.frequency.daily",
                    message: "Every day",
                  })}
                </option>
                <option value="weekdays">
                  {t({
                    id: "scheduled.form.frequency.weekdays",
                    message: "Every weekday (Monday to Friday)",
                  })}
                </option>
                <option value="weekly">
                  {t({
                    id: "scheduled.form.frequency.weekly",
                    message: "Every week",
                  })}
                </option>
                <option value="monthly">
                  {t({
                    id: "scheduled.form.frequency.monthly",
                    message: "Every month",
                  })}
                </option>
              </Select>
            </div>
            <span
              aria-hidden="true"
              className="text-sm text-theme-fg-secondary"
            >
              {t({ id: "scheduled.form.at", message: "at" })}
            </span>
            {timeInput}
          </>
        )}
      </div>
      {triggerRowError && (
        <RowError id={ids.triggerError}>{triggerRowError}</RowError>
      )}

      {!isOnce && (
        <div className="space-y-4">
          {values.frequency === "weekly" && (
            <div
              role="group"
              aria-label={t({
                id: "scheduled.form.weekdays",
                message: "On these days",
              })}
              aria-describedby={errors.weekdays ? ids.weekdaysError : undefined}
              className="flex flex-wrap items-center gap-x-4 gap-y-2"
            >
              <span
                aria-hidden="true"
                className="text-sm text-theme-fg-secondary"
              >
                {t({ id: "scheduled.form.weekdays.on", message: "On" })}
              </span>
              {SCHEDULED_WEEKDAYS.map((day) => (
                <label
                  key={day}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-theme-fg-primary"
                >
                  <input
                    type="checkbox"
                    checked={values.weekdays.includes(day)}
                    onChange={(event) =>
                      update(
                        "weekdays",
                        event.target.checked
                          ? [...values.weekdays, day]
                          : values.weekdays.filter((entry) => entry !== day),
                        ["date"],
                      )
                    }
                    disabled={isSubmitting}
                    aria-label={weekdayName(day, locale, "long")}
                    className="size-4 accent-[var(--theme-fg-accent)]"
                  />
                  <span aria-hidden="true">
                    {weekdayName(day, locale, "short")}
                  </span>
                </label>
              ))}
            </div>
          )}
          {values.frequency === "weekly" && errors.weekdays && (
            <p
              id={ids.weekdaysError}
              role="alert"
              className="-mt-2 text-sm text-theme-error-fg"
            >
              {errors.weekdays}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="text-sm text-theme-fg-secondary"
              >
                {startsLabel}
              </span>
              <div className="w-44 flex-none">
                <Input
                  type="date"
                  geometry="control"
                  required
                  aria-label={startsLabel}
                  value={values.date}
                  onChange={(event) => {
                    const date = event.target.value;
                    update("date", date);
                    // A new start on a weekly rule with no day picked yet
                    // takes that weekday, as the blank form does.
                    if (date && values.weekdays.length === 0) {
                      update("weekdays", [weekdayOfDateKey(date)]);
                    }
                  }}
                  aria-describedby={
                    repeatRowError ? ids.repeatError : undefined
                  }
                  error={errors.date}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 sm:ml-2">
              <span
                aria-hidden="true"
                className="text-sm text-theme-fg-secondary"
              >
                {endsLabel}
              </span>
              <div className="w-56 max-w-full flex-none">
                <Select
                  aria-label={endsLabel}
                  value={values.endKind}
                  onChange={(event) =>
                    update("endKind", event.target.value as ScheduledEndKind, [
                      "date",
                      "endDate",
                      "endCount",
                    ])
                  }
                  disabled={isSubmitting}
                >
                  <option value="never">
                    {t({ id: "scheduled.form.ends.never", message: "Never" })}
                  </option>
                  <option value="on_date">
                    {t({
                      id: "scheduled.form.ends.onDate",
                      message: "On a date",
                    })}
                  </option>
                  <option value="after_count">
                    {t({
                      id: "scheduled.form.ends.afterCount",
                      message: "After a number of times",
                    })}
                  </option>
                </Select>
              </div>
            </div>
            {values.endKind === "on_date" && (
              <div className="w-44 flex-none">
                <Input
                  type="date"
                  geometry="control"
                  required
                  min={values.date || todayKey}
                  value={values.endDate}
                  onChange={(event) =>
                    // eslint-disable-next-line lingui/no-unlocalized-strings -- field key
                    update("endDate", event.target.value, ["date"])
                  }
                  aria-label={t({
                    id: "scheduled.form.ends.lastDay",
                    message: "Last day",
                  })}
                  aria-describedby={
                    repeatRowError ? ids.repeatError : undefined
                  }
                  error={errors.endDate}
                  disabled={isSubmitting}
                />
              </div>
            )}
            {values.endKind === "after_count" && (
              <div className="flex items-center gap-3">
                <div className="w-24 flex-none">
                  <Input
                    type="number"
                    aria-label={t({
                      id: "scheduled.form.ends.count",
                      message: "Number of times",
                    })}
                    geometry="control"
                    required
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={values.endCount}
                    onChange={(event) =>
                      // eslint-disable-next-line lingui/no-unlocalized-strings -- field key
                      update("endCount", event.target.value, ["date"])
                    }
                    aria-describedby={
                      repeatRowError ? ids.repeatError : undefined
                    }
                    error={errors.endCount}
                    disabled={isSubmitting}
                  />
                </div>
                <span
                  aria-hidden="true"
                  className="text-sm text-theme-fg-secondary"
                >
                  {t({ id: "scheduled.form.ends.times", message: "times" })}
                </span>
              </div>
            )}
          </div>
          {repeatRowError && (
            <p
              id={ids.repeatError}
              role="alert"
              className="-mt-2 text-sm text-theme-error-fg"
            >
              {repeatRowError}
            </p>
          )}
        </div>
      )}

      <ScheduledTriggerSummary
        values={values}
        now={reference}
        timeZone={timeZone}
        snoozedUntil={
          snoozedUntil && scheduledTriggerUnchanged(values, initialValues)
            ? snoozedUntil
            : null
        }
      />

      <SectionHeading
        title={t({ id: "scheduled.form.reminder", message: "Reminder" })}
        description={t({
          id: "scheduled.form.reminder.description",
          message: "What you receive.",
        })}
      />

      <FormField
        label={t({ id: "scheduled.form.message", message: "Message" })}
        required
        htmlFor={ids.message}
        error={errors.message}
      >
        <Textarea
          id={ids.message}
          rows={3}
          value={values.message}
          onChange={(event) => update("message", event.target.value)}
          error={errors.message}
          required
          disabled={isSubmitting}
        />
      </FormField>

      <FormField
        label={t({ id: "scheduled.form.linkedChat", message: "Linked chat" })}
        htmlFor={ids.chat}
        helpText={t({
          id: "scheduled.form.linkedChat.help",
          message:
            "Optional: the message links back to this chat, so you can continue where you left off.",
        })}
        helpTextId={ids.chatHelp}
        error={errors.linkedChatId}
      >
        <div className="max-w-md">
          <Select
            id={ids.chat}
            aria-describedby={errors.linkedChatId ? undefined : ids.chatHelp}
            error={errors.linkedChatId}
            value={values.linkedChatId}
            onChange={(event) => update("linkedChatId", event.target.value)}
            disabled={isSubmitting}
          >
            <option value="">
              {t({ id: "scheduled.form.linkedChat.none", message: "No chat" })}
            </option>
            {linkedChatMissing && (
              <option value={values.linkedChatId}>
                {t({
                  id: "scheduled.form.linkedChat.current",
                  message: "The chat linked now",
                })}
              </option>
            )}
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.title}
              </option>
            ))}
          </Select>
        </div>
      </FormField>

      <ScheduledDeliverySettings
        channel={values.channel}
        channelStatus={channelStatus}
        teamsAppName={teamsAppName}
        onChannelChange={(channel) => update("channel", channel)}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        error={errors.channel}
        disabled={isSubmitting}
      />

      <div className="space-y-4 border-t border-theme-border pt-5">
        {formError && (
          <div ref={formAlertRef} tabIndex={-1} className="outline-none">
            <Alert type="error" data-testid="scheduled-form-error">
              {formError}
            </Alert>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t({ id: "scheduled.form.cancel", message: "Cancel" })}
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {mode === "edit"
              ? t({ id: "scheduled.form.save", message: "Save changes" })
              : t({
                  id: "scheduled.form.schedule.reminder",
                  message: "Schedule reminder",
                })}
          </Button>
        </div>
      </div>
    </form>
  );
}
