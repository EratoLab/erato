import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { forgetSpokenStyle } from "@/hooks/audio/spokenStyle";
import {
  approvalSpeechStyleQuery,
  fetchUpdateProfilePreferences,
  replySpeechStyleQuery,
  useApprovalSpeechStyle,
  useReplySpeechStyle,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { SegmentedControl } from "../Controls/SegmentedControl";
import { toast } from "../Toast";

import type { UpdateProfilePreferencesRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type Wording = "natural" | "precise";

interface WordingRowProps {
  heading: string;
  description: string;
  wording?: Wording;
  userChoice?: boolean;
  saving: boolean;
  onChange: (wording: Wording) => void;
}

function WordingRow({
  heading,
  description,
  wording,
  userChoice,
  saving,
  onChange,
}: WordingRowProps) {
  const options: { value: Wording; label: string }[] = [
    {
      value: "natural",
      label: t({
        id: "preferences.dialog.audio.voice.option.natural",
        message: "Natural",
      }),
    },
    {
      value: "precise",
      label: t({
        id: "preferences.dialog.audio.voice.option.precise",
        message: "Word for word",
      }),
    },
  ];
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">{heading}</h3>
        <p className="text-sm text-theme-fg-secondary">{description}</p>
      </div>
      {wording !== undefined && (
        <SegmentedControl
          aria-label={heading}
          options={options}
          value={wording}
          onChange={onChange}
          disabled={saving || userChoice === false}
        />
      )}
      {userChoice === false && (
        <p className="text-xs text-theme-fg-muted">
          {t({
            id: "preferences.dialog.audio.voice.locked",
            message: "Set by your organization",
          })}
        </p>
      )}
    </div>
  );
}

/**
 * How the voice speaks in conversation mode: replies and approval cards,
 * each natural or word for word. A row is read-only where the organization
 * has not allowed a choice.
 */
export function VoiceOutputSetting() {
  const queryClient = useQueryClient();
  const replies = useReplySpeechStyle({});
  const cards = useApprovalSpeechStyle({});
  const [saving, setSaving] = useState(false);

  const save = async (
    patch: Partial<
      Record<
        | "preference_reply_speech_wording"
        | "preference_approval_speech_wording",
        Wording
      >
    >,
  ) => {
    setSaving(true);
    try {
      // The generated request type reads these string fields as null-only.
      const body = patch as UpdateProfilePreferencesRequest;
      await fetchUpdateProfilePreferences({ body });
      forgetSpokenStyle();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: replySpeechStyleQuery({}).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: approvalSpeechStyleQuery({}).queryKey,
        }),
      ]);
    } catch {
      toast.error({
        title: t({
          id: "preferences.dialog.audio.voice.saveFailed",
          message: "The voice setting could not be saved",
        }),
      });
    } finally {
      setSaving(false);
    }
  };

  const heading = t({
    id: "preferences.dialog.audio.voice.heading",
    message: "Voice",
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-theme-fg-primary">{heading}</h2>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.audio.voice.description",
            message:
              "How the voice speaks in conversation mode. The read-aloud button always reads the text in the chat.",
          })}
        </p>
      </div>
      <WordingRow
        heading={t({
          id: "preferences.dialog.audio.voice.replies.heading",
          message: "Replies in conversation",
        })}
        description={t({
          id: "preferences.dialog.audio.voice.replies.description",
          message:
            "Natural: the voice gives a short spoken answer and the chat keeps the complete written one. Word for word: the voice reads the written answer.",
        })}
        wording={replies.data?.wording}
        userChoice={replies.data?.user_choice}
        saving={saving}
        onChange={(wording) =>
          void save({ preference_reply_speech_wording: wording })
        }
      />
      <WordingRow
        heading={t({
          id: "preferences.dialog.audio.voice.cards.heading",
          message: "Approval cards",
        })}
        description={t({
          id: "preferences.dialog.audio.voice.cards.description",
          message:
            "Natural: the voice says what is being approved in plain sentences. Word for word: it reads the card's fields as shown.",
        })}
        wording={cards.data?.wording}
        userChoice={cards.data?.user_choice}
        saving={saving}
        onChange={(wording) =>
          void save({ preference_approval_speech_wording: wording })
        }
      />
    </div>
  );
}
