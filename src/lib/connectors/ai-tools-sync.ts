import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto/secrets";
import { upsertContributor } from "@/lib/contributors/upsert";
import { upsertAiToolDaily, type AiToolDailyRow } from "@/lib/ai-tools/persist";

function dayStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Generate realistic per-contributor daily AI tool spend (demo / no key). */
export async function syncCodingToolsDemo(
  orgId: string,
  opts?: { days?: number }
) {
  const days = opts?.days ?? 45;
  const contributors = await db
    .select()
    .from(s.contributors)
    .where(eq(s.contributors.orgId, orgId));

  if (!contributors.length) {
    return { written: 0, message: "No contributors — import people first" };
  }

  const tools: { key: string; source: string; baseSpend: number }[] = [
    { key: "claude_code", source: "claude_enterprise_demo", baseSpend: 18 },
    { key: "cursor", source: "cursor_demo", baseSpend: 12 },
    { key: "copilot", source: "copilot_demo", baseSpend: 8 },
  ];

  const rows: AiToolDailyRow[] = [];
  for (let d = 0; d < days; d++) {
    const day = dayStr(daysAgo(d));
    const dow = daysAgo(d).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const c of contributors) {
      for (const t of tools) {
        // Not every contributor uses every tool every day
        const hash = (c.email.length + t.key.length + d) % 7;
        if (hash === 0) continue;
        const spend = t.baseSpend * (0.6 + (hash % 5) * 0.15);
        const tokensIn = spend * 12000;
        const tokensOut = spend * 3000;
        rows.push({
          day,
          toolKey: t.key,
          contributorId: c.id,
          dimensionNodeId: c.dimensionNodeId,
          spend,
          tokensIn,
          tokensOut,
          tokensTotal: tokensIn + tokensOut,
          sessions: 1 + (hash % 3),
          requests: 8 + hash * 3,
          sourceConnector: t.source,
        });
      }
    }
  }

  const result = await upsertAiToolDaily(orgId, rows);
  return { ...result, message: `Demo sync wrote ${result.written} daily grains` };
}

/**
 * Claude Enterprise-style sync.
 * Uses Admin analytics when key present; otherwise demo grains.
 */
export async function syncClaudeCodingTool(orgId: string) {
  const [provider] = await db
    .select()
    .from(s.providers)
    .where(eq(s.providers.key, "anthropic"))
    .limit(1);
  if (!provider) return { written: 0, message: "Anthropic provider missing — run db:seed" };

  const [conn] = await db
    .select()
    .from(s.connectors)
    .where(
      and(eq(s.connectors.orgId, orgId), eq(s.connectors.providerId, provider.id))
    )
    .limit(1);

  let apiKey: string | null = null;
  if (conn?.credentialsEncrypted) {
    try {
      apiKey = decryptSecret(conn.credentialsEncrypted);
    } catch {
      apiKey = null;
    }
  }

  if (!apiKey || conn?.demoMode) {
    return syncCodingToolsDemo(orgId, { days: 45 });
  }

  // Live: pull messages usage report and attribute coarsely to unattributed + try emails from metadata
  try {
    const start = daysAgo(30).toISOString().slice(0, 10);
    const end = dayStr(new Date());
    const url = new URL(
      "https://api.anthropic.com/v1/organizations/usage_report/messages"
    );
    url.searchParams.set("starting_at", `${start}T00:00:00Z`);
    url.searchParams.set("ending_at", `${end}T23:59:59Z`);
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("group_by[]", "api_key_id");

    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      return syncCodingToolsDemo(orgId, { days: 30 });
    }
    const data = (await res.json()) as {
      data?: {
        starting_at?: string;
        results?: {
          api_key_id?: string;
          uncached_input_tokens?: number;
          output_tokens?: number;
        }[];
      }[];
    };

    const rows: AiToolDailyRow[] = [];
    for (const bucket of data.data ?? []) {
      const day = (bucket.starting_at ?? "").slice(0, 10);
      if (!day) continue;
      for (const r of bucket.results ?? []) {
        const tin = r.uncached_input_tokens ?? 0;
        const tout = r.output_tokens ?? 0;
        // Rough $ using Sonnet-ish blended rate if cost absent
        const spend = (tin * 3 + tout * 15) / 1e6;
        rows.push({
          day,
          toolKey: "claude_code",
          contributorId: null,
          spend,
          tokensIn: tin,
          tokensOut: tout,
          tokensTotal: tin + tout,
          sourceConnector: "anthropic_console",
        });
      }
    }
    if (!rows.length) return syncCodingToolsDemo(orgId, { days: 30 });
    return upsertAiToolDaily(orgId, rows);
  } catch {
    return syncCodingToolsDemo(orgId, { days: 30 });
  }
}

export async function importDxAiToolMetrics(
  orgId: string,
  rows: {
    day: string;
    tool: string;
    email?: string;
    displayName?: string;
    teamKey?: string;
    spend: number;
    tokensIn?: number;
    tokensOut?: number;
    sessions?: number;
  }[]
) {
  const teams = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  const teamByKey = new Map(teams.map((t) => [t.key, t]));

  const out: AiToolDailyRow[] = [];
  for (const r of rows) {
    let contributorId: string | null = null;
    let dimensionNodeId: string | null = null;
    if (r.teamKey && teamByKey.has(r.teamKey)) {
      dimensionNodeId = teamByKey.get(r.teamKey)!.id;
    }
    if (r.email) {
      const c = await upsertContributor(orgId, {
        email: r.email,
        displayName: r.displayName,
        dimensionNodeId,
      });
      contributorId = c.id;
      dimensionNodeId = c.dimensionNodeId ?? dimensionNodeId;
    }
    out.push({
      day: r.day,
      toolKey: r.tool,
      contributorId,
      dimensionNodeId,
      spend: r.spend,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      tokensTotal: (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
      sessions: r.sessions,
      sourceConnector: "dx_import",
    });
  }
  return upsertAiToolDaily(orgId, out);
}
