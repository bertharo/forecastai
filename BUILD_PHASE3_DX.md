# Build Prompt: Meter Phase 3 — Replace DX for AI Cost & Impact

Copy everything below this line into Claude Code (or Cursor Agent). Run from the existing Meter repo at `/Users/bertharo/forecastai`.

---

You are extending **Meter** (Next.js App Router + TypeScript, Postgres/Neon, Drizzle, Recharts; live at https://forecastai-delta.vercel.app).

## Product goal

Win the **“drop DX for AI spend”** decision — not a full DORA/eng-productivity suite.

Meter becomes the system of record for:

1. AI coding-tool + console spend (Claude / Cursor / Copilot / Codex + existing gateways)
2. Mapping that spend to **people → teams → cost centers**
3. Joining to **GitHub merged PRs** for cost-per-PR and AI-assisted delivery
4. Keeping Meter’s FinOps edge: price cards, scenarios, versioned budgets, allocation triage

**Out of scope for Phase 3:** general DORA dashboards, survey/DX Core 4, non-AI eng productivity, full Auth.js SSO (keep workspace-token model unless a connector needs OAuth).

**Do not start Workstream D (ROI UI) until Workstream C (metrics layer for contributor/team KPIs) has a clear `computeMetric` path — prefer completing Phase 2 WS4 provenance first or landing a minimal `computeMetric` in C before D.**

---

## Current baseline (do not regress)

- Workspace isolation via `access_token_hash` + cookie registry (`meter_ws`) — no cross-workspace leaks
- Anthropic Admin Usage API live when key set; OpenAI/Cursor mock; OTel ingest live
- Hierarchy roll-up, allocation triage, org-structure CSV, versioned budgets
- UI: light pastel shell (Brief / By org / Breakdown / Model a change / Data & sources)
- Schema already has stubs: `users`, `memberships`, `value_metrics`, `value_events`, `seat_snapshots`

Read `FEATURES.md` and `src/db/schema/index.ts` before proposing migrations.

---

## Schema approval first

**Propose the full Phase 3 schema diff and wait for approval before `drizzle-kit push`.** Prefer extending existing tables over inventing parallel concepts.

### Propose (indicative — refine against code)

```text
# People (workspace-scoped identity — not login users)
contributors (
  id, org_id → organizations,
  email text,                 -- primary join key (lowercased unique per org)
  display_name text,
  github_login text,
  github_id text,
  external_ids jsonb,         -- { cursor_user_id, anthropic_user_id, … }
  dimension_node_id → dimension_nodes,  -- default team
  active boolean,
  unique (org_id, email)
)

contributor_team_memberships (  -- time-bounded team assignment
  contributor_id, dimension_node_id, effective_from, effective_to
)

# SCM
scm_connections (
  org_id, provider text,      -- github|gitlab
  installation_id / access token encrypted,
  account_login, status, last_synced_at
)

pull_requests (
  org_id, scm_connection_id,
  external_id, repo, number, title,
  author_contributor_id → contributors,
  merged_at, additions, deletions, ai_assisted boolean null,
  unique (scm_connection_id, repo, number)
)

# AI tool daily grains (DX-shaped, Meter-owned)
ai_tool_daily (
  org_id, day date,
  tool_key text,              -- claude_code|cursor|copilot|codex|anthropic_api|openai_api|…
  contributor_id null,        -- null = unattributed rollup
  dimension_node_id null,     -- team rollup denorm
  spend numeric, tokens_in, tokens_out, tokens_total,
  sessions int, requests int,
  source_connector text,      -- which connector wrote the row
  content_hash text,
  unique (org_id, day, tool_key, contributor_id)  -- treat null contributor as sentinel
)

# Optional session samples for impact (Phase B lite)
ai_sessions (
  org_id, tool_key, contributor_id, started_at,
  use_case text,              -- generate|debug|refactor|docs|unknown
  tokens, spend, pr_external_id null
)
```

Reuse: `connectors` for Cursor/Copilot/Codex/Claude-Enterprise; encrypt credentials with existing `METER_CREDENTIALS_KEY` AES-GCM helper. Extend `allocation_rules.match` to accept `contributor_email`, `github_login`, `tool_key`.

---

## Workstream A — People & GitHub (foundation)

Without this, you cannot replace DX’s mapping story.

### A1. Contributors
- CRUD-lite UI under Workspaces / Settings: list contributors, set default team, bulk CSV (`email, display_name, github_login, team_key`)
- Auto-create contributors from connector payloads when email/login present
- Allocation fallback: contributor.default team → dimension set

### A2. GitHub connector (Tier 1)
- GitHub App **or** fine-grained PAT (document both; ship PAT first if faster)
- Sync: repos (selected), merged PRs for trailing N days (default 90), author → contributor via `github_login` / email from GitHub API when available
- Persist `pull_requests`; idempotent on (connection, repo, number)
- UI: Data & sources card “GitHub” with connect + last sync + PR count

### A3. Cost per merged PR (read path)
- For a period: `sum(ai_tool_daily.spend) / count(merged PRs)` overall and by team
- Surface on Brief as a KPI card + Breakdown “By team” column

**DoD A:** Seed Northstar with ~40 contributors, team links, 90d merged PRs; Brief shows cost/PR when both AI spend and PRs exist; empty workspace shows setup CTAs (connect GitHub, invite/import contributors).

---

## Workstream B — Coding-tool connectors (DX AI source parity)

Ship in this order (highest switcher value first):

### B1. Claude Code / Anthropic (extend existing)
- Keep Admin Usage API for console/API spend
- Add **Claude Enterprise Analytics** path when key has `read:analytics` (users + user_usage + user_cost reports) → `ai_tool_daily` + contributors
- Document when to use Console vs Enterprise vs OTel (mirror DX’s guidance; avoid double-count warnings in UI)

### B2. Cursor
- Live connector (replace mock): usage/spend by user when API available; else documented CSV template + auto-map
- Map Cursor user email → contributors

### B3. GitHub Copilot
- Copilot Metrics + Billing (as available) → spend/credits + CLI tokens where present
- Join to same GitHub connection from A2 when possible

### B4. OpenAI Codex Enterprise
- Platform API + workspace id; tokens first, $ when API provides it
- Honest empty states when OpenAI lacks dollar mapping (same as DX)

### B5. Dedup / source-of-truth
- Per workspace setting: primary source per `tool_key` (e.g. Claude Enterprise wins over Console if both enabled)
- Banner when two sources overlap on same day/tool

**DoD B:** Data & sources shows Live/Demo/Needs-setup for each tool; sync writes `ai_tool_daily`; Breakdown can slice **By tool** and **By contributor**; no double-count without warning.

---

## Workstream C — Team / contributor AI cost report (the DX replacement surface)

### C1. New tab or route: **AI cost** (eng-facing)
- Suggested IA: Home pill **“AI cost”** or sidebar under Plan — pick one, keep shell consistent
- Controls: date range, team tree picker (reuse subtree roll-up), tool multi-select
- KPIs: total spend, tokens, active contributors, cost/PR, WoW deltas
- Charts: spend over time by tool; table by team; table by contributor (sortable)
- All KPIs go through **`computeMetric()`** (land minimal provenance here if Phase 2 WS4 not done — `{ value, trace }` with formula + window + filters + freshness)

### C2. Brief integration
- Replace persona fluff with real drivers: top teams by spend, top tools, cost/PR, unallocated coding-tool spend
- Empty states when no `ai_tool_daily`

### C3. Allocation bridge
- “Create rule from contributor pattern” → allocation_rules
- Unattributed AI tool spend appears in `/allocation` clusters (`tool_key`, missing email)

**DoD C:** Northstar demo shows a DX-like AI cost view with team/contributor drill-down and cost/PR; provenance hover on KPIs.

---

## Workstream D — Migration off DX

- Import path: CSV/JSON matching DX `aiToolMetrics`-style rows → `ai_tool_daily` + contributors
- Documented mapping guide: “Export from DX → Meter”
- Optional: API stub `POST /api/connectors/dx/import` for future partner pull
- One-click “I’ve moved off DX” checklist in Data & sources (connectors connected, GitHub synced, cost/PR visible, budgets set)

**DoD D:** Fixture file in repo + import template; README section “Migrating from DX”.

---

## Workstream E — Seed, UX polish, DoD

- Extend Northstar seed: contributors, GitHub PRs, `ai_tool_daily` for claude_code + cursor + copilot (~90d), overlapping days for dedup demo
- Data & sources primary CTAs: **Connect GitHub**, **Connect Claude**, **Connect Cursor** — CSV mapper demoted to “Don’t have API access?”
- Usage import: auto-pick **usage** template from headers (never default to org-structure on usage files)
- FEATURES.md + BUILD notes updated
- Workspace isolation preserved (all new tables `org_id`; APIs use `getCurrentOrg()`; no `?org=` IDOR)

---

## Non-goals (explicit)

- Rebuilding DX Core surveys, deployment frequency product suite, issue trackers beyond PR merge join
- Real-time streaming
- Reading customer source code from GitHub (metadata + PR stats only)
- Forcing Auth.js before workspace tokens (OAuth for GitHub App is fine)

---

## Implementation order

```text
Schema proposal → approve → migrate
A (people + GitHub + cost/PR)
B1 Claude Enterprise/extend → B2 Cursor → B3 Copilot → B4 Codex → B5 dedup
C (AI cost report + computeMetric on KPIs + Brief)
D (DX migration import)
E (seed + UX + docs)
```

Ship vertical slices that demo on Northstar after A+B1+C skeleton.

---

## Acceptance checklist (Phase 3 done)

- [ ] New workspace: connect GitHub + Claude key → see team spend without CSV
- [ ] Contributor ↔ team mapping works from sync + CSV
- [ ] AI cost view: by tool / team / contributor + cost per merged PR
- [ ] Cursor + Copilot connectors live or honest stub with working CSV template
- [ ] Dedup warning when two Claude sources overlap
- [ ] DX migration fixture imports history
- [ ] Workspace isolation tests / manual checklist pass
- [ ] Prod Neon schema + seed + Vercel deploy

---

## Positioning copy (for UI empty states)

> Meter is the system of record for **AI investment**: coding tools and app inference, mapped to your teams, forecasted and budgeted — with cost-per-PR when GitHub is connected. Connect Claude and GitHub to replace a DX-only AI cost setup.

---

End of build prompt.
