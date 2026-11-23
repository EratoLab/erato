import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  fetchUpdateProfilePreferences,
  spokenLanguageQuery,
  useSpokenLanguage,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Select } from "../Input/Select";
import { toast } from "../Toast";

const MAX_LANGUAGES = 3;

function languageNamer(locale: string): (code: string) => string {
  try {
    const names = new Intl.DisplayNames([locale], { type: "language" });
    return (code) => names.of(code) ?? code;
  } catch {
    return (code) => code;
  }
}

const linkButton =
  "text-xs text-theme-fg-secondary underline hover:text-theme-fg-primary disabled:opacity-50";

/**
 * "Languages I speak": up to three, in order, the first being the main one.
 * The voice in conversation mode answers in the language the person speaks,
 * among these. Nothing listed means their app language.
 */
export function SpokenLanguagesSetting() {
  const { i18n } = useLingui();
  const queryClient = useQueryClient();
  const spoken = useSpokenLanguage({});
  const [saving, setSaving] = useState(false);
  const nameOf = useMemo(() => languageNamer(i18n.locale), [i18n.locale]);

  const data = spoken.data;
  if (!data) {
    return null;
  }

  const locked = !data.user_choice;
  const ownListed = data.own.length > 0;
  // Without a list of their own the person sees the language the voice
  // falls back to, as the server resolved it, and adding starts from it.
  const shown = ownListed && !locked ? data.own : [data.main];
  const offered = data.offered
    .filter((code) => !shown.includes(code))
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, i18n.locale));
  const allowedNames = data.allowed.map(nameOf).join(", ");
  const notAllowed = data.allowed.length
    ? shown.filter((code) => !data.allowed.includes(code))
    : [];
  const mainCode = shown.find((code) => !notAllowed.includes(code));
  const mainName = nameOf(data.main);

  // `null` clears the list: the app language applies again.
  const save = async (languages: string[] | null) => {
    setSaving(true);
    try {
      await fetchUpdateProfilePreferences({
        body: { preference_spoken_languages: languages },
      });
      await queryClient.invalidateQueries({
        queryKey: spokenLanguageQuery({}).queryKey,
      });
    } catch {
      toast.error({
        title: t({
          id: "preferences.dialog.audio.spokenLanguages.saveFailed",
          message: "Your languages could not be saved",
        }),
      });
    } finally {
      setSaving(false);
    }
  };

  const moveUp = (index: number) => {
    const next = [...shown];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    void save(next);
  };
  const remove = (index: number) => {
    const next = shown.filter((_, at) => at !== index);
    void save(next.length ? next : null);
  };
  const add = (code: string) => {
    if (code) {
      void save([...shown, code]);
    }
  };

  const heading = t({
    id: "preferences.dialog.audio.spokenLanguages.heading",
    message: "Languages I speak",
  });

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">{heading}</h3>
        <p className="text-sm text-theme-fg-secondary">
          {data.follow_speaker
            ? t({
                id: "preferences.dialog.audio.spokenLanguages.description",
                message:
                  "In conversation mode the voice answers in the language you speak, out of these. Put your main language first: the voice uses it when it cannot tell.",
              })
            : t({
                id: "preferences.dialog.audio.spokenLanguages.description.fixed",
                message:
                  "In conversation mode the voice always speaks your first language here.",
              })}
        </p>
      </div>
      <ol aria-label={heading} className="space-y-1">
        {shown.map((code, index) => {
          const language = nameOf(code);
          return (
            <li
              key={code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-theme-fg-primary"
            >
              <span>
                {language}
                {code === mainCode && (
                  <span className="ml-2 text-xs text-theme-fg-muted">
                    {t({
                      id: "preferences.dialog.audio.spokenLanguages.main",
                      message: "Main language",
                    })}
                  </span>
                )}
                {notAllowed.includes(code) && (
                  <span className="ml-2 text-xs text-theme-fg-muted">
                    {t({
                      id: "preferences.dialog.audio.spokenLanguages.notAllowed",
                      message: "Not used here",
                    })}
                  </span>
                )}
              </span>
              {!locked && index > 0 && (
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => moveUp(index)}
                  disabled={saving}
                  aria-label={t({
                    id: "preferences.dialog.audio.spokenLanguages.moveUp.label",
                    message: `Move ${language} up`,
                  })}
                >
                  {t({
                    id: "preferences.dialog.audio.spokenLanguages.moveUp",
                    message: "Move up",
                  })}
                </button>
              )}
              {!locked && ownListed && (
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => remove(index)}
                  disabled={saving}
                  aria-label={t({
                    id: "preferences.dialog.audio.spokenLanguages.remove.label",
                    message: `Remove ${language}`,
                  })}
                >
                  {t({
                    id: "preferences.dialog.audio.spokenLanguages.remove",
                    message: "Remove",
                  })}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {!ownListed && !locked && data.main === data.app_language && (
        <p className="text-xs text-theme-fg-muted">
          {t({
            id: "preferences.dialog.audio.spokenLanguages.fromApp",
            message: "Your app language, until you add another.",
          })}
        </p>
      )}
      {mainCode === undefined && (
        <p className="text-xs text-theme-fg-muted">
          {t({
            id: "preferences.dialog.audio.spokenLanguages.fallback",
            message: `None of these is used here, so the voice speaks ${mainName}.`,
          })}
        </p>
      )}
      {!locked && shown.length < MAX_LANGUAGES && offered.length > 0 && (
        <Select
          aria-label={t({
            id: "preferences.dialog.audio.spokenLanguages.add",
            message: "Add a language",
          })}
          value=""
          onChange={(event) => add(event.target.value)}
          disabled={saving}
        >
          <option value="">
            {t({
              id: "preferences.dialog.audio.spokenLanguages.add",
              message: "Add a language",
            })}
          </option>
          {offered.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      )}
      {data.allowed.length > 0 && (
        <p className="text-xs text-theme-fg-muted">
          {t({
            id: "preferences.dialog.audio.spokenLanguages.allowed",
            message: `Your organization allows: ${allowedNames}.`,
          })}
        </p>
      )}
      {locked && (
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
