import { useFileCapabilities } from "@erato/frontend/library";

import { modelTakesSlidePictures } from "../utils/powerpointSlidePicture";

/** Whether the selected model takes slide pictures, from `/me/file-capabilities` for that model. */
export function useModelTakesSlidePictures(
  modelId: string | undefined,
  enabled: boolean,
): { takes: boolean; known: boolean } {
  const capabilities = useFileCapabilities(
    { queryParams: { model_id: modelId } },
    {
      enabled: enabled && !!modelId,
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  );
  return {
    takes: modelTakesSlidePictures(capabilities.data),
    known: capabilities.data !== undefined,
  };
}
