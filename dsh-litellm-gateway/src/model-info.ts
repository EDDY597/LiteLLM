/**
 * Live model information from the LiteLLM gateway's admin API.
 *
 * `/model/info` is the one authoritative listing of what the gateway can
 * actually serve: each entry pairs the public `model_name` clients address
 * with the concrete upstream in `litellm_params.model` (for example
 * `deepseek/deepseek-v4-flash`). This module caches that listing so the
 * plugin can (a) merge real model names into the session directory, and
 * (b) translate a routed alias into the concrete upstream name the router
 * picked — the response body only echoes the alias.
 *
 * @module @deepseek-ai/dsh-llm-litellm-gateway/model-info
 */

/** One live model served by the gateway. */
export interface LiteLlmLiveModel {
  /** Public model_name clients send (an alias or a concrete model). */
  modelName: string
  /** Upstream identifier behind this entry, provider prefix stripped. */
  upstream: string
  /** Full configured LiteLLM deployment model (including protocol prefix). */
  deployment?: string
  /** Provider label derived from the configured model prefix or endpoint. */
  supplier: string
  /** Stable LiteLLM deployment hash returned in model_info.id, when present. */
  deploymentId?: string
}

/** Connection facts shared with the plans reader. */
export interface LiteLlmModelInfoFace {
  baseURL: () => string
  apiKey: () => Promise<string>
}

/** One outbound read deadline shared by every endpoint call. */
export const PLAN_QUERY_TIMEOUT_MS = 10_000

/** Admin API root for one deployment base: a trailing `/v1` belongs to the OpenAI-compatible surface only. */
export function adminBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** Strip a provider prefix (`deepseek/`, `openai/`, …) from an upstream identifier. */
export function upstreamName(litellmModel: string): string {
  const slash = litellmModel.indexOf('/')
  return slash >= 0 ? litellmModel.slice(slash + 1) : litellmModel
}

/** Derive a concise provider label from the configured model prefix. */
export function supplierName(litellmModel: string, apiBase?: string): string {
  const slash = litellmModel.indexOf('/')
  const prefix = slash > 0 ? litellmModel.slice(0, slash) : 'litellm'
  if (prefix !== 'openai') return prefix
  const base = (apiBase ?? '').toLowerCase()
  if (base.includes('opencode.ai')) return 'opencode'
  if (base.includes('siliconflow.cn')) return 'siliconflow'
  if (base.includes('dashscope.aliyuncs.com')) return 'dashscope'
  if (base.includes('bigmodel.cn')) return 'zhipu'
  if (base.includes('agnes-ai')) return 'agnes'
  if (base.includes('minimaxi.com')) return 'minimax'
  return prefix
}

export function supplierFromModel(litellmModel: string, apiBase?: string): string {
  return supplierName(litellmModel, apiBase)
}

/**
 * Read the gateway's model listing into normalized entries; tolerant of
 * `{ data: [...] }` wrappers across proxy versions.
 * @param payload - the parsed `/model/info` response body.
 * @returns the normalized live-model entries.
 */
export function parseModelInfo(payload: unknown): LiteLlmLiveModel[] {
  let list: unknown = payload
  if (typeof list === 'object' && list !== null && !Array.isArray(list)) {
    const data = (list as { data?: unknown }).data
    if (Array.isArray(data)) list = data
  }
  if (!Array.isArray(list)) return []
  const out: LiteLlmLiveModel[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const modelName = record['model_name']
    const params = record['litellm_params']
    if (typeof modelName !== 'string' || modelName.length === 0) continue
    let upstream = modelName
    let configuredModel = modelName
    let apiBase: string | undefined
    let deploymentId: string | undefined
    if (typeof params === 'object' && params !== null) {
      const model = (params as Record<string, unknown>)['model']
      if (typeof model === 'string' && model.length > 0) {
        configuredModel = model
        upstream = upstreamName(model)
      }
      const base = (params as Record<string, unknown>)['api_base']
      if (typeof base === 'string') apiBase = base
      const info = record['model_info']
      if (typeof info === 'object' && info !== null) {
        const id = (info as Record<string, unknown>)['id']
        if (typeof id === 'string' && id.length > 0) deploymentId = id
      }
    }
    out.push({ modelName, upstream, supplier: supplierName(configuredModel, apiBase), ...configuredModel !== modelName ? { deployment: configuredModel } : {}, ...deploymentId === undefined ? {} : { deploymentId } })
  }
  return out
}

