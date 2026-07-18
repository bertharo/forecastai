"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usd } from "@/lib/format";

type TeamOpt = { id: string; label: string };

export function BudgetActions({
  budgets,
  teams,
}: {
  budgets: { id: string; name: string; amount: number }[];
  teams: TeamOpt[];
}) {
  const router = useRouter();
  const [fromId, setFromId] = useState(budgets[1]?.id ?? budgets[0]?.id ?? "");
  const [toId, setToId] = useState(budgets[2]?.id ?? budgets[0]?.id ?? "");
  const [amount, setAmount] = useState("1000");
  const [note, setNote] = useState("Moved mid-month");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState("Company monthly AI spend");
  const [newAmount, setNewAmount] = useState("10000");
  const [newTeam, setNewTeam] = useState("");

  async function createBudget() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: newName,
          amount: Number(newAmount),
          dimensionNodeId: newTeam || null,
          changeNote: "Set from Plan",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create budget");
      setMsg(`Budget set: ${newName} at ${usd(Number(newAmount))}/mo`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reallocate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reallocate",
          fromBudgetId: fromId,
          toBudgetId: toId,
          amount: Number(amount),
          changeNote: note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`Moved ${usd(Number(amount))} between budgets`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await fetch("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="soft-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold">Set a monthly limit</div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
              Whole company, or one team. We’ll warn you before you blow past it.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost text-[13px]"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-[12px]">
          <label>
            Name
            <input
              className="input mt-1 block w-56"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label>
            Monthly $
            <input
              className="input mt-1 block w-28 mono"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
          </label>
          <label>
            Applies to
            <select
              className="select mt-1 block"
              value={newTeam}
              onChange={(e) => {
                setNewTeam(e.target.value);
                if (e.target.value) {
                  const t = teams.find((x) => x.id === e.target.value);
                  if (t) setNewName(`${t.label} monthly`);
                } else {
                  setNewName("Company monthly AI spend");
                }
              }}
            >
              <option value="">Whole company</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || !newName.trim() || !Number(newAmount)}
            onClick={() => void createBudget()}
          >
            Save limit
          </button>
        </div>
      </div>

      {budgets.length >= 2 && (
        <div className="soft-card space-y-3">
          <div>
            <div className="text-[13px] font-semibold">Move money between limits</div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
              Shift budget from one bucket to another mid-month.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2 text-[12px]">
            <label>
              From
              <select
                className="select mt-1 block"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                {budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({usd(b.amount)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              To
              <select
                className="select mt-1 block"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                {budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({usd(b.amount)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input
                className="input mt-1 block w-28"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Why
              <input
                className="input mt-1 block w-48"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || !fromId || !toId || fromId === toId}
              onClick={() => void reallocate()}
            >
              Move
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
