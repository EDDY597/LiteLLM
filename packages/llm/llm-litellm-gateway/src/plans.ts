/**
 * Reads remaining quota and spend for the configured LiteLLM billing objects
 * (api keys and budgets) from the gateway's own management endpoints, using
 * the same master-key credential that serves requests.
 *
 * The gateway accounts spend itself; an entry therefore reports exactly what
 * LiteLLM tracks. Responses vary across proxy versions — some wrap the info
 * object in `{ data }` — so field extraction is tolerant and per-plan failures
 * isolate instead of failing the whole snapshot.
 *
 * @module @deepseek-ai/dsh-llm-litellm-gateway/plans
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LiteLlmPlan } from './config.ts'

/** One billing entry's resolved view on the web card. */
export interface LiteLlmPlanStatus {
  /** Configured plan id. */
  id: string
  /** Display name (the configured name or the id). */
  name: string
  /** Which LiteLLM billing object backs this entry. */
  kind: 'key' | 'budget'
  /** Amount consumed so far in the gateway's accounting unit. */
  spend: number
  /** Configured spend cap; absent while the object carries no budget. */
  maxBudget?: number
  /** Cap minus spend, negative when over budget; absent without a cap. */
  remaining?: number
  /** When the budget window resets, verbatim from the gateway. */
  resetAt?: string
}

/** One card panel refresh's result, safe to send over the Remote wire. */
export interface LiteLlmPlansSnapshot {
  generatedAt: number
  /** Successfully read entries in configured order. */
  plans: LiteLlmPlanStatus[]
  /** Per-entry failures; the sound entries stay readable. */
  failures: Array<{ id: string; message: string }>
}

/** One outbound read deadline shared by every endpoint call. */
const PLAN_QUERY_TIMEOUT_MS = 10_000

/** Fields whose presence marks an object as the billing info payload. */
const KNOWN_FIELDS = ['spend', 'total_spend', 'current_spend', 'max_budget', 'hard_budget', 'limit', 'budget_reset_at', 'reset_at'] as const

/**
 * Management API root for one deployment base. LiteLLM serves `/v1` for the
 * OpenAI-compatible surface but mounts the admin routes at the origin root,
 * so a trailing `/v1` segment is dropped.
 * @param baseURL - the configured gateway endpoint.
 * @returns the admin base URL.
 */
export function adminBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

function pickNumber(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function pickString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Prefer a nested `{ data }` object when the root carries none of the known fields. */
function unwrap(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {}
  const root = payload as Record<string, unknown>
  if (KNOWN_FIELDS.some(field => field in root)) return root
  const inner = root['data']
  if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)
    && KNOWN_FIELDS.some(field => field in (inner as Record<string, unknown>))) {
    return inner as Record<string, unknown>
  }
  return root
}

/**
 * Project one billing response onto the wire status; absent numbers default honestly.
 * @param plan - the configured entry being projected.
 * @param payload - the parsed gateway response body.
 * @returns the detached wire status.
 */
export function normalizeStatus(plan: LiteLlmPlan, payload: unknown): LiteLlmPlanStatus {
  const record = unwrap(payload)
  const spend = pickNumber(record, ['spend', 'total_spend', 'current_spend']) ?? 0
  const maxBudget = pickNumber(record, ['max_budget', 'hard_budget', 'limit'])
  const resetAt = pickString(record, ['budget_reset_at', 'reset_at'])
  return {
    id: plan.id,
    name: plan.name ?? plan.id,
    kind: plan.kind,
    spend,
    ...maxBudget === undefined ? {} : { maxBudget, remaining: maxBudget - spend },
    ...resetAt === undefined ? {} : { resetAt },
  }
}

/** Admin endpoint for one plan entry. */
function endpointFor(baseURL: string, plan: LiteLlmPlan): string {
  const param = plan.kind === 'key'
    ? `key=${encodeURIComponent(plan.target)}`
    : `budget_id=${encodeURIComponent(plan.target)}`
  return `${adminBase(baseURL)}/${plan.kind === 'key' ? 'key/info' : 'budget/info'}?${param}`
}

/** Connection facts the reader needs at call time (fresh per refresh). */
export interface LiteLlmPlansFace {
  /** The configured gateway endpoint. */
  baseURL: () => string
  /**
   * Resolve the master-key credential value once per refresh. Rejecting fails
   * the whole snapshot loudly — without a credential no entry is trustworthy.
   */
  apiKey: () => Promise<string>
}

/** Queries each configured billing object and projects a detached snapshot. */
export class LiteLlmPlansReader {
  constructor(
    private readonly face: LiteLlmPlansFace,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /**
   * Read every configured plan in order; per-entry failures ride the snapshot
   * while sound entries remain usable.
   * @param plans - the resolved configuration entries.
   * @returns the detached snapshot for the wire.
   */
  async snapshot(plans: readonly LiteLlmPlan[]): Promise<LiteLlmPlansSnapshot> {
    const key = await this.face.apiKey()
    const results = await Promise.all(plans.map(async (plan): Promise<
      { ok: true; status: LiteLlmPlanStatus } | { ok: false; id: string; message: string }
    > => {
      try {
        const response = await this.fetchFn(endpointFor(this.face.baseURL(), plan), {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(PLAN_QUERY_TIMEOUT_MS),
        })
        if (!response.ok) throw new LlmError(`gateway answered HTTP ${response.status}`, 'SERVER')
        return { ok: true as const, status: normalizeStatus(plan, await response.json()) }
      } catch (error: unknown) {
        return {
          ok: false as const,
          id: plan.id,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }))
    return {
      generatedAt: Date.now(),
      plans: results.flatMap(result => result.ok ? [result.status] : []),
      failures: results.flatMap(result => result.ok ? [] : [{ id: result.id, message: result.message }]),
    }
  }
}
