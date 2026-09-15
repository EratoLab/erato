// The assistant error bubble's wording, split out of ChatMessage so a kit that
// draws its own bubble can call the host's copy instead of re-deriving it. The
// helpers are pure `t()` lookups carrying no markup, so they cross the kit
// surface unchanged; every Tailwind-bearing piece of the alert stays in
// ChatMessage.

import { t } from "@lingui/core/macro";

import {
  isPromptInjectionFilterDetails,
  type MessageErrorFilterDetails,
} from "@/types/chat";

export const getErrorTitle = (errorType: string) => {
  if (errorType === "content_filter") {
    return undefined;
  }

  return t({
    id: "chat.message.error.title",
    message: "Assistant error",
  });
};

export const getErrorDescription = (
  errorType: string,
  filterDetails?: MessageErrorFilterDetails | null,
) => {
  if (errorType === "content_filter") {
    if (isPromptInjectionFilterDetails(filterDetails)) {
      return t({
        id: "chat.message.error.variant.prompt_injection",
        message:
          "The request was blocked because it matched a prompt injection guardrail.",
      });
    }

    return t({
      id: "chat.message.error.variant.content_filter",
      message:
        "The response was filtered due to the prompt triggering content management policy.",
    });
  }

  if (errorType === "rate_limit") {
    return t({
      id: "chat.message.error.variant.rate_limit",
      message:
        "Rate limit or quota exceeded. This can also happen if your input is too large.",
    });
  }

  if (errorType === "hallucination_loop") {
    return t({
      id: "chat.message.error.variant.hallucination_loop",
      message:
        "Generation aborted. Hallucination loop detected. Please regenerate the message.",
    });
  }

  return t({
    id: "chat.message.error.variant.default",
    message: "The assistant was unable to respond.",
  });
};

export const getErrorCta = (
  errorType: string,
  filterDetails?: MessageErrorFilterDetails | null,
) => {
  if (errorType === "content_filter") {
    if (isPromptInjectionFilterDetails(filterDetails)) {
      return t({
        id: "chat.message.error.variant.prompt_injection.cta",
        message:
          "Please edit the previous message to remove the offending text before continuing.",
      });
    }

    return t({
      id: "chat.message.error.variant.content_filter.cta",
      message:
        "Please try again with a different message that avoids the filtered categories.",
    });
  }

  if (errorType === "rate_limit") {
    return t({
      id: "chat.message.error.variant.rate_limit.cta",
      message:
        "Please try again in a minute, and reduce the length or number of attachments.",
    });
  }

  return undefined;
};

export const getContentFilterCategoryLabel = (category: string) => {
  switch (category) {
    case "hate":
      return t({
        id: "chat.message.error.variant.content_filter.hate",
        message: "Hate",
      });
    case "self_harm":
      return t({
        id: "chat.message.error.variant.content_filter.self_harm",
        message: "Self harm",
      });
    case "sexual":
      return t({
        id: "chat.message.error.variant.content_filter.sexual",
        message: "Sexual",
      });
    case "violence":
      return t({
        id: "chat.message.error.variant.content_filter.violence",
        message: "Violence",
      });
    default:
      return formatFilterLabel(category);
  }
};

export const getContentFilterSeverityLabel = (severity: string) => {
  switch (severity) {
    case "safe":
      return t({
        id: "chat.message.error.variant.content_filter.safe_severity",
        message: "safe",
      });
    case "low":
      return t({
        id: "chat.message.error.variant.content_filter.low_severity",
        message: "low severity",
      });
    case "medium":
      return t({
        id: "chat.message.error.variant.content_filter.medium_severity",
        message: "medium severity",
      });
    case "high":
      return t({
        id: "chat.message.error.variant.content_filter.high_severity",
        message: "high severity",
      });
    default:
      return formatFilterLabel(severity);
  }
};

const formatFilterLabel = (value: string) =>
  value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
