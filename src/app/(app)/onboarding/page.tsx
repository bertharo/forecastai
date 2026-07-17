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
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [claimToken, setClaimToken] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  async function createWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create workspace");
      setOrg(data.org);
      setOtelKey(data.otelKey);
      setWorkspaceToken(data.workspaceToken ?? null);
      setStep(2);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function claimWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: claimToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Claim failed");
      setOrg(data.org);
      setWorkspaceToken(claimToken.trim());
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
      <div className="soft-card" style={{ background: "var(--card-blue)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Workspaces
        </div>
        <p className="mt-2 text-[16px] font-medium leading-snug">
          Each workspace keeps its own spend, budgets, and connectors. No user accounts —
          this browser holds an access token so data stays private to you.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-[11px]">
        {(["Workspace", "Dimensions", "Telemetry", "Done"] as const).map((label, i) => {
          const n = (i + 1) as Step;
          const active = step === n;
          return (
            <li
              key={label}
              className="rounded-full px-2.5 py-1"
              style={{
                background: active ? "#12141a" : "var(--panel)",
                border: "1px solid var(--border)",
                color: active ? "#fff" : "var(--muted)",
              }}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>

      {error && (
        <div
          className="soft-card text-[13px]"
          style={{ background: "#ffe8e8", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Create a workspace</h2>
            <p className="muted text-[13px]">
              Starts empty with business unit, department, team, and cost center dimensions
              plus a starter allocation rule.
            </p>
            <label className="block text-[13px]">
              Workspace name
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
              onClick={() => void createWorkspace()}
            >
              {busy ? "Creating…" : "Create workspace"}
            </button>
          </div>

          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Open an existing workspace</h2>
            <p className="muted text-[13px]">
              Paste the workspace access token (shown once at create, or from seed for the
              Northstar demo).
            </p>
            <input
              className="select w-full mono text-[12px]"
              placeholder="ws_…"
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || claimToken.trim().length < 8}
              onClick={() => void claimWorkspace()}
            >
              Open workspace
            </button>
          </div>
        </div>
      )}

      {step === 2 && org && (
        <div className="space-y-3">
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Workspace ready</h2>
            <p className="muted text-[13px]">
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {org.name}
              </span>{" "}
              is active on this browser. Data you import or ingest lands only here.
            </p>
            {workspaceToken && (
              <div>
                <div className="mb-1 text-[12px] font-semibold">
                  Workspace access token (save this)
                </div>
                <pre
                  className="mono overflow-auto p-2 text-[11px]"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                >
                  {workspaceToken}
                </pre>
                <p className="muted mt-1 text-[11px]">
                  Use it on another browser via Orgs → Open existing workspace. We don&apos;t
                  show it again.
                </p>
              </div>
            )}
            <button type="button" className="btn" onClick={() => setStep(3)}>
              Continue to telemetry
            </button>
          </div>
          <OrgStructureImport />
        </div>
      )}

      {step === 3 && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">Connect telemetry (OTel)</h2>
          {otelKey ? (
            <>
              <p className="muted text-[13px]">
                Use this key once — store it in your secrets manager. Spans become usage,
                cost, and allocations <strong>only in this workspace</strong>.
              </p>
              <pre
                className="mono overflow-auto p-2 text-[11px]"
                style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
              >
                {otelKey}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void sendTestSpan()}
                >
                  {busy ? "Sending…" : "Send test span"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep(4)}>
                  Skip for now
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted text-[13px]">
                You opened an existing workspace — create a new OTel key under Data &amp;
                sources, or continue.
              </p>
              <button type="button" className="btn" onClick={() => setStep(4)}>
                Continue
              </button>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">You&apos;re in</h2>
          {testResult && <p className="text-[13px]">{testResult}</p>}
          <p className="muted text-[13px]">
            Open Brief for this workspace only. Import CSV or sync connectors — nothing
            crosses into other workspaces.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href="/">
              Go to Brief
            </a>
            <a className="btn btn-ghost" href="/connectors">
              Data &amp; sources
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
