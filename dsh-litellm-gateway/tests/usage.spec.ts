import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LiteLlmUsageLedger } from '../src/usage.ts'

const request = { provider: 'litellm-gateway', model: 'dsh-balanced', messages: [] } as GenerateOptions

describe('LiteLLM usage ledger', () => {
  it('aggregates virtual-model requests and disjoint token buckets', () => {
    const ledger = new LiteLlmUsageLedger()
    const chunks: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    ledger.record(request, chunks)
    ledger.record({ ...request, model: 'dsh-cost' }, [{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'busy' } } }])
    expect(ledger.snapshot()).toMatchObject({
      totals: { requests: 2, successes: 1, failures: 1, inputTokens: 12, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 1 },
      rows: [
        { provider: 'litellm-gateway', model: 'dsh-balanced', requests: 1, successes: 1 },
        { provider: 'litellm-gateway', model: 'dsh-cost', requests: 1, failures: 1 },
      ],
    })
  })

  it('counts an iteration exception as a failed request', () => {
    const ledger = new LiteLlmUsageLedger()
    ledger.record(request, [], true)
    expect(ledger.snapshot().totals).toMatchObject({ requests: 1, successes: 0, failures: 1 })
  })
})

