/** LiteLLM gateway configuration and route resolution. */

import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ResolvedNormalRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'

/** A virtual model advertised by the LiteLLM gateway. */
export interface LiteLlmModel {
  /** Model id accepted by LiteLLM, for example `dsh-balanced`. */
  id: string
  /** Optional selector label. */
  name?: string
  /** Context capacity supplied by the gateway deployment. */
  contextWindow?: number
  /** Default output cap supplied by the gateway deployment. */
  maxTokens?: number
}

/** User preference aliases sent to LiteLLM's complexity router. */
export interface LiteLlmRoutes {
  /** Cost-saving alias. */
  cost: string
  /** Balanced alias and default. */
  balanced: string
  /** Quality-first alias. */
  quality: string
}

/** Plugin configuration. */
export interface Config {
  /** Harness provider route. */
  provider?: string
  /** Local/private LiteLLM endpoint. */
  baseURL?: string
  /** Environment-variable credential reference. */
  apiKeyEnv?: string
  /** Models exposed by the endpoint. */
  models?: LiteLlmModel[]
  /** User-facing route aliases. */
  routes?: Partial<LiteLlmRoutes>
  /** Provider retry policy; LiteLLM owns retry/fallback, so maxRetries must be zero. */
  retryPolicy?: RetryPolicyConfig
}

/** Fully resolved configuration used by the plugin. */
export interface ResolvedConfig {
  provider: string
  baseURL: string
  apiKeyEnv: CredentialRef
  models: LiteLlmModel[]
  routes: LiteLlmRoutes
  retryPolicy: ResolvedNormalRetryPolicy
}

const DEFAULT_PROVIDER = 'litellm-gateway'
const DEFAULT_BASE_URL = 'http://127.0.0.1:4000/v1'
const DEFAULT_API_KEY_ENV = 'LITELLM_MASTER_KEY'
const DEFAULT_ROUTES: LiteLlmRoutes = {
  cost: 'dsh-cost',
  balanced: 'dsh-balanced',
  quality: 'dsh-quality',
}
const DEFAULT_MODELS: LiteLlmModel[] = [
  { id: 'deepseek-main', name: 'DeepSeek Main' },
  { id: 'dsh-cost', name: 'Cost Saving' },
  { id: 'dsh-balanced', name: 'Balanced' },
  { id: 'dsh-quality', name: 'High Quality' },
]

const model: z<LiteLlmModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number(),
  maxTokens: z.number(),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV),
  models: z.array(model).default(DEFAULT_MODELS),
  routes: z.object({ cost: z.string(), balanced: z.string(), quality: z.string() }).default(DEFAULT_ROUTES),
  retryPolicy: RetryPolicySchema.default({ mode: 'normal', maxRetries: 0 }),
})

/**
 * Resolve and validate deployment configuration once per settings snapshot.
 * @param source - composition or settings values to resolve.
 * @returns a detached configuration ready to build one adapter profile.
 */
export function resolveConfig(source: Config): ResolvedConfig {
  const provider = source.provider ?? DEFAULT_PROVIDER
  const baseURL = source.baseURL ?? DEFAULT_BASE_URL
  const apiKeyEnv = source.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  if (provider.length === 0) throw new Error('llm-litellm-gateway: provider must be non-empty')
  if (baseURL.length === 0) throw new Error('llm-litellm-gateway: baseURL must be non-empty')
  const routes = { ...DEFAULT_ROUTES, ...source.routes }
  const models = (source.models ?? DEFAULT_MODELS).map(entry => ({ ...entry }))
  const ids = new Set<string>()
  for (const entry of models) {
    if (entry.id.length === 0 || ids.has(entry.id)) throw new Error(`llm-litellm-gateway: duplicate model "${entry.id}"`)
    ids.add(entry.id)
    if (entry.contextWindow !== undefined && (!Number.isSafeInteger(entry.contextWindow) || entry.contextWindow <= 0)) {
      throw new Error(`llm-litellm-gateway: model "${entry.id}" contextWindow must be positive`)
    }
    if (entry.maxTokens !== undefined && (!Number.isSafeInteger(entry.maxTokens) || entry.maxTokens <= 0)) {
      throw new Error(`llm-litellm-gateway: model "${entry.id}" maxTokens must be positive`)
    }
  }
  for (const alias of Object.values(routes)) {
    if (ids.has(alias)) continue
    models.push({ id: alias, name: alias })
    ids.add(alias)
  }
  const retryPolicy = resolveRetryPolicy(source.retryPolicy, 'llm-litellm-gateway: retryPolicy')
  if (retryPolicy.mode !== 'normal' || retryPolicy.maxRetries !== 0) {
    throw new Error('llm-litellm-gateway: retryPolicy must use mode "normal" with maxRetries 0; configure retries in LiteLLM')
  }
  return {
    provider,
    baseURL,
    apiKeyEnv: credentialRef(apiKeyEnv),
    models,
    routes,
    retryPolicy,
  }
}

/** Default settings used by an absent section and by composition examples. */
export const DEFAULT_CONFIG = {
  provider: DEFAULT_PROVIDER,
  baseURL: DEFAULT_BASE_URL,
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  models: DEFAULT_MODELS,
  routes: DEFAULT_ROUTES,
  retryPolicy: { mode: 'normal', maxRetries: 0 },
} satisfies Config
