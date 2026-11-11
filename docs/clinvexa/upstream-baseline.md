# CLINVEXA Hermes Upstream Baseline

## Decision

The supplied source is usable as the CLINVEXA starting snapshot, but it is not a clean checkout of a single official Hermes release. CLINVEXA changes must remain isolated in their own directories and every later upstream update must be compared against the recorded official tags.

## Supplied Snapshot

| Item | Value |
|---|---|
| Source directory | `D:\N260 Hermes+CLINVEXA\hermes-agent-main` |
| Git metadata | absent |
| Python package declaration | `hermes-agent` 0.19.1 |
| Desktop package declaration | `hermes` 0.17.0 |
| License | MIT |

## Official Upstream

| Item | Value |
|---|---|
| Repository | `https://github.com/NousResearch/hermes-agent` |
| v0.19.1 tag | `v2026.7.30` |
| Annotated tag object | `d25e2dbdbc40b49808c0a0e9cfed21cc90cffab3` |
| Tag commit | `cc4cab2f592e60a197e796506de9168f74baf3ea` |
| v0.20.0 tag | `v2026.8.3` |
| Annotated tag object | `7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2` |
| Tag commit | `3c27eb6234bf91b8ceee9e9071591b31e9b148cb` |

Official comparison checkouts are stored outside the product source at:

- `D:\N260 Hermes+CLINVEXA\.upstream-baseline-v2026.7.30`
- `D:\N260 Hermes+CLINVEXA\.upstream-baseline-v2026.8.3`

## Comparison Evidence

Line-ending-normalized content comparison produced these results:

| File | v2026.7.30 | v2026.8.3 |
|---|---:|---:|
| `LICENSE` | match | match |
| `apps/desktop/package.json` | differs | match |
| `tui_gateway/methods_tools.py` | differs | match |
| `tools/registry.py` | differs | match |
| `model_tools.py` | differs | match |
| `pyproject.toml` | differs | differs only by project version |
| `uv.lock` | differs | differs by project version, cutoff timestamp, and one `nemo-relay` sdist row |

The supplied core and Desktop sample align with official v0.20.0, while Python package metadata remains at 0.19.1. This is classified as a hybrid snapshot. A full semantic comparison could not be proven because the archive and Git checkout apply different line-ending normalization across most tracked files.

## CLINVEXA Change Boundary

- New Python product code lives under `clinvexa/`.
- New product documentation lives under `docs/clinvexa/` and `docs/delivery-reports/`.
- Hermes core files are changed only when an existing public extension point cannot satisfy an approved CLINVEXA requirement.
- Desktop changes remain under a dedicated `clinvexa` contribution area where possible.
- No version number is changed merely to make this hybrid snapshot look like an official release.

## Upgrade Rule

Before adopting a later Hermes tag:

1. Record the tag object and dereferenced commit.
2. Compare CLINVEXA integration points against that tag.
3. Run Hermes regression tests and every completed CLINVEXA stage test.
4. Update this document and the active stage delivery report.
