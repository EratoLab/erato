/**
 * Client-executed tools this web app can run.
 *
 * A fixed, code-defined allowlist advertised to the backend via the
 * `X-Erato-Supported-Client-Tools` header (see `useChatMessaging`). The backend
 * offers the model only client tools present here, so the model is never handed
 * a tool this client can't execute (which would otherwise park the turn until
 * timeout). Mirrors the add-in's `IMPLEMENTED_CLIENT_ACTIONS` registry pattern.
 *
 * Empty for now: the web app implements no client-executed tools yet. To add
 * one, register its name here alongside a client-side executor.
 */
export const IMPLEMENTED_CLIENT_TOOLS: readonly string[] = [];

/** Whether this client has an executor for the given client tool. */
export function isImplementedClientTool(tool: string): boolean {
  return IMPLEMENTED_CLIENT_TOOLS.includes(tool);
}
