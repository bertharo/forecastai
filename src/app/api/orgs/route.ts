import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg, listOrgs } from "@/lib/queries/org";
import {
  ORG_COOKIE,
  ORG_COOKIE_MAX_AGE,
  parseWorkspaceRegistry,
  serializeWorkspaceRegistry,
  upsertWorkspaceEntry,
  WS_REGISTRY_COOKIE,
} from "@/lib/org/cookie";
import { hashWorkspaceToken, mintWorkspaceToken } from "@/lib/org/access";
import { eq } from "drizzle-orm";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function setWorkspaceCookies(
  res: NextResponse,
  req: NextRequest,
  entry: { id: string; token: string }
) {
  const registry = upsertWorkspaceEntry(
    parseWorkspaceRegistry(req.cookies.get(WS_REGISTRY_COOKIE)?.value),
    entry
  );
  res.cookies.set(ORG_COOKIE, entry.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });
  res.cookies.set(WS_REGISTRY_COOKIE, serializeWorkspaceRegistry(registry), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });
}

/** List open workspaces plus private ones this browser has claimed. */
export async function GET() {
  const [orgs, current] = await Promise.all([listOrgs(), getCurrentOrg()]);
  return NextResponse.json({ orgs, currentOrgId: current?.id ?? null });
}

/** Create a workspace (shared by default) + access token (shown once). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    slug?: string;
    isPrivate?: boolean;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const isPrivate = body.isPrivate === true;
  let slug = (body.slug ?? slugify(name)).trim() || slugify(name);

  const [slugTaken] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, slug))
    .limit(1);
  if (slugTaken) {
    slug = `${slug}-${randomBytes(2).toString("hex")}`;
  }

  const accessToken = mintWorkspaceToken();
  const [org] = await db
    .insert(s.organizations)
    .values({
      name,
      slug,
      isPrivate,
      accessTokenHash: hashWorkspaceToken(accessToken),
    })
    .returning();

  const dimDefs = [
    { key: "business_unit", displayName: "Business unit", hierarchical: true, order: 0 },
    { key: "department", displayName: "Department", hierarchical: true, order: 1 },
    { key: "team", displayName: "Team", hierarchical: true, order: 2 },
    { key: "cost_center", displayName: "Cost center", hierarchical: false, order: 3 },
  ];

  const typeIds: Record<string, string> = {};
  for (const d of dimDefs) {
    const [t] = await db
      .insert(s.dimensionTypes)
      .values({
        orgId: org.id,
        key: d.key,
        displayName: d.displayName,
        isHierarchical: d.hierarchical,
        sortOrder: d.order,
      })
      .returning();
    typeIds[d.key] = t.id;
  }

  const [buProduct] = await db
    .insert(s.dimensionNodes)
    .values({
      orgId: org.id,
      dimensionTypeId: typeIds.business_unit,
      key: "product",
      displayName: "Product",
      path: "/product",
    })
    .returning();
  const [deptSupport] = await db
    .insert(s.dimensionNodes)
    .values({
      orgId: org.id,
      dimensionTypeId: typeIds.department,
      key: "product-support",
      displayName: "Product Support",
      parentId: buProduct.id,
      path: "/product/product-support",
    })
    .returning();
  await db.insert(s.dimensionNodes).values([
    {
      orgId: org.id,
      dimensionTypeId: typeIds.business_unit,
      key: "platform",
      displayName: "Platform",
      path: "/platform",
    },
    {
      orgId: org.id,
      dimensionTypeId: typeIds.team,
      key: "ai-platform",
      displayName: "AI Platform",
      path: "/platform/ai-platform",
    },
    {
      orgId: org.id,
      dimensionTypeId: typeIds.team,
      key: "support",
      displayName: "Support",
      parentId: deptSupport.id,
      path: "/product/product-support/support",
    },
    {
      orgId: org.id,
      dimensionTypeId: typeIds.cost_center,
      key: "cc-100",
      displayName: "CC-100",
      path: "/cc-100",
      costCenterCode: "CC-100",
    },
  ]);

  await db.insert(s.allocationRules).values({
    orgId: org.id,
    name: "Feature → Support (starter)",
    priority: 100,
    match: { feature: "support_copilot" },
    set: {
      team: "support",
      cost_center: "cc-100",
      business_unit: "product",
      department: "product-support",
    },
  });

  const rawKey = `meter_${slug}_${randomBytes(12).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  await db.insert(s.otelIngestKeys).values({
    orgId: org.id,
    keyHash,
    keyPrefix: rawKey.slice(0, 10),
    label: "Primary OTel ingest",
    envTag: "prod",
    createdBy: "onboarding",
  });

  const providers = await db.select().from(s.providers);
  for (const p of providers.filter((x) =>
    ["anthropic", "openai", "cursor"].includes(x.key)
  )) {
    try {
      await db.insert(s.connectors).values({
        orgId: org.id,
        providerId: p.id,
        tier: 1,
        status: "never_synced",
        authConfig: { mock: true },
        spendCoveredPct: "0",
        demoMode: true,
      });
    } catch {
      /* ignore */
    }
  }

  const res = NextResponse.json({
    ok: true,
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      isPrivate: org.isPrivate,
    },
    otelKey: rawKey,
    /** Shown once — required to reopen private workspaces on another browser. */
    workspaceToken: accessToken,
  });
  setWorkspaceCookies(res, req, { id: org.id, token: accessToken });
  return res;
}
