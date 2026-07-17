import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import {
  importDxAiToolMetrics,
  syncClaudeCodingTool,
  syncCodingToolsDemo,
} from "@/lib/connectors/ai-tools-sync";
import { findOverlappingAiSources } from "@/lib/ai-tools/persist";
import { parseCsv } from "@/lib/import/parse";

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const body = (await req.json()) as {
    action: "demo" | "claude" | "dx_csv";
    csv?: string;
  };

  try {
    if (body.action === "demo") {
      const result = await syncCodingToolsDemo(org.id);
      const overlaps = await findOverlappingAiSources(org.id);
      return NextResponse.json({ ok: true, ...result, overlaps });
    }
    if (body.action === "claude") {
      const result = await syncClaudeCodingTool(org.id);
      const overlaps = await findOverlappingAiSources(org.id);
      return NextResponse.json({ ok: true, ...result, overlaps });
    }
    if (body.action === "dx_csv" && body.csv) {
      const { rows } = parseCsv(body.csv);
      const mapped = rows.map((r) => ({
        day: (r.day || r.date || "").slice(0, 10),
        tool: r.tool || r.tool_key || "claude_code",
        email: r.email || r.contributor_email,
        displayName: r.display_name || r.name,
        teamKey: r.team_key || r.team,
        spend: Number(r.spend || r.cost || 0),
        tokensIn: Number(r.tokens_in || r.input_tokens || 0),
        tokensOut: Number(r.tokens_out || r.output_tokens || 0),
        sessions: Number(r.sessions || 0),
      }));
      const result = await importDxAiToolMetrics(
        org.id,
        mapped.filter((r) => r.day && r.spend >= 0)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
