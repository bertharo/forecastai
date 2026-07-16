"use client";

import { useState } from "react";

export function GatewaySnippets({ ingestUrl }: { ingestUrl: string }) {
  const [key, setKey] = useState("meter_demo_otel_key");

  const litellm = `# LiteLLM — custom callback / success_callback forwarding GenAI usage
# pip install litellm
# Set Meter as an OTLP-compatible HTTP sink (simplified):
export METER_OTLP_ENDPOINT="${ingestUrl}"
export METER_API_KEY="${key}"
# In config.yaml success_callback, POST gen_ai attrs to Meter with header x-meter-key`;

  const portkey = `# Portkey gateway — Analytics / Logs webhook
# Dashboard → Configs → Analytics → Custom webhook
URL: ${ingestUrl}
Header: x-meter-key: ${key}
# Map OpenTelemetry GenAI attributes (model, input/output tokens, metadata.feature)`;

  const helicone = `# Helicone — Custom Property + Webhook
# https://docs.helicone.ai
# 1. Tag requests: Helicone-Property-Feature: support_copilot
# 2. Webhook → ${ingestUrl}
#    Header x-meter-key: ${key}
# Transform Helicone log payload into Meter spans[] shape in a thin proxy if needed`;

  const curl = `curl -X POST ${ingestUrl} \\
  -H 'content-type: application/json' \\
  -H 'x-meter-key: ${key}' \\
  -d '{"spans":[{"gen_ai.system":"anthropic","gen_ai.request.model":"claude-sonnet-4","gen_ai.usage.input_tokens":100,"gen_ai.usage.output_tokens":40,"tags":{"feature":"support_copilot","team":"support"}}]}'`;

  const blocks = [
    { title: "LiteLLM", body: litellm },
    { title: "Portkey", body: portkey },
    { title: "Helicone", body: helicone },
    { title: "curl", body: curl },
  ];

  return (
    <div className="panel space-y-3 p-4">
      <h2 className="text-sm font-medium">Connect your gateway (config, not code)</h2>
      <p className="muted text-[12px]">
        Forward GenAI spans to Meter. Paste your org ingest key (Onboarding or Keys below).
      </p>
      <label className="block text-[12px]">
        Ingest key (for snippet preview)
        <input
          className="select mt-1 w-full mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <div className="grid gap-3 lg:grid-cols-2">
        {blocks.map((b) => (
          <div key={b.title}>
            <div className="mb-1 text-[11px] font-medium">{b.title}</div>
            <pre
              className="mono overflow-auto p-2 text-[10px]"
              style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
            >
              {b.body}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
