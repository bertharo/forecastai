"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OrgStructureImport } from "@/components/OrgStructureImport";
import { usd } from "@/lib/format";

type ListedOrg = {
  id: string;
  name: string;
  slug: string;
  isPrivate?: boolean;
  createdAt?: string;
  spend30d?: number;
  memberCount?: number;
  isSample?: boolean;
};

const DEMO_TOKEN = "ws_demo_northstar";

function formatCreated(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function OnboardingPage() {
  const router = useRouter();
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
  const [showSamples, setShowSamples] = useState(false);
  const [phase, setPhase] = useState<"list" | "created" | "optional" | "done">(
    "list"
  );

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

  const displayOrgs = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const o of knownOrgs) {
      const k = o.name.trim().toLowerCase();
      nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
    }

    const sorted = [...knownOrgs].sort((a, b) => {
      const aSample = Boolean(a.isSample);
      const bSample = Boolean(b.isSample);
      if (aSample !== bSample) return aSample ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    const visible = showSamples ? sorted : sorted.filter((o) => !o.isSample);
    const sampleCount = knownOrgs.filter((o) => o.isSample).length;

    return { rows: visible, nameCounts, sampleCount };
  }, [knownOrgs, showSamples]);

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
      setPhase("created");
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
      setPhase("done");
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
      setTestResult("Sample usage is in your workspace.");
      setPhase("done");
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

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {error && (
        <div
          className="rounded-[var(--radius-sm)] border px-4 py-3 text-[13px]"
          style={{
            borderColor: "rgba(196,59,59,0.35)",
            background: "rgba(196,59,59,0.06)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {phase === "list" && (
        <div className="space-y-3">
          {knownOrgs.length > 0 && (
            <div className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Your workspaces</h2>
                {displayOrgs.sampleCount > 0 && (
                  <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--muted)" }}>
                    <input
                      type="checkbox"
                      checked={showSamples}
                      onChange={(e) => setShowSamples(e.target.checked)}
                    />
                    Show samples ({displayOrgs.sampleCount})
                  </label>
                )}
              </div>
              <ul className="space-y-2">
                {displayOrgs.rows.map((o) => {
                  const dup =
                    (displayOrgs.nameCounts.get(o.name.trim().toLowerCase()) ?? 0) >
                    1;
                  return (
                    <li
                      key={o.id}
                      className="row-card flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{o.name}</span>
                          {o.isSample && <span className="badge">Sample</span>}
                          {o.isPrivate && (
                            <span className="badge">Private</span>
                          )}
                        </div>
                        <div
                          className="mt-1 flex flex-wrap gap-x-3 text-[12px]"
                          style={{ color: "var(--muted)" }}
                        >
                          <span>Created {formatCreated(o.createdAt)}</span>
                          <span>{usd(o.spend30d ?? 0)} · 30d</span>
                          <span>
                            {o.memberCount ?? 0} member
                            {(o.memberCount ?? 0) === 1 ? "" : "s"}
                          </span>
                          {dup && (
                            <span className="mono" title={o.id}>
                              {o.slug}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn shrink-0"
                        disabled={busy || currentOrgId === o.id}
                        onClick={() => void switchTo(o.id)}
                      >
                        {currentOrgId === o.id ? "You’re here" : "Open"}
                      </button>
                    </li>
                  );
                })}
                {displayOrgs.rows.length === 0 && (
                  <li className="text-[13px]" style={{ color: "var(--muted)" }}>
                    No workspaces yet — create one below, or show samples.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Just looking around?</h2>
            <p className="muted text-[13px]">
              Open the sample company (Northstar) with demo data already filled in.
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
            <h2 className="text-sm font-semibold">Start your own</h2>
            <p className="muted text-[13px]">
              Fresh workspace for your company. Shared by default.
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
                  Only browsers with the access code can open it.
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
              Paste a code starting with <span className="mono">ws_</span> to open
              that workspace here.
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

      {phase === "created" && org && (
        <div className="space-y-3">
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">{org.name} is ready</h2>
            <p className="muted text-[13px]">
              You’re in. Spend you add later only shows up here.
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
                  Required on another browser. We only show it once.
                </p>
                <pre
                  className="mono overflow-auto p-2 text-[11px]"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                >
                  {workspaceToken}
                </pre>
                <button
                  type="button"
                  className="btn btn-ghost mt-2"
                  onClick={() => void copyToken()}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setPhase("optional")}>
                Continue
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPhase("done")}
              >
                Skip to home
              </button>
            </div>
          </div>
          <details className="panel p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Optional: upload your team list
            </summary>
            <p className="muted mt-2 mb-3 text-[13px]">
              Import departments and teams now, or skip and do it later.
            </p>
            <OrgStructureImport bare />
          </details>
        </div>
      )}

      {phase === "optional" && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">Add a tiny bit of sample spend</h2>
          {otelKey ? (
            <>
              <p className="muted text-[13px]">
                Drops one fake AI request so Home isn’t empty. Connect real billing later under
                Sources.
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPhase("done")}
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted text-[13px]">
                You’re all set. Connect bills anytime under Sources.
              </p>
              <button type="button" className="btn" onClick={() => setPhase("done")}>
                Continue
              </button>
            </>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">You’re in</h2>
          {testResult && <p className="text-[13px]">{testResult}</p>}
          <p className="muted text-[13px]">
            {org ? (
              <>
                <strong style={{ color: "var(--text)" }}>{org.name}</strong> is open. Finish setup
                from Home, or add a source now.
              </>
            ) : (
              <>Home shows your forecast. Use Workspace (top right) to switch folders.</>
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
