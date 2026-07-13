export const DEFAULT_ERROR_REPORT_TEMPLATE = `## Error Report

- Environment: {{environment}}
- Timestamp: {{timestamp}}
- Chat ID: {{chat_id}}
- Assistant ID: {{assistant_id}}
- Platform: {{platform}}
- Active facets: {{facets_active}}

Error:
\`\`\`text
{{error}}
\`\`\``;

export const ERROR_REPORT_NONE_PLACEHOLDER = "<none>";
const MAX_CONTEXT_LENGTH = 100_000;
const REDACTED_HEADER_VALUE = "<redacted>";
const SENSITIVE_HEADER_RE =
  /authorization|cookie|token|api-key|subscription-key|client-secret/i;

export interface ErrorRequestContext {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ErrorResponseContext {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body?: string;
}

export class FrontendRequestError extends Error {
  readonly request: ErrorRequestContext;
  readonly response?: ErrorResponseContext;

  constructor(
    message: string,
    request: ErrorRequestContext,
    response?: ErrorResponseContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FrontendRequestError";
    this.request = request;
    this.response = response;
  }
}

export interface FrontendErrorReportOptions {
  template?: string;
  environment?: string | null;
  chatId?: string | null;
  assistantId?: string | null;
  platform?: string | null;
  facetsActive?: string | null;
  componentStack?: string | null;
  timestamp?: Date;
}

const optional = (value: string | null | undefined): string =>
  value?.trim() ? value : ERROR_REPORT_NONE_PLACEHOLDER;

const truncate = (value: string): string => {
  if (value.length <= MAX_CONTEXT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_CONTEXT_LENGTH)}\n<truncated>`;
};

const formatBody = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) {
    return ERROR_REPORT_NONE_PLACEHOLDER;
  }

  try {
    return truncate(JSON.stringify(JSON.parse(trimmed), null, 2));
  } catch {
    return truncate(trimmed);
  }
};

const formatHeaders = (headers?: Record<string, string>): string => {
  if (!headers || Object.keys(headers).length === 0) {
    return ERROR_REPORT_NONE_PLACEHOLDER;
  }

  return Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `  ${name}: ${value}`)
    .join("\n");
};

const formatRequest = (request: ErrorRequestContext): string =>
  [
    "Request:",
    `  Method: ${request.method}`,
    `  URL: ${request.url}`,
    "  Headers:",
    formatHeaders(request.headers),
    "  Body:",
    request.body ? formatBody(request.body) : ERROR_REPORT_NONE_PLACEHOLDER,
  ].join("\n");

const formatResponse = (response: ErrorResponseContext): string =>
  [
    "Response:",
    `  Status: ${response.status} ${response.statusText}`.trimEnd(),
    "  Headers:",
    formatHeaders(response.headers),
    "  Body:",
    response.body ? formatBody(response.body) : ERROR_REPORT_NONE_PLACEHOLDER,
  ].join("\n");

const getRequestTemplateContext = (
  error: unknown,
): {
  chatId?: string;
  assistantId?: string;
  platform?: string;
  facetsActive?: string;
} => {
  if (!(error instanceof FrontendRequestError)) {
    return {};
  }

  let body: Record<string, unknown> = {};
  if (error.request.body) {
    try {
      const parsed: unknown = JSON.parse(error.request.body);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON request bodies still appear in the detailed request section.
    }
  }

  const stringValue = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  const facetIds = Array.isArray(body.selected_facet_ids)
    ? body.selected_facet_ids.filter(
        (facetId): facetId is string => typeof facetId === "string",
      )
    : [];

  return {
    chatId: stringValue(body.existing_chat_id) ?? stringValue(body.chat_id),
    assistantId: stringValue(body.assistant_id),
    platform: error.request.headers?.["x-erato-platform"],
    facetsActive: facetIds.length > 0 ? facetIds.sort().join(", ") : undefined,
  };
};

export const sanitizeHeaders = (
  headers: HeadersInit | undefined,
): Record<string, string> | undefined => {
  if (!headers) {
    return undefined;
  }

  const entries = new Headers(headers);
  const sanitized: Record<string, string> = {};
  entries.forEach((value, name) => {
    sanitized[name] = SENSITIVE_HEADER_RE.test(name)
      ? REDACTED_HEADER_VALUE
      : value;
  });
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

export const getErrorDetails = (
  error: unknown,
  componentStack?: string | null,
): string => {
  const sections: string[] = [];

  if (error instanceof Error) {
    const stack = error.stack?.trim();
    sections.push(stack?.length ? stack : `${error.name}: ${error.message}`);

    if (error instanceof FrontendRequestError) {
      sections.push(formatRequest(error.request));
      if (error.response) {
        sections.push(formatResponse(error.response));
      }
    }

    if (error.cause instanceof Error && error.cause.stack) {
      sections.push(`Cause:\n${error.cause.stack}`);
    }
  } else {
    sections.push(String(error));
  }

  if (componentStack?.trim()) {
    sections.push(`Component stack:\n${componentStack.trim()}`);
  }

  return sections.join("\n\n");
};

export const renderFrontendErrorReport = (
  error: unknown,
  options: FrontendErrorReportOptions = {},
): string => {
  const requestContext = getRequestTemplateContext(error);
  const context: Record<string, string> = {
    environment: optional(options.environment),
    timestamp: (options.timestamp ?? new Date()).toISOString(),
    chat_id: optional(options.chatId ?? requestContext.chatId),
    assistant_id: optional(options.assistantId ?? requestContext.assistantId),
    platform: optional(requestContext.platform ?? options.platform),
    facets_active: optional(
      options.facetsActive ?? requestContext.facetsActive,
    ),
    error: optional(getErrorDetails(error, options.componentStack)),
  };

  return (options.template ?? DEFAULT_ERROR_REPORT_TEMPLATE).replace(
    /\{\{\{?\s*([a-z_]+)\s*\}?\}\}/g,
    (_match, key: string) => context[key] ?? "",
  );
};
