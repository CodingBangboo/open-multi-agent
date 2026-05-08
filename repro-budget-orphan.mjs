/**
 * Reproducer for: orphaned tool_use when maxTokenBudget fires before tool execution
 *
 * Phase 1 — produces the orphan via a mock runner (no API key needed)
 * Phase 2 — passes the orphaned messages to the real Anthropic API to
 *            demonstrate the resulting 400 Bad Request
 */

import { AgentRunner } from './dist/agent/runner.js'
import { ToolRegistry } from './dist/tool/framework.js'
import { ToolExecutor } from './dist/tool/executor.js'
import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Phase 1: produce the orphan using a mock adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  name: 'mock',
  async chat(_messages, _opts) {
    return {
      id: 'mock-1',
      model: 'mock',
      stop_reason: 'tool_use',
      usage: { input_tokens: 80, output_tokens: 30 }, // total = 110, exceeds budget
      content: [
        { type: 'text', text: 'Let me search for that.' },
        {
          type: 'tool_use',
          id: 'tool_abc123',
          name: 'web_search',
          input: { query: 'open-multi-agent' },
        },
      ],
    }
  },
  async *stream() {},
}

const registry = new ToolRegistry()
const executor = new ToolExecutor(registry)

const runner = new AgentRunner(mockAdapter, registry, executor, {
  model: 'mock',
  systemPrompt: 'You are a helpful assistant.',
  maxTokenBudget: 50, // intentionally below the mock's 110-token response
})

const originalUserMessage = { role: 'user', content: 'Search for open-multi-agent.' }
const result = await runner.run([originalUserMessage])

console.log('\n=== Phase 1: Budget exceeded — orphan produced ===')
console.log('budgetExceeded:', result.budgetExceeded)
for (const [i, msg] of result.messages.entries()) {
  const types = Array.isArray(msg.content)
    ? msg.content.map(b => b.type).join(', ')
    : 'string'
  console.log(`  messages[${i}]: role=${msg.role}  blocks=[${types}]`)
}

const orphanedMsg = result.messages[0] // assistant turn: [text, tool_use] — no tool_result follows

// ---------------------------------------------------------------------------
// Phase 2: simulate what agent.prompt() does on the next call.
//
// agent.prompt() appends result.messages to its messageHistory, then on the
// next invocation seeds the runner with that history + a new user message.
// Here we replicate that manually and call the real Anthropic API so the
// 400 is genuine, not simulated.
// ---------------------------------------------------------------------------

console.log('\n=== Phase 2: Resuming conversation via real Anthropic API ===')
console.log('Sending orphaned messages as conversation history...\n')

const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

try {
  await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [
      originalUserMessage,                               // original user turn
      orphanedMsg,                                       // ← tool_use with no tool_result
      { role: 'user', content: 'What did you find?' },  // follow-up (simulates next prompt())
    ],
  })
  console.log('ERROR: expected a 400 but the call succeeded — bug may be fixed')
} catch (err) {
  console.log('HTTP status :', err.status)
  console.log('Error type  :', err.error?.type)
  console.log('Message     :', err.message)
}
