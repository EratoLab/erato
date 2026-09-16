import { t } from "@lingui/core/macro";

import { useErrorReportFeature } from "@/providers/FeatureConfigProvider";
import {
  isPromptInjectionFilterDetails,
  type MessageErrorFilterDetails,
} from "@/types/chat";

import { Alert } from "../Feedback/Alert";
import { CopyErrorButton } from "../Feedback/CopyErrorButton";
import {
  getContentFilterCategoryLabel,
  getContentFilterSeverityLabel,
  getErrorCta,
  getErrorDescription,
  getErrorTitle,
} from "../Message/messageErrorCopy";

import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

interface MessageErrorAlertProps {
  /** The message whose failed generation the alert reports on. */
  message: UiChatMessage;
}

/**
 * The bubble a failed generation leaves behind: wording, the remedy to offer,
 * whatever the guardrail matched on, the verbose description behind a feature
 * flag, and the backend-rendered report the user can copy.
 *
 * One component so that no renderer — the host's own or a component kit's
 * `ChatMessageRenderer` override — re-assembles the five copy helpers, the two
 * detail blocks and the two error-report flags around its own alert markup. A
 * kit that copies this to swap the Tailwind classes stops hearing about every
 * branch added afterwards; consuming it leaves only the `Alert` skin to
 * override, and `Alert` is itself on the kit surface.
 *
 * Renders nothing for a message that did not fail, so a renderer can place it
 * unconditionally.
 */
export const MessageErrorAlert = ({ message }: MessageErrorAlertProps) => {
  const errorReportConfig = useErrorReportFeature();

  if (!message.error) {
    return null;
  }

  return (
    <Alert
      type="error"
      title={getErrorTitle(message.error.error_type)}
      geometryVariant="message"
      className="mb-3"
      data-testid="chat-message-error"
    >
      <p>
        {getErrorDescription(
          message.error.error_type,
          message.error.filter_details,
        )}
      </p>
      {getErrorCta(message.error.error_type, message.error.filter_details) && (
        <p className="mt-2">
          {getErrorCta(message.error.error_type, message.error.filter_details)}
        </p>
      )}
      {renderContentFilterDetails(
        message.error.error_type,
        message.error.filter_details,
      )}
      {renderVerboseErrorDescription(
        message.error.error_type,
        message.error.error_description,
        errorReportConfig.showVerboseAssistantErrors,
      )}
      {errorReportConfig.showCopyErrorReport && message.error_report && (
        <div className="mt-3">
          <CopyErrorButton report={message.error_report} />
        </div>
      )}
    </Alert>
  );
};

const renderContentFilterDetails = (
  errorType: string,
  filterDetails?: MessageErrorFilterDetails | null,
) => {
  if (errorType !== "content_filter" || !filterDetails) {
    return null;
  }

  if (isPromptInjectionFilterDetails(filterDetails)) {
    return (
      <div className="mt-2 text-xs">
        <div className="font-medium">
          {t({
            id: "chat.message.error.variant.prompt_injection.offending_text",
            message: "Offending text",
          })}
        </div>
        <blockquote className="mt-1 break-words border-l-2 pl-2 italic">
          {filterDetails.matched_text}
        </blockquote>
      </div>
    );
  }

  const filteredCategories = Object.entries(filterDetails)
    .filter(([, details]) => details.filtered)
    .map(([category, details]) => ({
      category,
      severity: details.severity,
    }));

  if (filteredCategories.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 text-xs">
      <div className="font-medium">
        {t({
          id: "chat.message.error.variant.content_filter.filtered_categories",
          message: "Filtered categories",
        })}
      </div>
      <ul className="mt-1 list-disc pl-5">
        {filteredCategories.map(({ category, severity }) => (
          <li key={category}>
            {getContentFilterCategoryLabel(category)} (
            {getContentFilterSeverityLabel(severity)})
          </li>
        ))}
      </ul>
    </div>
  );
};

const renderVerboseErrorDescription = (
  errorType: string,
  errorDescription: string | undefined,
  showVerboseAssistantErrors: boolean,
) => {
  if (
    !showVerboseAssistantErrors ||
    errorType === "content_filter" ||
    !errorDescription?.trim()
  ) {
    return null;
  }

  return (
    <div className="mt-3 text-xs">
      <div className="font-medium">
        {t({
          id: "chat.message.error.details",
          message: "Details",
        })}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans">
        {errorDescription}
      </pre>
    </div>
  );
};
