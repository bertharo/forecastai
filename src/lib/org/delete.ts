/**
 * Permanently delete a workspace (organization) and all org-scoped data.
 *
 * Child tables use ON DELETE NO ACTION on org_id, so the org row cannot be
 * removed until dependents are wiped. Order follows seed clearAll + sample wipe,
 * scoped to a single org.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { wipeWorkspaceForSample } from "@/lib/demo/finopsSample";

export async function deleteOrganization(orgId: string): Promise<void> {
  // FinOps spend / roster / imports / allocation rules
  await wipeWorkspaceForSample(orgId);

  // Auth foreshadow + audit (unused in product today, but org-scoped)
  await db.execute(sql`
    delete from audit_logs where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from memberships where org_id = ${orgId}::uuid
  `);

  // Value / notifications / webhooks
  await db.execute(sql`
    delete from value_events
    where org_id = ${orgId}::uuid
       or value_metric_id in (
         select id from value_metrics where org_id = ${orgId}::uuid
       )
  `);
  await db.execute(sql`
    delete from value_metrics where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from notifications where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from org_webhooks where org_id = ${orgId}::uuid
  `);

  // Budgets (children cascade from budgets, but snapshots also carry org_id)
  await db.execute(sql`
    delete from budget_status_snapshots where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from budget_alerts
    where budget_id in (select id from budgets where org_id = ${orgId}::uuid)
  `);
  await db.execute(sql`
    delete from budget_versions
    where budget_id in (select id from budgets where org_id = ${orgId}::uuid)
  `);
  await db.execute(sql`
    delete from budgets where org_id = ${orgId}::uuid
  `);

  // Scenarios + drivers
  await db.execute(sql`
    delete from scenario_results
    where scenario_id in (select id from scenarios where org_id = ${orgId}::uuid)
  `);
  await db.execute(sql`
    delete from scenario_overrides
    where scenario_id in (select id from scenarios where org_id = ${orgId}::uuid)
  `);
  await db.execute(sql`
    delete from scenarios where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from driver_values
    where driver_id in (select id from drivers where org_id = ${orgId}::uuid)
  `);
  await db.execute(sql`
    delete from drivers where org_id = ${orgId}::uuid
  `);

  // Commitments (cost_records / drawdowns already cleared by wipe)
  await db.execute(sql`
    delete from commitments where org_id = ${orgId}::uuid
  `);

  // SCM / PRs (wipe only nulls author; remove org rows entirely)
  await db.execute(sql`
    delete from pull_requests where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from scm_connections where org_id = ${orgId}::uuid
  `);

  // AI tool prefs (sessions/daily cleared by wipe)
  await db.execute(sql`
    delete from ai_tool_source_prefs where org_id = ${orgId}::uuid
  `);

  // Connectors + sync history
  await db.execute(sql`
    delete from connector_sync_runs
    where connector_id in (select id from connectors where org_id = ${orgId}::uuid)
  `);
  await db.execute(sql`
    delete from connectors where org_id = ${orgId}::uuid
  `);

  // Org-owned mapping templates (NULL org_id = system templates — keep those)
  await db.execute(sql`
    delete from mapping_templates where org_id = ${orgId}::uuid
  `);

  await db.execute(sql`
    delete from otel_ingest_keys where org_id = ${orgId}::uuid
  `);

  // Org-scoped price cards (NULL org_id = public catalog — keep those)
  await db.execute(sql`
    delete from price_card_lines
    where price_card_id in (
      select id from price_cards where org_id = ${orgId}::uuid
    )
  `);
  await db.execute(sql`
    delete from price_cards where org_id = ${orgId}::uuid
  `);

  // Dimensions (parent_id is not an FK; safe to delete all org nodes then types)
  await db.execute(sql`
    delete from dimension_nodes where org_id = ${orgId}::uuid
  `);
  await db.execute(sql`
    delete from dimension_types where org_id = ${orgId}::uuid
  `);

  await db.execute(sql`
    delete from organizations where id = ${orgId}::uuid
  `);
}
