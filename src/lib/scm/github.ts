import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import {
  findContributorByGithub,
  upsertContributor,
} from "@/lib/contributors/upsert";

type GhPr = {
  id: number;
  number: number;
  title: string;
  merged_at: string | null;
  user: { login: string; id: number } | null;
  additions?: number;
  deletions?: number;
};

async function ghFetch(token: string, path: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "meter-forecastai",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function saveGithubPat(orgId: string, token: string, accountLogin?: string) {
  const enc = encryptSecret(token);
  const [existing] = await db
    .select()
    .from(s.scmConnections)
    .where(
      and(eq(s.scmConnections.orgId, orgId), eq(s.scmConnections.provider, "github"))
    )
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(s.scmConnections)
      .set({
        credentialsEncrypted: enc.ciphertext,
        credentialsKeyId: enc.keyId,
        accountLogin: accountLogin ?? existing.accountLogin,
        status: "healthy",
        lastError: null,
      })
      .where(eq(s.scmConnections.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(s.scmConnections)
    .values({
      orgId,
      provider: "github",
      accountLogin: accountLogin ?? null,
      status: "healthy",
      credentialsEncrypted: enc.ciphertext,
      credentialsKeyId: enc.keyId,
    })
    .returning();
  return row;
}

export async function syncGithubMergedPrs(
  orgId: string,
  opts?: { days?: number; repos?: string[] }
) {
  const [conn] = await db
    .select()
    .from(s.scmConnections)
    .where(
      and(eq(s.scmConnections.orgId, orgId), eq(s.scmConnections.provider, "github"))
    )
    .limit(1);

  if (!conn?.credentialsEncrypted) {
    throw new Error("GitHub not connected — paste a PAT first");
  }

  const token = decryptSecret(conn.credentialsEncrypted);
  const days = opts?.days ?? 90;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = since.toISOString();

  let repos = opts?.repos?.length
    ? opts.repos
    : ((conn.selectedRepos as string[] | null) ?? []);

  if (!repos.length) {
    // Discover user/org repos (first page)
    const me = (await ghFetch(token, "/user")) as { login: string };
    await db
      .update(s.scmConnections)
      .set({ accountLogin: me.login })
      .where(eq(s.scmConnections.id, conn.id));

    const list = (await ghFetch(
      token,
      `/user/repos?per_page=30&sort=pushed&affiliation=owner,organization_member`
    )) as { full_name: string }[];
    repos = list.map((r) => r.full_name).slice(0, 15);
    await db
      .update(s.scmConnections)
      .set({ selectedRepos: repos })
      .where(eq(s.scmConnections.id, conn.id));
  }

  let written = 0;
  for (const repo of repos) {
    const q = encodeURIComponent(
      `repo:${repo} is:pr is:merged merged:>=${sinceIso.slice(0, 10)}`
    );
    const search = (await ghFetch(
      token,
      `/search/issues?q=${q}&per_page=50`
    )) as { items: { number: number; title: string; user: { login: string; id: number } | null; pull_request?: { merged_at?: string } }[] };

    for (const item of search.items ?? []) {
      let additions = 0;
      let deletions = 0;
      let mergedAt = item.pull_request?.merged_at ?? null;
      try {
        const pr = (await ghFetch(
          token,
          `/repos/${repo}/pulls/${item.number}`
        )) as GhPr;
        additions = pr.additions ?? 0;
        deletions = pr.deletions ?? 0;
        mergedAt = pr.merged_at;
      } catch {
        /* search hit is enough */
      }

      let contributorId: string | null = null;
      const login = item.user?.login?.toLowerCase();
      if (login) {
        let c = await findContributorByGithub(orgId, login);
        if (!c) {
          c = await upsertContributor(orgId, {
            email: `${login}@users.noreply.github.com`,
            displayName: login,
            githubLogin: login,
            githubId: item.user ? String(item.user.id) : null,
          });
        }
        contributorId = c.id;
      }

      const existing = await db
        .select({ id: s.pullRequests.id })
        .from(s.pullRequests)
        .where(
          and(
            eq(s.pullRequests.scmConnectionId, conn.id),
            eq(s.pullRequests.repo, repo),
            eq(s.pullRequests.number, item.number)
          )
        )
        .limit(1);

      const values = {
        orgId,
        scmConnectionId: conn.id,
        externalId: String(item.number),
        repo,
        number: item.number,
        title: item.title ?? "",
        authorContributorId: contributorId,
        authorLogin: login ?? null,
        mergedAt: mergedAt ? new Date(mergedAt) : null,
        additions,
        deletions,
      };

      if (existing[0]) {
        await db
          .update(s.pullRequests)
          .set(values)
          .where(eq(s.pullRequests.id, existing[0].id));
      } else {
        await db.insert(s.pullRequests).values(values);
      }
      written++;
    }
  }

  await db
    .update(s.scmConnections)
    .set({ lastSyncedAt: new Date(), status: "healthy", lastError: null })
    .where(eq(s.scmConnections.id, conn.id));

  return { written, repos: repos.length };
}

/** Demo sync without calling GitHub — used when no PAT / demo mode. */
export async function seedMockGithubPrs(
  orgId: string,
  contributors: { id: string; githubLogin: string | null }[],
  days = 90
) {
  let conn = (
    await db
      .select()
      .from(s.scmConnections)
      .where(
        and(eq(s.scmConnections.orgId, orgId), eq(s.scmConnections.provider, "github"))
      )
      .limit(1)
  )[0];

  if (!conn) {
    [conn] = await db
      .insert(s.scmConnections)
      .values({
        orgId,
        provider: "github",
        accountLogin: "northstar-demo",
        status: "healthy",
        selectedRepos: ["northstar/app", "northstar/api"],
      })
      .returning();
  }

  let n = 0;
  for (let d = 0; d < days; d++) {
    if (d % 3 !== 0) continue;
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - d);
    const author = contributors[d % Math.max(1, contributors.length)];
    const repo = d % 2 === 0 ? "northstar/app" : "northstar/api";
    const number = 1000 + d;
    const existing = await db
      .select({ id: s.pullRequests.id })
      .from(s.pullRequests)
      .where(
        and(
          eq(s.pullRequests.scmConnectionId, conn.id),
          eq(s.pullRequests.repo, repo),
          eq(s.pullRequests.number, number)
        )
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(s.pullRequests).values({
        orgId,
        scmConnectionId: conn.id,
        externalId: String(number),
        repo,
        number,
        title: `feat: demo change ${number}`,
        authorContributorId: author?.id ?? null,
        authorLogin: author?.githubLogin ?? "demo",
        mergedAt: day,
        additions: 40 + (d % 80),
        deletions: 10 + (d % 20),
        aiAssisted: d % 4 !== 0,
      });
      n++;
    }
  }
  await db
    .update(s.scmConnections)
    .set({ lastSyncedAt: new Date(), status: "healthy" })
    .where(eq(s.scmConnections.id, conn.id));
  return { written: n };
}
