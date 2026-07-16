"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BudgetActions({
  budgets,
}: {
  budgets: { id: string; name: string; amount: number }[];
}) {
  const router = useRouter();
  const [fromId, setFromId] = useState(budgets[1]?.id ?? budgets[0]?.id ?? "");
  const [toId, setToId] = useState(budgets[2]?.id ?? budgets[0]?.id ?? "");
  const [amount, setAmount] = useState("1000");
  const [note, setNote] = useState("Mid-month reallocation");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      setMsg(`Reallocated $${amount} (group ${data.reallocationGroupId?.slice(0, 8)})`);
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
    <div className="panel space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Reallocate</h2>
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          Refresh status
        </button>
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
                {b.name} (${b.amount.toLocaleString()})
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
                {b.name} (${b.amount.toLocaleString()})
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input
            className="select mt-1 block w-28"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Note
          <input
            className="select mt-1 block w-48"
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
          Move funds
        </button>
      </div>
      {msg && <p className="muted text-[12px]">{msg}</p>}
    </div>
  );
}
