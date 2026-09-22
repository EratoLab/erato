import type { DiscoverResult } from "./generated/index.js";
import { validateLocalDelegationSecurity } from "./generated/validators.mjs";

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
  const required = [
    "local_contexts.challenge.v1",
    "local_contexts.bind.v1",
    "local_tasks.start.v1",
    "local_tasks.status.v1",
    "local_tasks.cancel.v1",
    "local_tasks.review.v1",
    "local_exports.status.v1",
    "local_exports.read.v1",
    "local_exports.ack.v1",
  ];
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
