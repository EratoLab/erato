import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import {
  chatIsReadyToChat,
  createAuthenticatedContext,
  sendFirstMessage,
} from "./shared";

// Model-agnostic cases run in the `basic` scenario. The Mock-LLM-dependent
// cases (send failure / archived / infinite-spinner) live in
// invalid-chat-navigation.many-models.spec.ts, since Mock-LLM only exists in
// the many-models scenario.

const BOGUS_CHAT_ID = "00000000-0000-0000-0000-000000000000";
const CHAT_MESSAGES = /\/api\/v1beta\/chats\/[0-9a-fA-F-]+\/messages/;

const textboxOf = (page: Page) =>
  page.getByRole("textbox", { name: "Type a message..." });

// F1 + B1: an invalid/unauthorized chat id must not become a dead-end. The
// history GET is 404 (B1) and the route guard redirects to the blank composer.
test(
  "invalid chat id redirects to /chat/new (no dead-end)",
  { tag: TAG_CI },
  async ({ page }) => {
    const messagesResp = page
      .waitForResponse((r) => CHAT_MESSAGES.test(r.url()), { timeout: 15000 })
      .catch(() => null);
    await page.goto(`/chat/${BOGUS_CHAT_ID}`);

    // F1: guard redirects an invalid chat to the blank composer.
    await expect(page).toHaveURL(/\/chat\/new$/, { timeout: 15000 });
    await expect(textboxOf(page)).toBeVisible();

    const mResp = await messagesResp;
    console.log(
      `[invalid-id] messagesGET=${mResp?.status()} finalUrl=${page.url()}`,
    );
    // B1: the history GET is 404 (not 500).
    expect(mResp?.status()).toBe(404);
  },
);

// Security probe: does the status code for another user's chat differ from a
// nonexistent one? If so, existence of others' chats is an enumeration oracle.
test("cross-user status oracle probe", { tag: TAG_CI }, async ({ browser }) => {
  const { context: c1, page: p1 } = await createAuthenticatedContext(
    browser,
    "user01@example.com",
  );
  await p1.goto("/");
  await chatIsReadyToChat(p1);
  const victimId = await sendFirstMessage(p1, "a private secret for user01");

  const { context: c2, page: p2 } = await createAuthenticatedContext(
    browser,
    "user02@example.com",
  );

  const randomId = "11111111-1111-4111-8111-111111111111";
  const foreign = await p2.request.get(
    `/api/v1beta/chats/${victimId}/messages`,
  );
  const missing = await p2.request.get(
    `/api/v1beta/chats/${randomId}/messages`,
  );
  const ownByVictim = await p1.request.get(
    `/api/v1beta/chats/${victimId}/messages`,
  );
  const foreignBody = await foreign.text();

  console.log(`[oracle] foreign (user02 -> user01 chat) = ${foreign.status()}`);
  console.log(`[oracle] missing (random uuid)           = ${missing.status()}`);
  console.log(
    `[oracle] own     (user01 -> own chat)    = ${ownByVictim.status()}`,
  );
  console.log(
    `[oracle] foreign leaks victim text? ${foreignBody.includes("a private secret for user01")}`,
  );
  console.log(
    `[oracle] foreign body (first 200): ${foreignBody.slice(0, 200)}`,
  );

  // S1: no cross-user content leak.
  expect(foreignBody).not.toContain("a private secret for user01");
  // Own chat is readable.
  expect(ownByVictim.status()).toBe(200);
  // B1 + S2: foreign == missing == 404 (uniform → no existence-enumeration oracle).
  expect(foreign.status()).toBe(404);
  expect(missing.status()).toBe(404);

  await c1.close();
  await c2.close();
});
