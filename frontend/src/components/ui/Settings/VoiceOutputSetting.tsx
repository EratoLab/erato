import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";

import { refreshVoiceTraces } from "@/hooks/audio/voiceTraces";
import {
  approvalSpeechStyleQuery,
  fetchUpdateProfilePreferences,
  replySpeechStyleQuery,
  useApprovalSpeechStyle,
  useReplySpeechStyle,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Checkbox } from "../Controls/Checkbox";
import { SegmentedControl } from "../Controls/SegmentedControl";
import { toast } from "../Toast";

import type { UpdateProfilePreferencesRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type Wording = "natural" | "precise";

/**
 * Under a row: the way back to the organization's value when the user set
 * their own, or that the organization set it when the user may not choose.
 */
function OrganizationNote({
  userChoice,
  ownValue,
  saving,
  indent = false,
  onFollowOrganization,
}: {
  userChoice?: boolean;
  ownValue: boolean;
  saving: boolean;
  /** Lined up with a checkbox's label. */
  indent?: boolean;
  onFollowOrganization: () => void;
}) {
  if (userChoice === false)
    return (
      <p className={clsx("text-xs text-theme-fg-muted", indent && "pl-6")}>
        {t({
          id: "preferences.dialog.audio.voice.locked",
          message: "Set by your organization",
        })}
      </p>
    );
  if (!ownValue) return null;
  return (
    <button
      type="button"
      className={clsx(
        "text-xs text-theme-fg-secondary underline hover:text-theme-fg-primary disabled:opacity-50",
        indent && "pl-6",
      )}
      onClick={onFollowOrganization}
      disabled={saving}
    >
      {t({
        id: "preferences.dialog.audio.voice.followOrganization",
        message: "Use my organization's setting",
      })}
    </button>
  );
}

interface WordingRowProps {
  heading: string;
  description: string;
  wording?: Wording;
  userChoice?: boolean;
  /** The value shown is the user's own, not the organization's. */
  ownValue: boolean;
  saving: boolean;
  onChange: (wording: Wording) => void;
  onFollowOrganization: () => void;
}

function WordingRow({
  heading,
  description,
  wording,
  userChoice,
  ownValue,
  saving,
  onChange,
  onFollowOrganization,
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
        <h4 className="text-sm text-theme-fg-primary">{heading}</h4>
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
      <OrganizationNote
        userChoice={userChoice}
        ownValue={ownValue}
        saving={saving}
        onFollowOrganization={onFollowOrganization}
      />
    </div>
  );
}

interface SpokenRowProps {
  label: string;
  description: string;
  spoken?: boolean;
  userChoice?: boolean;
  ownValue: boolean;
  saving: boolean;
  /** Why the row cannot be changed now, other than the organization's lock. */
  unavailable?: string;
  onChange: (spoken: boolean) => void;
  onFollowOrganization: () => void;
}

/** One thing the voice says or not, with the same lock as the wording. */
function SpokenRow({
  label,
  description,
  spoken,
  userChoice,
  ownValue,
  saving,
  unavailable,
  onChange,
  onFollowOrganization,
}: SpokenRowProps) {
  if (spoken === undefined) return null;
  return (
    <div className="space-y-1">
      <Checkbox
        checked={spoken}
        onCheckedChange={onChange}
        disabled={saving || userChoice === false || unavailable !== undefined}
        label={label}
      />
      <p className="pl-6 text-sm text-theme-fg-secondary">{description}</p>
      {unavailable !== undefined && (
        <p className="pl-6 text-xs text-theme-fg-muted">{unavailable}</p>
      )}
      <OrganizationNote
        indent
        userChoice={userChoice}
        ownValue={ownValue}
        saving={saving}
        onFollowOrganization={onFollowOrganization}
      />
    </div>
  );
}

function GroupHeading({
  heading,
  first = false,
}: {
  heading: string;
  first?: boolean;
}) {
  return (
    <h3
      className={clsx(
        "text-sm font-medium text-theme-fg-primary",
        !first && "border-t border-[var(--theme-border-subtle)] pt-4",
      )}
    >
      {heading}
    </h3>
  );
}

/**
 * The voice in conversation mode, in the order a person thinks of it: what
 * they hear (replies, approval cards), how it sounds (natural or word for
 * word), and what the chat shows of it. A row is read-only where the
 * organization has not allowed a choice.
 */
export function VoiceOutputSetting() {
  const queryClient = useQueryClient();
  const replies = useReplySpeechStyle({});
  const cards = useApprovalSpeechStyle({});
  const [saving, setSaving] = useState(false);

  // `null` clears the user's own value: the organization's applies again.
  const save = async (body: UpdateProfilePreferencesRequest) => {
    setSaving(true);
    try {
      await fetchUpdateProfilePreferences({ body });
      await Promise.all([
        refreshVoiceTraces(),
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

  const repliesSpoken = replies.data?.spoken;

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

      <GroupHeading
        first
        heading={t({
          id: "preferences.dialog.audio.voice.hear.heading",
          message: "What you hear",
        })}
      />
      <SpokenRow
        label={t({
          id: "preferences.dialog.audio.voice.repliesSpoken.label",
          message: "Speak replies",
        })}
        description={t({
          id: "preferences.dialog.audio.voice.repliesSpoken.description",
          message:
            "In conversation mode the voice says each reply. Off: replies are only written in the chat.",
        })}
        spoken={repliesSpoken}
        userChoice={replies.data?.user_choice}
        ownValue={replies.data?.spoken_source === "user"}
        saving={saving}
        onChange={(spoken) =>
          void save({ preference_reply_speech_spoken: spoken })
        }
        onFollowOrganization={() =>
          void save({ preference_reply_speech_spoken: null })
        }
      />
      <SpokenRow
        label={t({
          id: "preferences.dialog.audio.voice.cardsSpoken.label",
          message: "Read approval cards aloud",
        })}
        description={t({
          id: "preferences.dialog.audio.voice.cardsSpoken.description",
          message:
            "When the assistant asks you to approve something, the voice reads the card. The card is always shown on screen.",
        })}
        spoken={cards.data?.spoken}
        userChoice={cards.data?.user_choice}
        ownValue={cards.data?.spoken_source === "user"}
        saving={saving}
        unavailable={
          repliesSpoken === false
            ? t({
                id: "preferences.dialog.audio.voice.cardsSpoken.needsReplies",
                message: "Cards are read aloud only while replies are spoken.",
              })
            : undefined
        }
        onChange={(spoken) =>
          void save({ preference_approval_speech_spoken: spoken })
        }
        onFollowOrganization={() =>
          void save({ preference_approval_speech_spoken: null })
        }
      />

      <GroupHeading
        heading={t({
          id: "preferences.dialog.audio.voice.sound.heading",
          message: "How it sounds",
        })}
      />
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
        ownValue={replies.data?.source === "user"}
        saving={saving}
        onChange={(wording) =>
          void save({ preference_reply_speech_wording: wording })
        }
        onFollowOrganization={() =>
          void save({ preference_reply_speech_wording: null })
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
        ownValue={cards.data?.source === "user"}
        saving={saving}
        onChange={(wording) =>
          void save({ preference_approval_speech_wording: wording })
        }
        onFollowOrganization={() =>
          void save({
            preference_approval_speech_wording: null,
            preference_approval_speech_amount: null,
          })
        }
      />

      {replies.data && (
        <>
          <GroupHeading
            heading={t({
              id: "preferences.dialog.audio.voice.shown.heading",
              message: "What the chat shows",
            })}
          />
          <div className="space-y-1">
            <Checkbox
              checked={replies.data.show_in_chat}
              onCheckedChange={(shown) =>
                void save({ preference_reply_speech_show_in_chat: shown })
              }
              disabled={saving}
              label={t({
                id: "preferences.dialog.audio.voice.showInChat.label",
                message: "Show what the voice said in the chat",
              })}
            />
            <p className="pl-6 text-sm text-theme-fg-secondary">
              {t({
                id: "preferences.dialog.audio.voice.showInChat.description",
                message:
                  "Adds a folded “Spoken” line above each answer in conversation, with a play button where your organization keeps the recording.",
              })}
            </p>
            <OrganizationNote
              indent
              ownValue={replies.data.show_in_chat_source === "user"}
              saving={saving}
              onFollowOrganization={() =>
                void save({ preference_reply_speech_show_in_chat: null })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
