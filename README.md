# Meter

Spend intelligence for companies running AI in production. v1 wedges on LLM/token spend — tracking, forecasting, and scenario modeling — on a **meter** abstraction and **FOCUS-aligned** schema so hyperscaler cloud spend (AWS CUR, Azure Cost Management, GCP billing export) is a data-adapter problem later, not a re-platform.

## Core ideas

### Everything is a meter

Do not hardcode tokens as the unit of the system. A **meter** is a metered, priced consumption dimension:

- Token meters: `input_tokens`, `output_tokens`, `cache_write_tokens`, `cache_read_tokens`, `batch_*`
- AI SaaS: `seats`, `credits`, `premium_requests`
- Future cloud: `gpu_hours`, `vcpu_hours`, `gb_storage_month`, `gb_egress`

Cost = `ConsumedQuantity × PriceCard(in effect at event time)` ± commitment drawdown.

### FOCUS alignment

Usage and cost tables use FinOps FOCUS semantics (`BilledCost`, `EffectiveCost`, `ServiceName`, `SkuId`, `ConsumedQuantity`, `ConsumedUnit`, `ChargePeriodStart/End`, `Tags`) so CUR / Azure / GCP adapters map into the same facts.

### Org slicing (cost center, team, BU, …)

Dimension types are **per-org configurable** (`business_unit`, `team`, `cost_center`, or anything you add). Facts bind via `usage_event_dimensions` / `cost_record_dimensions`. Budgets, forecasts, and scenarios scope to a dimension node (with optional descendants). Untagged spend is **unallocated**; `% allocated` is tracked **per dimension type**.

### Connector tiers

| Tier | Meaning |
|------|---------|
| 1 | Native usage/admin API pull |
| 2 | Billing/usage export + column mapper |
| 3 | OTel GenAI push + REST ingest |
| 4 | Invoice / seat reconciliation (low fidelity) |

A vendor can upgrade 4→1 without schema changes — only the adapter implementation changes.

## Stack

- Next.js (App Router) + TypeScript
- Postgres + Drizzle ORM
- Tailwind CSS (dark, finance-dense UI)
- Recharts (fan charts / stacked areas)
- Forecast math in `src/lib/forecast` (unit-tested, no DB deps)

## Quick start

```bash
# Postgres 16+ listening on localhost:5432
createdb meter   # if needed

cp .env.example .env
# DATABASE_URL=postgresql://USER@localhost:5432/meter

npm install
npm run db:setup    # drizzle push + seed
npm run test
npm run dev         # http://localhost:3000
```

Demo org: **Northstar Analytics** — 6 months of synthetic usage across 4 AI features, mid-history Haiku migration + Anthropic price cut, 180 Cursor seats, Perplexity invoice history.

## UI surfaces

1. **Spend** — run rate, MTD vs budget, by provider/model/team/feature, allocation %, anomalies, seat utilization, dimension slice filter
2. **Forecast** — fitted driver tree + P10/P50/P90 fan chart + budget burn
3. **Scenarios** — compare baseline vs routing/adoption overrides
4. **Model Switch** — routing + verbosity sliders; qualitative quality/latency fields required
5. **Price Cards** — versioned cards + Anthropic cut diff
6. **Budgets** — org / dimension scopes + alerts
7. **Connectors** — tier badges, sync health, % covered, OTel ingest docs

## Forecast engine

`src/lib/forecast/engine.ts`:

- `projectAdoption` — linear / logistic / cohort curves
- `priceAtTime` — price-card time travel
- `projectForecast` — driver tree × prices × commitments → daily P10/P50/P90
- `modelSwitchDelta` — replay workload under alternate routing
- `optimizeCommitment` — commit sizing vs P50/P90
- `adoptionBreakBudget` — “what breaks first”

Spend = Σ features (adoption × WAU × req/user × Σ routes (share × tokens × price)) − commits.

## Adding an AWS CUR adapter

1. Implement `ConnectorAdapter` in `src/lib/connectors/` (Tier 2), register in `ensureRegistry()`.
2. Map CUR → `NormalizedUsageEvent` / cost fields:

   | CUR | FOCUS / Meter |
   |-----|----------------|
   | `lineItem/UsageStartDate`–`UsageEndDate` | `ChargePeriodStart/End` |
   | `lineItem/UnblendedCost` | `BilledCost` |
   | `lineItem/NetUnblendedCost` (or discounted) | `EffectiveCost` |
   | `product/ProductName` | `ServiceName` |
   | `product/sku` + usage type | `SkuId` / meter key |
   | `lineItem/UsageAmount` + unit | `ConsumedQuantity` / `ConsumedUnit` |
   | `resourceTags/user:*` | tags → `allocation_rules` → dimension nodes |

3. Reuse existing `usage_events` / `cost_records` writers — **no schema migration** for the adapter itself.
4. Stub contract already lives at provider key `aws_cur` in `src/lib/connectors/stubs.ts`.

Same path for `azure_cost_export` and `gcp_billing_export`.

## OTel ingest

```bash
curl -X POST http://localhost:3000/api/otel/v1/traces \
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

## SDK / proxy tagging

Tag at call time (`team`, `feature`, `customer_id`, `environment`, cost center). Untagged spend still lands as **unallocated**. Connector health shows `% allocated` per dimension — the enterprise readiness metric.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run db:push` | Apply schema |
| `npm run db:seed` | Seed demo data |
| `npm run db:setup` | push + seed |
| `npm run test` | Forecast + cost unit tests |
| `npm run dev` | Next.js dev server |

## Non-goals (v1)

No real-time streaming (hourly batch fine). No model quality evals. No Meter multi-tenant billing. Hyperscaler adapters schema-ready only.
