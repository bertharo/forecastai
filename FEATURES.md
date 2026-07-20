# Meter — What exists (product status)

**Live:** https://forecastai-delta.vercel.app  
**Repo:** https://github.com/bertharo/forecastai  
**Stack:** Next.js App Router · TypeScript · Postgres (Neon) · Drizzle · Recharts · Vercel  

**Meter** is an AI spend / FinOps control plane: bring in bills (CSV or connectors), attribute spend to people/teams/departments, set limits, triage waste, and model what-ifs — without requiring a Meter-owned proxy.

---

## Two ways to get value

| Path | Who | What you do |
|------|-----|-------------|
| **CSV FinOps (week-one)** | FinOps analyst | Create workspace → Load sample **or** upload People + Bills → see vendor/dept spend, coverage %, findings |
| **Connectors + AI cost** | Eng / FinOps | Claim Northstar demo or connect Anthropic → Keys → AI cost / PR → budgets & allocation |

Demo workspace after seed: **Northstar Analytics** — claim token `ws_demo_northstar` (~6 months spend, hierarchy, budgets, unallocated clusters, contributors, mock GitHub PRs, coding-tool grains).

---

## Quick paths

### A) Empty workspace → FinOps one-pager (no connectors)

1. [Workspaces](https://forecastai-delta.vercel.app/onboarding) → create workspace  
2. [Home](https://forecastai-delta.vercel.app/) → **Load sample data**  
3. Confirm: vendor spend, department rollup, findings (terminated seats / inactive seats / unmapped keys), spend-weighted coverage  
4. Persistent **Sample data** watermark on every view while fixtures are loaded  

Sample pack invariants (deterministic): ~2,000-person roster; exactly 6 terminated employees with active seats (~$1.2k/mo); ~10% seats inactive 30+ days; exactly 2 unmapped API keys with meaningful spend. Tags use `source=seed`.

### B) Northstar product tour

1. Workspaces → Open the demo (`ws_demo_northstar`)  
2. Home Brief → AI cost/PR + forecast vs plan  
3. AI cost → tool / team / person  
4. Keys → map Anthropic keys to teams  
5. Plan → budgets · Alerts → unassigned spend  
6. Model a change → plain what-ifs  

### C) OTel smoke

```bash
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

| Route | Nav label | What exists |
|-------|-----------|-------------|
| `/` | Brief / By org / Breakdown | **FinOps one-pager** (vendor, department via email→roster, coverage, findings). Forecast vs plan card. AI cost/PR attention. Empty → Load sample. Breakdown by **vendor** (not SKU). |
| `/ai-cost` | AI cost | Coding-tool spend by tool / team / person; cost/PR via `computeMetric` + clickable `<Metric>` provenance; Claude/demo/DX sync. |
| `/scenarios` | Model a change | Plain **what-ifs**: switch models, cap spend, role-based recommendations, volume discount. |
| `/model-switch` | *(linked)* | Fine-grained routing / verbosity simulator (advanced). |
| `/budgets` | Plan | Plain-language limits: on track / getting close / likely over / over. **Set a monthly limit**, move money, heads-ups, recent changes. |
| `/allocation` | Alerts | Unassigned spend clusters → assign once or **Assign & remember** (retroactive rules). |
| `/import` | *(via Data & sources)* | Tabs: **People · Bills & usage · Teams · Past uploads**. Column map only after file load. |
| `/connectors` | Data & sources | Upload spreadsheet CTA + live vendor connect (Anthropic Admin, mocks), people, GitHub, coding tools, OTel keys, gateway snippets. |
| `/keys` | Keys | Discover Anthropic API keys/workspaces; assign team or mark service account; sidebar unmapped badge. |
| `/onboarding` | Workspaces | Create / claim workspace; access token once; demo claim; optional org CSV + OTel test. |
| `/forecast` | *(deep link)* | Driver tree × prices → P10/P50/P90 fan (still largely demo tree, not fully DB-driven). |
| `/price-cards` | *(sidebar/deep)* | Versioned price cards + Anthropic cut diff. |

**Shell:** workspace switcher, home tabs, **Sample data** watermark when `organizations.sample_data_loaded_at` is set.

---

## Attribution ladder (strategy)

| Rung | Status | Meaning |
|------|--------|---------|
| **0** | Live | Admin / CSV → spend by model / key / vendor. No customer code. |
| **1** | Live | **Key registry** — map discovered API keys → team; enrich tags on persist; retroactive remap. |
| **2** | **Not built** | Meter-owned proxy / base_url passthrough. Do not build. |

Department for FinOps rollups resolves via **email → roster** or **key-registry team fallback** — never from `tags.department` on the usage CSV.

Coverage / allocated % is **spend-weighted** ($ allocated / $ total), not row-count.

---

## CSV FinOps week-one (shipped)

| Capability | Status | Where |
|------------|--------|--------|
| HRIS fields on people | Done | `contributors`: department, cost_center, employment_status, started_on, ended_on |
| Roster CSV import | Done | `POST /api/roster`, Import → People, `fixtures/hris-roster.csv` |
| Usage CSV + `tags.email` / `tags.api_key` | Done | Import → Bills; department **not** from usage CSV |
| Vendor fixtures | Done | `vendor-anthropic-usage.csv`, `vendor-cursor-seats.csv` (+ `public/fixtures/`) |
| Deterministic sample pack | Done | `POST /api/demo/finops-sample`, Home **Load sample data** |
| Sample watermark | Done | Layout watermark when sample loaded |
| Dept spend join | Done | `getSpendByDepartment` in `src/lib/queries/finops.ts` |
| Spend-weighted coverage | Done | `getAttributionCoverage` + `getAllocationPct` |
| Findings panel | Done | Terminated+seats, inactive seats, unmapped keys |
| Home one-pager | Done | `FinopsOnePager` |

Verify script: `npx tsx scripts/verify-finops-sample.ts` (optional org id).

---

## Workspaces (no user accounts)

- Create under **Workspaces**; data scoped to that org only  
- **Shared by default** — anyone can list/open non-private workspaces  
- Opt-in **private** at create (`is_private`); then access token required  
- Browser httpOnly registry cookie `meter_ws` = `{ id, token }[]` (private claims)  
- Private access token shown **once** at create; claim via **Have a private workspace code?**  
- Demo: `ws_demo_northstar` (open/shared)  
- Hierarchy: BU → department → team (+ flat cost centers)  
- Org-structure CSV + IdP adapter contract (Okta/Workday sync **not** live)

---

## Telemetry & connectors

### OTel GenAI ingest (live)

`POST /api/otel/v1/traces` + `x-meter-key` → usage events + cost records + dimension allocation (tag rules + type-key fallbacks).

| | |
|--|--|
| Demo key (Northstar) | `meter_demo_otel_key` |
| New orgs | Key shown once in Onboarding |
| APIs | `GET/POST /api/otel/keys`, `POST .../revoke` |

### Connector tiers

| Tier | Meaning | Status |
|------|---------|--------|
| 1 | Native API pull | Anthropic **live Admin** when key set (+ daily cron); OpenAI / Cursor mock sync |
| 2 | Billing export | Google / Bedrock / Azure — stubs |
| 3 | OTel / push | Working |
| 4 | Invoice / seat | Perplexity mock / others stub |

Credentials encrypted at rest (AES-GCM; `METER_CREDENTIALS_KEY` or dev default). Staleness → Home banner.

### Cron

- `GET /api/cron/anthropic-sync` — daily `0 12 * * *` (Vercel Hobby-safe)  
- Auth: `CRON_SECRET` Bearer in production  
- Idempotent Admin grains via `contentHash` upsert  

---

## Keys (Rung 1)

- Table `provider_key_registry`  
- Discover on Anthropic sync / sample load  
- UI `/keys`: 30d spend, assign team, mark service account → allocation rule + force remap  
- Persist path enriches tags from registry before allocation  
- Sidebar orange badge for unmapped count  

---

## Plan (budgets)

- Create org-wide or team monthly limit from UI  
- Status in plain language (on track / getting close / likely to go over / over)  
- Burn spark: actual vs even pace vs outlook  
- Move money between limits (versioned)  
- Heads-ups at threshold crossings + recent change history  
- Gateway hook still exists: `GET /api/budgets/status?team=&feature=` (Meter advises; gateway enforces)

---

## Alerts (allocation triage)

1. Cluster last-30d **unallocated** cost  
2. Select → pick team  
3. **Assign once** or **Assign & remember** (preview then retroactive rule)  
4. Logged in `allocation_rule_applications` + audit  

Also linked from FinOps findings (unmapped keys → `/keys`).

---

## Model a change (scenarios)

Plain tabs (not override JSON / P50 jargon):

1. **Switch models** — team + Haiku/Sonnet/GPT mix → monthly $ delta  
2. **Cap spend** — monthly $ limit vs pace  
3. **By role** — Marketing / Support / Engineering / Product recommendations  
4. **Volume discount** — typical vs busy month → suggested commit  

Advanced: `/model-switch` for verbosity / quality notes.

---

## AI cost (Phase 3 — “drop DX for AI spend”)

Not full DORA.

1. **People** (`contributors`) → teams  
2. **Coding-tool daily grains** (`ai_tool_daily`) — Claude Admin / demo / DX CSV  
3. **GitHub merged PRs** → cost per PR (`computeMetric` + `<Metric>`)  
4. Overlap warning when multiple sources write same tool/day  

Fixtures: `fixtures/contributors.csv`, `fixtures/dx-ai-metrics.csv`.

---

## Import (plain UX)

| Tab | Purpose |
|-----|---------|
| People | Employee CSV (email, department, employment…) |
| Bills & usage | Usage / seats CSV; auto-guess columns; upload |
| Teams | Org chart CSV (optional) |
| Past uploads | History + undo |

Templates (system): Anthropic console export (incl. email/api_key), OpenAI usage, Generic invoice, Cursor/seat invoice (email), Org structure, DX AI metrics.

---

## Filtering (Home / Forecast)

| Control | Param | Notes |
|---------|--------|--------|
| Metric | `metric` | `spend` · `consumption` · `adoption` |
| Org slice | `dim` + `node` | Tree picker; subtree via materialized `path` |
| Provider | `provider` | e.g. `anthropic` |
| Model | `model` | e.g. `claude-sonnet-4` |
| Feature | `feature` | e.g. `support_copilot` |

---

## APIs (complete)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/spend/summary` | Spend KPIs + filters |
| `GET` | `/api/connectors` | List connectors |
| `POST` | `/api/connectors/[provider]/sync` | Sync anthropic / openai / cursor |
| `POST` | `/api/connectors/[provider]/credentials` | Store encrypted API key |
| `POST` | `/api/otel/v1/traces` | Ingest GenAI spans |
| `GET`/`POST` | `/api/otel/keys` | List / create ingest keys |
| `POST` | `/api/otel/keys/[id]/revoke` | Revoke key |
| `POST` | `/api/forecast/project` | Forecast projection |
| `POST` | `/api/scenarios/model-switch` | Model-switch delta |
| `GET`/`POST` | `/api/orgs` | List / create workspace |
| `POST` | `/api/orgs/switch` | Set current workspace cookie |
| `POST` | `/api/orgs/claim` | Claim by access token |
| `GET`/`POST` | `/api/import` | Usage preview / import |
| `POST` | `/api/import/[batchId]/rollback` | Undo import |
| `GET`/`POST` | `/api/org-structure` | Hierarchy CSV |
| `GET`/`POST` | `/api/roster` | HRIS roster |
| `POST` | `/api/demo/finops-sample` | Load FinOps sample pack |
| `GET`/`PATCH` | `/api/keys` | Key registry list / assign |
| `GET` | `/api/allocation/clusters` | Unallocated clusters |
| `POST` | `/api/allocation/assign` | One-off assign |
| `GET`/`POST` | `/api/allocation/rules` | Preview / apply rules |
| `GET` | `/api/budgets/status` | Gateway status snapshots |
| `GET`/`POST` | `/api/budgets` | Create / version / reallocate / refresh |
| `GET`/`POST` | `/api/contributors` | People list / upsert / CSV |
| `GET`/`POST` | `/api/scm/github` | GitHub PAT / demo PRs |
| `POST` | `/api/ai-tools/sync` | Coding tools / DX CSV |
| `GET` | `/api/ai-cost/summary` | AI cost KPIs |
| `GET` | `/api/cron/anthropic-sync` | Daily Anthropic sync |

---

## Data model (highlights)

- **Meter** abstraction (not tokens-only) · FOCUS-aligned cost/usage  
- Per-org **dimension types/nodes** (`path`, cost center, owner)  
- **Allocation rules** + retroactive applications  
- **Import batches** — content-hash idempotency + rollback  
- **Price cards** — versioned, time-travel pricing  
- Forecast **drivers**, **scenarios**, **commitments**  
- **Budgets** + versions + status snapshots + alerts  
- **Key registry** (`provider_key_registry`)  
- **Sample flag** `organizations.sample_data_loaded_at`  
- **Phase 3:** contributors (+ HRIS fields), scm_connections, pull_requests, ai_tool_daily, ai_sessions, ai_tool_source_prefs  
- Present but product-light: `users` / `memberships` / `audit_logs`, `value_metrics` / `value_events`, `org_webhooks`

---

## Fixtures

| File | Use |
|------|-----|
| `fixtures/hris-roster.csv` | People / roster |
| `fixtures/vendor-anthropic-usage.csv` | Usage + email + api_key |
| `fixtures/vendor-cursor-seats.csv` | Seat invoice |
| `fixtures/contributors.csv` | People → team (connectors) |
| `fixtures/dx-ai-metrics.csv` | DX AI metrics import |
| `public/fixtures/*` | Same FinOps CSVs for browser download |
| In-app sample | `POST /api/demo/finops-sample` |

See `fixtures/README.md`.

---

## Phase progress

| Workstream | Status |
|------------|--------|
| WS1 Real data paths (import, Anthropic live, OTel) | Done |
| WS2 Hierarchy, tree picker, allocation, org CSV | Done |
| WS3 Versioned budgets, burn-down, status API, alerts | Done |
| Phase 3A–D Contributors, GitHub, AI cost, DX CSV | Done |
| Rung 1 Key registry + cron sync | Done |
| CSV FinOps week-one (roster, sample, findings, watermark) | Done |
| Plain-language UX (Scenarios, Plan, Alerts, Import) | Done |
| WS5 Value metrics / ROI UI (`/roi`) | Not started (AI KPI provenance only) |
| WS6 Auth.js / RBAC / `/audit` | Not started |
| Rung 2 Meter proxy | **Cut — do not build** |
| Forecast fully rewired to DB | Partial (UI still uses demo tree) |

---

## Local vs prod

| | Local | Production |
|--|-------|------------|
| App | `npm run dev` → http://127.0.0.1:3000 | https://forecastai-delta.vercel.app |
| DB | Postgres (`DATABASE_URL`) | Neon |
| Setup | `npm run db:setup` | Schema pushed; seed for Northstar |

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

Env: `DATABASE_URL`, optional `METER_CREDENTIALS_KEY`, prod `CRON_SECRET`.

---

## Not built / out of scope

- Auth / SSO / roles  
- Full ROI / value-metrics product surface  
- Live Cursor / Copilot enterprise APIs (demo grains today)  
- Meter billing for tenants  
- Real-time streaming (batch/hourly is fine)  
- Model quality evals / full DORA  
- Full hyperscaler CUR / Azure / GCP adapters (stubs)  
- Live Okta / Workday org sync  
- **Meter-owned proxy / Rung 2**  
- Invoice reconciliation as a first-class product  
- Forecast engine fully driven from live DB drivers (demo tree still primary on `/forecast`)
