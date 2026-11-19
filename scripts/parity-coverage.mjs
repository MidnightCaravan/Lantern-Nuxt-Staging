#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const csvPath = path.join(root, 'LANTERN_MIGRATION_AUDIT_20261118-002806', '01_FLASK_ROUTES.csv')
const mapPath = path.join(root, 'docs', 'parity-route-map.json')
const allowedStatuses = new Set(['covered', 'api', 'alias', 'embedded', 'vendor', 'gap'])
const blockingStatuses = new Set(['gap'])

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  const header = (rows.shift() ?? []).map((name) => name.replace(/^\uFEFF/, '').trim())
  return rows
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])))
}

const flaskRoutes = parseCsv(fs.readFileSync(csvPath, 'utf8'))
const parityMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
const mapEntries = new Map(parityMap.routes.map((entry) => [entry.id, entry]))
const seen = new Set()
const problems = []
const counts = {}

for (const route of flaskRoutes) {
  const id = `${route.source_file}#${route.line}|${route.normalized_rule}`
  seen.add(id)
  const entry = mapEntries.get(id)
  if (!entry) {
    problems.push(`UNREVIEWED ${id} (${route.endpoint} ${route.flask_rule})`)
    continue
  }
  if (entry.endpoint !== route.endpoint || entry.flask_rule !== route.flask_rule || entry.methods !== route.methods) {
    problems.push(`STALE MAP ${id}: expected ${route.endpoint} ${route.flask_rule} [${route.methods}], got ${entry.endpoint} ${entry.flask_rule} [${entry.methods}]`)
  }
  if (!allowedStatuses.has(entry.status)) {
    problems.push(`INVALID STATUS ${id}: ${entry.status}`)
    continue
  }
  counts[entry.status] = (counts[entry.status] ?? 0) + 1
  if (blockingStatuses.has(entry.status)) {
    problems.push(`GAP ${id} (${route.endpoint} ${route.flask_rule})`)
  }
  if (!['vendor', 'gap'].includes(entry.status)) {
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      problems.push(`NO EVIDENCE ${id}`)
      continue
    }
    for (const file of entry.evidence) {
      if (!fs.existsSync(path.join(root, file))) problems.push(`MISSING EVIDENCE ${id}: ${file}`)
    }
  }
}

for (const id of mapEntries.keys()) {
  if (!seen.has(id)) problems.push(`STALE MAP ENTRY ${id} (no matching Flask route)`)
}

console.log(`Flask routes reviewed: ${flaskRoutes.length}`)
console.log(`Dispositions: ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`)
if (problems.length) {
  console.error('\nParity coverage problems:')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}
console.log('\nNo route gaps or stale evidence. This checks coverage only, not behavioral parity.')
