#!/usr/bin/env node
import { completeAgentRun } from '../src/agent-run.js'

function readFlag(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? '' : (process.argv[index + 1] ?? '')
}

const runId = readFlag('--run')
const appliedIds = readFlag('--applied')
  .split(',')
  .map((value) => Number.parseInt(value, 10))
  .filter(Number.isInteger)
const files = readFlag('--files')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (!runId) {
  console.error('Usage: node scripts/complete-agent-run.mjs --run <runId> --applied 0,2 --files file1,file2')
  process.exit(1)
}

try {
  const completion = completeAgentRun({ runId, appliedIds, files })
  console.log(JSON.stringify(completion))
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
