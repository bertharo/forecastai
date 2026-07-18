/**
 * Deterministic FinOps sample pack for empty workspaces.
 * Same seed → same ~2000-person roster, 6 terminated+seat (~$1.2k/mo),
 * ~10% seats inactive 30+ days, exactly 2 unmapped API keys with meaningful spend.
 *
 * Inserts cost_records in bulk (not per-event persist) so load stays under ~10s.
 */
import { createHash } from "crypto";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

const SAMPLE_SEED = 20260717;
const ROSTER_SIZE = 2000;
const TERMINATED_WITH_SEATS = 6;
const SEAT_PRICE = 200; // 6 × 200 = $1,200 / mo
const TOTAL_SEATS = 180;
const INACTIVE_SEATS = 18; // exactly 10% of 180
const SAMPLE_KEYS = ["key_eng_mapped", "key_shadow_batch", "key_orphan_eval"] as const;

const DEPTS = [
  { dept: "Engineering", cc: "CC-100", team: "ai-platform" },
  { dept: "Product", cc: "CC-220", team: "docs" },
  { dept: "Support", cc: "CC-220", team: "support" },
  { dept: "GTM", cc: "CC-310", team: "sales-eng" },
] as const;

const FIRST = [
  "Alex", "Jordan", "Morgan", "Sam", "Riley", "Casey", "Taylor", "Quinn",
  "Avery", "Jamie", "Drew", "Cameron", "Blake", "Reese", "Skyler", "Parker",
];
const LAST = [
  "Chen", "Lee", "Patel", "Rivera", "Kim", "Brooks", "Ng", "Ortiz",
  "Shah", "Nguyen", "Garcia", "Wright", "Adams", "Lopez", "Singh", "Brown",
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayStr(offset: number) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function hash(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

async function ensureSampleDimensions(orgId: string) {
  let [dtTeam] = await db
    .select()
    .from(s.dimensionTypes)
    .where(and(eq(s.dimensionTypes.orgId, orgId), eq(s.dimensionTypes.key, "team")))
    .limit(1);
  if (!dtTeam) {
    [dtTeam] = await db
      .insert(s.dimensionTypes)
      .values({
        orgId,
        key: "team",
        displayName: "Team",
        isHierarchical: true,
        sortOrder: 3,
      })
      .returning();
  }

  const teamKeys = ["ai-platform", "docs", "support", "sales-eng"] as const;
  const nodes = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  for (const key of teamKeys) {
    if (byKey.has(key)) continue;
    const [n] = await db
      .insert(s.dimensionNodes)
      .values({
        orgId,
        dimensionTypeId: dtTeam.id,
        key,
        displayName: key
          .split("-")
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(" "),
        path: `/${key}`,
      })
      .returning();
    byKey.set(key, n);
  }
  return { byKey, dtTeam };
}

async function wipeSampleData(orgId: string) {
  // Costs may reference seed usage_events even if tags differ — clear both paths
  await db.execute(sql`
    delete from cost_record_dimensions
    where cost_record_id in (
      select cr.id from cost_records cr
      left join usage_events ue on ue.id = cr.usage_event_id
      where cr.org_id = ${orgId}::uuid
        and (
          cr.tags->>'source' = 'seed'
          or ue.tags->>'source' = 'seed'
        )
    )
  `);
  await db.execute(sql`
    delete from cost_records
    where id in (
      select cr.id from cost_records cr
      left join usage_events ue on ue.id = cr.usage_event_id
      where cr.org_id = ${orgId}::uuid
        and (
          cr.tags->>'source' = 'seed'
          or ue.tags->>'source' = 'seed'
        )
    )
  `);
  await db.execute(sql`
    delete from usage_event_dimensions
    where usage_event_id in (
      select id from usage_events
      where org_id = ${orgId}::uuid and tags->>'source' = 'seed'
    )
  `);
  await db.execute(sql`
    delete from usage_events
    where org_id = ${orgId}::uuid and tags->>'source' = 'seed'
  `);
  await db.execute(sql`
    delete from provider_key_registry
    where org_id = ${orgId}::uuid
      and external_id in (${sql.join(
        SAMPLE_KEYS.map((k) => sql`${k}`),
        sql`, `
      )})
  `);
  await db.execute(sql`
    delete from seat_snapshots
    where org_id = ${orgId}::uuid
      and coalesce(metadata->>'source', '') = 'seed'
  `);
  await db.execute(sql`
    delete from contributors
    where org_id = ${orgId}::uuid
      and (
        email like '%@sample.meter.demo'
        or coalesce(external_ids->>'sample', '') = '1'
      )
  `);
  await db.execute(sql`
    delete from allocation_rules
    where org_id = ${orgId}::uuid
      and name = ${`Key registry · api_key ${SAMPLE_KEYS[0]}`}
  `);
}

/**
 * Wipe prior sample-tagged spend for this org, then reload deterministic pack.
 */
export async function loadFinopsSamplePack(orgId: string) {
  const rand = mulberry32(SAMPLE_SEED);
  const { byKey: teamByKey, dtTeam } = await ensureSampleDimensions(orgId);
  await wipeSampleData(orgId);

  const people: {
    email: string;
    name: string;
    dept: string;
    cc: string;
    team: string;
    status: string;
    startedOn: string;
    endedOn: string | null;
    hasSeat: boolean;
    seatInactive: boolean;
  }[] = [];

  for (let i = 0; i < ROSTER_SIZE; i++) {
    const dept = DEPTS[i % DEPTS.length];
    const fn = FIRST[i % FIRST.length];
    const ln = LAST[Math.floor(i / FIRST.length) % LAST.length];
    people.push({
      email: `user${String(i).padStart(4, "0")}@sample.meter.demo`,
      name: `${fn} ${ln}`,
      dept: dept.dept,
      cc: dept.cc,
      team: dept.team,
      status: "active",
      startedOn: dayStr(-400 - (i % 800)),
      endedOn: null,
      hasSeat: i < TOTAL_SEATS,
      seatInactive: false,
    });
  }

  for (let i = 0; i < TERMINATED_WITH_SEATS; i++) {
    people[i].status = "terminated";
    people[i].endedOn = dayStr(-45 - i);
    people[i].hasSeat = true;
    people[i].seatInactive = false;
  }

  for (let i = 0; i < INACTIVE_SEATS; i++) {
    const idx = 50 + i;
    if (idx < TOTAL_SEATS) {
      people[idx].seatInactive = true;
      people[idx].hasSeat = true;
    }
  }

  const CHUNK = 250;
  for (let i = 0; i < people.length; i += CHUNK) {
    const slice = people.slice(i, i + CHUNK);
    await db.insert(s.contributors).values(
      slice.map((p) => ({
        orgId,
        email: p.email,
        displayName: p.name,
        department: p.dept,
        costCenter: p.cc,
        employmentStatus: p.status,
        startedOn: p.startedOn,
        endedOn: p.endedOn,
        dimensionNodeId: teamByKey.get(p.team)?.id ?? null,
        externalIds: { sample: "1" },
        active: p.status === "active" || p.status === "contractor" || p.status === "leave",
      }))
    );
  }

  const seatHolders = people.filter((p) => p.hasSeat);
  const activeSeatEmails = seatHolders
    .filter((p) => !p.seatInactive && p.status !== "terminated")
    .map((p) => p.email);
  const inactiveSeatEmails = seatHolders
    .filter((p) => p.seatInactive)
    .map((p) => p.email);
  const terminatedSeatEmails = people
    .filter((p) => p.status === "terminated" && p.hasSeat)
    .map((p) => p.email);

  const providers = await db.select().from(s.providers);
  const meters = await db.select().from(s.meters);
  const skus = await db.select().from(s.skus);
  const anth = providers.find((p) => p.key === "anthropic");
  const cursor = providers.find((p) => p.key === "cursor");
  if (!anth || !cursor) throw new Error("Providers missing — run db:seed");

  const anthIn = meters.find(
    (m) => m.providerId === anth.id && m.meterKey === "input_tokens"
  );
  const anthOut = meters.find(
    (m) => m.providerId === anth.id && m.meterKey === "output_tokens"
  );
  const cursorSeat = meters.find(
    (m) => m.providerId === cursor.id && m.meterKey === "seats"
  );
  const sonnet = skus.find(
    (sk) => sk.providerId === anth.id && sk.skuId === "claude-sonnet-4"
  );
  const cursorSku = skus.find(
    (sk) => sk.providerId === cursor.id && sk.skuId === "cursor-teams-seat"
  );
  if (!anthIn || !anthOut || !cursorSeat || !sonnet || !cursorSku) {
    throw new Error("Meters/SKUs missing — run db:seed");
  }

  await db.insert(s.seatSnapshots).values({
    orgId,
    providerId: cursor.id,
    asOf: dayStr(0),
    seatsPurchased: TOTAL_SEATS,
    seatsActive: TOTAL_SEATS - INACTIVE_SEATS,
    seatsHeavy: Math.round((TOTAL_SEATS - INACTIVE_SEATS) * 0.35),
    metadata: {
      inactive: INACTIVE_SEATS,
      inactiveDays: 30,
      seatPrice: SEAT_PRICE,
      terminatedWithActiveSeat: terminatedSeatEmails,
      inactiveEmails: inactiveSeatEmails,
      source: "seed",
    },
  });

  const mappedKey = SAMPLE_KEYS[0];
  const unmappedA = SAMPLE_KEYS[1];
  const unmappedB = SAMPLE_KEYS[2];
  const engTeam = teamByKey.get("ai-platform")!;
  const now = new Date();

  // Key registry: 1 mapped + 2 unmapped
  await db.insert(s.providerKeyRegistry).values([
    {
      orgId,
      providerId: anth.id,
      kind: "api_key",
      externalId: mappedKey,
      displayName: "Engineering (mapped)",
      dimensionNodeId: engTeam.id,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    {
      orgId,
      providerId: anth.id,
      kind: "api_key",
      externalId: unmappedA,
      displayName: "Shadow batch",
      firstSeenAt: now,
      lastSeenAt: now,
    },
    {
      orgId,
      providerId: anth.id,
      kind: "api_key",
      externalId: unmappedB,
      displayName: "Orphan eval",
      firstSeenAt: now,
      lastSeenAt: now,
    },
  ]);

  await db.insert(s.allocationRules).values({
    orgId,
    name: `Key registry · api_key ${mappedKey}`,
    priority: 10,
    match: { api_key: mappedKey },
    set: { team: engTeam.key },
  });

  type CostInsert = typeof s.costRecords.$inferInsert;
  const costs: CostInsert[] = [];
  const dimLinks: { contentHash: string; nodeId: string; typeId: string }[] = [];

  // Aggregated API spend: 14 days × representative emails (joinable) + 2 unmapped keys
  for (let d = 1; d <= 14; d++) {
    const day = new Date();
    day.setUTCHours(12, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - d);
    const dayKey = day.toISOString().slice(0, 10);

    // One row per dept with a real employee email for roster join
    for (let di = 0; di < DEPTS.length; di++) {
      const emailIdx = 100 + di * 40 + (d % 10);
      const p = people[emailIdx];
      if (p.status !== "active") continue;
      const spend = 8 + rand() * 12; // ~$8–20/day/dept
      const qty = Math.round((spend * 1e6) / 3);
      const h = hash([orgId, "seed", "mapped", dayKey, p.email, String(di)]);
      costs.push({
        orgId,
        chargePeriodStart: day,
        chargePeriodEnd: day,
        providerId: anth.id,
        skuId: sonnet.id,
        meterId: anthIn.id,
        serviceName: "Claude API (sample)",
        focusSkuId: "claude-sonnet-4",
        consumedQuantity: String(qty),
        consumedUnit: "Tokens",
        billedCost: spend.toFixed(6),
        effectiveCost: spend.toFixed(6),
        listUnitPrice: String(3 / 1e6),
        effectiveUnitPrice: String(3 / 1e6),
        tags: {
          source: "seed",
          api_key: mappedKey,
          email: p.email,
        },
        allocationStatus: "allocated",
        contentHash: h,
      });
      dimLinks.push({ contentHash: h, nodeId: engTeam.id, typeId: dtTeam.id });
    }

    // Unmapped A ~$40/day
    {
      const spend = 40;
      const h = hash([orgId, "seed", "unmappedA", dayKey]);
      costs.push({
        orgId,
        chargePeriodStart: day,
        chargePeriodEnd: day,
        providerId: anth.id,
        skuId: sonnet.id,
        meterId: anthIn.id,
        serviceName: "Claude API (sample)",
        focusSkuId: "claude-sonnet-4",
        consumedQuantity: String(4_000_000),
        consumedUnit: "Tokens",
        billedCost: spend.toFixed(6),
        effectiveCost: spend.toFixed(6),
        tags: { source: "seed", api_key: unmappedA },
        allocationStatus: "unallocated",
        contentHash: h,
      });
    }

    // Unmapped B ~$25/day
    {
      const spend = 25;
      const h = hash([orgId, "seed", "unmappedB", dayKey]);
      costs.push({
        orgId,
        chargePeriodStart: day,
        chargePeriodEnd: day,
        providerId: anth.id,
        skuId: sonnet.id,
        meterId: anthOut.id,
        serviceName: "Claude API (sample)",
        focusSkuId: "claude-sonnet-4",
        consumedQuantity: String(500_000),
        consumedUnit: "Tokens",
        billedCost: spend.toFixed(6),
        effectiveCost: spend.toFixed(6),
        tags: { source: "seed", api_key: unmappedB },
        allocationStatus: "unallocated",
        contentHash: h,
      });
    }
  }

  const seatDay = new Date();
  seatDay.setUTCHours(12, 0, 0, 0);
  seatDay.setUTCDate(1);
  for (const email of [
    ...activeSeatEmails,
    ...terminatedSeatEmails,
    ...inactiveSeatEmails,
  ]) {
    const status = terminatedSeatEmails.includes(email)
      ? "terminated_active"
      : inactiveSeatEmails.includes(email)
        ? "inactive_30d"
        : "active";
    const h = hash([orgId, "seed", "seat", email, status]);
    costs.push({
      orgId,
      chargePeriodStart: seatDay,
      chargePeriodEnd: seatDay,
      providerId: cursor.id,
      skuId: cursorSku.id,
      meterId: cursorSeat.id,
      serviceName: "Cursor (sample)",
      focusSkuId: "cursor-teams-seat",
      consumedQuantity: "1",
      consumedUnit: "Seats",
      billedCost: String(SEAT_PRICE),
      effectiveCost: String(SEAT_PRICE),
      listUnitPrice: String(SEAT_PRICE),
      effectiveUnitPrice: String(SEAT_PRICE),
      tags: {
        source: "seed",
        email,
        seat_status: status,
      },
      // Email-joinable seats count as attributed for coverage story
      allocationStatus: "allocated",
      contentHash: h,
    });
  }

  for (let i = 0; i < costs.length; i += 200) {
    await db.insert(s.costRecords).values(costs.slice(i, i + 200));
  }

  // Dimension links for mapped API rows
  if (dimLinks.length) {
    const inserted = await db
      .select({ id: s.costRecords.id, contentHash: s.costRecords.contentHash })
      .from(s.costRecords)
      .where(
        and(
          eq(s.costRecords.orgId, orgId),
          sql`${s.costRecords.tags}->>'source' = 'seed'`
        )
      );
    const byHash = new Map(inserted.map((r) => [r.contentHash, r.id]));
    const dims = dimLinks
      .map((d) => {
        const costId = byHash.get(d.contentHash);
        if (!costId) return null;
        return {
          costRecordId: costId,
          dimensionTypeId: d.typeId,
          dimensionNodeId: d.nodeId,
        };
      })
      .filter(Boolean) as {
      costRecordId: string;
      dimensionTypeId: string;
      dimensionNodeId: string;
    }[];
    for (let i = 0; i < dims.length; i += 200) {
      await db.insert(s.costRecordDimensions).values(dims.slice(i, i + 200));
    }
  }

  await db
    .update(s.organizations)
    .set({ sampleDataLoadedAt: new Date() })
    .where(eq(s.organizations.id, orgId));

  const [unmappedRow] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.providerKeyRegistry)
    .where(
      and(
        eq(s.providerKeyRegistry.orgId, orgId),
        eq(s.providerKeyRegistry.kind, "api_key"),
        sql`${s.providerKeyRegistry.dimensionNodeId} is null`,
        sql`${s.providerKeyRegistry.externalId} in (${sql.join(
          SAMPLE_KEYS.map((k) => sql`${k}`),
          sql`, `
        )})`
      )
    );

  return {
    roster: ROSTER_SIZE,
    terminatedWithSeats: TERMINATED_WITH_SEATS,
    terminatedSeatMonthlyCost: TERMINATED_WITH_SEATS * SEAT_PRICE,
    inactiveSeats: INACTIVE_SEATS,
    unmappedKeys: Number(unmappedRow?.n ?? 0),
    costRows: costs.length,
    activeSeatEmails: activeSeatEmails.length,
  };
}

export async function clearSampleFlag(orgId: string) {
  await db
    .update(s.organizations)
    .set({ sampleDataLoadedAt: null })
    .where(eq(s.organizations.id, orgId));
}

export async function isSampleDataActive(orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ at: s.organizations.sampleDataLoadedAt })
    .from(s.organizations)
    .where(eq(s.organizations.id, orgId))
    .limit(1);
  return Boolean(org?.at);
}
