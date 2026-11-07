import { Navigate, Outlet } from "react-router-dom";

import AssistantsPageStructure from "@/components/ui/Assistant/AssistantsPageStructure";
import { useScheduledFeature } from "@/providers/FeatureConfigProvider";
import { RootProvider } from "@/providers/RootProvider";

function ScheduledGate() {
  const { enabled } = useScheduledFeature();
  if (!enabled) {
    return <Navigate to="/" replace />;
  }
  return (
    <AssistantsPageStructure>
      <Outlet />
    </AssistantsPageStructure>
  );
}

export default function ScheduledLayout() {
  return (
    <RootProvider>
      <ScheduledGate />
    </RootProvider>
  );
}
