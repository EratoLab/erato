/**
 * Client-executed tools this Outlook add-in can run.
 *
 * A fixed, code-defined allowlist advertised to the backend via the
 * `X-Erato-Supported-Client-Tools` header (passed through `useChatMessaging`).
 * The backend offers the model only client tools present here, so the model is
 * never handed a tool this client can't execute (which would otherwise park the
 * turn until timeout). Parallels `IMPLEMENTED_CLIENT_ACTIONS` in
 * `outlookClientActions.ts` — the terminal, one-way seam — whereas these are
 * the returning round-trip tools.
 *
 * Empty for now: the client-side executors (e.g. `outlook.fetch_availability`
 * dispatching Graph `getSchedule` / EWS `GetUserAvailability`) land in a
 * follow-up. Register a tool's name here alongside its executor to have it
 * offered to the model.
 */
export const IMPLEMENTED_CLIENT_TOOLS: readonly string[] = [];

/** Whether this add-in has an executor for the given client tool. */
export function isImplementedClientTool(tool: string): boolean {
  return IMPLEMENTED_CLIENT_TOOLS.includes(tool);
}
