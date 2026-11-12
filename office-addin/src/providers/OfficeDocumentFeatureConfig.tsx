import { FeatureConfigProvider } from "@erato/frontend/library";

import { useOffice } from "./OfficeProvider";
import { SHARED_ADDIN_FEATURE_CONFIG } from "../core/SharedAddinShell";

/** Feature overrides of the document task panes (Word, Excel, PowerPoint). */
export function OfficeDocumentFeatureConfig({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supportsAudioCapture } = useOffice();
  return (
    <FeatureConfigProvider
      config={{
        ...SHARED_ADDIN_FEATURE_CONFIG,
        ...(supportsAudioCapture
          ? {}
          : {
              audioTranscription: { enabled: false },
              audioDictation: { enabled: false },
              audioConversational: { enabled: false },
            }),
      }}
    >
      {children}
    </FeatureConfigProvider>
  );
}
