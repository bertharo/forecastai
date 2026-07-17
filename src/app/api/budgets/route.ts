import { NextResponse } from "next/server";
import { assertBudgetInOrg, getCurrentOrg } from "@/lib/queries/org";
import {
  createBudgetVersion,
  hierarchyWarnings,
  reallocateBudgets,
  refreshBudgetSnapshots,
} from "@/lib/budgets/status";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const statuses = await refreshBudgetSnapshots(org.id);
  const warnings = await hierarchyWarnings(org.id);
  const versions = await db
    .select()
    .from(s.budgetVersions)
    .innerJoin(s.budgets, eq(s.budgetVersions.budgetId, s.budgets.id))
    .where(eq(s.budgets.orgId, org.id))
    .orderBy(asc(s.budgetVersions.budgetId), asc(s.budgetVersions.version));

  return NextResponse.json({
    statuses,
    warnings,
    versions: versions.map((v) => v.budget_versions),
  });
}

export async function POST(req: Request) {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const body = (await req.json()) as {
    action: "version" | "reallocate" | "refresh";
    budgetId?: string;
    fromBudgetId?: string;
    toBudgetId?: string;
    amount?: number;
    changeNote?: string;
  };

  try {
    if (body.action === "refresh") {
      const statuses = await refreshBudgetSnapshots(org.id);
      return NextResponse.json({ statuses });
    }
    if (body.action === "version") {
      if (!body.budgetId || body.amount == null || !body.changeNote) {
        return NextResponse.json(
          { error: "budgetId, amount, changeNote required" },
          { status: 400 }
        );
      }
      if (!(await assertBudgetInOrg(body.budgetId, org.id))) {
        return NextResponse.json({ error: "Budget not in this workspace" }, { status: 403 });
      }
      const ver = await createBudgetVersion(body.budgetId, {
        amount: body.amount,
        changeNote: body.changeNote,
      });
      await refreshBudgetSnapshots(org.id);
      return NextResponse.json({ version: ver });
    }
    if (body.action === "reallocate") {
      if (!body.fromBudgetId || !body.toBudgetId || body.amount == null) {
        return NextResponse.json(
          { error: "fromBudgetId, toBudgetId, amount required" },
          { status: 400 }
        );
      }
      if (
        !(await assertBudgetInOrg(body.fromBudgetId, org.id)) ||
        !(await assertBudgetInOrg(body.toBudgetId, org.id))
      ) {
        return NextResponse.json({ error: "Budget not in this workspace" }, { status: 403 });
      }
      const result = await reallocateBudgets({
        fromBudgetId: body.fromBudgetId,
        toBudgetId: body.toBudgetId,
        amount: body.amount,
        changeNote: body.changeNote || `Reallocate $${body.amount}`,
      });
      await refreshBudgetSnapshots(org.id);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
