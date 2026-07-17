# Meter — Product status (Phase 2 + Phase 3 AI cost)

**Live:** https://forecastai-delta.vercel.app  
**Repo:** https://github.com/bertharo/forecastai  
**Stack:** Next.js App Router · TypeScript · Postgres (Neon) · Drizzle · Recharts · Vercel  

Demo org: **Northstar Analytics** — ~6 months seeded spend (~$76k effective), hierarchy, budgets, connectors, unallocated clusters, **contributors + mock GitHub PRs + coding-tool AI cost grains**.

---

## Quick demo path

1. Open [Home / Brief](https://forecastai-delta.vercel.app/) — forecast + AI cost/PR KPI  
2. [AI cost](https://forecastai-delta.vercel.app/ai-cost) — coding-tool spend by tool / team / person; click KPIs for provenance  
3. [Connectors](https://forecastai-delta.vercel.app/connectors) — people CSV, GitHub PAT/demo PRs, Claude/Cursor sync, DX CSV import  
4. Filter org slice with the **tree picker** (BU → dept → team); parent nodes roll up subtree  
5. [Allocation](https://forecastai-delta.vercel.app/allocation) — cluster unallocated spend → assign or create rule  
6. [Budgets](https://forecastai-delta.vercel.app/budgets) — burn-down, P50 breach, reallocate  
7. [Import](https://forecastai-delta.vercel.app/import) — usage CSV + org-structure CSV  
8. [Onboarding](https://forecastai-delta.vercel.app/onboarding) — create / claim a workspace  

```bash
# Smoke OTel ingest (Northstar demo key)
curl -X POST https://forecastai-delta.vercel.app/api/otel/v1/traces \
  -H 'content-type: application/json' \
  -H 'x-meter-key: meter_demo_otel_key' \
  -d '{
    "spans": [{
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-sonnet-4",
      "gen_ai.usage.input_tokens": 1200,
      "gen_ai.usage.output_tokens": 400,
      "tags": { "feature": "support_copilot", "team": "support" }
    }]
  }'
```

---

## Product surfaces

| Route | What it does |
|-------|----------------|
| `/` **Home** | Brief / By org / Breakdown. Forecast vs plan, **AI cost per merged PR** (provenance), attention cards. |
| `/ai-cost` **AI cost** | Coding-tool spend by tool / team / contributor; cost/PR via `computeMetric`; Claude/demo sync. |
| `/forecast` **Forecast** | Driver tree × prices × adoption → P10/P50/P90 fan chart (180d). |
| `/scenarios` **Scenarios** | Baseline vs overrides; commitment optimizer panel. |
| `/model-switch` **Model Switch** | Interactive routing + verbosity; quality/latency notes required. |
| `/price-cards` **Price Cards** | Versioned cards + Anthropic cut diff. |
| `/budgets` **Budgets** | Versioned control plane: burn-down (actual / pro-rata / P50), projected breach, status, reallocate, version history, alerts. |
| `/allocation` **Allocation** | Unallocated spend clustered by provider/model/feature/api_key/source; bulk select; assign once or create retroactive rule (preview Δ allocated %). |
| `/import` **Import** | CSV/JSONL usage import (templates, preview, rollback) + org-structure hierarchy CSV. Auto-selects usage template (not org-structure) from headers. |
| `/connectors` **Sources** | Billing connectors + **people**, **GitHub**, **coding tools**, **DX CSV import**, OTel keys, gateway snippets. |
| `/onboarding` **Workspaces** | Create / claim workspace → dimensions → OTel key → test span. |

---

## Filtering (Spend & Forecast)

| Control | Param | Notes |
|---------|--------|--------|
| Metric | `metric` | `spend` · `consumption` · `adoption` (Spend only) |
| Org slice type | `dim` | `business_unit` · `department` · `team` · `cost_center` |
| Slice node | `node` | UUID — **tree picker**; filter includes **subtree** via materialized `path` |
| Provider | `provider` | e.g. `anthropic` |
| Model / SKU | `model` | e.g. `claude-sonnet-4` |
| Feature | `feature` | e.g. `support_copilot` |

---

## Workspaces (no user accounts yet)

- Each person **creates a workspace** under **Workspaces** — data (spend, budgets, connectors, imports) is scoped to that workspace only  
- Browser stores an httpOnly **workspace registry** (`meter_ws`) of `{ id, token }`; only those workspaces appear in the switcher  
- Access token shown **once** at create — paste it on another browser via **Open an existing workspace** (`POST /api/orgs/claim`)  
- No URL `?org=` override; no “fall back to first org in the DB”  
- Demo Northstar (after seed): claim with token `ws_demo_northstar`  
- Hierarchy: **BU → department → team** + flat **cost centers**  
- Org-structure CSV + IdP adapter contract (Okta/Workday sync not live)

---

## Telemetry & connectors

### OTel GenAI ingest (live)

```http
POST /api/otel/v1/traces
Header: x-meter-key: <key>
```

Writes **usage events + cost records + dimension allocations** (tag rules + type-key fallbacks).

| | |
|--|--|
| Demo key (Northstar) | `meter_demo_otel_key` |
| New orgs | Key shown once in Onboarding |
| Key APIs | `GET/POST /api/otel/keys`, `POST /api/otel/keys/[id]/revoke` |

Tag spans with `feature`, `team` (and optionally department / cost center keys) so allocation rules fire.

### Connector tiers

| Tier | Meaning | Status |
|------|---------|--------|
| 1 | Native API pull | Anthropic: **live Admin Usage API** when key set, else demo mock. OpenAI / Cursor: mock sync. |
| 2 | Billing export + mapper | Google / Bedrock / Azure — stubs |
| 3 | OTel / push | **Working** |
| 4 | Invoice / seat | Perplexity mock / others stub |

Credentials encrypted at rest (AES-GCM; `METER_CREDENTIALS_KEY` or dev default). Staleness threshold → Spend banner.

---

## Budgets (control plane)

- Every edit → new **budget version** (`effective_from`, author, change note, policy)  
- **Reallocate** $ from A → B in one linked group (shared-parent check)  
- Hierarchy warning if child amount > parent (soft)  
- Burn-down: cumulative actual vs pro-rata vs P50 band (from scoped daily rate + residual CV)  
- Status: `ok` · `warn` · `projected-breach` · `exceeded`  
- Threshold crossings → `budget_alerts` + in-app `notifications` (+ org webhook POST stub)  
- **Gateway hook:** `GET /api/budgets/status?team=&feature=` reads materialized snapshots (auto-refresh if >15m stale)

Meter recommends (`advisory_downgrade` / `advisory_block` + `recommended_model`); the customer gateway enforces.

---

## Allocation triage

1. Cluster last-30d **unallocated** cost by shared attributes  
2. Select cluster(s) → pick dimension node  
3. **Assign once** (no rule) or **Preview rule** → show allocated % before/after → **Create rule + apply** retroactively  
4. Applications logged in `allocation_rule_applications` + audit log  

Seed includes ~15% unallocated plus clustered patterns (`shadow_eval` / LiteLLM, batch rewrite, Portkey gateway) for demos.

---

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/spend/summary` | Spend KPIs (+ filter query params) |
| `GET` | `/api/connectors` | List connectors |
| `POST` | `/api/connectors/[provider]/sync` | Sync (`anthropic` \| `openai` \| `cursor`) |
| `POST` | `/api/connectors/[provider]/credentials` | Store encrypted API key |
| `POST` | `/api/otel/v1/traces` | Ingest GenAI spans |
| `GET`/`POST` | `/api/otel/keys` | List / create ingest keys |
| `POST` | `/api/otel/keys/[id]/revoke` | Revoke key |
| `POST` | `/api/forecast/project` | Run forecast projection |
| `POST` | `/api/scenarios/model-switch` | Model-switch delta |
| `GET`/`POST` | `/api/orgs` | List / create org (+ OTel key) |
| `POST` | `/api/orgs/switch` | Set current org cookie |
| `GET`/`POST` | `/api/import` | Usage CSV preview / import |
| `POST` | `/api/import/[batchId]/rollback` | Rollback import batch |
| `GET`/`POST` | `/api/org-structure` | Hierarchy CSV preview / commit |
| `GET` | `/api/allocation/clusters` | Unallocated clusters + trend |
| `POST` | `/api/allocation/assign` | One-off assign |
| `GET`/`POST` | `/api/allocation/rules` | List / preview / apply rules |
| `GET` | `/api/budgets/status` | Fast gateway status |
| `GET`/`POST` | `/api/budgets` | Refresh / version / reallocate |
| `GET`/`POST` | `/api/contributors` | List / upsert / CSV people |
| `GET`/`POST` | `/api/scm/github` | GitHub PAT connect / live sync / demo PRs |
| `POST` | `/api/ai-tools/sync` | Coding-tool demo / Claude / DX CSV |
| `GET` | `/api/ai-cost/summary` | AI cost KPIs + breakdowns |

---

## AI cost (Phase 3 — DX replacement path)

Win **“drop DX for AI spend”** — not full DORA.

1. **People** (`contributors`) mapped to teams  
2. **Coding-tool daily grains** (`ai_tool_daily`) from Claude/Cursor/Copilot demo, Anthropic Admin, or DX CSV  
3. **GitHub merged PRs** → cost per PR (`computeMetric` + clickable `<Metric>` provenance)  
4. Overlap warning when multiple sources write the same tool/day  

Fixtures: `fixtures/contributors.csv`, `fixtures/dx-ai-metrics.csv` (see `fixtures/README.md`).

---

## Data model (highlights)

- **Meter** abstraction (not token-hardcoded)  
- **FOCUS-aligned** cost/usage fields  
- Per-org **dimension types/nodes** (`parent_id`, materialized `path`, `cost_center_code`, `owner_email`)  
- **Allocation rules** — tag match → dimension set; retroactive applications  
- **Import batches** — content-hash idempotency + rollback  
- **Price cards** — versioned, time-travel pricing  
- Forecast **drivers**, **scenarios**, **commitments**  
- **Budgets** + versions + status snapshots + alerts  
- **Phase 3:** `contributors`, `scm_connections`, `pull_requests`, `ai_tool_daily`, `ai_sessions`, `ai_tool_source_prefs`  
- Stubbed for later: `users` / `memberships` / `audit_logs`, `value_metrics` / `value_events`, `org_webhooks`

---

## Phase progress

| Workstream | Status |
|------------|--------|
| **WS1** Real data paths (import, Anthropic live, OTel keys) | Done |
| **WS2** Hierarchy roll-up, tree picker, allocation triage, org CSV | Done |
| **WS3** Versioned budgets, burn-down, status API, alerts | Done |
| **Phase 3A** Contributors + GitHub + cost/PR | Done |
| **Phase 3B** Coding-tool connectors → `ai_tool_daily` | Done (demo + Claude Admin fallback) |
| **Phase 3C** AI cost report + Brief + `computeMetric` / `<Metric>` | Done (minimal provenance) |
| **Phase 3D** DX CSV import + fixtures | Done |
| **WS5** Value metrics / ROI (`/roi`) | Next (provenance path exists for AI KPIs) |
| **WS6** Auth.js / RBAC / `/audit` / `DEMO_MODE` | Not started |

Prod: push Phase 3 schema + re-seed Northstar after deploy (`drizzle-kit push` + `npm run db:seed`).

---

## Local vs prod

| | Local | Production |
|--|-------|------------|
| App | `npm run dev` → http://127.0.0.1:3000 | https://forecastai-delta.vercel.app |
| DB | Homebrew / Docker Postgres | Neon (`DATABASE_URL` on Vercel) |
| Setup | `npm run db:setup` | Schema + seed already applied |

```bash
cp .env.example .env
npm install
npm run db:setup   # ensure Postgres, drizzle push, seed
npm run dev
```

Optional: `METER_CREDENTIALS_KEY` for connector credential encryption (dev has a default).

---

## Not built yet

- Auth / SSO / roles (WS6)  
- Full ROI / value metrics UI (WS5) — AI cost provenance is live; broader ROI not  
- Live Cursor / Copilot enterprise APIs (demo grains today)  
- Meter billing for tenants  
- Real-time streaming (batch/hourly is fine)  
- Model quality evals / full DORA  
- Full hyperscaler CUR / Azure / GCP adapters (stubs only)  
- Live Okta / Workday org sync (CSV + adapter contract only)
