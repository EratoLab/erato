//! The bot's own texts in English and German, keyed by message id. The
//! answers come from the model and the tips from the admin; neither is here.
//! Values go in at `{name}` placeholders; both languages name the same ones.

pub use crate::services::text_language::Lang;

macro_rules! texts {
    ($($id:ident => $english:literal, $german:literal;)*) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Msg {
            $($id,)*
        }

        impl Msg {
            #[cfg(test)]
            const ALL: &'static [Msg] = &[$(Msg::$id,)*];

            fn pair(self) -> (&'static str, &'static str) {
                match self {
                    $(Msg::$id => ($english, $german),)*
                }
            }
        }
    };
}

texts! {
    // Welcome and sign-in
    Welcome => "Hi, I'm {app}. Ask me anything here, attach files, or @mention me in group chats and channels. Send /new to start a fresh chat.",
        "Hallo, ich bin {app}. Fragen Sie mich hier, was Sie möchten, hängen Sie Dateien an oder erwähnen Sie mich mit @ in Gruppenchats und Kanälen. Senden Sie /new, um einen neuen Chat zu beginnen.";
    WelcomeSummary => "Hi, I'm {app}.", "Hallo, ich bin {app}.";
    WelcomeOpenTab => "Open the {tab} tab at the top of this chat once so I know your account, then send me your first question.",
        "Öffnen Sie einmal den Tab {tab} oben in diesem Chat, damit ich Ihr Konto kenne, und senden Sie mir dann Ihre erste Frage.";
    WelcomeOpenApp => "Open {app} once so I know your account, then send me your first question.",
        "Öffnen Sie einmal {app}, damit ich Ihr Konto kenne, und senden Sie mir dann Ihre erste Frage.";
    OpenApp => "Open {app}", "{app} öffnen";
    UnknownUser => "I don't know you in {app} yet. Please open {place} once, then message me again.",
        "Ich kenne Sie in {app} noch nicht. Bitte öffnen Sie einmal {place} und schreiben Sie mir dann erneut.";
    PlaceTabOrLink => "the {tab} tab at the top of this chat or {link}", "den Tab {tab} oben in diesem Chat oder {link}";
    PlaceTab => "the {tab} tab at the top of this chat", "den Tab {tab} oben in diesem Chat";
    SignIn => "Sign in", "Anmelden";
    SignInText => "Sign in to let {app} access your Microsoft 365 data.",
        "Melden Sie sich an, damit {app} auf Ihre Microsoft-365-Daten zugreifen kann.";

    // Messages and their progress
    SendAMessage => "Send me a message to start a chat with {app}.",
        "Senden Sie mir eine Nachricht, um einen Chat mit {app} zu beginnen.";
    NewChatStarted => "Started a new chat. Send your next message when you are ready.",
        "Ein neuer Chat ist gestartet. Senden Sie Ihre nächste Nachricht, wenn Sie so weit sind.";
    NothingToStop => "There is no active response to stop in this chat.",
        "In diesem Chat läuft keine Antwort, die sich stoppen ließe.";
    MessageNotIdentified => "I could not identify this message. Please send it again.",
        "Ich konnte diese Nachricht nicht zuordnen. Bitte senden Sie sie noch einmal.";
    Preparing => "Preparing your request…", "Ihre Anfrage wird vorbereitet…";
    Working => "Working on your request…", "Ihre Anfrage wird bearbeitet…";
    Thinking => "Thinking…", "Denkt nach…";
    ReadingAttachments => "Reading attachments…", "Anhänge werden gelesen…";
    ReadingConversation => "Reading the conversation…", "Die Unterhaltung wird gelesen…";
    AttachmentUnreadable => "I could not read the attachment \"{file}\"; continuing without it.",
        "Ich konnte den Anhang „{file}“ nicht lesen und mache ohne ihn weiter.";
    LookAtAttachedFiles => "Please take a look at the attached file(s).",
        "Bitte sehen Sie sich die angehängten Dateien an.";
    ToolPreparing => "Preparing {tool}…", "{tool} wird vorbereitet…";
    ToolRunning => "Using {tool}…", "{tool} wird verwendet…";
    ToolFinished => "Finished {tool}. Preparing the response…",
        "{tool} ist fertig. Die Antwort wird vorbereitet…";
    ToolFailed => "{tool} failed. Preparing the response…",
        "{tool} ist fehlgeschlagen. Die Antwort wird vorbereitet…";
    NeedsAppProgress => "This step needs the {app} app…", "Dieser Schritt erfordert die {app}-App…";
    Stopped => "Stopped.", "Gestoppt.";
    Stopping => "Stopping…", "Wird gestoppt…";
    Finished => "Finished.", "Fertig.";
    EarlierSteps => "Earlier steps", "Frühere Schritte";
    TaskFinished => "A background task finished.", "Eine Hintergrundaufgabe ist abgeschlossen.";

    // Answers
    NeedApproval => "I need your approval before I continue.",
        "Bevor ich weitermache, brauche ich Ihre Genehmigung.";
    ApprovalNeededToContinue => "Approval needed to continue.",
        "Zum Fortfahren ist eine Genehmigung nötig.";
    NeedsApp => "This step needs the {app} app.", "Dieser Schritt erfordert die {app}-App.";
    OpenChatToContinue => "[Open the chat in {app}]({link}) to continue.",
        "[Öffnen Sie den Chat in {app}]({link}), um fortzufahren.";
    OpenChatToContinuePlain => "Open the chat in {app} to continue.",
        "Öffnen Sie den Chat in {app}, um fortzufahren.";
    NoText => "(The answer contained no text.)", "(Die Antwort enthielt keinen Text.)";
    UnavailableFile => "Unavailable file", "Nicht verfügbare Datei";
    File => "File", "Datei";
    PageNumber => "Page {number}", "Seite {number}";
    MessageNumber => "Message {number}", "Nachricht {number}";

    // Errors
    SomethingWentWrong => "Sorry, something went wrong while handling your message.",
        "Entschuldigung, beim Verarbeiten Ihrer Nachricht ist etwas schiefgelaufen.";
    PreparingFailed => "Sorry, something went wrong while preparing your message.",
        "Entschuldigung, beim Vorbereiten Ihrer Nachricht ist etwas schiefgelaufen.";
    GenerationFailed => "Sorry, something went wrong: {reason}",
        "Entschuldigung, etwas ist schiefgelaufen: {reason}";
    AnswerNotGenerated => "The answer could not be generated.",
        "Die Antwort konnte nicht erstellt werden.";
    ContentFiltered => "The response was filtered because the request triggered the content policy.",
        "Die Antwort wurde gefiltert, weil die Anfrage gegen die Inhaltsrichtlinien verstößt.";
    RateLimited => "The rate limit or quota was exceeded. This can also happen when the input is too large. Please try again in a minute.",
        "Das Anfragelimit oder Kontingent wurde überschritten. Das kann auch passieren, wenn die Eingabe zu groß ist. Bitte versuchen Sie es in einer Minute noch einmal.";
    RepetitionLoop => "The answer kept repeating itself and was stopped. Please try again.",
        "Die Antwort hat sich ständig wiederholt und wurde abgebrochen. Bitte versuchen Sie es noch einmal.";
    NoAnswer => "Sorry, I did not get an answer this time.",
        "Entschuldigung, diesmal habe ich keine Antwort bekommen.";
    Busy => "I'm still working on your previous message.",
        "Ich arbeite noch an Ihrer vorherigen Nachricht.";
    CouldNotStart => "I could not start this request: {reason}",
        "Ich konnte diese Anfrage nicht starten: {reason}";
    CouldNotStartPlain => "I could not start this request.",
        "Ich konnte diese Anfrage nicht starten.";
    ChatArchived => "This chat is archived and cannot receive new messages. Send /new to start a fresh chat.",
        "Dieser Chat ist archiviert und kann keine neuen Nachrichten empfangen. Senden Sie /new, um einen neuen Chat zu beginnen.";
    TaskStillRunning => "This task is still running and cannot receive new messages yet.",
        "Diese Aufgabe läuft noch und kann noch keine neuen Nachrichten empfangen.";
    TooManyAttachments => "This message has too many attachments. Please send fewer files at once.",
        "Diese Nachricht hat zu viele Anhänge. Bitte senden Sie weniger Dateien auf einmal.";
    StartFailed => "Something went wrong while starting this request. Please try again.",
        "Beim Starten dieser Anfrage ist etwas schiefgelaufen. Bitte versuchen Sie es noch einmal.";
    StartFailedTryButton => "Something went wrong while starting this. Please try the button again.",
        "Beim Starten ist etwas schiefgelaufen. Bitte versuchen Sie es mit der Schaltfläche noch einmal.";
    RequestNotProcessed => "The request could not be processed.",
        "Die Anfrage konnte nicht verarbeitet werden.";

    // Approvals
    ApprovalNeeded => "Approval needed", "Genehmigung erforderlich";
    ToolCallsNeedApproval => "{count} tool calls need approval",
        "{count} Tool-Aufrufe brauchen eine Genehmigung";
    TasksToStart => "{app} wants to start {count} task(s)",
        "{app} möchte {count} Aufgabe(n) starten";
    SubTasksWaiting => "Sub-tasks are waiting for approval",
        "Teilaufgaben warten auf eine Genehmigung";
    ToolCallLimitReached => "Tool-call limit reached", "Limit für Tool-Aufrufe erreicht";
    ToolCallLimitChoice => "Continue with twice the tool-call budget, generate an answer using the information collected so far, or stop this response.",
        "Mit dem doppelten Budget für Tool-Aufrufe fortfahren, eine Antwort anhand der bisher gesammelten Informationen erstellen oder diese Antwort stoppen.";
    ToolCallLimitSummary => "{heading}. Choose whether to continue, answer now, or stop.",
        "{heading}. Wählen Sie: fortfahren, jetzt antworten oder stoppen.";
    ApprovalSummary => "Approval needed to run {tool}.",
        "Genehmigung erforderlich, um {tool} auszuführen.";
    RunTool => "Run {tool}?", "{tool} ausführen?";
    ChooseApproveOrDeny => "Choose approve or deny", "Wählen Sie Genehmigen oder Ablehnen";
    Approve => "Approve", "Genehmigen";
    Deny => "Deny", "Ablehnen";
    ApproveAll => "Approve all", "Alle genehmigen";
    DenyAll => "Deny all", "Alle ablehnen";
    SubmitDecisions => "Submit decisions", "Entscheidungen senden";
    ContinueToolCalls => "Continue tool calls", "Tool-Aufrufe fortsetzen";
    AnswerNow => "Generate answer now", "Jetzt Antwort erstellen";
    Stop => "Stop", "Stoppen";
    OmittedDetails => "Some details are not shown because Teams limits card size. Open the chat in {app} to see them.",
        "Einige Details fehlen, weil Teams die Größe von Karten begrenzt. Öffnen Sie den Chat in {app}, um sie zu sehen.";
    ApprovedBy => "{tool} was approved by {person}.", "{tool} wurde von {person} genehmigt.";
    DeniedBy => "{tool} was denied by {person}.", "{tool} wurde von {person} abgelehnt.";
    StoppedBy => "{tool} was stopped by {person}.", "{tool} wurde von {person} gestoppt.";
    TheTool => "The tool", "Das Tool";
    // The person who decided, when Teams did not name them.
    You => "you", "Ihnen";
    // Who a group reply mentions, when Teams did not name them.
    MentionFallback => "you", "Sie";
    ChooseEveryItem => "Please choose Approve or Deny for every item, then submit again.",
        "Bitte wählen Sie für jeden Eintrag Genehmigen oder Ablehnen und senden Sie dann erneut.";
    ApprovalsChanged => "The approvals changed in the meantime. Here they are again:",
        "Die Genehmigungen haben sich inzwischen geändert. Hier sind sie noch einmal:";
    ApprovalNotOpenForYou => "This approval is not open for you anymore.",
        "Diese Genehmigung ist für Sie nicht mehr offen.";
    ApprovalAlreadyDecided => "This approval was already decided.",
        "Über diese Genehmigung wurde bereits entschieden.";
    ApprovalNotOpen => "This approval is not open anymore.",
        "Diese Genehmigung ist nicht mehr offen.";
    ApprovalInParentChat => "This approval is answered in the chat that started the task.",
        "Diese Genehmigung wird in dem Chat erteilt, der die Aufgabe gestartet hat.";
    ContinuesOnItsOwn => "This response continues on its own once its tasks finish.",
        "Diese Antwort geht von selbst weiter, sobald ihre Aufgaben fertig sind.";

    // Response controls, edits and retries
    ControlUnavailable => "This control is no longer available for you in this chat.",
        "Diese Schaltfläche ist für Sie in diesem Chat nicht mehr verfügbar.";
    StopOrWaitFirst => "Please stop the current response or wait for it to finish, then use the latest card.",
        "Bitte stoppen Sie die aktuelle Antwort oder warten Sie, bis sie fertig ist, und verwenden Sie dann die neueste Karte.";
    StillFinishing => "The previous response is still finishing. Please try this button again in a moment.",
        "Die vorherige Antwort wird noch abgeschlossen. Bitte versuchen Sie es gleich noch einmal.";
    ActionGone => "This action was already used, expired, or replaced by a newer edit. Use the latest card.",
        "Diese Aktion wurde bereits verwendet, ist abgelaufen oder wurde durch eine neuere Änderung ersetzt. Verwenden Sie die neueste Karte.";
    NothingLeftToStop => "This response has already finished or was replaced. There is nothing to stop.",
        "Diese Antwort ist bereits fertig oder wurde ersetzt. Es gibt nichts zu stoppen.";
    QuestionEdited => "Your question was edited. Regenerate the answer using the updated question?",
        "Ihre Frage wurde bearbeitet. Soll die Antwort mit der geänderten Frage neu erstellt werden?";
    RegenerateHint => "Regenerating starts a new answer and may run tools again. Original attachments are kept.",
        "Eine Neubeantwortung erstellt eine neue Antwort und kann Tools erneut ausführen. Die ursprünglichen Anhänge bleiben erhalten.";
    StopBeforeRegenerating => "Stop the current response or wait for it to finish before regenerating.",
        "Stoppen Sie die aktuelle Antwort oder warten Sie, bis sie fertig ist, bevor Sie sie neu erstellen lassen.";
    RegenerateEdited => "Regenerate edited question", "Bearbeitete Frage neu beantworten";
    Retry => "Retry", "Erneut versuchen";
    ResponseIncomplete => "The response could not be completed.",
        "Die Antwort konnte nicht abgeschlossen werden.";
    ToolsInvolved => "This request involved tools. Send a new instruction to continue without automatically repeating their work.",
        "An dieser Anfrage waren Tools beteiligt. Senden Sie eine neue Anweisung, um fortzufahren, ohne deren Arbeit automatisch zu wiederholen.";
    SendNewMessage => "Send a new message to continue.",
        "Senden Sie eine neue Nachricht, um fortzufahren.";
    EditSavedResend => "That edit was saved in Teams. I can regenerate questions sent after this update; please send this question again or edit it in {app}.",
        "Die Änderung ist in Teams gespeichert. Neu beantworten kann ich nur Fragen, die nach diesem Update gesendet wurden. Bitte senden Sie die Frage noch einmal oder bearbeiten Sie sie in {app}.";
    EditSavedNotLatest => "That edit was saved in Teams. Only the latest question can be regenerated here; open {app} to edit an earlier turn.",
        "Die Änderung ist in Teams gespeichert. Hier lässt sich nur die letzte Frage neu beantworten. Öffnen Sie {app}, um eine frühere Frage zu bearbeiten.";
    NotLatestQuestion => "This question is no longer the latest question in this chat.",
        "Diese Frage ist nicht mehr die letzte Frage in diesem Chat.";
    NoAnswerToRetry => "There is no saved answer to retry.",
        "Es gibt keine gespeicherte Antwort, die sich erneut versuchen ließe.";
    AnswerUnavailable => "This answer is no longer available.",
        "Diese Antwort ist nicht mehr verfügbar.";
    AnswerCannotRetry => "This answer can no longer be retried.",
        "Diese Antwort lässt sich nicht mehr erneut versuchen.";
    ToolsMayHaveRun => "Tools may already have run. Send a new instruction to continue without repeating their effects.",
        "Möglicherweise wurden bereits Tools ausgeführt. Senden Sie eine neue Anweisung, um fortzufahren, ohne deren Wirkung zu wiederholen.";
    QuestionUnavailable => "The original question is unavailable.",
        "Die ursprüngliche Frage ist nicht verfügbar.";
    OnlyYourQuestion => "Only your question can be edited.",
        "Nur Ihre eigene Frage kann bearbeitet werden.";
    EditUnavailable => "This edit is no longer available.",
        "Diese Änderung ist nicht mehr verfügbar.";

    // Tips and reminders
    TipFrom => "A tip from {app}", "Ein Tipp von {app}";
    DontRemindMe => "Don't remind me", "Nicht mehr erinnern";
    TipsOn => "{app} will send you tips again when you have not used it for a while. Send /reminders off to stop them.",
        "{app} sendet Ihnen wieder Tipps, wenn Sie es eine Weile nicht genutzt haben. Senden Sie /erinnerungen aus, um sie abzustellen.";
    TipsOff => "All right, {app} will not send you any more tips. Send /reminders on to get them again.",
        "In Ordnung, {app} sendet Ihnen keine Tipps mehr. Senden Sie /erinnerungen an, um sie wieder zu erhalten.";
    ButtonNotSupported => "This button is not supported.", "Diese Schaltfläche wird nicht unterstützt.";
    ButtonFailed => "Something went wrong. Please try the button again.",
        "Etwas ist schiefgelaufen. Bitte versuchen Sie es mit der Schaltfläche noch einmal.";
    ButtonGone => "This button was already used or has expired.",
        "Diese Schaltfläche wurde bereits verwendet oder ist abgelaufen.";
    ReminderButtonGone => "This button was already used or has expired. You can find your reminders on the {page}.",
        "Diese Schaltfläche wurde bereits verwendet oder ist abgelaufen. Ihre Erinnerungen finden Sie auf der Seite {page}.";
    ScheduledPage => "Scheduled page", "„Geplant“";
    MarkedDone => "Marked as done.", "Als erledigt markiert.";
    SnoozedUntil => "Snoozed until {time}.", "Zurückgestellt bis {time}.";
    ReminderGone => "This reminder no longer exists.", "Diese Erinnerung existiert nicht mehr.";
    ReminderCancelled => "This reminder was cancelled.", "Diese Erinnerung wurde abgebrochen.";
    ReminderArriving => "Not snoozed: this reminder is arriving right now.",
        "Nicht zurückgestellt: Diese Erinnerung wird gerade zugestellt.";
    DueAgainFirst => "Not snoozed: this reminder is due again by then, or already was.",
        "Nicht zurückgestellt: Diese Erinnerung ist bis dahin ohnehin wieder fällig oder war es schon.";
    TimeHasPassed => "Not snoozed: that time has passed.",
        "Nicht zurückgestellt: Dieser Zeitpunkt ist schon vorbei.";
    ReminderUnchangeable => "This reminder cannot be changed right now.",
        "Diese Erinnerung lässt sich gerade nicht ändern.";
}

