import { readFile } from "node:fs/promises";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMockSidecar,
  type MockSidecar,
} from "../test-server/src/index.js";
import {
  DesktopSidecarClient,
  HttpTransport,
  type SidecarConfigureV1Params,
} from "../typescript/src/index.js";
import { validateSidecarConfigureV1Params } from "../typescript/src/generated/validators.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../conformance/fixtures/policy-guides.json", import.meta.url),
    "utf8",
  ),
) as SidecarConfigureV1Params;
const sidecars: MockSidecar[] = [];
afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.stop()));
});

describe("policy guide configuration", () => {
  it("supports both rollout directions of the extensible configuration contract", async () => {
    // A previous client sends no policy guides to a current sidecar.
    expect(
      validateSidecarConfigureV1Params({
        user_configuration: {},
        organization_configuration: { show_tray_icon: false },
      }),
    ).toBe(true);
    expect(validateSidecarConfigureV1Params(fixture)).toBe(true);
    // The previous configuration schema had no policy_guides property and
    // explicitly accepted unknown fields. A new client can send it unchanged.
    const schema = JSON.parse(
      await readFile(
        new URL(
          "../schemas/configuration/sidecar-configuration.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    delete schema.properties.policy_guides;
    const ajv = new Ajv({ strict: true });
    addFormats(ajv);
    expect(ajv.compile(schema)(fixture.organization_configuration)).toBe(true);
  });

  it("validates enabled policies while preserving disabled definitions and arbitrary metadata", () => {
    const invalid = structuredClone(fixture);
    const policy =
      invalid.organization_configuration.policy_guides!.policies.confidential;
    policy.decision_providers = [];
    expect(validateSidecarConfigureV1Params(invalid)).toBe(false);
    policy.enabled = false;
    expect(validateSidecarConfigureV1Params(invalid)).toBe(true);
    policy.enabled = true;
    policy.decision_providers = ["same", "same"];
    expect(validateSidecarConfigureV1Params(invalid)).toBe(false);
    policy.decision_providers = ["primary"];
    policy.question = "   ";
    expect(validateSidecarConfigureV1Params(invalid)).toBe(false);
  });

  it("round-trips all policy data and replaces or clears definitions without losing the user layer", async () => {
    const origin = "https://app.erato.example";
    const sidecar = await createMockSidecar({ allowedOrigins: [origin] });
    sidecars.push(sidecar);
    const client = new DesktopSidecarClient({
      transport: new HttpTransport(sidecar.address.url, {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Origin", origin);
          return fetch(input, { ...init, headers });
        },
      }),
      clientInfo: {
        name: "policy-test",
        version: "1",
        host: { application: "test", runtime: "node" },
        os: { name: "test" },
      },
    });
    await client.discover();
    await client.invoke("sidecar.configure.v1", fixture);
    expect(
      (await client.invoke("indexing.status.v1", {})).configuration,
    ).toEqual(fixture);
    const updated = structuredClone(fixture);
    delete updated.organization_configuration.policy_guides!.policies
      .confidential;
    await client.invoke("sidecar.configure.v1", updated);
    expect(
      (await client.invoke("indexing.status.v1", {})).configuration,
    ).toEqual(updated);
    updated.organization_configuration.policy_guides = { policies: {} };
    await client.invoke("sidecar.configure.v1", updated);
    expect(
      (await client.invoke("indexing.status.v1", {})).configuration,
    ).toEqual(updated);
    delete updated.organization_configuration.policy_guides;
    await client.invoke("sidecar.configure.v1", updated);
    expect(
      (await client.invoke("indexing.status.v1", {})).configuration,
    ).toEqual(updated);
  });
});
