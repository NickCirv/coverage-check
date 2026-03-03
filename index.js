#!/usr/bin/env node
// coverage-check — enforce test coverage thresholds from existing reports
// Zero dependencies · Node 18+ · MIT License

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, relative, join } from 'path'

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY

const color = (code, str) => NO_COLOR ? str : `${code}${str}${c.reset}`
const red = str => color(c.red + c.bold, str)
const green = str => color(c.green + c.bold, str)
const yellow = str => color(c.yellow, str)
const cyan = str => color(c.cyan, str)
const dim = str => color(c.dim, str)
const bold = str => color(c.bold, str)

// ─── CLI argument parser ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = {
    lcov: null,
    json: null,
    clover: null,
    threshold: null,
    lines: null,
    branches: null,
    functions: null,
    statements: null,
    perFile: false,
    perFileThreshold: null,
    exclude: [],
    format: 'table',
    output: null,
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      case '--lcov':        opts.lcov = next;                   i++; break
      case '--json':        opts.json = next;                   i++; break
      case '--clover':      opts.clover = next;                 i++; break
      case '--threshold':   opts.threshold = parseFloat(next);  i++; break
      case '--lines':       opts.lines = parseFloat(next);      i++; break
      case '--branches':    opts.branches = parseFloat(next);   i++; break
      case '--functions':   opts.functions = parseFloat(next);  i++; break
      case '--statements':  opts.statements = parseFloat(next); i++; break
      case '--per-file':    opts.perFile = true;                break
      case '--per-file-threshold': opts.perFileThreshold = parseFloat(next); i++; break
      case '--exclude':     opts.exclude = next.split(',').map(s => s.trim()); i++; break
      case '--format':      opts.format = next;                 i++; break
      case '--output':      opts.output = next;                 i++; break
      case '--help':
      case '-h':            opts.help = true;                   break
      default:
        if (arg.startsWith('--')) {
          console.error(red(`Unknown option: ${arg}`))
          process.exit(2)
        }
    }
  }

  return opts
}

// ─── Glob-style exclude matching ─────────────────────────────────────────────
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<DOUBLE>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLE>>>/g, '.*')
  return new RegExp(`(^|/)${escaped}($|/)`)
}

function isExcluded(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false
  const normalized = filePath.replace(/\\/g, '/')
  return patterns.some(p => globToRegex(p).test(normalized))
}

// ─── LCOV parser ──────────────────────────────────────────────────────────────
function parseLcov(content) {
  const files = {}
  let current = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()

    if (line.startsWith('SF:')) {
      const filePath = line.slice(3)
      current = filePath
      files[current] = { lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } }
    } else if (line === 'end_of_record') {
      current = null
    } else if (current) {
      if (line.startsWith('LF:')) {
        files[current].lines.found = parseInt(line.slice(3), 10)
      } else if (line.startsWith('LH:')) {
        files[current].lines.hit = parseInt(line.slice(3), 10)
      } else if (line.startsWith('BRF:')) {
        files[current].branches.found = parseInt(line.slice(4), 10)
      } else if (line.startsWith('BRH:')) {
        files[current].branches.hit = parseInt(line.slice(4), 10)
      } else if (line.startsWith('FNF:')) {
        files[current].functions.found = parseInt(line.slice(4), 10)
      } else if (line.startsWith('FNH:')) {
        files[current].functions.hit = parseInt(line.slice(4), 10)
      }
    }
  }

  return files
}

function aggregateLcov(files, excludePatterns) {
  const totals = { lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } }
  const perFile = []

  for (const [filePath, data] of Object.entries(files)) {
    if (isExcluded(filePath, excludePatterns)) continue

    totals.lines.found     += data.lines.found
    totals.lines.hit       += data.lines.hit
    totals.branches.found  += data.branches.found
    totals.branches.hit    += data.branches.hit
    totals.functions.found += data.functions.found
    totals.functions.hit   += data.functions.hit

    perFile.push({
      file: filePath,
      lines:     pct(data.lines.hit,     data.lines.found),
      branches:  pct(data.branches.hit,  data.branches.found),
      functions: pct(data.functions.hit, data.functions.found),
      statements: null,
    })
  }

  return {
    lines:      pct(totals.lines.hit,     totals.lines.found),
    branches:   pct(totals.branches.hit,  totals.branches.found),
    functions:  pct(totals.functions.hit, totals.functions.found),
    statements: null,
    perFile,
  }
}

