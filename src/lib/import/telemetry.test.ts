import { describe, expect, it } from "vitest";
import {
  parseImportTimestamp,
  resolveCodingToolKey,
  resolveProviderKey,
} from "./telemetry";

describe("resolveCodingToolKey", () => {
  it("maps coding tools to AI Cost keys", () => {
    expect(resolveCodingToolKey("Claude")).toBe("claude_code");
    expect(resolveCodingToolKey("claude_code")).toBe("claude_code");
    expect(resolveCodingToolKey("Anthropic")).toBe("claude_code");
    expect(resolveCodingToolKey("Cursor")).toBe("cursor");
    expect(resolveCodingToolKey("GitHub Copilot")).toBe("copilot");
    expect(resolveCodingToolKey("ChatGPT")).toBe("chatgpt");
    expect(resolveCodingToolKey("ChatGPT Enterprise")).toBe("chatgpt");
    expect(resolveCodingToolKey("OpenAI")).toBe("chatgpt");
    expect(resolveCodingToolKey("codex")).toBe("codex");
  });

  it("returns null for non-coding vendors (FinOps only)", () => {
    expect(resolveCodingToolKey("Gemini")).toBeNull();
    expect(resolveCodingToolKey("google")).toBeNull();
    expect(resolveCodingToolKey("Perplexity")).toBeNull();
    expect(resolveCodingToolKey("perplexity")).toBeNull();
    expect(resolveCodingToolKey("aws_bedrock")).toBeNull();
    expect(resolveCodingToolKey("")).toBeNull();
  });
});

describe("resolveProviderKey", () => {
  it("maps sheet ai_tool labels onto catalog providers", () => {
    expect(resolveProviderKey("ChatGPT")).toBe("openai");
    expect(resolveProviderKey("ChatGPT Enterprise")).toBe("openai");
    expect(resolveProviderKey("GitHub Copilot")).toBe("openai");
    expect(resolveProviderKey("Claude")).toBe("anthropic");
    expect(resolveProviderKey("Cursor")).toBe("cursor");
    expect(resolveProviderKey("Gemini")).toBe("google");
    expect(resolveProviderKey("Perplexity")).toBe("perplexity");
  });
});

describe("parseImportTimestamp month grain", () => {
  it("treats YYYY-MM-01 as month grain (Excel first-of-month)", () => {
    const parsed = parseImportTimestamp("2026-06-01");
    expect(parsed?.monthGrain).toBe(true);
    expect(parsed?.start.getUTCFullYear()).toBe(2026);
    expect(parsed?.start.getUTCMonth()).toBe(5);
  });

  it("places completed months on last day of month", () => {
    const parsed = parseImportTimestamp("2026-01-01");
    expect(parsed?.monthGrain).toBe(true);
    // Jan 2026 is completed relative to "today" in this workspace (Jul 2026)
    expect(parsed?.start.getUTCDate()).toBe(31);
  });
});
