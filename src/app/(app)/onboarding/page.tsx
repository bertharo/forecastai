"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OrgStructureImport } from "@/components/OrgStructureImport";

type Step = 1 | 2 | 3 | 4;

type ListedOrg = { id: string; name: string; slug: string; isPrivate?: boolean };

const DEMO_TOKEN = "ws_demo_northstar";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<{
    id: string;
    name: string;
    slug: string;
    isPrivate?: boolean;
  } | null>(null);
  const [otelKey, setOtelKey] = useState<string | null>(null);
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [claimToken, setClaimToken] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [knownOrgs, setKnownOrgs] = useState<ListedOrg[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshKnown = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs");
      const data = await res.json();
      const list = (data.orgs ?? []) as ListedOrg[];
      setKnownOrgs(list);
      setCurrentOrgId(data.currentOrgId ?? list[0]?.id ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshKnown();
  }, [refreshKnown]);

  async function switchTo(orgId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn’t switch workspace");
      setCurrentOrgId(orgId);
      router.refresh();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, isPrivate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn’t create workspace");
      setOrg(data.org);
      setOtelKey(data.otelKey);
      setWorkspaceToken(data.workspaceToken ?? null);
      setCurrentOrgId(data.org?.id ?? null);
      setStep(2);
      await refreshKnown();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openWithToken(token: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That code didn’t work");
      setOrg(data.org);
      setWorkspaceToken(token.trim());
      setCurrentOrgId(data.org?.id ?? null);
      setStep(4);
      await refreshKnown();
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
      if (!res.ok) throw new Error(data.error || "Test didn’t go through");
      setTestResult("Nice — sample AI usage is in your workspace now.");
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!workspaceToken) return;
    try {
      await navigator.clipboard.writeText(workspaceToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const steps = ["Start", "Optional setup", "Sample data", "Done"] as const;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="soft-card" style={{ background: "var(--card-blue)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Workspaces
        </div>
        <p className="mt-2 text-[18px] font-semibold leading-snug">
          A workspace is a folder for AI spend.
        </p>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "#3a4050" }}>
          Budgets, bills, and forecasts stay inside each workspace. Workspaces are shared
          by default so everyone can open them — mark one private only if you need a code.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-[11px]">
        {steps.map((label, i) => {
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
          {knownOrgs.length > 0 && (
            <div className="panel space-y-3 p-4">
              <h2 className="text-sm font-semibold">Workspaces</h2>
              <p className="muted text-[13px]">
                Pick one to open. You can also switch anytime with{" "}
                <strong>Workspace</strong> in the top right.
              </p>
              <ul className="space-y-2">
                {knownOrgs.map((o) => (
                  <li
                    key={o.id}
                    className="row-card flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-medium">{o.name}</div>
                      {o.isPrivate && (
                        <div className="muted text-[11px]">Private</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || currentOrgId === o.id}
                      onClick={() => void switchTo(o.id)}
                    >
                      {currentOrgId === o.id ? "You’re here" : "Open"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div
            className="panel space-y-3 p-4"
            style={{ borderColor: "rgba(47,91,216,0.25)" }}
          >
            <h2 className="text-sm font-semibold">Just looking around?</h2>
            <p className="muted text-[13px]">
              Open the sample company (Northstar) with fake data already filled in — forecasts,
              teams, and AI tool costs.
            </p>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void openWithToken(DEMO_TOKEN)}
            >
              {busy ? "Opening…" : "Open the demo"}
            </button>
          </div>

          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Start your own (empty)</h2>
            <p className="muted text-[13px]">
              Fresh workspace for your company. Shared by default — others can open it from
              the list. You’ll add spend next.
            </p>
            <label className="block text-[13px]">
              Name
              <input
                className="select mt-1 w-full"
                placeholder="e.g. Acme AI"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              <span>
                Make this workspace private
                <span className="muted mt-0.5 block text-[12px]">
                  Only browsers with the access code can see or open it.
                </span>
              </span>
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

          <details className="panel p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Have a private workspace code?
            </summary>
            <p className="muted mt-2 text-[13px]">
              Private workspaces need a code (starts with{" "}
              <span className="mono">ws_</span>). Paste it here to open that folder on this
              browser.
            </p>
            <input
              className="select mono mt-3 w-full text-[12px]"
              placeholder="Paste code…"
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost mt-2"
              disabled={busy || claimToken.trim().length < 8}
              onClick={() => void openWithToken(claimToken)}
            >
              Open with code
            </button>
          </details>
        </div>
      )}

      {step === 2 && org && (
        <div className="space-y-3">
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">{org.name} is ready</h2>
            <p className="muted text-[13px]">
              You’re in. Spend you add later only shows up here — not in other workspaces.
              {org.isPrivate
                ? " This workspace is private."
                : " Others can open it from the workspace list."}
            </p>
            {workspaceToken && org.isPrivate && (
              <div>
                <div className="mb-1 text-[12px] font-semibold">
                  Save your private access code
                </div>
                <p className="muted mb-2 text-[12px]">
                  Required to open this private workspace on another browser. We only show it
                  once.
                </p>
                <pre
                  className="mono overflow-auto p-2 text-[11px]"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                >
                  {workspaceToken}
                </pre>
                <button type="button" className="btn btn-ghost mt-2" onClick={() => void copyToken()}>
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setStep(3)}>
                Continue
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(4)}>
                Skip to home
              </button>
            </div>
          </div>
          <details className="panel p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Optional: upload your team list
            </summary>
            <p className="muted mt-2 mb-3 text-[13px]">
              Already have departments and teams in a spreadsheet? You can import them now, or
              skip and do it later.
            </p>
            <OrgStructureImport bare />
          </details>
        </div>
      )}

      {step === 3 && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">Add a tiny bit of sample spend</h2>
          {otelKey ? (
            <>
              <p className="muted text-[13px]">
                This drops one fake AI request into your workspace so Home isn’t empty. You can
                connect real billing later under <strong>Sources</strong>.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void sendTestSpan()}
                >
                  {busy ? "Adding…" : "Add sample spend"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep(4)}>
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted text-[13px]">
                You’re all set. Connect bills anytime under Sources, or go look around.
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
          <h2 className="text-sm font-semibold">You’re in</h2>
          {testResult && <p className="text-[13px]">{testResult}</p>}
          <p className="muted text-[13px]">
            {org ? (
              <>
                <strong style={{ color: "var(--text)" }}>{org.name}</strong> is open. Home shows
                your forecast; <strong>Sources</strong> is where you plug in bills;{" "}
                <strong>AI cost</strong> is for coding-tool spend by person.
              </>
            ) : (
              <>
                Home shows your forecast. Use <strong>Workspace</strong> (top right) to switch
                folders. <strong>Sources</strong> is where bills come in.
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href="/">
              Go to Home
            </a>
            <a className="btn btn-ghost" href="/connectors">
              Add a data source
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
