import { describe, expect, it } from 'vitest'
import type { GenerateOptions, ReplayEnvelope, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LiteLlmUsageLedger } from '../src/usage.ts'

const request = { provider: 'litellm-gateway', model: 'dsh-balanced', messages: [] } as GenerateOptions

/** A finish chunk whose replay envelope names one concrete upstream model. */
function routedFinish(responseModel: string): StreamChunk {
  const envelope: ReplayEnvelope = {
    response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'litellm-gateway', model: 'dsh-balanced', responseModel, stopReason: 'stop' },
    blocks: [],
  }
  return { type: 'finish', reason: { kind: 'stop' }, replayState: envelope }
}

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

  it('remembers the concrete upstream model the router last picked and keeps it across failures', () => {
    const ledger = new LiteLlmUsageLedger()
    expect(ledger.currentActive()).toBeNull()
    expect(ledger.snapshot().active).toBeUndefined()

    ledger.record(request, [routedFinish('qwen3.5-plus')])
    expect(ledger.currentActive()).toMatchObject({ provider: 'litellm-gateway', model: 'dsh-balanced', responseModel: 'qwen3.5-plus' })

    // An upstream failure delivers no response model; the reading stays.
    ledger.record({ ...request }, [{ type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'boom' } } }])
    expect(ledger.currentActive()?.responseModel).toBe('qwen3.5-plus')

    // The next completed routing decision replaces it.
    ledger.record({ ...request, model: 'dsh-quality' }, [{ type: 'finish', reason: { kind: 'stop' } }, routedFinish('DeepSeek-V4-Flash')])
    expect(ledger.currentActive()).toMatchObject({ model: 'dsh-quality', responseModel: 'DeepSeek-V4-Flash' })
  })

  it('ignores replay envelopes that are not a recognizable pi-ai projection', () => {
    const ledger = new LiteLlmUsageLedger()
    ledger.record(request, [{
      type: 'finish',
      reason: { kind: 'stop' },
      replayState: { response: { kind: 'other-adapter', responseModel: 'ignored' }, blocks: [] },
    }])
    expect(ledger.currentActive()).toBeNull()
  })

  it('detaches the active row so callers cannot mutate ledger state', () => {
    const ledger = new LiteLlmUsageLedger()
    ledger.record(request, [routedFinish('qwen3.5-plus')])
    const first = ledger.currentActive()!
    first.responseModel = 'tampered'
    expect(ledger.currentActive()?.responseModel).toBe('qwen3.5-plus')
    const snap = ledger.snapshot()
    if (snap.active !== undefined) snap.active.responseModel = 'tampered'
    expect(ledger.currentActive()?.responseModel).toBe('qwen3.5-plus')
  })
})
