/** Browser-local staged form and usage state for the LiteLLM card. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { LiteLlmModel, LiteLlmRoutes } from '../config.ts'
import type { LiteLlmActiveModel, LiteLlmUsageSnapshot } from '../usage.ts'
import type { LiteLlmPlansSnapshot } from '../plans.ts'

/** Settings fields served by the LiteLLM namespace. */
export interface LiteLlmSettings {
  provider?: string
  baseURL?: string
  apiKeyEnv?: string
  models?: LiteLlmModel[]
  routes?: Partial<LiteLlmRoutes>
}

/** State rendered by the card. */
export interface LiteLlmGatewayState {
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  invalid: boolean
  failed: boolean
  fields: Record<'provider' | 'baseURL' | 'apiKeyEnv' | 'models' | 'cost' | 'balanced' | 'quality', { text: string; overridden: boolean; invalid: boolean }>
  usage: { status: 'cold' | 'loading' | 'ready' | 'error'; value: LiteLlmUsageSnapshot | null }
  plans: { status: 'cold' | 'loading' | 'ready' | 'error'; value: LiteLlmPlansSnapshot | null }
}

/** Remote shape used by the controller; generated Remote results preserve transport failures. */
export interface LiteLlmUsageRemote {
  usage: () => Promise<{ ok: true; value: LiteLlmUsageSnapshot } | { ok: false; error: { code: string; message: string } }>
  activeModel: () => Promise<{ ok: true; value: LiteLlmActiveModel | null } | { ok: false; error: { code: string; message: string } }>
  plans: () => Promise<{ ok: true; value: LiteLlmPlansSnapshot } | { ok: false; error: { code: string; message: string } }>
}

/** Injected actions and state hook for the card slot. */
export interface LiteLlmGatewayFace {
  hooks: { liteLlmGateway: SnapshotStore<LiteLlmGatewayState> }
  edit: (field: keyof LiteLlmGatewayState['fields'], text: string) => void
  reset: (field: keyof LiteLlmGatewayState['fields']) => void
  save: () => void
  discard: () => void
  refreshUsage: () => void
}

/** Card form defaults mirrored from the host configuration defaults. */
const DEFAULTS = { provider: 'litellm-gateway', baseURL: 'http://127.0.0.1:4000/v1', apiKeyEnv: 'LITELLM_MASTER_KEY', cost: 'dsh-cost', balanced: 'dsh-balanced', quality: 'dsh-quality' }
type Field = keyof LiteLlmGatewayState['fields']

function textOf(value: unknown): string { return typeof value === 'string' ? value : '' }
function jsonOf(value: unknown): string { return Array.isArray(value) ? JSON.stringify(value, null, 2) : '' }

/** Owns drafts and dashboard reads for one LiteLLM settings namespace. */
export class LiteLlmGatewayController {
  private readonly drafts = new Map<Field, string>()
  private saving = false
  private failed = false
  private usageState: LiteLlmGatewayState['usage'] = { status: 'cold', value: null }
  private plansState: LiteLlmGatewayState['plans'] = { status: 'cold', value: null }
  private readonly store: SnapshotStore<LiteLlmGatewayState>

  constructor(private readonly scope: SettingsScope<LiteLlmSettings>, private readonly remote: LiteLlmUsageRemote) {
    this.store = createSnapshotStore(this.project())
    scope.subscribe(() => { this.store.set(this.project()) })
  }

  /**
   * Expose the card's injected face: the shared state store plus the editing,
   * save/discard, and dashboard-refresh actions.
   * @returns the face consumed by the settings card slot.
   */
  inject(): LiteLlmGatewayFace {
    return {
      hooks: { liteLlmGateway: this.store },
      edit: (field, text) => { this.drafts.set(field, text); this.failed = false; this.store.set(this.project()) },
      reset: (field) => { this.drafts.set(field, ''); this.failed = false; this.store.set(this.project()) },
      save: () => { void this.save() },
      discard: () => { this.drafts.clear(); this.failed = false; this.store.set(this.project()) },
      refreshUsage: () => { void this.refreshUsage() },
    }
  }

  private value(field: Field): unknown {
    const snapshot = this.scope.getSnapshot().value as LiteLlmSettings | undefined
    if (field === 'cost' || field === 'balanced' || field === 'quality') return snapshot?.routes?.[field]
    return snapshot?.[field]
  }

  private field(field: Field) {
    const staged = this.drafts.get(field)
    const value = field === 'models' ? jsonOf(this.value(field)) : textOf(this.value(field))
    const text = staged ?? value
    let invalid = false
    if (field === 'models' && staged !== undefined && staged.trim() !== '') {
      try { const parsed: unknown = JSON.parse(staged); invalid = !Array.isArray(parsed) } catch { invalid = true }
    }
    return { text, overridden: staged !== undefined || Object.hasOwn(this.scope.getSnapshot().user ?? {}, field), invalid }
  }

  private project(): LiteLlmGatewayState {
    const fields = Object.fromEntries((['provider', 'baseURL', 'apiKeyEnv', 'models', 'cost', 'balanced', 'quality'] as Field[]).map(field => [field, this.field(field)])) as LiteLlmGatewayState['fields']
    const invalid = Object.values(fields).some(item => item.invalid)
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: this.drafts.size > 0,
      saving: this.saving,
      invalid,
      failed: this.failed,
      fields,
      usage: this.usageState,
      plans: this.plansState,
    }
  }

  private async save(): Promise<void> {
    const writes: Array<Promise<unknown>> = []
    for (const [field, text] of this.drafts) {
      if (field === 'models') {
        let value: unknown
        try { value = JSON.parse(text) } catch { continue }
        if (!Array.isArray(value)) continue
        writes.push(this.scope.set('models', value))
      } else if (field === 'cost' || field === 'balanced' || field === 'quality') {
        writes.push(this.scope.set(`routes.${field}`, text.trim()))
      } else {
        writes.push(text.trim() === '' ? this.scope.unset(field) : this.scope.set(field, text.trim()))
      }
    }
    if (writes.length === 0 || this.saving) return
    this.saving = true; this.store.set(this.project())
    try { await Promise.all(writes); this.drafts.clear(); this.failed = false } catch { this.failed = true }
    this.saving = false; this.store.set(this.project())
  }

  private async refreshUsage(): Promise<void> {
    this.usageState = { status: 'loading', value: this.usageState.value }
    this.plansState = { status: 'loading', value: this.plansState.value }
    this.store.set(this.project())
    // One refresh serves both dashboards; each settles independently so a
    // balance failure never blanks usage counters or vice versa.
    const [usage, plans] = await Promise.allSettled([this.remote.usage(), this.remote.plans()])
    this.usageState = usage.status === 'fulfilled' && usage.value.ok
      ? { status: 'ready', value: usage.value.value }
      : { status: 'error', value: null }
    this.plansState = plans.status === 'fulfilled' && plans.value.ok
      ? { status: 'ready', value: plans.value.value }
      : { status: 'error', value: null }
    this.store.set(this.project())
  }
}

export { DEFAULTS }
