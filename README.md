<div align="center">

# coverage-check

**Fail CI when test coverage drops — no test runner required**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=0B0A09)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node: >=18](https://img.shields.io/badge/node-%3E%3D18-339933?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/coverage-check --lcov coverage/lcov.info --threshold 80
```

## Usage

```bash
# Check lcov with an 80% threshold on all metrics
covcheck --lcov coverage/lcov.info --threshold 80

# Different thresholds per metric
covcheck --json coverage/coverage-final.json --lines 90 --branches 75 --functions 85

# GitHub Actions annotations (::error:: format)
covcheck --lcov coverage/lcov.info --threshold 80 --format github

# Auto-detect report in current directory
covcheck --threshold 80
```

| Flag | Description |
|------|-------------|
| `--lcov <file>` | Parse an lcov.info report |
| `--json <file>` | Parse an Istanbul / c8 JSON report |
| `--clover <file>` | Parse a Clover XML report |
| `--threshold <n>` | Minimum coverage % for all metrics |
| `--lines/branches/functions/statements <n>` | Per-metric thresholds |
| `--per-file` | Enforce threshold on every individual file |
| `--per-file-threshold <n>` | Override per-file threshold (default: `--threshold`) |
| `--exclude "<globs>"` | Comma-separated glob patterns to exclude |
| `--format table\|json\|github` | Output format (default: `table`) |
| `--output <file>` | Save results JSON to a file |

## What it does

Point `coverage-check` at an existing coverage report and it exits `1` if any metric falls below your threshold — with no test runner or build tooling involved. It reads lcov, Istanbul JSON, and Clover XML natively, emits colored table output in the terminal, GitHub Actions `::error::` annotations in CI, or machine-readable JSON. Per-file enforcement catches files hiding at 0% even when aggregate numbers look healthy.

## GitHub Actions

```yaml
- name: Enforce coverage
  run: npx github:NickCirv/coverage-check --lcov coverage/lcov.info --threshold 80 --format github
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All thresholds met |
| `1` | Coverage below threshold |
| `2` | Parse error / bad arguments |

---
<sub>Zero dependencies · Node >=18 · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
