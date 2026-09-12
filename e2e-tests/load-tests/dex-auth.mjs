// Real Dex OAuth smoke test; application profile checks live in direct.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
const issuer = process.env.DEX_ISSUER || "http://127.0.0.1:5556";
const redirect = "http://localhost:4180/oauth2/callback";
const browser = await chromium.launch();
const subjects = new Set();
try {
  for (const [email, password] of [
    ["user-0001@example.com", "password"],
    ["user-0500@example.com", "password"],
    ["user-1000@example.com", "password"],
    ["admin@example.com", "admin"],
  ]) {
    const context = await browser.newContext();
    try {
      const state = randomUUID();
      const page = await context.newPage();
      await page.route(`${redirect}**`, async (route) => {
        await route.fulfill({ status: 200, body: "OAuth callback received" });
      });
      const query = new URLSearchParams({
        client_id: "example-app",
        redirect_uri: redirect,
        response_type: "code",
        scope: "openid profile email",
        state,
      });
      await page.goto(`${issuer}/auth?${query}`);
      await page.locator('input[name="login"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('input[name="password"]').press("Enter");
      await page.getByRole("button", { name: "Grant Access" }).click();
      await page.waitForURL(`${redirect}**`);
      const callback = new URL(page.url());
      assert.equal(callback.searchParams.get("state"), state);
      assert.ok(callback.searchParams.get("code"));
      const response = await context.request.post(`${issuer}/token`, {
        form: {
          grant_type: "authorization_code",
          code: callback.searchParams.get("code"),
          client_id: "example-app",
          client_secret: "example-app-secret",
          redirect_uri: redirect,
        },
      });
      assert.equal(response.status(), 200);
      const tokens = await response.json();
      const claims = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64url").toString(),
      );
      assert.equal(claims.iss, issuer);
      assert.equal(claims.aud, "example-app");
      assert.equal(claims.email, email);
      assert.ok(claims.sub && !subjects.has(claims.sub));
      subjects.add(claims.sub);
      console.log(
        `PASS: ${email}: OAuth callback, code exchange, distinct subject and email`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
