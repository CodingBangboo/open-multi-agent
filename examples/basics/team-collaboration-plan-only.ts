/**
 * Multi-Agent Team Collaboration — planOnly mode
 *
 * Same team as `team-collaboration.ts`, but the orchestrator runs only the
 * coordinator decomposition and stops before any task agent executes. Useful
 * for reviewing the coordinator's task DAG without spending tokens on the run.
 *
 * Run:
 *   npx tsx examples/basics/team-collaboration-plan-only.ts
 *
 * Prerequisites:
 *   ANTHROPIC_API_KEY env var must be set.
 */

import { writeFileSync } from 'node:fs'
import { OpenMultiAgent, renderTeamRunDashboard } from '../../src/index.js'
import type { AgentConfig, OrchestratorEvent } from '../../src/types.js'

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

const architect: AgentConfig = {
  name: 'architect',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  systemPrompt: `You are a software architect with deep experience in Node.js and REST API design.
Your job is to design clear, production-quality API contracts and file/directory structures.
Output concise plans in markdown — no unnecessary prose.`,
  tools: ['bash', 'file_write'],
  maxTurns: 5,
  temperature: 0.2,
}

const developer: AgentConfig = {
  name: 'developer',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  systemPrompt: `You are a TypeScript/Node.js developer. You implement what the architect specifies.
Write clean, runnable code with proper error handling. Use the tools to write files and run tests.`,
  tools: ['bash', 'file_read', 'file_write', 'file_edit'],
  maxTurns: 12,
  temperature: 0.1,
}

const reviewer: AgentConfig = {
  name: 'reviewer',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  systemPrompt: `You are a senior code reviewer. Review code for correctness, security, and clarity.
Provide a structured review with: LGTM items, suggestions, and any blocking issues.
Read files using the tools before reviewing.`,
  tools: ['bash', 'file_read', 'grep'],
  maxTurns: 5,
  temperature: 0.3,
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

const startTimes = new Map<string, number>()

function handleProgress(event: OrchestratorEvent): void {
  const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm

  switch (event.type) {
    case 'agent_start':
      startTimes.set(event.agent ?? '', Date.now())
      console.log(`[${ts}] AGENT START  → ${event.agent}`)
      break

    case 'agent_complete': {
      const elapsed = Date.now() - (startTimes.get(event.agent ?? '') ?? Date.now())
      console.log(`[${ts}] AGENT DONE   ← ${event.agent} (${elapsed}ms)`)
      break
    }

    case 'task_start':
      console.log(`[${ts}] TASK START   ↓ ${event.task}`)
      break

    case 'task_complete':
      console.log(`[${ts}] TASK DONE    ↑ ${event.task}`)
      break

    case 'message':
      console.log(`[${ts}] MESSAGE      • ${event.agent} → (team)`)
      break

    case 'error':
      console.error(`[${ts}] ERROR        ✗ agent=${event.agent} task=${event.task}`)
      if (event.data instanceof Error) {
        console.error(`               ${event.data.message}`)
      }
      break
  }
}

// ---------------------------------------------------------------------------
// Orchestrate
// ---------------------------------------------------------------------------

const orchestrator = new OpenMultiAgent({
  defaultModel: 'claude-sonnet-4-6',
  maxConcurrency: 1, // run agents sequentially so output is readable
  onProgress: handleProgress,
})

const team = orchestrator.createTeam('api-team', {
  name: 'api-team',
  agents: [architect, developer, reviewer],
  sharedMemory: true,
  maxConcurrency: 1,
})

console.log(`Team "${team.name}" created with agents: ${team.getAgents().map(a => a.name).join(', ')}`)
console.log('\nStarting plan-only team run...\n')
console.log('='.repeat(60))

const goal = `Create a minimal Express.js REST API in /tmp/express-api/ with:
- GET  /health       → { status: "ok" }
- GET  /users        → returns a hardcoded array of 2 user objects
- POST /users        → accepts { name, email } body, logs it, returns 201
- Proper error handling middleware
- The server should listen on port 3001
- Include a package.json with the required dependencies`

const result = await orchestrator.runTeam(team, goal, { planOnly: true })

console.log('\n' + '='.repeat(60))

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log('\nPlan-only team run complete.')
console.log(`Success: ${result.success}`)
console.log(`planOnly flag: ${result.planOnly}`)
console.log(`Total tokens — input: ${result.totalTokenUsage.input_tokens}, output: ${result.totalTokenUsage.output_tokens}`)

console.log('\nCoordinator-produced task DAG:')
console.log('─'.repeat(60))
if (result.tasks && result.tasks.length > 0) {
  for (const task of result.tasks) {
    const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(', ')})` : ''
    console.log(`  • [${task.status}] ${task.id} → ${task.assignee ?? '(unassigned)'}`)
    console.log(`      ${task.title}${deps}`)
  }
} else {
  console.log('  (no tasks produced)')
}
console.log('─'.repeat(60))

const dashboardPath = '/tmp/team-plan.html'
writeFileSync(dashboardPath, renderTeamRunDashboard(result), 'utf8')
console.log(`\nDAG dashboard written to: ${dashboardPath}`)
console.log(`Open in a browser:  open ${dashboardPath}`)

console.log('\nPer-agent results (coordinator only in planOnly):')
for (const [agentName, agentResult] of result.agentResults) {
  const status = agentResult.success ? 'OK' : 'FAILED'
  const tools = agentResult.toolCalls.length
  console.log(`  ${agentName.padEnd(14)} [${status}]  tool_calls=${tools}`)
  if (!agentResult.success) {
    console.log(`    Error: ${agentResult.output.slice(0, 120)}`)
  }
}
