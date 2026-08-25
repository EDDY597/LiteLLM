/** Process-local usage projection for the LiteLLM gateway route. */

import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'

/** One virtual-model usage row shown by the LiteLLM dashboard. */
export interface LiteLlmUsageRow {
  provider: string
  model: string
  requests: number
  successes: number
  failures: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  lastUsedAt?: number
}

/** Aggregate usage returned to the browser. */
export interface LiteLlmUsageSnapshot {
  generatedAt: number
  totals: Omit<LiteLlmUsageRow, 'provider' | 'model' | 'lastUsedAt'>
  rows: LiteLlmUsageRow[]
}

function emptyTotals(): LiteLlmUsageSnapshot['totals'] {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function addUsage(row: LiteLlmUsageRow, usage: TokenUsage): void {
  row.inputTokens += usage.inputTokens
  row.outputTokens += usage.outputTokens
  row.cacheReadTokens += usage.cacheReadTokens ?? 0
  row.cacheWriteTokens += usage.cacheWriteTokens ?? 0
}

/** Mutable process-local ledger owned by one LiteLLM plugin instance. */
export class LiteLlmUsageLedger {
  private readonly rows = new Map<string, LiteLlmUsageRow>()

  /**
   * Observe one completed stream. The request is counted before dispatch and
   * the final chunk decides whether it completed successfully.
   * @param options - provider and virtual model selected by DSH.
   * @param chunks - chunks emitted by the provider stream.
   * @param thrown - whether iteration ended with an exception.
   */
  record(options: GenerateOptions, chunks: readonly StreamChunk[], thrown = false): void {
    const key = `${options.provider}\u0000${options.model}`
    let row = this.rows.get(key)
    if (row === undefined) {
      row = {
        provider: options.provider,
        model: options.model,
        requests: 0,
        successes: 0,
        failures: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }
      this.rows.set(key, row)
    }
    row.requests += 1
    row.lastUsedAt = Date.now()
    for (const chunk of chunks) {
      if (chunk.type === 'usage') addUsage(row, chunk.usage)
    }
    const finish = chunks.findLast(chunk => chunk.type === 'finish')
    const failed = thrown || (finish?.type === 'finish' && (finish.reason.kind === 'error' || finish.reason.kind === 'aborted'))
    if (failed) row.failures += 1
    else row.successes += 1
  }

  /** Return a detached snapshot safe to send over the Remote wire. */
  snapshot(): LiteLlmUsageSnapshot {
    const totals = emptyTotals()
    const rows = [...this.rows.values()].map(row => {
      totals.requests += row.requests
      totals.successes += row.successes
      totals.failures += row.failures
      totals.inputTokens += row.inputTokens
      totals.outputTokens += row.outputTokens
      totals.cacheReadTokens += row.cacheReadTokens
      totals.cacheWriteTokens += row.cacheWriteTokens
      return { ...row }
    })
    rows.sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
    return { generatedAt: Date.now(), totals, rows }
  }
}

/** Host Remote exposing the process-local LiteLLM usage projection. */
export class LiteLlmGatewayRemote extends TypertRemoteService {
  static inject = []

  constructor(ctx: Context, private readonly ledger: LiteLlmUsageLedger) {
    super(ctx, 'litellmGateway')
  }

  /** Read the current usage counters without exposing the gateway key. */
  @Remote('usage')
  usage(): LiteLlmUsageSnapshot {
    return this.ledger.snapshot()
  }
}

