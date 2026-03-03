# coverage-check

> Enforce coverage thresholds from existing reports. Zero dependencies.

No test runner needed — point it at your existing report and fail CI if coverage drops below threshold. Supports lcov, Istanbul JSON, and Clover XML out of the box.

## Install

```bash
# One-shot via npx
npx coverage-check --lcov coverage/lcov.info --threshold 80

# Global install
npm install -g coverage-check
```

## Quick Start

```
$ covcheck --lcov coverage/lcov.info --threshold 80

Coverage Summary
────────────────────────────────────────────────────
Metric          Coverage     Threshold    Status
────────────────────────────────────────────────────
Lines           92.50%       80%          PASS
Branches        78.40%       80%          FAIL
Functions       95.00%       80%          PASS
Statements      91.30%       80%          PASS
────────────────────────────────────────────────────

✗ Coverage check FAILED
```

## Supported Formats

| Format | Flag | File |
|--------|------|------|
| lcov | `--lcov` | `coverage/lcov.info` |
| Istanbul / c8 JSON | `--json` | `coverage/coverage-final.json` |
| Clover XML | `--clover` | `coverage/clover.xml` |

**Auto-detect:** Run `covcheck` with no format flag — it scans common paths automatically.

## Options

```
FORMAT FLAGS (pick one, or omit for auto-detect)
  --lcov   <file>    Parse an lcov.info report
  --json   <file>    Parse an Istanbul/c8 JSON report
  --clover <file>    Parse a Clover XML report

THRESHOLD FLAGS
  --threshold <n>    Set threshold for all metrics
  --lines <n>        Minimum line coverage %
  --branches <n>     Minimum branch coverage %
  --functions <n>    Minimum function coverage %
  --statements <n>   Minimum statement coverage %

PER-FILE FLAGS
  --per-file                    Enforce minimum per individual file
  --per-file-threshold <n>      Threshold for per-file check (defaults to --threshold)

FILTER FLAGS
  --exclude "<globs>"  Comma-separated glob patterns to exclude

OUTPUT FLAGS
  --format table|json|github    Output format (default: table)
  --output <file>               Save results JSON to file
```

## Examples

```bash
# Check lcov with 80% threshold on everything
covcheck --lcov coverage/lcov.info --threshold 80

# Different thresholds per metric
covcheck --json coverage/coverage-final.json --lines 90 --branches 75 --functions 85

# Per-file enforcement — catches 0% files even if overall is high
covcheck --lcov lcov.info --threshold 80 --per-file --per-file-threshold 60

# GitHub Actions annotations (::error:: format)
covcheck --json coverage-final.json --format github --threshold 80

# Exclude test files and fixtures
covcheck --lcov lcov.info --threshold 80 --exclude "**/*.test.js,**/fixtures/**"

# Save results JSON for downstream processing
covcheck --lcov lcov.info --threshold 80 --output coverage-results.json

# Auto-detect report in current directory
covcheck --threshold 80
```

## GitHub Actions

```yaml
- name: Check coverage
  run: npx coverage-check --lcov coverage/lcov.info --threshold 80 --format github
```

With `--format github`, failures emit `::error::` annotations visible in the PR checks panel.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All thresholds met |
| `1` | Coverage below threshold |
| `2` | Parse error / bad arguments |

## JSON Output

Use `--format json` or `--output results.json` for machine-readable output:

```json
{
  "pass": false,
  "summary": {
    "lines":      { "value": 92.5,  "threshold": 80, "pass": true  },
    "branches":   { "value": 78.4,  "threshold": 80, "pass": false },
    "functions":  { "value": 95.0,  "threshold": 80, "pass": true  },
    "statements": { "value": 91.3,  "threshold": 80, "pass": true  }
  },
  "perFile": []
}
```

## Why Zero Dependencies?

No supply chain risk. No `node_modules`. Works in air-gapped environments. Ships as a single 300-line file.

---

Built with Node.js · Zero dependencies · MIT License
