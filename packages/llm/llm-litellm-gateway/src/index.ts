/** Hot-pluggable LiteLLM gateway provider policy. */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { authContextFrom, credentialStoreFrom, PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { Config as Schema, DEFAULT_CONFIG, resolveConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'

export { Config } from './config.ts'
export type { LiteLlmModel, LiteLlmRoutes, ResolvedConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'llm-litellm-gateway'
/** Services required by this provider plugin. */
export const inject = ['llm']

const NS = settingsNamespace('llm-litellm-gateway')

function retryPolicyConfig(options: ResolvedConfig): import('@deepseek-ai/dsh-llm').RetryPolicyConfig {
  return {
    mode: 'normal',
    maxRetries: options.retryPolicy.maxRetries,
    retryableCodes: [...options.retryPolicy.retryableCodes],
    backoff: {
      initialDelayMs: options.retryPolicy.initialDelayMs,
      maxDelayMs: options.retryPolicy.maxDelayMs,
      jitterRatio: options.retryPolicy.jitterRatio,
    },
  }
}

function modelProfiles(options: ResolvedConfig): PiAiProviderProfile {
  return {
    api: 'openai-completions',
    baseURL: options.baseURL,
    apiKeyEnv: options.apiKeyEnv,
    retryPolicy: retryPolicyConfig(options),
    models: options.models.map(model => ({
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    })),
  }
}

/** Install the LiteLLM route and dynamic settings. */
export function apply(ctx: Context, config: Config): void {
  const entry: Config = {
    provider: config.provider ?? DEFAULT_CONFIG.provider,
    baseURL: config.baseURL ?? DEFAULT_CONFIG.baseURL,
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_CONFIG.apiKeyEnv,
    models: config.models ?? DEFAULT_CONFIG.models,
    routes: config.routes ?? DEFAULT_CONFIG.routes,
    retryPolicy: config.retryPolicy ?? DEFAULT_CONFIG.retryPolicy,
  }
  let current: () => Config = () => entry
  let lastRaw: Config | undefined
  let lastGood: ResolvedConfig | undefined
  const options = (): ResolvedConfig => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    const next = resolveConfig(raw)
    lastRaw = raw
    lastGood = next
    return next
  }
  options()

  const profiles = (): ReadonlyMap<string, import('@deepseek-ai/dsh-llm-pi-ai').ResolvedPiAiProviderProfile> => {
    const resolved = options()
    return resolveProfiles({ [resolved.provider]: modelProfiles(resolved) })
  }
  const resolveApiKey = async (_provider: string, resolved: import('@deepseek-ai/dsh-llm-pi-ai').ResolvedPiAiProviderProfile): Promise<string> => {
    const ref = resolved.apiKeyEnv
    if (ref === undefined) throw new LlmError('llm-litellm-gateway: apiKeyEnv is required', 'MISSING_CREDENTIAL')
    const hit = ctx.get('credentials') !== undefined
      ? await ctx.credentials.resolve(ref)
      : launchEnvironmentOf(ctx).get(ref)
    if (hit !== undefined && hit.value.length > 0) return assertUsableApiKey(hit.value, 'llm-litellm-gateway', ref)
    throw new LlmError(`llm-litellm-gateway: no credential resolved from ${ref}`, 'MISSING_CREDENTIAL')
  }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    resolveAttachments: () => ctx.get('attachments'),
  })

  let registration: AdapterRegistrationHandle | undefined
  let registrationFacts: unknown
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensure = (): void => {
    const resolved = options()
    const facts = { provider: resolved.provider, retryPolicy: resolved.retryPolicy }
    if (deepEqualJson(facts, registrationFacts)) return
    if (registration === undefined) registration = ctx.llm.registerAdapter([resolved.provider], adapter)
    else registration.replace([resolved.provider])
    registrationFacts = facts
    const entries: LlmConfigurableProvider[] = [{
      provider: resolved.provider,
      displayName: 'LiteLLM Gateway',
      settingsNs: NS,
      settingsPath: [],
    }]
    if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(entries)
    else if (!deepEqualJson(entries, directoryFacts)) directory.replace(entries)
    directoryFacts = entries
  }
  ensure()

  installSettingsSection(ctx, NS, Schema, entry, {
    validate: resolveConfig,
    setSource: (source) => { current = source },
    onChange: ensure,
  })
}
