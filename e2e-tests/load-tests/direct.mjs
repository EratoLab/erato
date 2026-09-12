// Real Dex login via the upstream helper, then Node HTTP/SSE with no browser
// work during the measured generation window. This is a diagnostic control.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readChatStream } from "./sse.mjs";

function integer(name, fallback, min, max) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || +raw < min || +raw > max)
    throw new Error(`Invalid ${name}: ${raw}`);
  return +raw;
}
const users = integer("USERS", 1, 1, 1000);
const first = integer("FIRST_USER", 1, 1, 1000);
const duration = integer("DURATION_SECONDS", 45, 0, 86400);
const timeout = integer("RESPONSE_TIMEOUT_MS", 120000, 1, 600000);
if (first + users - 1 > 1000) throw new Error("Account range exceeds 1000");
if (!process.argv[2]) throw new Error("Pass the infrastructure checkout path");
const { login } = await import(
  pathToFileURL(
    resolve(process.argv[2], "helm/erato-stress-test/load-tests/lib/chat.js"),
  )
);
const base = process.env.BASE_URL || "http://localhost:4180";
const browser = await chromium.launch();
const identities = new Set();
const sessions = [];
let failures = 0;
try {
  // Login sequentially, then close Chromium before measuring backend traffic.
  for (let i = first; i < first + users; i++) {
    const email = `user-${String(i).padStart(4, "0")}@example.com`;
    const context = await browser.newContext({ locale: "en-US" });
    try {
      const page = await context.newPage();
      await login(page, base, email, process.env.TEST_PASSWORD || "password");
      const response = await context.request.get(
        `${base}/api/v1beta/me/profile`,
      );
      const profile = await response.json();
      if (
        !response.ok() ||
        profile.email !== email ||
        !profile.id ||
        identities.has(profile.id)
      )
        throw new Error(
          "Profile identity is missing, duplicated, or mismatched",
        );
      identities.add(profile.id);
      const cookies = await context.cookies(base);
      sessions.push({
        email,
        cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      });
      console.log(
        JSON.stringify({ kind: "login", email, id: profile.id, success: true }),
      );
    } catch (error) {
      failures++;
      console.error(
        JSON.stringify({
          kind: "login",
          email,
          success: false,
          error: String(error),
        }),
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (process.env.AUTH_ONLY !== "1") {
  const deadline = performance.now() + duration * 1000;
  await Promise.all(
    sessions.map(async ({ email, cookie }) => {
      let successful = false;
      try {
        do {
          const start = performance.now();
          const timing = { kind: "chat", email, success: false };
          try {
            const response = await fetch(
              `${base}/api/v1beta/me/messages/submitstream`,
              {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(timeout),
                headers: {
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "X-Erato-Platform": "web",
                },
                body: JSON.stringify({
                  user_message: "Test",
                  chat_provider_id: process.env.MODEL_ID || "mock",
                }),
              },
            );
            timing.headers_ms = performance.now() - start;
            if (!response.ok)
              throw new Error(
                `submitstream HTTP ${response.status}: ${await response.text()}`,
              );
            await readChatStream(response.body, (event) => {
              const elapsed = performance.now() - start;
              if (event.message_type === "chat_created")
                timing.chat_id = event.chat_id;
              if (event.message_type === "text_delta") {
                timing.first_token_ms ??= elapsed;
                timing.last_token_ms = elapsed;
              }
              if (event.message_type === "assistant_message_completed")
                timing.persisted_ms = elapsed;
            });
            timing.success = true;
          } catch (error) {
            timing.error = String(error);
            throw error;
          } finally {
            timing.total_ms = performance.now() - start;
            console.log(JSON.stringify(timing));
          }
        } while (performance.now() < deadline);
        successful = true;
      } catch {
        failures++;
      } finally {
        console.log(
          JSON.stringify({ kind: "journey", email, success: successful }),
        );
      }
    }),
  );
}
process.exitCode = failures ? 1 : 0;
