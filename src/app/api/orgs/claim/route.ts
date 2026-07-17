import { NextRequest, NextResponse } from "next/server";
import {
  ORG_COOKIE,
  ORG_COOKIE_MAX_AGE,
  parseWorkspaceRegistry,
  serializeWorkspaceRegistry,
  upsertWorkspaceEntry,
  WS_REGISTRY_COOKIE,
} from "@/lib/org/cookie";
import { findOrgByAccessToken } from "@/lib/org/access";

/**
 * Attach an existing workspace to this browser using its access token.
 * No user accounts — possession of the token is the credential.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = (body.token ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const org = await findOrgByAccessToken(token);
  if (!org) {
    return NextResponse.json({ error: "Invalid workspace token" }, { status: 404 });
  }

  const registry = upsertWorkspaceEntry(
    parseWorkspaceRegistry(req.cookies.get(WS_REGISTRY_COOKIE)?.value),
    { id: org.id, token }
  );

  const res = NextResponse.json({
    ok: true,
    org: { id: org.id, name: org.name, slug: org.slug },
  });
  res.cookies.set(ORG_COOKIE, org.id, {
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
  return res;
}