impl Msg {
    pub fn text(self, lang: Lang) -> &'static str {
        let (english, german) = self.pair();
        lang.pick(english, german)
    }

    /// The text with each `{name}` replaced by its value. Values are never
    /// read for placeholders themselves, so a tool named `{count}` stays.
    pub fn fill(self, lang: Lang, values: &[(&str, &str)]) -> String {
        let text = self.text(lang);
        let mut filled = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(start) = rest.find('{') {
            filled.push_str(&rest[..start]);
            let after = &rest[start + 1..];
            let value = after.find('}').and_then(|end| {
                values
                    .iter()
                    .find(|(name, _)| *name == &after[..end])
                    .map(|(_, value)| (end, *value))
            });
            match value {
                Some((end, value)) => {
                    filled.push_str(value);
                    rest = &after[end + 1..];
                }
                None => {
                    filled.push('{');
                    rest = after;
                }
            }
        }
        filled.push_str(rest);
        filled
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn placeholders(text: &str) -> BTreeSet<&str> {
        text.split('{')
            .skip(1)
            .filter_map(|part| part.split_once('}').map(|(name, _)| name))
            .collect()
    }

    #[test]
    fn every_text_has_a_german_version_with_the_same_placeholders() {
        for msg in Msg::ALL {
            let (english, german) = msg.pair();
            assert!(!german.trim().is_empty(), "{msg:?}");
            assert_ne!(english, german, "{msg:?} is not translated");
            assert_eq!(placeholders(english), placeholders(german), "{msg:?}");
        }
    }

    #[test]
    fn german_texts_address_the_user_formally() {
        // "Ihr" and "Ihnen" are formal; their informal forms are not listed.
        let informal = [
            "du", "dich", "dir", "dein", "deine", "deinen", "deinem", "deiner", "euch", "euer",
        ];
        for msg in Msg::ALL {
            let german = msg.text(Lang::De);
            for word in german.split(|c: char| !c.is_alphanumeric()) {
                assert!(
                    !informal.contains(&word.to_lowercase().as_str()),
                    "{msg:?}: {german}"
                );
            }
        }
    }

    #[test]
    fn values_fill_their_placeholders_once() {
        assert_eq!(
            Msg::RunTool.fill(Lang::De, &[("tool", "search_docs")]),
            "search_docs ausführen?"
        );
        assert_eq!(
            Msg::ToolCallsNeedApproval.fill(Lang::En, &[("count", "{count}")]),
            "{count} tool calls need approval"
        );
        assert_eq!(
            Msg::ApprovalSummary.fill(Lang::En, &[]),
            "Approval needed to run {tool}."
        );
    }
}
