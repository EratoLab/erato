import { describe, expect, it } from "vitest";

import { isMachineId, maskMachineIds } from "./machineId";

describe("isMachineId", () => {
  it("agrees with the backend on what is a machine id", () => {
    for (const id of [
      "aaaaaaaa-0000-4000-8000-0000000000a1",
      "AAAAAAAA-0000-4000-8000-0000000000A1",
      "{aaaaaaaa-0000-4000-8000-0000000000a1}",
      "9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
      "507f1f77bcf86cd799439011",
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
      "pi_3MtwBwLkdIwHu7ix28a3tqPa",
      "cus_NffrFeUfNV2Hib",
      "C024BE91L",
      "U012AB3CD",
      "1234567890123456789",
      "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      "/accounts(aaaaaaaa-0000-4000-8000-0000000000a1)",
      "  aaaaaaaa-0000-4000-8000-0000000000a1 ",
    ]) {
      expect(isMachineId(id), id).toBe(true);
    }
  });

  it("agrees with the backend on what people recognise", () => {
    for (const text of [
      "#4211",
      "4211",
      "INC-0012345",
      "ABC-123",
      "SKU-0000",
      "SKU12345",
      "WIDGET0001",
      "ACME-WIDGET-BLUE-0001",
      "f_1",
      "report_2024_q3_final_version_2.pdf",
      "src/module_0.py",
      "/srv/app/some_long_directory_name",
      "ana@contoso.example",
      "+49 170 1234567",
      "+4917012345678",
      "491701234567890",
      "DE44500105175407324931",
      "3e26caa46",
      "main",
      "customer-reported-needs-triage",
      "UserAccountSettingsPage",
      "ProductCategoryMappingTable",
      "https://example.test/9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
      "has a space in 9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
      "/accounts(4211)",
      "a1b2".repeat(1000),
      "",
    ]) {
      expect(isMachineId(text), text).toBe(false);
    }
  });
});

describe("maskMachineIds", () => {
  it("masks ids inside a server's message and keeps the words around them", () => {
    const id = "aaaaaaaa-0000-4000-8000-0000000000a1";
    const masked = maskMachineIds(
      `User (Id=${id}, type=8, ObjectId='${id}', unitId=${id}), lacks the createRecord permission. Record ${id}.`,
      "[ID]",
    );
    expect(masked).not.toContain(id);
    expect(masked).toBe(
      "User (Id=[ID], type=8, ObjectId='[ID]', unitId=[ID]), lacks the createRecord permission. Record [ID].",
    );
  });

  it("leaves ids people recognise alone", () => {
    expect(maskMachineIds("Issue ENG-314 not found in src/a.py.", "[ID]")).toBe(
      "Issue ENG-314 not found in src/a.py.",
    );
  });
});
