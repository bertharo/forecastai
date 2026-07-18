import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { runConnectorSync } from "@/lib/connectors";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> }
) {
  const { provider } = await ctx.params;
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 500 });
  }

  if (!["anthropic", "openai", "cursor"].includes(provider)) {
    return NextResponse.json(
      { error: "Only anthropic, openai, cursor sync are implemented end-to-end" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    phase?: "backfill" | "incremental";
    backfillDays?: number;
  };

  try {
    const { result, run, persisted } = await runConnectorSync(
      provider,
      org.id,
      body.phase ?? "incremental",
      { backfillDays: body.backfillDays }
    );
    return NextResponse.json({
      ok: true,
      runId: run?.id,
      persisted,
      result: {
        phase: result.phase,
        rowsIn: result.rowsIn,
        rowsWritten: result.rowsWritten,
        upserted: persisted.upserted,
        errors: result.errors,
        sample: result.events.slice(0, 3),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
