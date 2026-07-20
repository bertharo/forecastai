import { describe, expect, it } from "vitest";
import { resolveCodingToolKey, resolveProviderKey } from "./telemetry";

describe("resolveCodingToolKey", () => {
  it("maps coding tools to AI Cost keys", () => {
    expect(resolveCodingToolKey("Claude")).toBe("claude_code");
    expect(resolveCodingToolKey("claude_code")).toBe("claude_code");
    expect(resolveCodingToolKey("Anthropic")).toBe("claude_code");
    expect(resolveCodingToolKey("Cursor")).toBe("cursor");
    expect(resolveCodingToolKey("GitHub Copilot")).toBe("copilot");
    expect(resolveCodingToolKey("ChatGPT")).toBe("chatgpt");
    expect(resolveCodingToolKey("OpenAI")).toBe("chatgpt");
    expect(resolveCodingToolKey("codex")).toBe("codex");
  });

  it("returns null for non-coding vendors", () => {
    expect(resolveCodingToolKey("perplexity")).toBeNull();
    expect(resolveCodingToolKey("aws_bedrock")).toBeNull();
    expect(resolveCodingToolKey("")).toBeNull();
  });
});

describe("resolveProviderKey", () => {
  it("still maps ChatGPT to openai for meters", () => {
    expect(resolveProviderKey("ChatGPT")).toBe("openai");
    expect(resolveProviderKey("Claude")).toBe("anthropic");
  });
});
