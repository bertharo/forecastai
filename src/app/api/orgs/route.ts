import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg, getOrgById, listWorkspacesWithStats } from "@/lib/queries/org";
import {
  ORG_COOKIE,
  ORG_COOKIE_MAX_AGE,
  parseWorkspaceRegistry,
  serializeWorkspaceRegistry,
  upsertWorkspaceEntry,
  type WorkspaceEntry,
  WS_REGISTRY_COOKIE,
} from "@/lib/org/cookie";
import {
  hashWorkspaceToken,
  mintWorkspaceToken,
  verifyWorkspaceAccess,
} from "@/lib/org/access";
import { deleteOrganization } from "@/lib/org/delete";
import { asc, eq } from "drizzle-orm";

/** After deleting the active workspace, pick another this browser can open. */
async function pickFallbackOrgId(
  registry: WorkspaceEntry[]
): Promise<string | null> {
  for (const entry of registry) {
    if (await verifyWorkspaceAccess(entry.id, entry.token)) {
      return entry.id;
    }
  }
  const [open] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.isPrivate, false))
    .orderBy(asc(s.organizations.name))
    .limit(1);
  return open?.id ?? null;
}

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
  const [orgs, current] = await Promise.all([
    listWorkspacesWithStats(),
    getCurrentOrg(),
  ]);
  return NextResponse.json({
    orgs: orgs.map((o) => ({
      ...o,
      createdAt:
        o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt,
      sampleDataLoadedAt:
        o.sampleDataLoadedAt instanceof Date
          ? o.sampleDataLoadedAt.toISOString()
          : o.sampleDataLoadedAt,
    })),
    currentOrgId: current?.id ?? null,
  });
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

/**
 * Permanently delete a workspace and all org-scoped data.
 * Open workspaces: anyone who can list them. Private: requires claimed token.
 */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    orgId?: string;
    /** Client must send true after an explicit confirm dialog. */
    confirmed?: boolean;
  };
  const orgId = body.orgId?.trim();
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json(
      { error: "Confirmation required. Delete was not confirmed." },
      { status: 400 }
    );
  }

  const org = await getOrgById(orgId);
  if (!org) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }

  const registry = parseWorkspaceRegistry(
    req.cookies.get(WS_REGISTRY_COOKIE)?.value
  );

  if (org.isPrivate) {
    const entry = registry.find((e) => e.id === orgId);
    if (!entry) {
      return NextResponse.json(
        {
          error:
            "This workspace is private. Open it with a workspace token before deleting.",
        },
        { status: 403 }
      );
    }
    const ok = await verifyWorkspaceAccess(entry.id, entry.token);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid workspace access" },
        { status: 403 }
      );
    }
  }

  await deleteOrganization(orgId);

  const nextRegistry = registry.filter((e) => e.id !== orgId);
  const currentCookie = req.cookies.get(ORG_COOKIE)?.value;
  const wasCurrent = currentCookie === orgId;
  const nextOrgId = wasCurrent
    ? await pickFallbackOrgId(nextRegistry)
    : currentCookie && currentCookie !== orgId
      ? currentCookie
      : null;

  const res = NextResponse.json({
    ok: true,
    deletedOrgId: orgId,
    currentOrgId: nextOrgId,
  });

  res.cookies.set(WS_REGISTRY_COOKIE, serializeWorkspaceRegistry(nextRegistry), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });

  if (nextOrgId) {
    res.cookies.set(ORG_COOKIE, nextOrgId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: ORG_COOKIE_MAX_AGE,
    });
  } else if (wasCurrent) {
    res.cookies.set(ORG_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return res;
}