// ─── Istanbul JSON parser ──────────────────────────────────────────────────────
function parseIstanbul(content) {
  return JSON.parse(content)
}

function aggregateIstanbul(data, excludePatterns) {
  const totals = {
    statements: { total: 0, covered: 0 },
    branches:   { total: 0, covered: 0 },
    functions:  { total: 0, covered: 0 },
    lines:      { total: 0, covered: 0 },
  }
  const perFile = []

  for (const [filePath, fileCov] of Object.entries(data)) {
    if (isExcluded(filePath, excludePatterns)) continue

    // statements
    const stmtVals  = Object.values(fileCov.s || {})
    const stmtTotal = stmtVals.length
    const stmtHit   = stmtVals.filter(v => v > 0).length

    // functions
    const fnVals  = Object.values(fileCov.f || {})
    const fnTotal = fnVals.length
    const fnHit   = fnVals.filter(v => v > 0).length

    // branches — each branch entry is an array [notTaken, taken, ...]
    const branchVals  = Object.values(fileCov.b || {}).flat()
    const branchTotal = branchVals.length
    const branchHit   = branchVals.filter(v => v > 0).length

    // lines — from statementMap keys mapped to line numbers
    const lineSet   = new Set()
    const lineHitSet = new Set()
    const stmtMap   = fileCov.statementMap || {}
    const stmtCount = fileCov.s || {}
    for (const [id, loc] of Object.entries(stmtMap)) {
      const ln = loc.start.line
      lineSet.add(ln)
      if ((stmtCount[id] || 0) > 0) lineHitSet.add(ln)
    }

    totals.statements.total   += stmtTotal
    totals.statements.covered += stmtHit
    totals.branches.total     += branchTotal
    totals.branches.covered   += branchHit
    totals.functions.total    += fnTotal
    totals.functions.covered  += fnHit
    totals.lines.total        += lineSet.size
    totals.lines.covered      += lineHitSet.size

    perFile.push({
      file: filePath,
      statements: pct(stmtHit, stmtTotal),
      branches:   pct(branchHit, branchTotal),
      functions:  pct(fnHit, fnTotal),
      lines:      pct(lineHitSet.size, lineSet.size),
    })
  }

  return {
    statements: pct(totals.statements.covered, totals.statements.total),
    branches:   pct(totals.branches.covered,   totals.branches.total),
    functions:  pct(totals.functions.covered,  totals.functions.total),
    lines:      pct(totals.lines.covered,       totals.lines.total),
    perFile,
  }
}

