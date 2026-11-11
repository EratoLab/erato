import {
  fetchCancelClientOperation,
  fetchContinueClientOperation,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { isConflict } from "./conflict";
import { requestClientOperationSweep } from "./handlers";

/**
 * `stopped`: the call ended as stopped by the user, and its turn goes on
 * without the result. `settled`: the call had already ended (a result, its
 * expiry or a newer turn came first), so the row shown is out of date.
 */
export type StopWaitingOutcome = "stopped" | "settled";

/**
 * Ends the wait for a durable client call (ERMAIN-1165). The server settles
 * the call as cancelled, a server outcome like expiry, and its turn is then
 * continued at once, so it answers without the result instead of waiting for
 * the next inbox sweep. A continuation another client already started, or one
 * that fails, is left to the sweep. Any other refusal of the stop throws.
 *
 * A call that had already ended asks for a sweep as well: one withdrawn by a
 * stopped parent turn is ready but continued by no one until then.
 */
export async function stopWaitingForCall(
  attemptId: string,
): Promise<StopWaitingOutcome> {
  try {
    await fetchCancelClientOperation({ pathParams: { attemptId } });
  } catch (error) {
    if (!isConflict(error)) throw error;
    requestClientOperationSweep();
    return "settled";
  }
  try {
    await fetchContinueClientOperation({ pathParams: { attemptId } });
  } catch {
    requestClientOperationSweep();
  }
  return "stopped";
}
