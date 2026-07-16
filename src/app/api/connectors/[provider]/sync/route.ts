import { NextResponse } from "next/server";
import { getDemoOrg } from "@/lib/queries/org";
import { runConnectorSync } from "@/lib/connectors";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ provider: string }> }
) {
  const { provider } = await ctx.params;
  const org = await getDemoOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 500 });
  }

  if (!["anthropic", "openai", "cursor"].includes(provider)) {
    return NextResponse.json(
      { error: "Only anthropic, openai, cursor sync are implemented end-to-end" },
      { status: 400 }
    );
  }

  try {
    const { result, run } = await runConnectorSync(provider, org.id, "incremental");
    return NextResponse.json({
      ok: true,
      runId: run?.id,
      result: {
        phase: result.phase,
        rowsIn: result.rowsIn,
        rowsWritten: result.rowsWritten,
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
