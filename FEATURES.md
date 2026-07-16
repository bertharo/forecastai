# Meter — Product & Phase 2 status

**Live:** https://forecastai-delta.vercel.app  
**Repo:** https://github.com/bertharo/forecastai  
**Stack:** Next.js App Router · TypeScript · Postgres (Neon) · Drizzle · Recharts · Vercel  

Demo org: **Northstar Analytics** — ~6 months seeded spend (~$76k effective), hierarchy, budgets, connectors, unallocated clusters.

---

## Quick demo path

1. Open [Spend](https://forecastai-delta.vercel.app/) — KPIs, filters, allocation sparkline  
2. Filter org slice with the **tree picker** (BU → dept → team); parent nodes roll up subtree  
3. [Allocation](https://forecastai-delta.vercel.app/allocation) — cluster unallocated spend → assign or create rule  
4. [Budgets](https://forecastai-delta.vercel.app/budgets) — burn-down, P50 breach, reallocate  
5. [Connectors](https://forecastai-delta.vercel.app/connectors) — OTel keys, gateway snippets, Anthropic key form  
6. [Import](https://forecastai-delta.vercel.app/import) — usage CSV + org-structure CSV  
7. [Onboarding](https://forecastai-delta.vercel.app/onboarding) — create a new org end-to-end  

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
| `/` **Spend** | MTD / run rate / budget used / % allocated (+ 30d sparkline, per-connector %). Breakdowns by provider, model, feature, team. 60d stacked chart, anomalies, Cursor seat util. Stale-connector banner. |
| `/forecast` **Forecast** | Driver tree × prices × adoption → P10/P50/P90 fan chart (180d). |
| `/scenarios` **Scenarios** | Baseline vs overrides; commitment optimizer panel. |
| `/model-switch` **Model Switch** | Interactive routing + verbosity; quality/latency notes required. |
| `/price-cards` **Price Cards** | Versioned cards + Anthropic cut diff. |
| `/budgets` **Budgets** | Versioned control plane: burn-down (actual / pro-rata / P50), projected breach, status, reallocate, version history, alerts. |
| `/allocation` **Allocation** | Unallocated spend clustered by provider/model/feature/api_key/source; bulk select; assign once or create retroactive rule (preview Δ allocated %). |
| `/import` **Import** | CSV/JSONL usage import (templates, preview, rollback) + org-structure hierarchy CSV. |
| `/connectors` **Connectors** | Tier badges, sync status, Anthropic live/demo sync + encrypted key, OTel key lifecycle, LiteLLM/Portkey/Helicone snippets. |
| `/onboarding` **Onboarding** | Create org → dimensions (+ org CSV) → OTel key → test span. |

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

## Organizations & hierarchy

- Multi-org via cookie `meter_org` + sidebar switcher  
- Northstar hierarchy: **BU → department → team** + flat **cost centers** (codes + owner emails)  
- Org-structure CSV: `node_name, parent_name, dimension_type, cost_center_code, owner_email`  
  - Validates cycles/orphans, previews tree, then commits  
  - IdP adapter contract documented for future Okta/Workday (not live sync yet)  
- New orgs via Onboarding get starter dims + OTel key (shown once)

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
- Stubbed for later: `users` / `memberships` / `audit_logs`, `value_metrics` / `value_events`, `org_webhooks`

---

## Phase 2 progress

| Workstream | Status |
|------------|--------|
| **WS1** Real data paths (import, Anthropic live, OTel keys) | Done |
| **WS2** Hierarchy roll-up, tree picker, allocation triage, org CSV | Done |
| **WS3** Versioned budgets, burn-down, status API, alerts | Done |
| **WS4** `computeMetric()` + `<Metric>` provenance | Not started |
| **WS5** Value metrics / ROI (`/roi`) | Blocked on WS4 |
| **WS6** Auth.js / RBAC / `/audit` / `DEMO_MODE` | Not started |

Prod (Neon `ep-silent-pine…` + Vercel) has Phase 2 schema + Northstar seed as of last deploy.

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
- Calculation provenance layer (WS4)  
- ROI / value metrics UI (WS5)  
- Meter billing for tenants  
- Real-time streaming (batch/hourly is fine)  
- Model quality evals  
- Full hyperscaler CUR / Azure / GCP adapters (stubs only)  
- Live Okta / Workday org sync (CSV + adapter contract only)
