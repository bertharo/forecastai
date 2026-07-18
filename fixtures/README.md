# Fixtures

## FinOps CSV week-one

| File | Use |
|------|-----|
| `hris-roster.csv` | HRIS roster → `POST /api/roster` or Import → HRIS roster |
| `vendor-anthropic-usage.csv` | Anthropic-style usage with `email` + `api_key` |
| `vendor-cursor-seats.csv` | Seat invoice rows with email + amount |
| *(in-app)* Load sample data | `POST /api/demo/finops-sample` — deterministic ~2k roster, 6 terminated seats (~$1.2k/mo), ~10% inactive seats, exactly 2 unmapped API keys |

Department never comes from the usage CSV. Join on `tags.email` → roster, or fall back to key registry.

Also copied under `public/fixtures/` for browser download.

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