/** Cached model listing plus alias→upstream resolution for the composer badge. */
export class LiteLlmModelInfoService {
  private live: LiteLlmLiveModel[] = []
  private version = 0

  constructor(
    private readonly face: LiteLlmModelInfoFace,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Monotonic stamp bumped on every successful refresh; drivers use it to notice changes. */
  get currentVersion(): number {
    return this.version
  }

  /** The cached listing (empty before the first successful refresh). */
  get snapshot(): readonly LiteLlmLiveModel[] {
    return this.live
  }

  /** Unique concrete upstream model names, with supplier prefix on collisions. */
  get uniqueUpstreams(): readonly string[] {
    const counts = new Map<string, number>()
    for (const entry of this.live) {
      counts.set(entry.upstream, (counts.get(entry.upstream) ?? 0) + 1)
    }
    const seen = new Set<string>()
    const out: string[] = []
    for (const entry of this.live) {
      const label = (counts.get(entry.upstream) ?? 0) > 1
        ? `${entry.supplier}/${entry.upstream}`
        : entry.upstream
      if (seen.has(label)) continue
      seen.add(label)
      out.push(label)
    }
    return out
  }

  /** Unique public model_name values accepted by LiteLLM. */
  get uniqueModelNames(): readonly string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const entry of this.live) {
      if (seen.has(entry.modelName)) continue
      seen.add(entry.modelName)
      out.push(entry.modelName)
    }
    return out
  }

  /** Direct, non-router deployments with stable LiteLLM ids. */
  get directDeployments(): readonly LiteLlmLiveModel[] {
    const rows = this.live.filter(entry => entry.deploymentId !== undefined && !entry.modelName.startsWith('dsh-') && !entry.deployment?.startsWith('auto_router/'))
    return [...rows].sort((left, right) => {
      const leftPeers = rows.filter(entry => entry.upstream.toLowerCase() === left.upstream.toLowerCase()).length
      const rightPeers = rows.filter(entry => entry.upstream.toLowerCase() === right.upstream.toLowerCase()).length
      return rightPeers - leftPeers || `${left.supplier}/${left.upstream}`.localeCompare(`${right.supplier}/${right.upstream}`)
    })
  }

  displayName(entry: LiteLlmLiveModel): string {
    const peers = this.directDeployments.filter(candidate => candidate.upstream.toLowerCase() === entry.upstream.toLowerCase())
    const name = entry.upstream
    return peers.length > 1 ? `${entry.supplier}/${name}` : name
  }

  displayNameOf(deploymentId: string): string | undefined {
    const entry = this.directDeployments.find(candidate => candidate.deploymentId === deploymentId)
    return entry === undefined ? undefined : this.displayName(entry)
  }

  /**
   * Refresh the listing; a failure keeps the previous cache and lets the
   * caller decide whether the error is loud (discovery stays soft).
   * @returns the fresh listing.
   */
  async refresh(): Promise<readonly LiteLlmLiveModel[]> {
    const key = await this.face.apiKey()
    const response = await this.fetchFn(`${adminBase(this.face.baseURL())}/model/info`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PLAN_QUERY_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`gateway answered HTTP ${response.status}`)
    this.live = parseModelInfo(await response.json())
    this.version += 1
    return this.live
  }

  /**
   * Resolve a routed alias to the concrete upstream the gateway serves for it.
   * @param modelName - the alias or model name a completion reported.
   * @returns the upstream name, or undefined when unknown (callers keep the input).
   */
  upstreamOf(modelName: string): string | undefined {
    const direct = this.live.find(entry => entry.modelName === modelName || entry.deploymentId === modelName)
    if (direct !== undefined) return direct.upstream
    return modelName.length > 0 ? modelName : undefined
  }
}
