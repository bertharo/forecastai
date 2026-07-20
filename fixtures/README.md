# Fixtures

## FinOps CSV / Excel week-one

| File | Use |
|------|-----|
| `people-cost-center-chain.csv` / `.xlsx` / `.xls` | People: Email, Project Worker, Cost Center Chain L02–L07 |
| `telemetry-spend.csv` / `.xlsx` | Spend: email, month, ai_tool, model, total_tokens, total_spend_dollars |
| *(in-app)* Load sample data | `POST /api/demo/finops-sample` — deterministic ~2k roster, 6 terminated seats (~$1.2k/mo), ~10% inactive seats, exactly 2 unmapped API keys |

Excel (`.xls` / `.xlsx` / `.xlsm`) is accepted on **Import** (People + Bills) and **Data & sources** — first sheet only. Month columns that Excel stores as serial dates are normalized to `YYYY-MM-DD`.

Also copied under `public/fixtures/` for browser download.

Department never comes from the usage CSV. Join on `tags.email` → roster, or fall back to key registry.

## Phase 3 — DX migration

| File | Use |
|------|-----|
| `contributors.csv` | People → team mapping (`POST /api/contributors` action `csv`) |
| `dx-ai-metrics.csv` | DX-shaped AI tool daily export (`POST /api/ai-tools/sync` action `dx_csv`) |

### Recommended path

1. Claim or create a workspace
2. **Load sample data** on Home, or import roster + vendor CSVs under Import
3. Confirm Findings: terminated seats, inactive seats, unmapped keys
4. Optional: Import org structure, DX metrics, GitHub for AI cost/PR