// ─── Clover XML parser ────────────────────────────────────────────────────────
function parseClover(content) {
  // Lightweight XML value extractor — no DOM, no dependencies
  const extractAttr = (tag, attr) => {
    const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i')
    const m = content.match(re)
    return m ? parseFloat(m[1]) : null
  }

  // Try project-level metrics element
  const metricsMatch = content.match(/<project[^>]*>[\s\S]*?<metrics([^/]*)\/?>/)
  if (metricsMatch) {
    const m = metricsMatch[1]
    const getN = name => {
      const r = new RegExp(`\\b${name}="(\\d+)"`)
      const res = m.match(r)
      return res ? parseInt(res[1], 10) : 0
    }

    const stmts    = getN('statements')
    const covStmts = getN('coveredstatements')
    const conds    = getN('conditionals')
    const covConds = getN('coveredconditionals')
    const methods  = getN('methods')
    const covMeth  = getN('coveredmethods')
    const els      = getN('elements')
    const covEls   = getN('coveredelements')

    return {
      statements: pct(covStmts, stmts),
      branches:   pct(covConds, conds),
      functions:  pct(covMeth, methods),
      lines:      pct(covEls, els),
      perFile: [],
    }
  }

  return { statements: null, branches: null, functions: null, lines: null, perFile: [] }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function pct(hit, total) {
  if (total === 0) return 100
  return Math.round((hit / total) * 10000) / 100
}

function fmt(val) {
  if (val === null || val === undefined) return dim('N/A')
  return val.toFixed(2) + '%'
}

function pass(val, threshold) {
  if (val === null || threshold === null) return true
  return val >= threshold
}

// ─── Auto-detect report ───────────────────────────────────────────────────────
function autoDetect() {
  const candidates = [
    { type: 'lcov', paths: ['coverage/lcov.info', 'lcov.info'] },
    { type: 'json', paths: ['coverage/coverage-final.json', 'coverage-final.json', '.nyc_output/coverage-final.json'] },
    { type: 'clover', paths: ['coverage/clover.xml', 'clover.xml'] },
  ]

  for (const { type, paths } of candidates) {
    for (const p of paths) {
      if (existsSync(p)) return { type, path: p }
    }
  }
  return null
}

// ─── Output renderers ─────────────────────────────────────────────────────────
function renderTable(result, thresholds, perFileThreshold, opts) {
  const metrics = ['lines', 'branches', 'functions', 'statements']
  const labels  = { lines: 'Lines', branches: 'Branches', functions: 'Functions', statements: 'Statements' }

  const colW = [14, 12, 12, 8]
  const hr = dim('─'.repeat(52))

  console.log()
  console.log(bold('Coverage Summary'))
  console.log(hr)

  const header = [
    'Metric'.padEnd(colW[0]),
    'Coverage'.padEnd(colW[1]),
    'Threshold'.padEnd(colW[2]),
    'Status',
  ].join('  ')
  console.log(bold(header))
  console.log(hr)

  let allPass = true
  for (const m of metrics) {
    const val = result[m]
    if (val === null) continue
    const thr = thresholds[m]
    const ok  = pass(val, thr)
    if (!ok) allPass = false

    const valStr = fmt(val).padEnd(colW[1])
    const thrStr = (thr !== null ? thr + '%' : 'none').padEnd(colW[2])
    const status = ok ? green('PASS') : red('FAIL')
    const valCol = ok ? green(fmt(val).padEnd(colW[1])) : red(fmt(val).padEnd(colW[1]))

    console.log(`${labels[m].padEnd(colW[0])}  ${valCol}  ${thrStr}  ${status}`)
  }

  console.log(hr)

  if (opts.perFile && result.perFile && result.perFile.length > 0) {
    const pft = perFileThreshold ?? thresholds.lines ?? thresholds.statements ?? 0
    const failing = result.perFile.filter(f => {
      const v = f.lines ?? f.statements
      return v !== null && v < pft
    })

    if (failing.length > 0) {
      console.log()
      console.log(bold('Per-File Failures') + dim(` (threshold: ${pft}%)`))
      console.log(hr)
      for (const f of failing) {
        const v = f.lines ?? f.statements
        console.log(`  ${red('✗')} ${relative(process.cwd(), f.file)} ${dim('→')} ${red(fmt(v))}`)
      }
      allPass = false
    } else {
      console.log(dim(`  All ${result.perFile.length} files pass per-file threshold (${pft}%)`))
    }
  }

  console.log()
  if (allPass) {
    console.log(green('✓ Coverage check PASSED'))
  } else {
    console.log(red('✗ Coverage check FAILED'))
  }
  console.log()

  return allPass
}

function renderGithub(result, thresholds, perFileThreshold, opts) {
  const metrics = ['lines', 'branches', 'functions', 'statements']
  let allPass = true

  for (const m of metrics) {
    const val = result[m]
    if (val === null) continue
    const thr = thresholds[m]
    if (!pass(val, thr)) {
      allPass = false
      console.log(`::error::Coverage FAILED — ${m}: ${fmt(val)} (required: ${thr}%)`)
    }
  }

  if (opts.perFile && result.perFile) {
    const pft = perFileThreshold ?? thresholds.lines ?? thresholds.statements ?? 0
    for (const f of result.perFile) {
      const v = f.lines ?? f.statements
      if (v !== null && v < pft) {
        allPass = false
        const rel = relative(process.cwd(), f.file)
        console.log(`::error file=${rel}::Coverage FAILED — ${fmt(v)} lines (required: ${pft}%)`)
      }
    }
  }

  if (allPass) console.log('::notice::Coverage check PASSED')
  return allPass
}

function renderJson(result, thresholds, perFileThreshold, opts) {
  const metrics = ['lines', 'branches', 'functions', 'statements']
  const summary = {}
  let allPass = true

  for (const m of metrics) {
    const val = result[m]
    const thr = thresholds[m]
    const ok  = pass(val, thr)
    if (!ok) allPass = false
    summary[m] = { value: val, threshold: thr, pass: ok }
  }

  const output = { pass: allPass, summary, perFile: result.perFile ?? [] }
  console.log(JSON.stringify(output, null, 2))
  return allPass
}

// ─── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${bold('coverage-check')} — enforce test coverage thresholds from existing reports

${bold('USAGE')}
  covcheck [options]
  coverage-check [options]

${bold('FORMAT FLAGS')} (pick one, or omit for auto-detect)
  --lcov   <file>    Parse an lcov.info report
  --json   <file>    Parse an Istanbul/c8 JSON report
  --clover <file>    Parse a Clover XML report

${bold('THRESHOLD FLAGS')}
  --threshold <n>    Set threshold for all metrics (default: none)
  --lines <n>        Minimum line coverage %
  --branches <n>     Minimum branch coverage %
  --functions <n>    Minimum function coverage %
  --statements <n>   Minimum statement coverage %

${bold('PER-FILE FLAGS')}
  --per-file                    Enforce minimum per individual file
  --per-file-threshold <n>      Threshold for per-file check (defaults to --threshold)

${bold('FILTER FLAGS')}
  --exclude "<globs>"  Comma-separated glob patterns to exclude

${bold('OUTPUT FLAGS')}
  --format table|json|github    Output format (default: table)
  --output <file>               Save results JSON to file

${bold('EXAMPLES')}
  covcheck --lcov coverage/lcov.info --threshold 80
  covcheck --json coverage/coverage-final.json --lines 90 --branches 75
  covcheck --clover clover.xml --threshold 80 --per-file --per-file-threshold 60
  covcheck --lcov lcov.info --format github --threshold 80
  covcheck --json coverage-final.json --exclude "**/*.test.js,**/fixtures/**"

${bold('EXIT CODES')}
  0 — all thresholds met
  1 — coverage below threshold
  2 — parse error / bad args
`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv)

  if (opts.help) {
    printHelp()
    process.exit(0)
  }

  // Resolve report
  let reportType = null
  let reportPath = null

  if (opts.lcov)   { reportType = 'lcov';   reportPath = opts.lcov }
  else if (opts.json)   { reportType = 'json';   reportPath = opts.json }
  else if (opts.clover) { reportType = 'clover'; reportPath = opts.clover }
  else {
    const detected = autoDetect()
    if (detected) {
      reportType = detected.type
      reportPath = detected.path
      console.log(dim(`Auto-detected: ${reportType} report at ${reportPath}`))
    } else {
      console.error(red('No coverage report found. Specify --lcov, --json, or --clover, or run your test suite first.'))
      process.exit(2)
    }
  }

  // Read file
  let content
  try {
    content = readFileSync(resolve(reportPath), 'utf8')
  } catch (err) {
    console.error(red(`Cannot read report: ${reportPath}`))
    console.error(dim(err.message))
    process.exit(2)
  }

  // Parse
  let result
  try {
    if (reportType === 'lcov') {
      const files = parseLcov(content)
      result = aggregateLcov(files, opts.exclude)
    } else if (reportType === 'json') {
      const data = parseIstanbul(content)
      result = aggregateIstanbul(data, opts.exclude)
    } else if (reportType === 'clover') {
      result = parseClover(content)
    } else {
      console.error(red(`Unknown report type: ${reportType}`))
      process.exit(2)
    }
  } catch (err) {
    console.error(red(`Failed to parse ${reportType} report: ${err.message}`))
    process.exit(2)
  }

  // Build thresholds
  const global = opts.threshold
  const thresholds = {
    lines:      opts.lines      ?? global,
    branches:   opts.branches   ?? global,
    functions:  opts.functions  ?? global,
    statements: opts.statements ?? global,
  }

  const perFileThreshold = opts.perFileThreshold ?? global

  // Render
  let allPass
  if (opts.format === 'github') {
    allPass = renderGithub(result, thresholds, perFileThreshold, opts)
  } else if (opts.format === 'json') {
    allPass = renderJson(result, thresholds, perFileThreshold, opts)
  } else {
    allPass = renderTable(result, thresholds, perFileThreshold, opts)
  }

  // Save output
  if (opts.output) {
    const metrics = ['lines', 'branches', 'functions', 'statements']
    const summary = {}
    for (const m of metrics) {
      const val = result[m]
      const thr = thresholds[m]
      summary[m] = { value: val, threshold: thr, pass: pass(val, thr) }
    }
    const out = { pass: allPass, summary, perFile: result.perFile ?? [] }
    writeFileSync(opts.output, JSON.stringify(out, null, 2))
    console.log(dim(`Results saved to ${opts.output}`))
  }

  process.exit(allPass ? 0 : 1)
}

main()
