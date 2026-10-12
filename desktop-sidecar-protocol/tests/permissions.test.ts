import { expect, it } from "vitest";
import {
  validateSidecarStatusV1Result,
  validateSidecarRequestPermissionV1Params,
} from "../typescript/src/generated/validators.mjs";
it("accepts future permission keys with the four defined states", () => {
  for (const state of [
    "granted",
    "not_granted",
    "unknown",
    "not_appliccable_different_platform",
  ]) {
    expect(
      validateSidecarStatusV1Result({
        permissions: { future_permission: state },
        futureField: true,
      }),
    ).toBe(true);
  }
  for (const permissions of [
    { future_permission: "allowed" },
    { future_permission: null },
    [],
  ]) {
    expect(validateSidecarStatusV1Result({ permissions })).toBe(false);
  }
  expect(validateSidecarStatusV1Result({})).toBe(false);
  expect(
    validateSidecarRequestPermissionV1Params({
      permission: "future_permission",
    }),
  ).toBe(true);
  for (const params of [{}, { permission: "" }, { permission: 3 }])
    expect(validateSidecarRequestPermissionV1Params(params)).toBe(false);
});
