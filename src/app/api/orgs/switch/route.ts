import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/queries/org";
import { ORG_COOKIE, ORG_COOKIE_MAX_AGE } from "@/lib/org/cookie";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { orgId?: string };
  if (!body.orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const org = await getOrgById(body.orgId);
  if (!org) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, org: { id: org.id, slug: org.slug } });
  res.cookies.set(ORG_COOKIE, org.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });
  return res;
}
