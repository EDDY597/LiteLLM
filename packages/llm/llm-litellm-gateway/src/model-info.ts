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
    if (typeof params === 'object' && params !== null) {
      const model = (params as Record<string, unknown>)['model']
      if (typeof model === 'string' && model.length > 0) upstream = upstreamName(model)
    }
    out.push({ modelName, upstream })
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

  /** Unique concrete upstream model names (deduped across deployments). */
  get uniqueUpstreams(): readonly string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const entry of this.live) {
      if (seen.has(entry.upstream)) continue
      seen.add(entry.upstream)
      out.push(entry.upstream)
    }
    return out
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
    const direct = this.live.find(entry => entry.modelName === modelName)
    if (direct !== undefined) return direct.upstream
    return undefined
  }
}
