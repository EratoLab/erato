import { TeamsChatInput } from "./components/TeamsChatInput";
import { createNeutralAddinChatHost } from "../core/AddinChatCore";

/** The neutral host with the Teams composer, whose transcripts are chips. */
export const TeamsAddinChatHost = createNeutralAddinChatHost(TeamsChatInput);
