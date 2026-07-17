/**
 * Seed Meter with a realistic demo for "Northstar Analytics" — fictional B2B SaaS.
 * 6 months of usage across 4 AI features, mid-history model migration + price change,
 * 180 Cursor seats, Perplexity Enterprise invoices.
 *
 * Run: npx tsx src/db/seed.ts
 */
import "dotenv/config";
import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";
import { computeCostRecord, type PriceCardLineLookup } from "../lib/cost/compute";

function hashTags(tags: Record<string, string>): string {
  const keys = Object.keys(tags).sort();
  const payload = keys.map((k) => `${k}=${tags[k]}`).join("&");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

async function clearAll() {
  // Order matters for FKs
  const tables = [
    s.auditLogs,
    s.memberships,
    s.users,
    s.valueEvents,
    s.valueMetrics,
    s.notifications,
    s.orgWebhooks,
    s.allocationRuleApplications,
    s.budgetStatusSnapshots,
    s.budgetAlerts,
    s.budgetVersions,
    s.budgets,
    s.scenarioResults,
    s.scenarioOverrides,
    s.scenarios,
    s.driverValues,
    s.drivers,
    s.commitmentDrawdowns,
    s.costRecordDimensions,
    s.costRecords,
    s.usageEventDimensions,
    s.usageEvents,
    s.usageDaily,
    s.seatSnapshots,
    s.aiSessions,
    s.aiToolDaily,
    s.aiToolSourcePrefs,
    s.pullRequests,
    s.contributorTeamMemberships,
    s.contributors,
    s.scmConnections,
    s.connectorSyncRuns,
    s.connectors,
    s.importBatches,
    s.mappingTemplates,
    s.otelIngestKeys,
    s.allocationRules,
    s.commitments,
    s.priceCardLines,
    s.priceCards,
    s.dimensionNodes,
    s.dimensionTypes,
    s.meters,
    s.skus,
    s.providers,
    s.organizations,
  ];
  for (const table of tables) {
    await db.delete(table);
  }
}

async function seed() {
  console.log("Clearing existing data…");
  await clearAll();

  console.log("Seeding organization + catalog…");
  const [org] = await db
    .insert(s.organizations)
    .values({
      name: "Northstar Analytics",
      slug: "northstar",
      // Claim via POST /api/orgs/claim { token: "ws_demo_northstar" }
      accessTokenHash: createHash("sha256")
        .update("ws_demo_northstar")
        .digest("hex"),
    })
    .returning();

  const providerRows = await db
    .insert(s.providers)
    .values([
      {
        key: "anthropic",
        displayName: "Anthropic",
        connectorTier: 1,
        connectorStatus: "mock",
        estimatedSpendShare: "0.42",
      },
      {
        key: "openai",
        displayName: "OpenAI",
        connectorTier: 1,
        connectorStatus: "mock",
        estimatedSpendShare: "0.28",
      },
      {
        key: "google",
        displayName: "Google Gemini",
        connectorTier: 2,
        connectorStatus: "stub",
        estimatedSpendShare: "0.08",
      },
      {
        key: "cursor",
        displayName: "Cursor",
        connectorTier: 1,
        connectorStatus: "mock",
        estimatedSpendShare: "0.15",
      },
      {
        key: "perplexity",
        displayName: "Perplexity",
        connectorTier: 4,
        connectorStatus: "mock",
        estimatedSpendShare: "0.04",
      },
      {
        key: "replit",
        displayName: "Replit",
        connectorTier: 4,
        connectorStatus: "stub",
        estimatedSpendShare: "0.01",
      },
      {
        key: "lovable",
        displayName: "Lovable",
        connectorTier: 4,
        connectorStatus: "stub",
        estimatedSpendShare: "0.01",
      },
      {
        key: "aws_bedrock",
        displayName: "AWS Bedrock",
        connectorTier: 2,
        connectorStatus: "stub",
        estimatedSpendShare: "0.005",
      },
      {
        key: "azure_openai",
        displayName: "Azure OpenAI",
        connectorTier: 2,
        connectorStatus: "stub",
        estimatedSpendShare: "0.005",
      },
    ])
    .returning();

  const p = Object.fromEntries(providerRows.map((r) => [r.key, r]));

  // SKUs
  const skuDefs = [
    { provider: "anthropic", skuId: "claude-sonnet-4", displayName: "Claude Sonnet 4", family: "claude-4" },
    { provider: "anthropic", skuId: "claude-haiku-3.5", displayName: "Claude Haiku 3.5", family: "claude-3.5" },
    { provider: "openai", skuId: "gpt-4o", displayName: "GPT-4o", family: "gpt-4o" },
    { provider: "openai", skuId: "text-embedding-3-small", displayName: "Embedding 3 Small", family: "embeddings", modality: "embedding" },
    { provider: "google", skuId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", family: "gemini-2.5" },
    { provider: "cursor", skuId: "cursor-teams-seat", displayName: "Cursor Teams Seat", family: "cursor", modality: "seat" },
    { provider: "cursor", skuId: "cursor-premium-request", displayName: "Cursor Premium Request", family: "cursor" },
    { provider: "perplexity", skuId: "perplexity-enterprise-seat", displayName: "Perplexity Enterprise Seat", family: "perplexity", modality: "seat" },
  ] as const;

  const skuRows = await db
    .insert(s.skus)
    .values(
      skuDefs.map((d) => ({
        providerId: p[d.provider].id,
        skuId: d.skuId,
        displayName: d.displayName,
        family: d.family,
        modality: "modality" in d ? d.modality : "chat",
      }))
    )
    .returning();
  const sku = Object.fromEntries(skuRows.map((r) => [r.skuId, r]));

  // Meters per provider
  const meterDefs: {
    provider: string;
    meterKey: string;
    displayName: string;
    consumedUnit: string;
    category: string;
  }[] = [];
  for (const prov of ["anthropic", "openai", "google", "aws_bedrock", "azure_openai"]) {
    for (const [meterKey, displayName, unit] of [
      ["input_tokens", "Input tokens", "Tokens"],
      ["output_tokens", "Output tokens", "Tokens"],
      ["cache_write_tokens", "Cache write tokens", "Tokens"],
      ["cache_read_tokens", "Cache read tokens", "Tokens"],
      ["batch_input_tokens", "Batch input tokens", "Tokens"],
      ["batch_output_tokens", "Batch output tokens", "Tokens"],
    ] as const) {
      meterDefs.push({
        provider: prov,
        meterKey,
        displayName,
        consumedUnit: unit,
        category: "usage",
      });
    }
  }
  meterDefs.push(
    {
      provider: "cursor",
      meterKey: "seats",
      displayName: "Seats",
      consumedUnit: "Seats",
      category: "seat",
    },
    {
      provider: "cursor",
      meterKey: "premium_requests",
      displayName: "Premium requests",
      consumedUnit: "Requests",
      category: "usage",
    },
    {
      provider: "perplexity",
      meterKey: "seats",
      displayName: "Enterprise seats",
      consumedUnit: "Seats",
      category: "seat",
    },
    {
      provider: "replit",
      meterKey: "credits",
      displayName: "Credits",
      consumedUnit: "Credits",
      category: "credit",
    },
    {
      provider: "lovable",
      meterKey: "credits",
      displayName: "Credits",
      consumedUnit: "Credits",
      category: "credit",
    }
  );

  const meterRows = await db
    .insert(s.meters)
    .values(
      meterDefs.map((m) => ({
        providerId: p[m.provider].id,
        meterKey: m.meterKey,
        displayName: m.displayName,
        consumedUnit: m.consumedUnit,
        category: m.category,
      }))
    )
    .returning();

  const meterByProvKey = (providerKey: string, meterKey: string) => {
    const row = meterRows.find(
      (m) => m.providerId === p[providerKey].id && m.meterKey === meterKey
    );
    if (!row) throw new Error(`meter ${providerKey}/${meterKey}`);
    return row;
  };

  // Dimensions: BU → department → team (+ flat cost centers)
  console.log("Seeding dimensions…");
  const [dtBu, dtDept, dtTeam, dtCc] = await db
    .insert(s.dimensionTypes)
    .values([
      {
        orgId: org.id,
        key: "business_unit",
        displayName: "Business Unit",
        isHierarchical: true,
        isRequired: true,
        sortOrder: 1,
      },
      {
        orgId: org.id,
        key: "department",
        displayName: "Department",
        isHierarchical: true,
        isRequired: false,
        sortOrder: 2,
      },
      {
        orgId: org.id,
        key: "team",
        displayName: "Team",
        isHierarchical: true,
        isRequired: true,
        sortOrder: 3,
      },
      {
        orgId: org.id,
        key: "cost_center",
        displayName: "Cost Center",
        isHierarchical: false,
        isRequired: false,
        sortOrder: 4,
      },
    ])
    .returning();

  const [buProduct, buPlatform, buGtm] = await db
    .insert(s.dimensionNodes)
    .values([
      {
        orgId: org.id,
        dimensionTypeId: dtBu.id,
        key: "product",
        displayName: "Product",
        path: "/product",
        ownerEmail: "vp-product@northstar.demo",
      },
      {
        orgId: org.id,
        dimensionTypeId: dtBu.id,
        key: "platform",
        displayName: "Platform",
        path: "/platform",
        ownerEmail: "vp-platform@northstar.demo",
      },
      {
        orgId: org.id,
        dimensionTypeId: dtBu.id,
        key: "gtm",
        displayName: "GTM",
        path: "/gtm",
        ownerEmail: "vp-gtm@northstar.demo",
      },
    ])
    .returning();

  const [deptProductEng, deptProductSupport, deptPlatformCore, deptGtmField] =
    await db
      .insert(s.dimensionNodes)
      .values([
        {
          orgId: org.id,
          dimensionTypeId: dtDept.id,
          key: "product-eng",
          displayName: "Product Engineering",
          parentId: buProduct.id,
          path: "/product/product-eng",
          ownerEmail: "eng-lead@northstar.demo",
        },
        {
          orgId: org.id,
          dimensionTypeId: dtDept.id,
          key: "product-support",
          displayName: "Product Support",
          parentId: buProduct.id,
          path: "/product/product-support",
          ownerEmail: "support-lead@northstar.demo",
        },
        {
          orgId: org.id,
          dimensionTypeId: dtDept.id,
          key: "platform-core",
          displayName: "Platform Core",
          parentId: buPlatform.id,
          path: "/platform/platform-core",
          ownerEmail: "platform-lead@northstar.demo",
        },
        {
          orgId: org.id,
          dimensionTypeId: dtDept.id,
          key: "gtm-field",
          displayName: "GTM Field",
          parentId: buGtm.id,
          path: "/gtm/gtm-field",
          ownerEmail: "gtm-lead@northstar.demo",
        },
      ])
      .returning();

  const teamDefs = [
    {
      key: "ai-platform",
      displayName: "AI Platform",
      parent: deptPlatformCore,
      path: "/platform/platform-core/ai-platform",
      bu: "platform",
      dept: "platform-core",
    },
    {
      key: "support",
      displayName: "Support",
      parent: deptProductSupport,
      path: "/product/product-support/support",
      bu: "product",
      dept: "product-support",
    },
    {
      key: "docs",
      displayName: "Docs",
      parent: deptProductEng,
      path: "/product/product-eng/docs",
      bu: "product",
      dept: "product-eng",
    },
    {
      key: "sales-eng",
      displayName: "Sales Engineering",
      parent: deptGtmField,
      path: "/gtm/gtm-field/sales-eng",
      bu: "gtm",
      dept: "gtm-field",
    },
  ];

  const teamRows = await db
    .insert(s.dimensionNodes)
    .values(
      teamDefs.map((t) => ({
        orgId: org.id,
        dimensionTypeId: dtTeam.id,
        key: t.key,
        displayName: t.displayName,
        parentId: t.parent.id,
        path: t.path,
        ownerEmail: `${t.key}@northstar.demo`,
      }))
    )
    .returning();
  const team = Object.fromEntries(teamRows.map((r) => [r.key, r]));
  const deptByKey = {
    "product-eng": deptProductEng,
    "product-support": deptProductSupport,
    "platform-core": deptPlatformCore,
    "gtm-field": deptGtmField,
  };

  const ccRows = await db
    .insert(s.dimensionNodes)
    .values([
      {
        orgId: org.id,
        dimensionTypeId: dtCc.id,
        key: "cc-100",
        displayName: "CC-100 Platform AI",
        path: "/cc-100",
        costCenterCode: "CC-100",
        ownerEmail: "finance-platform@northstar.demo",
      },
      {
        orgId: org.id,
        dimensionTypeId: dtCc.id,
        key: "cc-220",
        displayName: "CC-220 Product Copilot",
        path: "/cc-220",
        costCenterCode: "CC-220",
        ownerEmail: "finance-product@northstar.demo",
      },
      {
        orgId: org.id,
        dimensionTypeId: dtCc.id,
        key: "cc-310",
        displayName: "CC-310 GTM",
        path: "/cc-310",
        costCenterCode: "CC-310",
        ownerEmail: "finance-gtm@northstar.demo",
      },
    ])
    .returning();
  const cc = Object.fromEntries(ccRows.map((r) => [r.key, r]));

  await db.insert(s.allocationRules).values([
    {
      orgId: org.id,
      name: "Copilot → Support + CC-220",
      priority: 10,
      match: { feature: "support_copilot" },
      set: {
        team: "support",
        cost_center: "cc-220",
        business_unit: "product",
        department: "product-support",
      },
    },
    {
      orgId: org.id,
      name: "Doc QA → Docs + CC-220",
      priority: 10,
      match: { feature: "doc_qa" },
      set: {
        team: "docs",
        cost_center: "cc-220",
        business_unit: "product",
        department: "product-eng",
      },
    },
    {
      orgId: org.id,
      name: "Code assist → AI Platform + CC-100",
      priority: 10,
      match: { feature: "code_assist" },
      set: {
        team: "ai-platform",
        cost_center: "cc-100",
        business_unit: "platform",
        department: "platform-core",
      },
    },
    {
      orgId: org.id,
      name: "Sales email → Sales Eng + CC-310",
      priority: 10,
      match: { feature: "sales_email" },
      set: {
        team: "sales-eng",
        cost_center: "cc-310",
        business_unit: "gtm",
        department: "gtm-field",
      },
    },
  ]);

  // Price cards — published Anthropic with mid-history cut; OpenAI; Gemini; Cursor seats
  console.log("Seeding price cards…");
  const priceStart = daysAgo(200);
  const priceCut = daysAgo(90);

  const [anthCardV1] = await db
    .insert(s.priceCards)
    .values({
      orgId: null,
      providerId: p.anthropic.id,
      name: "Anthropic list (pre-cut)",
      version: 1,
      effectiveFrom: priceStart,
      effectiveTo: priceCut,
      source: "published",
      notes: "Sonnet input $3 / output $15 per MTok",
    })
    .returning();

  const [anthCardV2] = await db
    .insert(s.priceCards)
    .values({
      orgId: null,
      providerId: p.anthropic.id,
      name: "Anthropic list (post-cut)",
      version: 2,
      effectiveFrom: priceCut,
      effectiveTo: null,
      source: "published",
      parentCardId: anthCardV1.id,
      notes: "Price cut: Sonnet input $2.50 / output $12 per MTok",
    })
    .returning();

  const [oaiCard] = await db
    .insert(s.priceCards)
    .values({
      orgId: null,
      providerId: p.openai.id,
      name: "OpenAI list",
      version: 1,
      effectiveFrom: priceStart,
      effectiveTo: null,
      source: "published",
    })
    .returning();

  const [gemCard] = await db
    .insert(s.priceCards)
    .values({
      orgId: null,
      providerId: p.google.id,
      name: "Gemini list",
      version: 1,
      effectiveFrom: priceStart,
      effectiveTo: null,
      source: "published",
    })
    .returning();

  const [cursorCard] = await db
    .insert(s.priceCards)
    .values({
      orgId: null,
      providerId: p.cursor.id,
      name: "Cursor Teams",
      version: 1,
      effectiveFrom: priceStart,
      effectiveTo: null,
      source: "published",
    })
    .returning();

  const [perpCard] = await db
    .insert(s.priceCards)
    .values({
      orgId: null,
      providerId: p.perplexity.id,
      name: "Perplexity Enterprise",
      version: 1,
      effectiveFrom: priceStart,
      effectiveTo: null,
      source: "published",
    })
    .returning();

  type LineIn = {
    priceCardId: string;
    skuId: string;
    providerKey: string;
    meterKey: string;
    unitPrice: string;
    metadata?: Record<string, unknown>;
  };

  const lineIns: LineIn[] = [
    // Anthropic v1
    { priceCardId: anthCardV1.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "input_tokens", unitPrice: String(3 / 1e6) },
    { priceCardId: anthCardV1.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "output_tokens", unitPrice: String(15 / 1e6) },
    { priceCardId: anthCardV1.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "cache_write_tokens", unitPrice: String(3.75 / 1e6) },
    { priceCardId: anthCardV1.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "cache_read_tokens", unitPrice: String(0.3 / 1e6) },
    { priceCardId: anthCardV1.id, skuId: "claude-haiku-3.5", providerKey: "anthropic", meterKey: "input_tokens", unitPrice: String(0.8 / 1e6) },
    { priceCardId: anthCardV1.id, skuId: "claude-haiku-3.5", providerKey: "anthropic", meterKey: "output_tokens", unitPrice: String(4 / 1e6) },
    // Anthropic v2 (price cut on sonnet)
    { priceCardId: anthCardV2.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "input_tokens", unitPrice: String(2.5 / 1e6) },
    { priceCardId: anthCardV2.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "output_tokens", unitPrice: String(12 / 1e6) },
    { priceCardId: anthCardV2.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "cache_write_tokens", unitPrice: String(3.125 / 1e6) },
    { priceCardId: anthCardV2.id, skuId: "claude-sonnet-4", providerKey: "anthropic", meterKey: "cache_read_tokens", unitPrice: String(0.25 / 1e6) },
    { priceCardId: anthCardV2.id, skuId: "claude-haiku-3.5", providerKey: "anthropic", meterKey: "input_tokens", unitPrice: String(0.8 / 1e6) },
    { priceCardId: anthCardV2.id, skuId: "claude-haiku-3.5", providerKey: "anthropic", meterKey: "output_tokens", unitPrice: String(4 / 1e6) },
    // OpenAI
    { priceCardId: oaiCard.id, skuId: "gpt-4o", providerKey: "openai", meterKey: "input_tokens", unitPrice: String(2.5 / 1e6) },
    { priceCardId: oaiCard.id, skuId: "gpt-4o", providerKey: "openai", meterKey: "output_tokens", unitPrice: String(10 / 1e6) },
    { priceCardId: oaiCard.id, skuId: "text-embedding-3-small", providerKey: "openai", meterKey: "input_tokens", unitPrice: String(0.02 / 1e6) },
    // Gemini
    { priceCardId: gemCard.id, skuId: "gemini-2.5-flash", providerKey: "google", meterKey: "input_tokens", unitPrice: String(0.15 / 1e6) },
    { priceCardId: gemCard.id, skuId: "gemini-2.5-flash", providerKey: "google", meterKey: "output_tokens", unitPrice: String(0.6 / 1e6) },
    // Cursor
    { priceCardId: cursorCard.id, skuId: "cursor-teams-seat", providerKey: "cursor", meterKey: "seats", unitPrice: "40" },
    { priceCardId: cursorCard.id, skuId: "cursor-premium-request", providerKey: "cursor", meterKey: "premium_requests", unitPrice: "0.04" },
    // Perplexity
    { priceCardId: perpCard.id, skuId: "perplexity-enterprise-seat", providerKey: "perplexity", meterKey: "seats", unitPrice: "40" },
  ];

  const priceLineRows = await db
    .insert(s.priceCardLines)
    .values(
      lineIns.map((l) => ({
        priceCardId: l.priceCardId,
        skuId: sku[l.skuId].id,
        meterId: meterByProvKey(l.providerKey, l.meterKey).id,
        unitPrice: l.unitPrice,
        metadata: l.metadata ?? {},
      }))
    )
    .returning();

  // Build lookup for cost computation
  const cardById = Object.fromEntries(
    [anthCardV1, anthCardV2, oaiCard, gemCard, cursorCard, perpCard].map((c) => [c.id, c])
  );

  const lookupLines: PriceCardLineLookup[] = priceLineRows.map((pl) => {
    const card = cardById[pl.priceCardId];
    const m = meterRows.find((x) => x.id === pl.meterId)!;
    return {
      id: pl.id,
      priceCardId: pl.priceCardId,
      skuId: pl.skuId,
      meterId: pl.meterId,
      meterKey: m.meterKey,
      unitPrice: Number(pl.unitPrice),
      discountPct: pl.discountPct ? Number(pl.discountPct) : 0,
      effectiveFrom: card.effectiveFrom,
      effectiveTo: card.effectiveTo,
      source: card.source,
    };
  });

  // Commitment
  const [commit] = await db
    .insert(s.commitments)
    .values({
      orgId: org.id,
      name: "Anthropic enterprise commit FY26",
      type: "enterprise_commit",
      providerId: p.anthropic.id,
      amountUsd: "120000",
      unit: "USD",
      termStart: daysAgo(180),
      termEnd: addDays(daysAgo(180), 365),
      applicableSkuIds: [sku["claude-sonnet-4"].id, sku["claude-haiku-3.5"].id],
      drawdownMethod: "fifo",
      utilizationTargetPct: "80",
    })
    .returning();

  // Features config for synthetic generation
  type FeatureCfg = {
    key: string;
    teamKey: string;
    ccKey: string;
    buKey: string;
    deptKey: keyof typeof deptByKey;
    // before migration day: primary sku; after: routing split
    migrationDay: number; // days ago
    providerBefore: string;
    skuBefore: string;
    routesAfter: { provider: string; sku: string; share: number }[];
    baseRequestsPerDay: number;
    growthPerDay: number;
    avgIn: number;
    avgOut: number;
    weekendFactor: number;
  };

  const features: FeatureCfg[] = [
    {
      key: "support_copilot",
      teamKey: "support",
      ccKey: "cc-220",
      buKey: "product",
      deptKey: "product-support",
      migrationDay: 100, // ~3 months ago: migrate 80% to haiku
      providerBefore: "anthropic",
      skuBefore: "claude-sonnet-4",
      routesAfter: [
        { provider: "anthropic", sku: "claude-haiku-3.5", share: 0.8 },
        { provider: "anthropic", sku: "claude-sonnet-4", share: 0.2 },
      ],
      baseRequestsPerDay: 4200,
      growthPerDay: 8,
      avgIn: 1800,
      avgOut: 420,
      weekendFactor: 0.55,
    },
    {
      key: "doc_qa",
      teamKey: "docs",
      ccKey: "cc-220",
      buKey: "product",
      deptKey: "product-eng",
      migrationDay: -1,
      providerBefore: "openai",
      skuBefore: "gpt-4o",
      routesAfter: [{ provider: "openai", sku: "gpt-4o", share: 1 }],
      baseRequestsPerDay: 2800,
      growthPerDay: 5,
      avgIn: 3200,
      avgOut: 600,
      weekendFactor: 0.4,
    },
    {
      key: "code_assist",
      teamKey: "ai-platform",
      ccKey: "cc-100",
      buKey: "platform",
      deptKey: "platform-core",
      migrationDay: -1,
      providerBefore: "anthropic",
      skuBefore: "claude-sonnet-4",
      routesAfter: [{ provider: "anthropic", sku: "claude-sonnet-4", share: 1 }],
      baseRequestsPerDay: 1500,
      growthPerDay: 4,
      avgIn: 4500,
      avgOut: 1100,
      weekendFactor: 0.7,
    },
    {
      key: "sales_email",
      teamKey: "sales-eng",
      ccKey: "cc-310",
      buKey: "gtm",
      deptKey: "gtm-field",
      migrationDay: -1,
      providerBefore: "google",
      skuBefore: "gemini-2.5-flash",
      routesAfter: [{ provider: "google", sku: "gemini-2.5-flash", share: 1 }],
      baseRequestsPerDay: 900,
      growthPerDay: 3,
      avgIn: 1200,
      avgOut: 800,
      weekendFactor: 0.3,
    },
  ];

  const HORIZON = 180;
  console.log(`Generating ${HORIZON} days of usage + cost…`);

  const dailyRows: (typeof s.usageDaily.$inferInsert)[] = [];
  const costRows: (typeof s.costRecords.$inferInsert)[] = [];
  const costDims: { costIdx: number; typeId: string; nodeId: string }[] = [];
  const eventSample: (typeof s.usageEvents.$inferInsert)[] = [];
  const eventDims: { eventIdx: number; typeId: string; nodeId: string }[] = [];

  const buNode = { product: buProduct, platform: buPlatform, gtm: buGtm };

  for (let dayOffset = HORIZON; dayOffset >= 0; dayOffset--) {
    const day = daysAgo(dayOffset);
    const dayStr = day.toISOString().slice(0, 10);
    const dow = day.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const daysFromStart = HORIZON - dayOffset;

    for (const f of features) {
      const season = 1 + 0.08 * Math.sin((daysFromStart / 7) * Math.PI * 2);
      const noise = 0.9 + rand() * 0.2;
      let reqs =
        (f.baseRequestsPerDay + f.growthPerDay * daysFromStart) *
        season *
        noise *
        (isWeekend ? f.weekendFactor : 1);
      reqs = Math.max(10, Math.round(reqs));

      const useMigration = f.migrationDay >= 0 && dayOffset <= f.migrationDay;
      const routes = useMigration
        ? f.routesAfter
        : [{ provider: f.providerBefore, sku: f.skuBefore, share: 1 }];

      for (const route of routes) {
        const routeReqs = Math.round(reqs * route.share);
        const inTok = routeReqs * f.avgIn * (0.95 + rand() * 0.1);
        const outTok = routeReqs * f.avgOut * (0.95 + rand() * 0.1);
        const tags = {
          feature: f.key,
          environment: "production",
        };
        const tagsH = hashTags(tags);
        const providerId = p[route.provider].id;
        const skuId = sku[route.sku].id;
        const serviceName =
          route.provider === "anthropic"
            ? "Claude API"
            : route.provider === "openai"
              ? "OpenAI API"
              : route.provider === "google"
                ? "Gemini API"
                : route.provider;

        for (const [meterKey, qty] of [
          ["input_tokens", inTok],
          ["output_tokens", outTok],
        ] as const) {
          const meter = meterByProvKey(route.provider, meterKey);
          dailyRows.push({
            orgId: org.id,
            day: dayStr,
            providerId,
            skuId,
            meterId: meter.id,
            tags,
            tagsHash: tagsH + meterKey.slice(0, 2),
            quantitySum: String(Math.round(qty)),
            eventCount: routeReqs,
            latencyP50: 400 + Math.floor(rand() * 200),
            latencyP95: 1200 + Math.floor(rand() * 800),
          });

          // Cost via time-travel pricing
          const computed = computeCostRecord(
            {
              id: `daily-${dayStr}-${f.key}-${route.sku}-${meterKey}`,
              eventTime: day,
              providerId,
              skuId,
              meterId: meter.id,
              meterKey,
              consumedQuantity: Math.round(qty),
              consumedUnit: "Tokens",
              serviceName,
              focusSkuId: route.sku,
              tags,
              allocationStatus: rand() < 0.15 ? "unallocated" : "allocated",
            },
            lookupLines
          );

          // Light commit discount on anthropic (~8%)
          let effective = computed.effectiveCost;
          let commitId: string | null = null;
          let savings = 0;
          if (route.provider === "anthropic") {
            savings = effective * 0.08;
            effective -= savings;
            commitId = commit.id;
          }

          const costIdx = costRows.length;
          costRows.push({
            orgId: org.id,
            chargePeriodStart: day,
            chargePeriodEnd: addDays(day, 1),
            providerId,
            skuId,
            meterId: meter.id,
            serviceName,
            focusSkuId: route.sku,
            consumedQuantity: String(Math.round(qty)),
            consumedUnit: "Tokens",
            billedCost: String(computed.billedCost.toFixed(6)),
            effectiveCost: String(effective.toFixed(6)),
            listUnitPrice: String(computed.listUnitPrice),
            effectiveUnitPrice: String(computed.effectiveUnitPrice),
            priceCardId: computed.priceCardId,
            priceCardLineId: computed.priceCardLineId,
            commitmentId: commitId,
            commitmentSavings: String(savings.toFixed(6)),
            tags,
            allocationStatus: computed.allocationStatus,
          });

          if (computed.allocationStatus === "allocated") {
            costDims.push(
              { costIdx, typeId: dtBu.id, nodeId: buNode[f.buKey as keyof typeof buNode].id },
              { costIdx, typeId: dtDept.id, nodeId: deptByKey[f.deptKey].id },
              { costIdx, typeId: dtTeam.id, nodeId: team[f.teamKey].id },
              { costIdx, typeId: dtCc.id, nodeId: cc[f.ccKey].id }
            );
          }
        }

        // Sample atomic events for last 7 days
        if (dayOffset <= 7) {
          const sampleN = Math.min(40, routeReqs);
          for (let i = 0; i < sampleN; i++) {
            const eventTime = new Date(day);
            eventTime.setUTCHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60));
            const meter = meterByProvKey(route.provider, "input_tokens");
            const eventIdx = eventSample.length;
            const allocated = rand() >= 0.15;
            eventSample.push({
              orgId: org.id,
              eventTime,
              providerId,
              skuId,
              meterId: meter.id,
              consumedQuantity: String(Math.round(f.avgIn * (0.8 + rand() * 0.4))),
              consumedUnit: "Tokens",
              requestId: `req_${dayStr}_${f.key}_${i}`,
              latencyMs: 300 + Math.floor(rand() * 1500),
              tags: { feature: f.key, environment: "production" },
              chargePeriodStart: eventTime,
              chargePeriodEnd: addDays(eventTime, 0),
              allocationStatus: allocated ? "allocated" : "unallocated",
            });
            if (allocated) {
              eventDims.push(
                { eventIdx, typeId: dtBu.id, nodeId: buNode[f.buKey as keyof typeof buNode].id },
                { eventIdx, typeId: dtDept.id, nodeId: deptByKey[f.deptKey].id },
                { eventIdx, typeId: dtTeam.id, nodeId: team[f.teamKey].id },
                { eventIdx, typeId: dtCc.id, nodeId: cc[f.ccKey].id }
              );
            }
          }
        }
      }

      // Embeddings for doc_qa
      if (f.key === "doc_qa") {
        const embMeter = meterByProvKey("openai", "input_tokens");
        const embQty = reqs * 800;
        const tags = { feature: "doc_qa", environment: "production", modality: "embedding" };
        dailyRows.push({
          orgId: org.id,
          day: dayStr,
          providerId: p.openai.id,
          skuId: sku["text-embedding-3-small"].id,
          meterId: embMeter.id,
          tags,
          tagsHash: hashTags(tags),
          quantitySum: String(Math.round(embQty)),
          eventCount: reqs,
        });
        const computed = computeCostRecord(
          {
            id: `emb-${dayStr}`,
            eventTime: day,
            providerId: p.openai.id,
            skuId: sku["text-embedding-3-small"].id,
            meterId: embMeter.id,
            meterKey: "input_tokens",
            consumedQuantity: Math.round(embQty),
            consumedUnit: "Tokens",
            serviceName: "OpenAI API",
            focusSkuId: "text-embedding-3-small",
            tags,
            allocationStatus: "allocated",
          },
          lookupLines
        );
        const costIdx = costRows.length;
        costRows.push({
          orgId: org.id,
          chargePeriodStart: day,
          chargePeriodEnd: addDays(day, 1),
          providerId: p.openai.id,
          skuId: sku["text-embedding-3-small"].id,
          meterId: embMeter.id,
          serviceName: "OpenAI API",
          focusSkuId: "text-embedding-3-small",
          consumedQuantity: String(Math.round(embQty)),
          consumedUnit: "Tokens",
          billedCost: String(computed.billedCost.toFixed(6)),
          effectiveCost: String(computed.effectiveCost.toFixed(6)),
          listUnitPrice: String(computed.listUnitPrice),
          effectiveUnitPrice: String(computed.effectiveUnitPrice),
          priceCardId: computed.priceCardId,
          priceCardLineId: computed.priceCardLineId,
          tags,
          allocationStatus: "allocated",
        });
        costDims.push(
          { costIdx, typeId: dtBu.id, nodeId: buProduct.id },
          { costIdx, typeId: dtDept.id, nodeId: deptProductEng.id },
          { costIdx, typeId: dtTeam.id, nodeId: team.docs.id },
          { costIdx, typeId: dtCc.id, nodeId: cc["cc-220"].id }
        );
      }
    }

    // Cursor seats — monthly-ish daily prorated + premium requests on weekdays
    if (day.getUTCDate() === 1 || dayOffset === 0) {
      // monthly seat charge recorded on 1st
    }
    const seatsPurchased = 180;
    const seatsActive = 85 + Math.floor(rand() * 15);
    const seatsHeavy = 22 + Math.floor(rand() * 8);
    if (dow === 1 || dayOffset === HORIZON) {
      // weekly snapshot
    }
  }

  // Clustered unallocated spend for allocation triage demos
  const unallocClusters: {
    tags: Record<string, string>;
    provider: "anthropic" | "openai" | "google";
    sku: string;
    days: number;
    dailyCost: number;
  }[] = [
    {
      tags: {
        feature: "shadow_eval",
        api_key: "sk-ant-shadow-***",
        source: "litellm",
        environment: "staging",
      },
      provider: "anthropic",
      sku: "claude-sonnet-4",
      days: 12,
      dailyCost: 180,
    },
    {
      tags: {
        feature: "batch_rewrite",
        api_key: "sk-oai-batch-***",
        source: "openai_batch",
        environment: "production",
      },
      provider: "openai",
      sku: "gpt-4o",
      days: 10,
      dailyCost: 95,
    },
    {
      tags: {
        feature: "unknown_gateway",
        source: "portkey",
        environment: "dev",
      },
      provider: "google",
      sku: "gemini-2.5-flash",
      days: 8,
      dailyCost: 40,
    },
  ];
  for (const cluster of unallocClusters) {
    for (let d = 0; d < cluster.days; d++) {
      const day = daysAgo(d);
      const meter = meterByProvKey(cluster.provider, "input_tokens");
      costRows.push({
        orgId: org.id,
        chargePeriodStart: day,
        chargePeriodEnd: addDays(day, 1),
        providerId: p[cluster.provider].id,
        skuId: sku[cluster.sku].id,
        meterId: meter.id,
        serviceName: `${cluster.provider} API`,
        focusSkuId: cluster.sku,
        consumedQuantity: String(Math.round(cluster.dailyCost * 400)),
        consumedUnit: "Tokens",
        billedCost: String(cluster.dailyCost.toFixed(6)),
        effectiveCost: String(cluster.dailyCost.toFixed(6)),
        listUnitPrice: "0",
        effectiveUnitPrice: "0",
        tags: cluster.tags,
        allocationStatus: "unallocated",
      });
    }
  }

  // Insert usage daily in batches
  console.log(`Inserting ${dailyRows.length} usage_daily rows…`);
  for (let i = 0; i < dailyRows.length; i += 500) {
    await db.insert(s.usageDaily).values(dailyRows.slice(i, i + 500));
  }

  console.log(`Inserting ${costRows.length} cost_records…`);
  const insertedCosts: { id: string }[] = [];
  for (let i = 0; i < costRows.length; i += 400) {
    const batch = await db.insert(s.costRecords).values(costRows.slice(i, i + 400)).returning({ id: s.costRecords.id });
    insertedCosts.push(...batch);
  }

  const dimInserts = costDims
    .filter((d) => insertedCosts[d.costIdx])
    .map((d) => ({
      costRecordId: insertedCosts[d.costIdx].id,
      dimensionTypeId: d.typeId,
      dimensionNodeId: d.nodeId,
    }));
  console.log(`Inserting ${dimInserts.length} cost dimensions…`);
  for (let i = 0; i < dimInserts.length; i += 500) {
    await db.insert(s.costRecordDimensions).values(dimInserts.slice(i, i + 500));
  }

  console.log(`Inserting ${eventSample.length} sample usage_events…`);
  const insertedEvents: { id: string }[] = [];
  for (let i = 0; i < eventSample.length; i += 300) {
    const batch = await db.insert(s.usageEvents).values(eventSample.slice(i, i + 300)).returning({ id: s.usageEvents.id });
    insertedEvents.push(...batch);
  }
  const evDims = eventDims
    .filter((d) => insertedEvents[d.eventIdx])
    .map((d) => ({
      usageEventId: insertedEvents[d.eventIdx].id,
      dimensionTypeId: d.typeId,
      dimensionNodeId: d.nodeId,
    }));
  for (let i = 0; i < evDims.length; i += 500) {
    await db.insert(s.usageEventDimensions).values(evDims.slice(i, i + 500));
  }

  // Cursor seat snapshots + monthly cost
  console.log("Seeding Cursor seats + Perplexity invoices…");
  const seatSnaps: (typeof s.seatSnapshots.$inferInsert)[] = [];
  for (let dayOffset = HORIZON; dayOffset >= 0; dayOffset -= 7) {
    const day = daysAgo(dayOffset);
    seatSnaps.push({
      orgId: org.id,
      providerId: p.cursor.id,
      asOf: day.toISOString().slice(0, 10),
      seatsPurchased: 180,
      seatsActive: 88 + Math.floor(rand() * 12),
      seatsHeavy: 24 + Math.floor(rand() * 6),
      metadata: { inactive: 180 - (88 + Math.floor(rand() * 12)) },
    });
  }
  await db.insert(s.seatSnapshots).values(seatSnaps);

  // Monthly Cursor seat costs + Perplexity
  for (let m = 0; m < 6; m++) {
    const day = daysAgo(m * 30 + 5);
    day.setUTCDate(1);
    const cursorMeter = meterByProvKey("cursor", "seats");
    const [cr] = await db
      .insert(s.costRecords)
      .values({
        orgId: org.id,
        chargePeriodStart: day,
        chargePeriodEnd: addDays(day, 30),
        providerId: p.cursor.id,
        skuId: sku["cursor-teams-seat"].id,
        meterId: cursorMeter.id,
        serviceName: "Cursor Teams",
        focusSkuId: "cursor-teams-seat",
        consumedQuantity: "180",
        consumedUnit: "Seats",
        billedCost: String(180 * 40),
        effectiveCost: String(180 * 40),
        listUnitPrice: "40",
        effectiveUnitPrice: "40",
        tags: { feature: "code_assist" },
        allocationStatus: "allocated",
      })
      .returning();
    await db.insert(s.costRecordDimensions).values([
      { costRecordId: cr.id, dimensionTypeId: dtBu.id, dimensionNodeId: buPlatform.id },
      { costRecordId: cr.id, dimensionTypeId: dtTeam.id, dimensionNodeId: team["ai-platform"].id },
      { costRecordId: cr.id, dimensionTypeId: dtCc.id, dimensionNodeId: cc["cc-100"].id },
    ]);

    const perpMeter = meterByProvKey("perplexity", "seats");
    const seats = 40;
    await db.insert(s.costRecords).values({
      orgId: org.id,
      chargePeriodStart: day,
      chargePeriodEnd: addDays(day, 30),
      providerId: p.perplexity.id,
      skuId: sku["perplexity-enterprise-seat"].id,
      meterId: perpMeter.id,
      serviceName: "Perplexity Enterprise",
      focusSkuId: "perplexity-enterprise-seat",
      consumedQuantity: String(seats),
      consumedUnit: "Seats",
      billedCost: String(seats * 40),
      effectiveCost: String(seats * 40),
      listUnitPrice: "40",
      effectiveUnitPrice: "40",
      tags: { source: "invoice", fidelity: "low" },
      allocationStatus: "unallocated",
    });
  }

  // Drivers
  console.log("Seeding drivers + scenarios + budgets + connectors…");
  const driverDefs = [
    { key: "weekly_active_users", displayName: "Weekly active users", unit: "users", featureKey: null, sortOrder: 1 },
    { key: "adoption", displayName: "Feature adoption", unit: "pct", featureKey: "support_copilot", sortOrder: 2 },
    { key: "requests_per_active_user", displayName: "Requests / active user / week", unit: "requests", featureKey: "support_copilot", sortOrder: 3 },
    { key: "avg_input_tokens", displayName: "Avg input tokens", unit: "tokens", featureKey: "support_copilot", sortOrder: 4 },
    { key: "avg_output_tokens", displayName: "Avg output tokens", unit: "tokens", featureKey: "support_copilot", sortOrder: 5 },
    { key: "output_input_ratio", displayName: "Output:input ratio", unit: "ratio", featureKey: "support_copilot", sortOrder: 6 },
    { key: "cache_hit_rate", displayName: "Cache hit rate", unit: "pct", featureKey: "support_copilot", sortOrder: 7 },
    { key: "adoption", displayName: "Doc QA adoption", unit: "pct", featureKey: "doc_qa", sortOrder: 8 },
    { key: "adoption", displayName: "Code assist adoption", unit: "pct", featureKey: "code_assist", sortOrder: 9 },
    { key: "adoption", displayName: "Sales email adoption", unit: "pct", featureKey: "sales_email", sortOrder: 10 },
  ];

  const driverRows = await db
    .insert(s.drivers)
    .values(
      driverDefs.map((d) => ({
        orgId: org.id,
        key: d.key,
        displayName: d.displayName,
        unit: d.unit,
        featureKey: d.featureKey,
        isFitted: true,
        sortOrder: d.sortOrder,
        formula: "leaf",
      }))
    )
    .returning();

  // Driver values — weekly for last 12 weeks
  const driverVals: (typeof s.driverValues.$inferInsert)[] = [];
  for (let w = 12; w >= 0; w--) {
    const period = daysAgo(w * 7).toISOString().slice(0, 10);
    for (const d of driverRows) {
      let value = 0;
      if (d.key === "weekly_active_users") value = 12000 + (12 - w) * 80;
      else if (d.key === "adoption" && d.featureKey === "support_copilot") value = 0.18 + (12 - w) * 0.008;
      else if (d.key === "adoption" && d.featureKey === "doc_qa") value = 0.35 + (12 - w) * 0.005;
      else if (d.key === "adoption" && d.featureKey === "code_assist") value = 0.55;
      else if (d.key === "adoption" && d.featureKey === "sales_email") value = 0.12 + (12 - w) * 0.01;
      else if (d.key === "requests_per_active_user") value = 4.5 + rand() * 0.4;
      else if (d.key === "avg_input_tokens") value = 1800;
      else if (d.key === "avg_output_tokens") value = 420;
      else if (d.key === "output_input_ratio") value = 420 / 1800;
      else if (d.key === "cache_hit_rate") value = 0.22;
      driverVals.push({
        driverId: d.id,
        periodStart: period,
        value: String(value),
        source: "fitted",
      });
    }
  }
  await db.insert(s.driverValues).values(driverVals);

  // Scenarios
  const [baseline] = await db
    .insert(s.scenarios)
    .values({
      orgId: org.id,
      name: "Baseline (P50)",
      description: "Fitted drivers, current routing, published prices",
      horizonMonths: 12,
      status: "active",
      createdBy: "system",
    })
    .returning();

  const [switchScenario] = await db
    .insert(s.scenarios)
    .values({
      orgId: org.id,
      name: "Support Copilot → 80/20 Haiku/Sonnet",
      description: "Route 80% of support_copilot to Haiku 3.5, 20% frontier Sonnet",
      horizonMonths: 12,
      baselineScenarioId: baseline.id,
      status: "active",
      createdBy: "demo",
    })
    .returning();

  await db.insert(s.scenarioOverrides).values([
    {
      scenarioId: switchScenario.id,
      overrideType: "routing",
      payload: {
        feature: "support_copilot",
        splits: [
          { sku: "claude-haiku-3.5", pct: 0.8 },
          { sku: "claude-sonnet-4", pct: 0.2 },
        ],
        verbosityMultiplier: 1.05,
        qualityAssumption: "Acceptable for L1 triage; escalate complex to Sonnet",
        latencyAssumption: "Haiku p95 ~40% faster",
        scope: { dimension_type: "team", node_key: "support", include_descendants: true },
      },
    },
  ]);

  const [adoptionScenario] = await db
    .insert(s.scenarios)
    .values({
      orgId: org.id,
      name: "Doc QA adoption 35% → 70%",
      description: "Logistic ramp over 26 weeks",
      horizonMonths: 12,
      baselineScenarioId: baseline.id,
      status: "draft",
      createdBy: "demo",
    })
    .returning();

  await db.insert(s.scenarioOverrides).values({
    scenarioId: adoptionScenario.id,
    overrideType: "adoption",
    payload: {
      feature: "doc_qa",
      curve: "logistic",
      current: 0.35,
      target: 0.7,
      weeks_to_sat: 26,
      scope: { dimension_type: "cost_center", node_key: "cc-220" },
    },
  });

  // Budgets (versioned, hierarchical, one projected-breach child)
  const [orgBudget] = await db
    .insert(s.budgets)
    .values({
      orgId: org.id,
      name: "Org AI monthly",
      amount: "85000",
      period: "monthly",
      scopeType: "org",
      thresholds: [0.5, 0.8, 1.0],
    })
    .returning();

  const [ccBudget, teamBudget] = await db
    .insert(s.budgets)
    .values([
      {
        orgId: org.id,
        name: "CC-220 Product Copilot",
        amount: "35000",
        period: "monthly",
        scopeType: "dimension",
        dimensionTypeId: dtCc.id,
        dimensionNodeId: cc["cc-220"].id,
        includeDescendants: true,
        thresholds: [0.8, 1.0],
        parentBudgetId: orgBudget.id,
      },
      {
        orgId: org.id,
        name: "AI Platform team",
        amount: "12000",
        period: "monthly",
        scopeType: "dimension",
        dimensionTypeId: dtTeam.id,
        dimensionNodeId: team["ai-platform"].id,
        thresholds: [0.8, 1.0],
        parentBudgetId: orgBudget.id,
      },
    ])
    .returning();

  const seedPolicy = [
    { pct: 0.8, action: "advisory_downgrade" as const, recommendedModel: "claude-haiku-3.5" },
    { pct: 1.0, action: "advisory_block" as const, recommendedModel: "claude-haiku-3.5" },
  ];

  for (const b of [orgBudget, ccBudget, teamBudget]) {
    const isOrg = b.id === orgBudget.id;
    const [ver] = await db
      .insert(s.budgetVersions)
      .values({
        budgetId: b.id,
        version: 1,
        amount: b.amount,
        currency: b.currency,
        period: b.period,
        scopeType: b.scopeType,
        dimensionTypeId: b.dimensionTypeId,
        dimensionNodeId: b.dimensionNodeId,
        featureKey: b.featureKey,
        includeDescendants: b.includeDescendants,
        thresholds: b.thresholds,
        policy: seedPolicy,
        effectiveFrom: daysAgo(45),
        effectiveTo: isOrg ? daysAgo(20) : null,
        author: "seed",
        changeNote: "Initial FY26 budget",
      })
      .returning();
    if (!isOrg) {
      await db
        .update(s.budgets)
        .set({ currentVersionId: ver.id })
        .where(eq(s.budgets.id, b.id));
    }
  }

  const [orgV2] = await db
    .insert(s.budgetVersions)
    .values({
      budgetId: orgBudget.id,
      version: 2,
      amount: "85000",
      currency: "USD",
      period: "monthly",
      scopeType: "org",
      thresholds: [0.5, 0.8, 1.0],
      policy: seedPolicy,
      effectiveFrom: daysAgo(20),
      author: "seed",
      changeNote: "Confirmed after Q2 forecast review",
    })
    .returning();
  await db
    .update(s.budgets)
    .set({ currentVersionId: orgV2.id })
    .where(eq(s.budgets.id, orgBudget.id));

  await db.insert(s.budgetAlerts).values({
    budgetId: orgBudget.id,
    thresholdPct: "0.8",
    projectedBreachDate: addDays(new Date(), 18).toISOString().slice(0, 10),
    message: "Org AI monthly budget projected to breach in ~18 days at current run rate",
    policyAction: "advisory_downgrade",
  });

  // Connectors
  const connectorDefs = [
    { provider: "anthropic", tier: 1, status: "healthy", covered: 42, allocated: 86, staleHoursAgo: 0 },
    { provider: "openai", tier: 1, status: "healthy", covered: 28, allocated: 84, staleHoursAgo: 0 },
    { provider: "cursor", tier: 1, status: "healthy", covered: 15, allocated: 100, staleHoursAgo: 0 },
    { provider: "google", tier: 2, status: "stale", covered: 8, allocated: 68, staleHoursAgo: 26 },
    { provider: "perplexity", tier: 4, status: "healthy", covered: 4, allocated: 0, staleHoursAgo: 0 },
    { provider: "replit", tier: 4, status: "disconnected", covered: 0, allocated: 0, staleHoursAgo: null as number | null },
    { provider: "lovable", tier: 4, status: "disconnected", covered: 0, allocated: 0, staleHoursAgo: null as number | null },
    { provider: "aws_bedrock", tier: 2, status: "disconnected", covered: 0, allocated: 0, staleHoursAgo: null as number | null },
    { provider: "azure_openai", tier: 2, status: "disconnected", covered: 0, allocated: 0, staleHoursAgo: null as number | null },
  ];

  for (const c of connectorDefs) {
    const lastSync =
      c.staleHoursAgo == null
        ? null
        : new Date(Date.now() - c.staleHoursAgo * 3600_000);
    const [conn] = await db
      .insert(s.connectors)
      .values({
        orgId: org.id,
        providerId: p[c.provider].id,
        tier: c.tier,
        status: c.status,
        demoMode: c.tier === 1,
        lastSyncedAt: lastSync,
        lastSuccessAt: lastSync,
        backfillProgressPct: c.status === "disconnected" ? "0" : "100",
        spendCoveredPct: String(c.covered),
        allocatedPct: String(c.allocated),
        allocatedByDimension: {
          team: c.allocated,
          business_unit: c.allocated,
          cost_center: Math.max(0, c.allocated - 15),
        },
        healthMessage:
          c.status === "healthy"
            ? "Sync OK"
            : c.status === "stale"
              ? "Last synced 26h ago — numbers may be incomplete"
              : c.status === "degraded"
                ? "Billing export delayed 12h"
                : "Not connected",
        authConfig: c.tier === 1 ? { mode: "api_key", mock: true } : { mode: "export" },
      })
      .returning();

    if (c.status !== "disconnected") {
      await db.insert(s.connectorSyncRuns).values({
        connectorId: conn.id,
        phase: "incremental",
        finishedAt: new Date(),
        rowsIn: 12000,
        rowsWritten: 11950,
        errors: [],
      });
    }
  }

  await db.insert(s.otelIngestKeys).values({
    orgId: org.id,
    keyHash: createHash("sha256").update("meter_demo_otel_key").digest("hex"),
    keyPrefix: "meter_de",
    label: "Demo OTel ingest",
    envTag: "prod",
    createdBy: "seed",
  });

  // System + org mapping templates (WS1a)
  await db.insert(s.mappingTemplates).values([
    {
      orgId: null,
      providerId: p.anthropic.id,
      name: "Anthropic console export",
      sourceFormat: "usage_export",
      isSystem: true,
      columnMap: {
        timestamp: "created_at",
        provider: "_literal:anthropic",
        model: "model",
        meter: "type",
        quantity: "tokens",
        cost: "cost_usd",
        "tags.feature": "workspace",
      },
      sampleHeaders: ["created_at", "model", "type", "tokens", "cost_usd", "workspace"],
    },
    {
      orgId: null,
      providerId: p.openai.id,
      name: "OpenAI usage export",
      sourceFormat: "usage_export",
      isSystem: true,
      columnMap: {
        timestamp: "start_time",
        provider: "_literal:openai",
        model: "model",
        meter: "n_context_tokens_total",
        quantity: "n_context_tokens_total",
        cost: "cost",
        "tags.feature": "project_id",
      },
      sampleHeaders: ["start_time", "model", "n_context_tokens_total", "cost", "project_id"],
    },
    {
      orgId: null,
      providerId: null,
      name: "Generic invoice",
      sourceFormat: "invoice",
      isSystem: true,
      columnMap: {
        timestamp: "period_end",
        provider: "vendor",
        model: "_literal:invoice",
        meter: "_literal:seats",
        quantity: "seats",
        cost: "amount",
        "tags.source": "_literal:invoice",
      },
      sampleHeaders: ["vendor", "period_start", "period_end", "amount", "seats"],
    },
    {
      orgId: null,
      providerId: null,
      name: "Org structure (BU / dept / team)",
      sourceFormat: "org_structure",
      isSystem: true,
      columnMap: {
        node_name: "node_name",
        parent_name: "parent_name",
        dimension_type: "dimension_type",
        cost_center_code: "cost_center_code",
        owner_email: "owner_email",
        node_key: "node_key",
      },
      sampleHeaders: [
        "node_name",
        "parent_name",
        "dimension_type",
        "cost_center_code",
        "owner_email",
        "node_key",
      ],
    },
    {
      orgId: null,
      providerId: null,
      name: "DX AI metrics export",
      sourceFormat: "dx_ai_metrics",
      isSystem: true,
      columnMap: {
        day: "day",
        tool: "tool",
        email: "email",
        display_name: "display_name",
        team_key: "team_key",
        spend: "spend",
        tokens_in: "tokens_in",
        tokens_out: "tokens_out",
        sessions: "sessions",
      },
      sampleHeaders: [
        "day",
        "tool",
        "email",
        "display_name",
        "team_key",
        "spend",
        "tokens_in",
        "tokens_out",
        "sessions",
      ],
    },
  ]);

  // Phase 3 — contributors, mock GitHub PRs, coding-tool daily grains
  console.log("Seeding Phase 3 AI cost (people + PRs + coding tools)…");
  const { upsertContributor } = await import("../lib/contributors/upsert");
  const { seedMockGithubPrs } = await import("../lib/scm/github");
  const { syncCodingToolsDemo } = await import("../lib/connectors/ai-tools-sync");

  const people = [
    { email: "alex@northstar.demo", name: "Alex Chen", github: "alexchen", team: "ai-platform" },
    { email: "jordan@northstar.demo", name: "Jordan Lee", github: "jordanlee", team: "support" },
    { email: "morgan@northstar.demo", name: "Morgan Patel", github: "morganpatel", team: "docs" },
    { email: "sam@northstar.demo", name: "Sam Rivera", github: "samrivera", team: "sales-eng" },
    { email: "riley@northstar.demo", name: "Riley Kim", github: "rileykim", team: "ai-platform" },
    { email: "casey@northstar.demo", name: "Casey Brooks", github: "caseybrooks", team: "docs" },
    { email: "taylor@northstar.demo", name: "Taylor Ng", github: "taylorng", team: "support" },
    { email: "quinn@northstar.demo", name: "Quinn Ortiz", github: "quinnortiz", team: "ai-platform" },
  ];
  const seededContributors = [];
  for (const p of people) {
    const c = await upsertContributor(org.id, {
      email: p.email,
      displayName: p.name,
      githubLogin: p.github,
      dimensionNodeId: team[p.team]?.id ?? null,
    });
    seededContributors.push(c);
  }
  const prSeed = await seedMockGithubPrs(
    org.id,
    seededContributors.map((c) => ({ id: c.id, githubLogin: c.githubLogin })),
    90
  );
  const toolSeed = await syncCodingToolsDemo(org.id, { days: 45 });

  // Quick spend sanity
  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)` })
    .from(s.costRecords)
    .where(eq(s.costRecords.orgId, org.id));

  console.log("Seed complete.");
  console.log(`  Org: ${org.name} (${org.id})`);
  console.log(`  Total effective cost (all history): $${Number(total).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Baseline scenario: ${baseline.id}`);
  console.log(`  Model-switch scenario: ${switchScenario.id}`);
  console.log(`  Workspace token (claim in Orgs): ws_demo_northstar`);
  console.log(`  OTel key: meter_demo_otel_key`);
  console.log(`  Contributors: ${seededContributors.length} · mock PRs: ${prSeed.written} · AI tool grains: ${toolSeed.written}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
