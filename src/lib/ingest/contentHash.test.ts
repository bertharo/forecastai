import { describe, expect, it } from "vitest";
import { usageEventContentHash } from "./contentHash";
import type { NormalizedUsageEvent } from "@/lib/connectors/types";

function ev(partial: Partial<NormalizedUsageEvent>): NormalizedUsageEvent {
  return {
    eventTime: new Date("2026-07-01T12:00:00Z"),
    providerKey: "anthropic",
    skuId: "claude-sonnet-4",
    meterKey: "input_tokens",
    consumedQuantity: 100,
    consumedUnit: "Tokens",
    tags: { source: "anthropic_admin", api_key: "key_a", workspace: "ws1" },
    serviceName: "Claude API",
    ...partial,
  };
}

describe("usageEventContentHash", () => {
  it("is stable for the same Admin grain", () => {
    const a = usageEventContentHash("org-1", ev({}));
    const b = usageEventContentHash("org-1", ev({ consumedQuantity: 999 }));
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("changes when key or day changes", () => {
    const a = usageEventContentHash("org-1", ev({}));
    const b = usageEventContentHash(
      "org-1",
      ev({ tags: { source: "anthropic_admin", api_key: "key_b", workspace: "ws1" } })
    );
    const c = usageEventContentHash(
      "org-1",
      ev({ eventTime: new Date("2026-07-02T12:00:00Z") })
    );
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("skips unhashed OTel without requestId", () => {
    expect(
      usageEventContentHash(
        "org-1",
        ev({ tags: { source: "otel", team: "support" }, requestId: undefined })
      )
    ).toBeNull();
  });
});
