# Fixtures

## Phase 3 — DX migration

| File | Use |
|------|-----|
| `contributors.csv` | People → team mapping (`POST /api/contributors` action `csv`) |
| `dx-ai-metrics.csv` | DX-shaped AI tool daily export (`POST /api/ai-tools/sync` action `dx_csv`) |

### Recommended path

1. Claim or create a workspace
2. Import org structure (if empty) under Import
3. Import `contributors.csv` under **Data & sources → People**
4. Paste `dx-ai-metrics.csv` under **Data & sources → Import DX AI metrics CSV**
5. **Demo PRs** (or connect a GitHub PAT) so cost/PR computes
6. Open **AI cost**

Meter replaces DX for **AI cost / impact**, not full DORA. Keep DX only if you still need its coding-tool pull and want Meter as FinOps + GitHub join.
