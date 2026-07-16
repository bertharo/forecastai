"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OrgStructureImport } from "@/components/OrgStructureImport";

type Step = 1 | 2 | 3 | 4;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<{ id: string; name: string; slug: string } | null>(
    null
  );
  const [otelKey, setOtelKey] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function createOrg() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create org");
      setOrg(data.org);
      setOtelKey(data.otelKey);
      setStep(2);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestSpan() {
    if (!otelKey) return;
    setBusy(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-meter-key": otelKey,
        },
        body: JSON.stringify({
          spans: [
            {
              "gen_ai.system": "anthropic",
              "gen_ai.request.model": "claude-sonnet-4",
              "gen_ai.usage.input_tokens": 800,
              "gen_ai.usage.output_tokens": 200,
              tags: {
                feature: "support_copilot",
                team: "support",
                environment: "onboarding",
              },
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ingest failed");
      setTestResult(
        `Wrote ${data.written} usage events, ${data.costed} cost records (${data.allocated} allocated).`
      );
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="page-title">Onboarding</h1>
        <p className="muted mt-1">
          Create an org, get an OTel key, send a test span, then open Spend
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-[11px]">
        {(["Org", "Dimensions", "Telemetry", "Done"] as const).map((label, i) => {
          const n = (i + 1) as Step;
          const active = step === n;
          return (
            <li
              key={label}
              className="rounded px-2 py-1"
              style={{
                background: active ? "var(--accent-dim)" : "var(--panel)",
                border: "1px solid var(--border)",
                color: active ? "var(--text)" : "var(--muted)",
              }}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>

      {error && (
        <div
          className="panel p-3 text-[12px]"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-medium">1. Create organization</h2>
          <p className="muted text-[12px]">
            Starts with business unit, team, and cost center dimensions plus a starter
            allocation rule for <span className="mono">support_copilot</span>.
          </p>
          <label className="block text-[12px]">
            Org name
            <input
              className="select mt-1 w-full"
              placeholder="Acme AI"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || name.trim().length < 2}
            onClick={() => void createOrg()}
          >
            {busy ? "Creating…" : "Create org"}
          </button>
          <p className="muted text-[11px]">
            Or stay on the seeded demo: switch to <span className="mono">Northstar Analytics</span>{" "}
            in the sidebar.
          </p>
        </div>
      )}

      {step === 2 && org && (
        <div className="space-y-3">
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-medium">2. Dimensions ready</h2>
            <p className="muted text-[12px]">
              <span className="mono">{org.name}</span> has{" "}
              <span className="mono">business_unit</span>,{" "}
              <span className="mono">department</span>, <span className="mono">team</span>, and{" "}
              <span className="mono">cost_center</span>. Optionally import a fuller hierarchy
              from CSV (Okta/Workday exports map onto the same adapter).
            </p>
            <button type="button" className="btn" onClick={() => setStep(3)}>
              Continue to telemetry
            </button>
          </div>
          <OrgStructureImport />
        </div>
      )}

      {step === 3 && otelKey && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-medium">3. Connect telemetry (OTel)</h2>
          <p className="muted text-[12px]">
            Use this key once — store it in your secrets manager. Spans become usage events,
            cost records, and dimension allocations.
          </p>
          <pre
            className="mono overflow-auto p-2 text-[11px]"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            {otelKey}
          </pre>
          <pre
            className="mono overflow-auto p-2 text-[10px]"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/otel/v1/traces \\
  -H 'content-type: application/json' \\
  -H 'x-meter-key: ${otelKey}' \\
  -d '{"spans":[{"gen_ai.system":"anthropic","gen_ai.request.model":"claude-sonnet-4","gen_ai.usage.input_tokens":800,"gen_ai.usage.output_tokens":200,"tags":{"feature":"support_copilot","team":"support"}}]}'`}</pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void sendTestSpan()}
            >
              {busy ? "Sending…" : "Send test span"}
            </button>
            <button type="button" className="btn" onClick={() => setStep(4)}>
              Skip for now
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-medium">4. You&apos;re in</h2>
          {testResult && <p className="text-[12px]">{testResult}</p>}
          <p className="muted text-[12px]">
            Open Spend and filter by team / feature / model. Tag every span with{" "}
            <span className="mono">feature</span> and <span className="mono">team</span> so
            allocation rules fire.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href="/">
              Go to Spend
            </a>
            <a className="btn" href="/connectors">
              View connectors
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
