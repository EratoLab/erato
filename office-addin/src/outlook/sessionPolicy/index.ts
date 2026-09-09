export {
  UNSAVED_APPOINTMENT_IDENTITY_PREFIX,
  UNSAVED_COMPOSE_IDENTITY_PREFIX,
  anchorsEqualForPreferences,
  composeInheritsAnchorsEqual,
  getOrMintItemIdentity,
  isAppointmentCompose,
  isMessageRead,
  outlookAnchorFromItem,
  outlookAnchorFromSelectedConversation,
  resolveSupportedMailboxItem,
  strictAnchorsEqual,
  summarizeSelectedConversation,
} from "./outlookAnchor";
export type {
  OutlookSelectedConversation,
  SupportedOutlookItem,
} from "./outlookAnchor";
export {
  DEFAULT_OUTLOOK_SESSION,
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  LEGACY_CHAT_ID_KEY,
  OUTLOOK_SESSION_KEY,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  migrateLegacyChatIdKey,
  outlookSessionPersistedOptions,
  outlookSessionPreferencesPersistedOptions,
  type OutlookSessionStorageValue,
} from "./persistence";
export type { OutlookSessionAnchor, OutlookSessionPreferences } from "./types";
export {
  holdSessionPolicy,
  isSessionPolicyHeld,
  releaseSessionPolicy,
  subscribeSessionPolicyGate,
} from "./policyGate";
