/**
 * Reads spend and remaining quota for the gateway's models from LiteLLM's own
 * management endpoints, using the same master-key credential that serves
 * requests.
 *
 * Two row sources merge into one snapshot:
 * - **auto rows** — every model the gateway serves (`/model/info`) with its
 *   consumed spend from `/spend/report` (last 30 days). Zero configuration.
 * - **plan rows** — optional `plans` config entries (api keys and budgets)
 *   for deployments that attach spending caps; these add cap/remaining.
 *
 * Responses vary across proxy versions — some wrap payloads in `{ data }` —
 * so field extraction is tolerant and per-row failures isolate instead of
 * failing the whole snapshot.
 *
 * @module @deepseek-ai/dsh-llm-litellm-gateway/plans
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LiteLlmPlan } from './config.ts'
import { adminBase, PLAN_QUERY_TIMEOUT_MS } from './model-info.ts'

/** One billing entry's resolved view on the web card. */
export interface LiteLlmPlanStatus {
  /** Stable row id (plan id or model name). */
  id: string
  /** Display name. */
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
  /** Auto model rows first, then configured plan rows. */
  plans: LiteLlmPlanStatus[]
  /** Per-source failures; the sound rows stay readable. */
  failures: Array<{ id: string; message: string }>
}

/** Fields whose presence marks an object as the billing info payload. */
const KNOWN_FIELDS = ['spend', 'total_spend', 'current_spend', 'max_budget', 'hard_budget', 'limit', 'budget_reset_at', 'reset_at'] as const

/** How many days of spend history the auto rows cover. */
const SPEND_REPORT_DAYS = 30

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

/** Project one plan-object response onto the wire status; absent numbers default honestly. */
function normalizePlan(plan: LiteLlmPlan, payload: unknown): LiteLlmPlanStatus {
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
  /** Live model names the gateway serves; drives the automatic model rows. */
  liveModelNames: () => readonly string[]
}

/** Queries model spend and configured billing objects into one detached snapshot. */
export class LiteLlmPlansReader {
  constructor(
    private readonly face: LiteLlmPlansFace,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /**
   * Read auto model rows plus every configured plan in order; per-source
   * failures ride the snapshot while sound rows remain usable.
   * @param plans - the resolved configuration entries.
   * @returns the detached snapshot for the wire.
   */
  async snapshot(plans: readonly LiteLlmPlan[]): Promise<LiteLlmPlansSnapshot> {
    const key = await this.face.apiKey()
    const auth = { authorization: `Bearer ${key}` }
    const base = adminBase(this.face.baseURL())
    const signal = AbortSignal.timeout(PLAN_QUERY_TIMEOUT_MS)
    const failures: Array<{ id: string; message: string }> = []

    const perModel = new Map<string, number>()
    const reportEnd = new Date()
    const reportStart = new Date(reportEnd.getTime() - SPEND_REPORT_DAYS * 24 * 60 * 60 * 1000)
    const iso = (date: Date): string => date.toISOString().slice(0, 10)
    let report: unknown
    try {
      const response = await this.fetchFn(
        `${base}/spend/report?start_date=${iso(reportStart)}&end_date=${iso(reportEnd)}`,
        { headers: auth, signal },
      )
      if (!response.ok) throw new LlmError(`gateway answered HTTP ${response.status}`, 'SERVER')
      report = await response.json()
    } catch (error: unknown) {
      failures.push({
        id: 'spend-report',
        message: error instanceof Error ? error.message : String(error),
      })
    }
    for (const row of spendRows(report)) {
      const model = pickString(row, ['model', 'model_group', 'model_name'])
      const spend = pickNumber(row, ['spend', 'total_spend'])
      if (model !== undefined && spend !== undefined) perModel.set(model, (perModel.get(model) ?? 0) + spend)
    }

    const rows: LiteLlmPlanStatus[] = []
    for (const name of this.face.liveModelNames()) {
      rows.push({
        id: `model:${name}`,
        name,
        kind: 'key',
        spend: perModel.get(name) ?? 0,
      })
    }
    const results = await Promise.all(plans.map(async (plan): Promise<
      { ok: true; status: LiteLlmPlanStatus } | { ok: false; id: string; message: string }
    > => {
      try {
        const response = await this.fetchFn(endpointFor(base, plan), {
          headers: auth,
          signal: AbortSignal.timeout(PLAN_QUERY_TIMEOUT_MS),
        })
        if (!response.ok) throw new LlmError(`gateway answered HTTP ${response.status}`, 'SERVER')
        return { ok: true as const, status: normalizePlan(plan, await response.json()) }
      } catch (error: unknown) {
        return {
          ok: false as const,
          id: plan.id,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }))
    for (const result of results) {
      if (result.ok) rows.push(result.status)
      else failures.push({ id: result.id, message: result.message })
    }
    return { generatedAt: Date.now(), plans: rows, failures }
  }
}

/**
 * Extract the per-model spend rows from a `/spend/report` payload; the
 * breakdown rides `breakdown` (common) or a bare array on older proxies.
 */
function spendRows(report: unknown): Array<Record<string, unknown>> {
  if (typeof report !== 'object' || report === null) return []
  const root = report as Record<string, unknown>
  const rows: unknown = Array.isArray(root['breakdown'])
    ? root['breakdown']
    : Array.isArray(report)
      ? report
      : undefined
  if (!Array.isArray(rows)) return []
  return rows.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
}
