import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { ChatInputControlsHandle } from "@/components/ui/Chat/ChatInputControlsContext";
import type { RefObject } from "react";

/** What a new chat's composer starts with when opened from elsewhere. */
export interface ComposerPreset {
  facetIds: string[];
  draft?: string;
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- History state key
const PRESET_STATE_KEY = "composerPreset";

// eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
const NEW_CHAT_PATH = "/chat/new";

export function readComposerPreset(state: unknown): ComposerPreset | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  const preset = (state as Record<string, unknown>)[PRESET_STATE_KEY];
  if (typeof preset !== "object" || preset === null) {
    return null;
  }
  const { facetIds, draft } = preset as Record<string, unknown>;
  if (
    !Array.isArray(facetIds) ||
    !facetIds.every((id) => typeof id === "string")
  ) {
    return null;
  }
  return {
    facetIds,
    ...(typeof draft === "string" && draft !== "" ? { draft } : {}),
  };
}

function withoutComposerPreset(state: unknown): unknown {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  const { [PRESET_STATE_KEY]: _preset, ...rest } = state as Record<
    string,
    unknown
  >;
  return Object.keys(rest).length > 0 ? rest : null;
}

/**
 * Opens a new chat whose composer starts with the given facets selected and,
 * optionally, a draft. The preset rides in the history entry's state, so it
 * reaches only this navigation.
 */
export function useOpenNewChatWithPreset(): (preset: ComposerPreset) => void {
  const navigate = useNavigate();
  return useCallback(
    (preset: ComposerPreset) => {
      navigate(NEW_CHAT_PATH, { state: { [PRESET_STATE_KEY]: preset } });
    },
    [navigate],
  );
}

/**
 * Applies a preset from the current history entry to the composer once, then
 * drops it from the entry so a reload or Back does not apply it again.
 */
export function useApplyComposerPreset(
  controlsRef: RefObject<ChatInputControlsHandle | null>,
): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const preset = readComposerPreset(location.state);
    const controls = controlsRef.current;
    if (!preset || !controls) {
      return;
    }
    controls.setSelectedFacetIds(preset.facetIds);
    if (preset.draft !== undefined) {
      controls.setDraftMessage(preset.draft, { focus: false });
    }
    controls.focusInput();
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { replace: true, state: withoutComposerPreset(location.state) },
    );
  }, [
    controlsRef,
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);
}
