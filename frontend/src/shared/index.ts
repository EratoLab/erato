// Import-map expose entry for the Erato-owned component-kit host surface.
// Keep this as a deliberate public API: kits import values from the single
// `@erato/frontend/shared` specifier and the host import map supplies the
// app-bundle module instance.
export * from "./component-registry.generated";

export * from "@/auth/tokenStore";
export * from "@/components/ui/Chat/ModelSelector";
export * from "@/hooks/chat/store/messagingStore";
export * from "@/hooks/chat/useStarterPrompts";
export * from "@/hooks/ui/useThemedIcon";
export * from "@/lib/voice-runtime/VoiceRuntimeProvider";
export * from "@/providers/ChatProvider";
export * from "@/providers/FeatureConfigProvider";
export * from "@/providers/FileCapabilitiesProvider";
export * from "@/providers/ProfileProvider";
export * from "@/state/audioInputDeviceStore";
export * from "@/state/uiStore";

export {
  useGetFile,
  useGetFilePreview,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

// Bump on breaking changes to the shared host surface. Kits compare this at
// startup and warn loudly when their expected contract does not match.
export const ERATO_SHARED_SURFACE_VERSION = 1;
