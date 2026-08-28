/** Process-local usage projection for the LiteLLM gateway route. */

import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { LiteLlmPlansSnapshot } from './plans.ts'

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
  /** The router's latest concrete model reading; absent before the first completed response. */
  active?: LiteLlmActiveModel
}

/** The gateway's most recently completed request, as the provider reported it. */
export interface LiteLlmActiveModel {
  /** Provider route DSH addressed. */
  provider: string
  /** Virtual model id DSH sent. */
  model: string
  /**
   * Upstream model id the gateway response named — LiteLLM routes a virtual
   * alias to one concrete backend per request and echoes it in the response's
   * `model` field; surfaced here only when the transport replay metadata
   * carries a recognizable copy.
   */
  responseModel?: string
  /** Completion time of that request. */
  at: number
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

/**
 * Read the upstream model id from a finish chunk's replay envelope, when the
 * transport's adapter-private metadata is a recognizable pi-ai projection.
 * The pi-ai OpenAI-compatible path mirrors the response's `model` field — the
 * concrete backend LiteLLM routed to — into `response.responseModel`.
 */
function upstreamModelOf(finish: StreamChunk | undefined): string | undefined {
  if (finish?.type !== 'finish') return undefined
  const state: unknown = finish.replayState
  if (typeof state !== 'object' || state === null) return undefined
  const response: unknown = (state as { response?: unknown }).response
  if (typeof response !== 'object' || response === null) return undefined
  const entry = response as Record<string, unknown>
  if (entry['kind'] !== 'pi-ai') return undefined
  const candidate = entry['responseModel']
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

/** Mutable process-local ledger owned by one LiteLLM plugin instance. */
export class LiteLlmUsageLedger {
  private readonly rows = new Map<string, LiteLlmUsageRow>()
  private active: LiteLlmActiveModel | undefined

  /**
   * Observe one completed stream. The request is counted before dispatch and
   * the final chunk decides whether it completed successfully.
   * @param options - provider and virtual model selected by DSH.
   * @param chunks - chunks emitted by the provider stream.
   * @param thrown - whether iteration ended with an exception.
   */
  record(options: GenerateOptions, chunks: readonly StreamChunk[], thrown = false): void {
    const finish = chunks.findLast(chunk => chunk.type === 'finish')
    const responseModel = upstreamModelOf(finish)
    // `active` answers "which concrete model did the router last pick", so it
    // only moves when a completed response named one — failures keep the
    // previous reading rather than blanking or mislabeling it.
    if (responseModel !== undefined) {
      this.active = {
        provider: options.provider,
        model: options.model,
        responseModel,
        at: Date.now(),
      }
    }
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
    const failed = thrown || (finish?.type === 'finish' && (finish.reason.kind === 'error' || finish.reason.kind === 'aborted'))
    if (failed) row.failures += 1
    else row.successes += 1
  }

  /**
   * Return a detached snapshot safe to send over the Remote wire.
   * @returns aggregate totals, per-model rows, and the router's latest concrete model.
   */
  snapshot(): LiteLlmUsageSnapshot {
    const totals = emptyTotals()
    const rows = [...this.rows.values()].map((row) => {
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
    return { generatedAt: Date.now(), totals, rows, ...this.active === undefined ? {} : { active: { ...this.active } } }
  }

  /**
   * The last upstream model a completed response named.
   * @returns the detached reading, or null before the first one.
   */
  currentActive(): LiteLlmActiveModel | null {
    return this.active === undefined ? null : { ...this.active }
  }
}

/** Construction dependencies of the gateway Remote, passed as one plugin argument. */
export interface LiteLlmGatewayRemoteDeps {
  /** Process-local usage ledger. */
  ledger: LiteLlmUsageLedger
  /**
   * Read every configured billing entry's spend and cap from the gateway.
   * A missing master-key credential fails this whole call loudly — partial
   * numbers without authentication would be misleading, not degraded.
   */
  readPlans: () => Promise<LiteLlmPlansSnapshot>
  /**
   * Translate a routed alias into the concrete upstream name the gateway
   * serves for it, from the live `/model/info` listing.
   */
  mapUpstream: (modelName: string) => string | undefined
}

/** Host Remote exposing the process-local LiteLLM usage projection and plan balances. */
export class LiteLlmGatewayRemote extends TypertRemoteService {
  static inject = []

  constructor(ctx: Context, private readonly deps: LiteLlmGatewayRemoteDeps) {
    super(ctx, 'litellmGateway')
  }

  /**
   * Read the current usage counters without exposing the gateway key.
   * @returns the detached usage snapshot.
   */
  @Remote('usage')
  usage(): LiteLlmUsageSnapshot {
    return this.deps.ledger.snapshot()
  }

  /**
   * Read the router's latest concrete model reading without exposing the gateway key.
   * The response body only echoes the routed alias, so the reading is upgraded
   * to the upstream name via the live model listing when it knows the alias.
   * @returns the detached reading, or null before the first completed response.
   */
  @Remote('activeModel')
  activeModel(): LiteLlmActiveModel | null {
    const active = this.deps.ledger.currentActive()
    if (active === null) return null
    const upstream = this.deps.mapUpstream(active.model)
    return upstream === undefined ? active : { ...active, responseModel: upstream }
  }

  /**
   * Wire the plans reader through to the browser as its own remote method.
   * @returns per-entry spend and caps with isolated failures.
   */
  @Remote('plans')
  plans(): Promise<LiteLlmPlansSnapshot> {
    return this.deps.readPlans()
  }
}
