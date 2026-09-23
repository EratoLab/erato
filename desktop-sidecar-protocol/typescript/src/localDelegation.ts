import type { SidecarMethodContract } from "./client.js";
import type { DiscoverResult } from "./generated/index.js";
import {
  validateLocalDelegationSecurity,
  validateLocalContextsChallengeV1Params,
  validateLocalContextsChallengeV1Result,
  validateLocalContextsBindV1Params,
  validateLocalContextsBindV1Result,
  validateLocalTasksStartV1Params,
  validateLocalTasksStartV1Result,
  validateLocalTasksStatusV1Params,
  validateLocalTasksStatusV1Result,
  validateLocalTasksCancelV1Params,
  validateLocalTasksCancelV1Result,
  validateLocalTasksReviewV1Params,
  validateLocalTasksReviewV1Result,
  validateLocalExportsStatusV1Params,
  validateLocalExportsStatusV1Result,
  validateLocalExportsReadV1Params,
  validateLocalExportsReadV1Result,
  validateLocalExportsAckV1Params,
  validateLocalExportsAckV1Result,
} from "./generated/validators.mjs";

export const localDelegationContracts: Readonly<
  Record<string, SidecarMethodContract>
> = {
  "local_contexts.challenge.v1": {
    validateParams: validateLocalContextsChallengeV1Params,
    validateResult: validateLocalContextsChallengeV1Result,
  },
  "local_contexts.bind.v1": {
    validateParams: validateLocalContextsBindV1Params,
    validateResult: validateLocalContextsBindV1Result,
  },
  "local_tasks.start.v1": {
    validateParams: validateLocalTasksStartV1Params,
    validateResult: validateLocalTasksStartV1Result,
  },
  "local_tasks.status.v1": {
    validateParams: validateLocalTasksStatusV1Params,
    validateResult: validateLocalTasksStatusV1Result,
  },
  "local_tasks.cancel.v1": {
    validateParams: validateLocalTasksCancelV1Params,
    validateResult: validateLocalTasksCancelV1Result,
  },
  "local_tasks.review.v1": {
    validateParams: validateLocalTasksReviewV1Params,
    validateResult: validateLocalTasksReviewV1Result,
  },
  "local_exports.status.v1": {
    validateParams: validateLocalExportsStatusV1Params,
    validateResult: validateLocalExportsStatusV1Result,
  },
  "local_exports.read.v1": {
    validateParams: validateLocalExportsReadV1Params,
    validateResult: validateLocalExportsReadV1Result,
  },
  "local_exports.ack.v1": {
    validateParams: validateLocalExportsAckV1Params,
    validateResult: validateLocalExportsAckV1Result,
  },
};

/** A claim from the trusted native transport, not a proof of OS confinement. */
export function supportsStrictLocalDelegation(
  discovery: DiscoverResult,
): boolean {
  const security = discovery.localDelegation;
  if (
    !validateLocalDelegationSecurity(security) ||
    security?.enforcement !== "enforced"
  )
    return false;
  const required = Object.keys(localDelegationContracts);
  return required.every((name) => {
    const methods = discovery.document.methods.filter(
      (method) => method.name === name,
    );
    if (methods.length !== 1) return false;
    const capability = methods[0]?.["x-erato-capability"];
    return (
      capability?.method === name &&
      capability.id === name.slice(0, -3) &&
      capability.major === 1 &&
      capability.availability.state === "enabled"
    );
  });
}
