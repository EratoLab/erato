/**
 * Normalised view of a Teams chat and its messages. Raw Graph JSON never
 * escapes this boundary — the picker, the transcript and the tests all work
 * against these shapes.
 */

import { CHAT_MEMBER_EXPAND_CAP } from "./teamsChatGraph";
import { buildTeamsMessageDeepLink } from "./teamsDeepLink";
import {
  referencedAttachmentIds,
  teamsBodyImageUrls,
  teamsMessageBodyToText,
} from "./teamsMessageText";

import type {
  GraphChat,
  GraphChatMember,
  GraphChatMessage,
} from "./teamsChatGraph";

/** How the signed-in user is recognised among the chat members. */
export interface TeamsSelfIdentity {
  userId?: string | null;
  userPrincipalName?: string | null;
}

export interface ParsedTeamsChat {
  chatId: string;
  title: string;
  /** Member display names, excluding the signed-in user. */
  participants: string[];
  /**
   * The signed-in user's own name as the roster spells it — the same Graph
   * field messages are attributed with, so it matches `senderName` exactly.
   * Null when no member could be matched against `self`.
   */
  selfDisplayName: string | null;
  /** True when `$expand=members` may have truncated the roster. */
  participantsTruncated: boolean;
  chatType: string;
  lastActivityAt: string | null;
  previewText: string;
}

/** A file shared with a message, living in OneDrive/SharePoint. */
export interface TeamsSharedFileRef {
  /** `chatMessageAttachment` id — joins the ref to its inline body marker. */
  attachmentId: string;
  name: string;
  /** Web URL of the file; bytes resolve only through the `/shares` endpoint. */
  contentUrl: string;
}

export interface ParsedTeamsMessage {
  chatId: string;
  messageId: string;
  senderName: string;
  createdAt: string | null;
  editedAt: string | null;
  /** Trimmed; null when Graph sent none or sent it blank. */
  subject: string | null;
  text: string;
  /** Bracketed disclosures for attachments the body never referenced. */
  markers: string[];
  /** Root message of a channel reply; null for roots and for chat messages. */
  replyToId: string | null;
  deepLink: string;
  /** Files shared as OneDrive/SharePoint references, in attachment order. */
  sharedFiles: TeamsSharedFileRef[];
  /**
   * Body images in `[image]` occurrence order; null entries are images the
   * message-reading token cannot fetch.
   */
  imageUrls: (string | null)[];
}

const UNKNOWN_SENDER = "Unknown";
const UNTITLED_CHAT = "Chat";
const TITLE_NAME_LIMIT = 3;

export function chatDisplayTitle(
  chat: GraphChat,
  self?: TeamsSelfIdentity,
): string {
  const topic = chat.topic?.trim();
  if (topic) return topic;

  const names = splitMemberNames(chat.members ?? [], self).others;
  if (names.length === 0) return UNTITLED_CHAT;
  if (chat.chatType === "oneOnOne") return names[0];

  const shown = names.slice(0, TITLE_NAME_LIMIT).join(", ");
  const remaining = names.length - TITLE_NAME_LIMIT;
  return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

export function messageSenderName(message: GraphChatMessage): string {
  return (
    message.from?.user?.displayName ??
    message.from?.application?.displayName ??
    UNKNOWN_SENDER
  );
}

/**
 * System events (joins, renames, calls) and tombstones carry no content the
 * model can use; they are dropped rather than rendered as noise.
 */
export function isRenderableChatMessage(message: GraphChatMessage): boolean {
  if (message.deletedDateTime) return false;
  if (message.messageType !== undefined && message.messageType !== "message") {
    return false;
  }
  return true;
}

export function parseTeamsChat(
  chat: GraphChat,
  self?: TeamsSelfIdentity,
): ParsedTeamsChat | null {
  if (!chat.id) return null;
  const members = chat.members ?? [];
  const names = splitMemberNames(members, self);
  return {
    chatId: chat.id,
    title: chatDisplayTitle(chat, self),
    participants: names.others,
    selfDisplayName: names.self,
    participantsTruncated: members.length >= CHAT_MEMBER_EXPAND_CAP,
    chatType: chat.chatType ?? "unknown",
    lastActivityAt:
      chat.lastMessagePreview?.createdDateTime ??
      chat.lastUpdatedDateTime ??
      null,
    previewText: chat.lastMessagePreview
      ? teamsMessageBodyToText(chat.lastMessagePreview.body)
      : "",
  };
}

export function parseTeamsMessage(
  message: GraphChatMessage,
  chatId: string,
): ParsedTeamsMessage | null {
  if (!message.id) return null;
  if (!isRenderableChatMessage(message)) return null;
  const text = teamsMessageBodyToText(message.body, {
    attachments: message.attachments,
  });
  const markers = unreferencedAttachmentMarkers(message);
  if (text.length === 0 && markers.length === 0) return null;
  return {
    chatId,
    messageId: message.id,
    senderName: messageSenderName(message),
    createdAt: message.createdDateTime ?? null,
    editedAt: message.lastEditedDateTime ?? null,
    subject: messageSubject(message),
    text,
    markers,
    replyToId: message.replyToId ?? null,
    deepLink: message.webUrl ?? buildTeamsMessageDeepLink(chatId, message.id),
    sharedFiles: sharedFileRefs(message),
    imageUrls: teamsBodyImageUrls(message.body),
  };
}

function messageSubject(message: GraphChatMessage): string | null {
  const subject = message.subject?.trim();
  return subject === undefined || subject.length === 0 ? null : subject;
}

function sharedFileRefs(message: GraphChatMessage): TeamsSharedFileRef[] {
  const refs: TeamsSharedFileRef[] = [];
  for (const attachment of message.attachments ?? []) {
    if (attachment.contentType !== "reference") continue;
    if (!attachment.id || !attachment.contentUrl || !attachment.name) continue;
    refs.push({
      attachmentId: attachment.id,
      name: attachment.name,
      contentUrl: attachment.contentUrl,
    });
  }
  return refs;
}

/** Newest first, matching the order Graph returns chat messages in. */
export function parseTeamsMessages(
  messages: GraphChatMessage[],
  chatId: string,
): ParsedTeamsMessage[] {
  const parsed: ParsedTeamsMessage[] = [];
  for (const message of messages) {
    const entry = parseTeamsMessage(message, chatId);
    if (entry) parsed.push(entry);
  }
  return parsed;
}

function unreferencedAttachmentMarkers(message: GraphChatMessage): string[] {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return [];
  const referenced = referencedAttachmentIds(message.body);
  const markers: string[] = [];
  for (const attachment of attachments) {
    if (attachment.id && referenced.has(attachment.id)) continue;
    markers.push(
      attachment.name ? `[attachment: ${attachment.name}]` : "[attachment]",
    );
  }
  return markers;
}

/** The roster is the only place the signed-in user's display name appears. */
function splitMemberNames(
  members: GraphChatMember[],
  self?: TeamsSelfIdentity,
): { others: string[]; self: string | null } {
  const others: string[] = [];
  let own: string | null = null;
  for (const member of members) {
    const name = member.displayName?.trim();
    if (isSelf(member, self)) {
      if (name) own = name;
      continue;
    }
    if (name) others.push(name);
  }
  return { others, self: own };
}

function isSelf(member: GraphChatMember, self?: TeamsSelfIdentity): boolean {
  if (!self) return false;
  if (self.userId && member.userId && member.userId === self.userId)
    return true;
  if (
    self.userPrincipalName &&
    member.email &&
    member.email.toLowerCase() === self.userPrincipalName.toLowerCase()
  ) {
    return true;
  }
  return false;
}
