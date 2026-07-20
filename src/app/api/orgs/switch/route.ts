import { NextRequest, NextResponse } from "next/server";
import {
  ORG_COOKIE,
  ORG_COOKIE_MAX_AGE,
  parseWorkspaceRegistry,
  WS_REGISTRY_COOKIE,
} from "@/lib/org/cookie";
import { verifyWorkspaceAccess } from "@/lib/org/access";
import { getOrgById } from "@/lib/queries/org";

/** Switch active workspace — open ones are free; private ones need a claimed token. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { orgId?: string };
  if (!body.orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }

  const org = await getOrgById(body.orgId);
  if (!org) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }

  if (org.isPrivate) {
    const registry = parseWorkspaceRegistry(
      req.cookies.get(WS_REGISTRY_COOKIE)?.value
    );
    const entry = registry.find((e) => e.id === body.orgId);
    if (!entry) {
      return NextResponse.json(
        {
          error:
            "This workspace is private. Open it with a workspace token first.",
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

  const res = NextResponse.json({
    ok: true,
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      isPrivate: org.isPrivate,
    },
  });
  res.cookies.set(ORG_COOKIE, org.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });
  return res;
}
