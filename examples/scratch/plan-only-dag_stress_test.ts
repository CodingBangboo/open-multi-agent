/**
 * planOnly stress test — non-linear DAG with multi-parent + final-aggregator nodes.
 *
 * 7-agent roster planning a User Authentication Service. The coordinator should
 * produce a roughly diamond-shaped DAG, 4 levels deep:
 *
 *   requirements-analyst
 *      ├─ architect ──────────┐
 *      └─ security-auditor ───┤
 *           ↓        ↓        ↓
 *        frontend  backend  threat-modeler  (threat-modeler has 2 parents)
 *           └────────┴────────┘
 *                    ↓
 *             project-manager  (depends on all above)
 *
 * No task agents run — only the coordinator's decomposition.
 *
 * Run:
 *   npx tsx examples/scratch/plan-only-dag.ts
 *
 * Prerequisites:
 *   ANTHROPIC_API_KEY env var must be set.
 */

import { writeFileSync } from 'node:fs'
import { OpenMultiAgent, renderTeamRunDashboard } from '../../src/index.js'
import type { AgentConfig } from '../../src/types.js'

const MODEL = 'claude-sonnet-4-6'

const agents: AgentConfig[] = [
  {
    name: 'requirements-analyst',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You gather and document functional and non-functional requirements for software systems. Output user stories, acceptance criteria, and constraints.',
  },
  {
    name: 'architect',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You design system architecture: services, data models, API contracts, deployment topology. You consume requirements and produce an architectural blueprint.',
  },
  {
    name: 'security-auditor',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You audit requirements for security and compliance concerns (auth flows, PII, OWASP, regulatory). Output a security requirements addendum.',
  },
  {
    name: 'frontend-planner',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You plan the frontend implementation: pages, components, state management, API integration. You consume the architectural blueprint.',
  },
  {
    name: 'backend-planner',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You plan the backend implementation: services, endpoints, persistence, integrations. You consume the architectural blueprint.',
  },
  {
    name: 'threat-modeler',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You produce a threat model (STRIDE, attack trees) by combining the architectural blueprint with the security requirements addendum. Both inputs are required.',
  },
  {
    name: 'project-manager',
    model: MODEL,
    provider: 'anthropic',
    systemPrompt:
      'You aggregate all upstream planning artefacts (requirements, architecture, security, frontend plan, backend plan, threat model) into a final delivery plan with milestones, risks, and ownership.',
  },
]

const orchestrator = new OpenMultiAgent({
  defaultModel: MODEL,
  maxConcurrency: 1,
})

const team = orchestrator.createTeam('auth-planning', {
  name: 'auth-planning',
  agents,
  sharedMemory: true,
})

const goal = `Produce a complete delivery plan for a new User Authentication Service.
Scope:
- Email/password sign-up + sign-in
- OAuth (Google, GitHub) sign-in
- Session management with refresh tokens
- Password reset via email
- Audit logging
- Admin dashboard for user management
The final output must be a project plan with milestones, owner per milestone, identified risks (including security threats), and dependency ordering across frontend and backend work.`

console.log('Running plan-only on 7-agent roster...\n')
const result = await orchestrator.runTeam(team, goal, { planOnly: true })

// ---------------------------------------------------------------------------
// DAG inspection — resolve dependsOn IDs back to titles for readability
// ---------------------------------------------------------------------------

const tasks = result.tasks ?? []
const titleById = new Map(tasks.map((t) => [t.id, t.title]))

console.log(`Coordinator produced ${tasks.length} tasks. Success: ${result.success}\n`)
console.log('DAG (deps shown as titles, resolved from IDs):')
console.log('─'.repeat(72))
for (const task of tasks) {
  const depTitles = task.dependsOn.map((id) => titleById.get(id) ?? `<unknown:${id}>`)
  const deps = depTitles.length > 0 ? depTitles.join('  +  ') : '(root)'
  console.log(`• ${task.title}`)
  console.log(`    assignee: ${task.assignee ?? '(unassigned)'}`)
  console.log(`    deps:     ${deps}`)
}
console.log('─'.repeat(72))

// Quick structural sanity check the user can eyeball
const rootCount = tasks.filter((t) => t.dependsOn.length === 0).length
const multiParent = tasks.filter((t) => t.dependsOn.length >= 2)
console.log(`\nStructure: ${rootCount} root(s), ${multiParent.length} multi-parent node(s)`)
if (multiParent.length > 0) {
  for (const t of multiParent) {
    console.log(`  multi-parent: "${t.title}"  (${t.dependsOn.length} parents)`)
  }
}

console.log(
  `\nCoordinator tokens — input: ${result.totalTokenUsage.input_tokens}, output: ${result.totalTokenUsage.output_tokens}`,
)

const dashboardPath = '/tmp/plan-only-dag.html'
writeFileSync(dashboardPath, renderTeamRunDashboard(result), 'utf8')
console.log(`\nDashboard: ${dashboardPath}`)
console.log(`Open with: open ${dashboardPath}`)
