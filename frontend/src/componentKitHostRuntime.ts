import { useNavigate } from "react-router-dom";

import { ChatHistoryListSkeleton } from "./components/ui/Chat/ChatHistoryList";
import { ModelSelector } from "./components/ui/Chat/ModelSelector";
import { InteractiveContainer } from "./components/ui/Container/InteractiveContainer";
import { Button } from "./components/ui/Controls/Button";
import { DropdownMenu } from "./components/ui/Controls/DropdownMenu";
import { Alert } from "./components/ui/Feedback/Alert";
import { Avatar } from "./components/ui/Feedback/Avatar";
import { FilePreviewButton } from "./components/ui/FileUpload/FilePreviewButton";
import { FilePreviewLoading } from "./components/ui/FileUpload/FilePreviewLoading";
import { ImageLightbox } from "./components/ui/Message/ImageLightbox";
import { useStarterPromptsData } from "./hooks/chat/useStarterPrompts";
import { useThemedIcon } from "./hooks/ui/useThemedIcon";
import { useGetFile } from "./lib/generated/v1betaApi/v1betaApiComponents";
import {
  useMessageFeedbackFeature,
  useTraceFeature,
} from "./providers/FeatureConfigProvider";

/**
 * Host runtime surface for component kits. Kits run as separately built
 * bundles on the host's React instance; hooks and components they render
 * must be the host's own module instances (contexts, react-query client,
 * router), so they are handed over here instead of being bundled or
 * re-implemented kit-side.
 *
 * This module lives in the app graph (imported by main.tsx), NOT in the
 * componentKitReactRuntime pre-app entry — bundling these imports into that
 * entry would duplicate most of the app into the boot script. Consequence:
 * the values are set before first render but AFTER kit bundles evaluate, so
 * kits must read them lazily inside components/hooks, never at module scope.
 *
 * `version` is bumped on breaking shape changes; kits should warn loudly
 * when it does not match what they were built against.
 */
export type ComponentKitHostRuntime = {
  version: 1;
  hooks: {
    useTraceFeature: typeof useTraceFeature;
    useMessageFeedbackFeature: typeof useMessageFeedbackFeature;
    useStarterPromptsData: typeof useStarterPromptsData;
    useThemedIcon: typeof useThemedIcon;
    useGetFile: typeof useGetFile;
    useNavigate: typeof useNavigate;
  };
  components: {
    Alert: typeof Alert;
    Avatar: typeof Avatar;
    Button: typeof Button;
    ChatHistoryListSkeleton: typeof ChatHistoryListSkeleton;
    DropdownMenu: typeof DropdownMenu;
    FilePreviewButton: typeof FilePreviewButton;
    FilePreviewLoading: typeof FilePreviewLoading;
    ImageLightbox: typeof ImageLightbox;
    InteractiveContainer: typeof InteractiveContainer;
    ModelSelector: typeof ModelSelector;
  };
};

(
  window as Window & {
    ERATO_KIT_RUNTIME?: ComponentKitHostRuntime;
  }
).ERATO_KIT_RUNTIME = {
  version: 1,
  hooks: {
    useTraceFeature,
    useMessageFeedbackFeature,
    useStarterPromptsData,
    useThemedIcon,
    useGetFile,
    useNavigate,
  },
  components: {
    Alert,
    Avatar,
    Button,
    ChatHistoryListSkeleton,
    DropdownMenu,
    FilePreviewButton,
    FilePreviewLoading,
    ImageLightbox,
    InteractiveContainer,
    ModelSelector,
  },
};
