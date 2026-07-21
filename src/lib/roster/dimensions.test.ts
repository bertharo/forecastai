import { describe, expect, it } from "vitest";
import {
  autoEnableLegacyVisibleColumns,
  classifyAttribute,
  enabledDimensionsInOrder,
  isGroupingEligible,
  mergeProfilesIntoConfig,
  profileAttributeColumns,
  attributesFromLegacyFields,
  attributesFromRow,
} from "./dimensions";

describe("classifyAttribute", () => {
  it("marks unique-per-row as identifier", () => {
    expect(classifyAttribute(10, 10)).toBe("identifier");
    expect(isGroupingEligible("identifier")).toBe(false);
  });

  it("marks single-value as constant", () => {
    expect(classifyAttribute(1, 10)).toBe("constant");
    expect(isGroupingEligible("constant")).toBe(false);
  });

  it("marks mid-cardinality as dimension", () => {
    expect(classifyAttribute(3, 10)).toBe("dimension");
    expect(isGroupingEligible("dimension")).toBe(true);
  });
});

describe("profileAttributeColumns", () => {
  it("profiles arbitrary columns without assumed names", () => {
    const rows = [
      { email: "a@x.com", bu: "Eng", squad: "AI", employee_id: "1" },
      { email: "b@x.com", bu: "Eng", squad: "Infra", employee_id: "2" },
      { email: "c@x.com", bu: "GTM", squad: "West", employee_id: "3" },
    ];
    const profiles = profileAttributeColumns(rows, {
      bu: "Business Unit",
      squad: "Squad",
      employee_id: "Employee ID",
      email: "Email",
    });
    // email is identity — excluded
    expect(profiles.map((p) => p.key).sort()).toEqual([
      "bu",
      "employee_id",
      "squad",
    ]);
    const bu = profiles.find((p) => p.key === "bu")!;
    expect(bu.suggestion).toBe("dimension");
    expect(bu.distinctCount).toBe(2);
    expect(bu.sampleValues).toHaveLength(2);
    expect(bu.sourceColumn).toBe("Business Unit");

    const id = profiles.find((p) => p.key === "employee_id")!;
    expect(id.suggestion).toBe("identifier");
  });
});

describe("attributesFromLegacyFields", () => {
  it("migrates chain + dept + cc into attributes", () => {
    const attrs = attributesFromLegacyFields({
      department: "Engineering",
      costCenter: "CC-ENG-AI-01",
      costCenterChain: { "02": "Acme", "04": "Engineering", "07": "CC-ENG-AI-01" },
    });
    expect(attrs.department).toBe("Engineering");
    expect(attrs.cost_center).toBe("CC-ENG-AI-01");
    expect(attrs.cost_center_chain_level_02).toBe("Acme");
    expect(attrs.cost_center_chain_level_04).toBe("Engineering");
    expect(attrs.cost_center_chain_level_07).toBe("CC-ENG-AI-01");
  });
});

describe("autoEnableLegacyVisibleColumns", () => {
  it("enables department + cost_center with primary = fewest distinct > 1", () => {
    const base = mergeProfilesIntoConfig(
      null,
      [
        {
          key: "department",
          sourceColumn: "department",
          distinctCount: 4,
          sampleValues: ["Eng"],
          suggestion: "dimension",
        },
        {
          key: "cost_center",
          sourceColumn: "cost_center",
          distinctCount: 12,
          sampleValues: ["CC-1"],
          suggestion: "dimension",
        },
        {
          key: "cost_center_chain_level_02",
          sourceColumn: "Cost Center Chain - Level 02",
          distinctCount: 1,
          sampleValues: ["Acme"],
          suggestion: "constant",
        },
      ],
      100
    );
    const migrated = autoEnableLegacyVisibleColumns(base);
    const enabled = migrated.columns.filter((c) => c.enabled);
    expect(enabled.map((c) => c.key).sort()).toEqual([
      "cost_center",
      "department",
    ]);
    expect(enabled.find((c) => c.role === "primary")?.key).toBe("department");
    expect(enabled.find((c) => c.role === "secondary")?.key).toBe("cost_center");
  });
});

describe("attributesFromRow", () => {
  it("stores only requested keys", () => {
    expect(
      attributesFromRow(
        { department: "Eng", email: "a@x.com", cost_center: "CC-1" },
        ["department", "cost_center"]
      )
    ).toEqual({ department: "Eng", cost_center: "CC-1" });
  });
});

describe("mergeProfilesIntoConfig", () => {
  it("preserves display names and strips identifier enablement", () => {
    const first = mergeProfilesIntoConfig(
      null,
      [
        {
          key: "bu",
          sourceColumn: "BU",
          distinctCount: 3,
          sampleValues: ["a"],
          suggestion: "dimension",
        },
      ],
      10
    );
    first.columns[0].enabled = true;
    first.columns[0].displayName = "Business unit";
    first.columns[0].role = "primary";

    const second = mergeProfilesIntoConfig(
      first,
      [
        {
          key: "bu",
          sourceColumn: "BU",
          distinctCount: 10,
          sampleValues: ["a"],
          suggestion: "identifier",
        },
      ],
      10
    );
    expect(second.columns[0].displayName).toBe("Business unit");
    expect(second.columns[0].enabled).toBe(false);
    expect(second.columns[0].role).toBeNull();
  });
});

describe("enabledDimensionsInOrder", () => {
  it("orders primary then secondary then remaining enabled", () => {
    const config = {
      rowCount: 10,
      profiledAt: null as string | null,
      columns: [
        {
          key: "a",
          sourceColumn: "A",
          displayName: "A",
          enabled: true,
          role: null as "primary" | "secondary" | null,
          suggestion: "dimension" as "identifier" | "constant" | "dimension",
          distinctCount: 5,
          sampleValues: [] as string[],
        },
        {
          key: "b",
          sourceColumn: "B",
          displayName: "B",
          enabled: true,
          role: "secondary" as "primary" | "secondary" | null,
          suggestion: "dimension" as "identifier" | "constant" | "dimension",
          distinctCount: 8,
          sampleValues: [] as string[],
        },
        {
          key: "c",
          sourceColumn: "C",
          displayName: "C",
          enabled: true,
          role: "primary" as "primary" | "secondary" | null,
          suggestion: "dimension" as "identifier" | "constant" | "dimension",
          distinctCount: 3,
          sampleValues: [] as string[],
        },
      ],
    };
    expect(enabledDimensionsInOrder(config).map((c) => c.key)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});
