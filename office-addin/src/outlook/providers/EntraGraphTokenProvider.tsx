import { t } from "@lingui/core/macro";

import { GraphTokenProvider } from "../../core/auth/GraphTokenProvider";

import type {
  AuthSource,
  GraphCapableSource,
} from "../../core/auth/AuthSource";
import type { GraphSignInPrompt } from "../../core/auth/GraphTokenProvider";

export {
  useGraphTokenOptional,
  type GraphTokenContextValue,
} from "../../core/auth/GraphTokenProvider";

/**
 * Outlook-only binding of the shared Graph token provider: mail-flavoured
 * sign-in copy over the host-neutral acquire/refresh/redeem behaviour.
 */
export function EntraGraphTokenProvider({
  source,
  children,
}: {
  source: AuthSource & GraphCapableSource;
  children: React.ReactNode;
}) {
  // Rebuilt every render so a locale switch re-translates; the provider's
  // callbacks depend on the string fields, not this object's identity.
  const prompt: GraphSignInPrompt = {
    dedupeKey: "graph-email-signin",
    title: t({
      id: "officeAddin.email.signInToLoad.title",
      message: "Sign in to load email",
    }),
    description: t({
      id: "officeAddin.email.signInToLoad.description",
      message:
        "This email wasn't attached because reading it needs a quick sign-in.",
    }),
    action: t({
      id: "officeAddin.email.signInToLoad.action",
      message: "Sign in",
    }),
    signedInTitle: t({
      id: "officeAddin.email.signedIn.title",
      message: "Signed in. Add the email again to attach it.",
    }),
  };

  return (
    <GraphTokenProvider source={source} prompt={prompt}>
      {children}
    </GraphTokenProvider>
  );
}
