/** Hot-pluggable LiteLLM gateway provider policy. */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmCatalogEntry, LlmConfigurableProvider, LlmProviderCatalog } from '@deepseek-ai/dsh-llm'
import { authContextFrom, credentialStoreFrom, PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { Config as Schema, DEFAULT_CONFIG, resolveConfig } from './config.ts'
import type { Config, LiteLlmModel, ResolvedConfig } from './config.ts'
import { LiteLlmModelInfoService } from './model-info.ts'
import { LiteLlmPlansReader } from './plans.ts'
import { LiteLlmGatewayRemote, LiteLlmUsageLedger } from './usage.ts'

export { Config } from './config.ts'
export type { LiteLlmModel, LiteLlmPlan, LiteLlmRoutes, ResolvedConfig } from './config.ts'
export type { LiteLlmLiveModel } from './model-info.ts'
export type { LiteLlmPlanStatus, LiteLlmPlansSnapshot } from './plans.ts'
export type { LiteLlmUsageSnapshot, LiteLlmUsageRow, LiteLlmActiveModel } from './usage.ts'
export { LiteLlmGatewayRemote, LiteLlmUsageLedger } from './usage.ts'

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

function modelProfiles(options: ResolvedConfig, liveUpstreams: readonly string[]): PiAiProviderProfile {
  const aliasIds = new Set(Object.values(options.routes))
  const discovered = liveUpstreams
    .filter(id => id.length > 0 && !aliasIds.has(id) && !options.models.some(model => model.id === id))
  const merged = [
    ...options.models,
    ...discovered.map((id): LiteLlmModel => ({ id, name: id })),
  ]
  return {
    api: 'openai-completions',
    baseURL: options.baseURL,
    apiKeyEnv: options.apiKeyEnv,
    retryPolicy: retryPolicyConfig(options),
    models: merged.map(model => ({
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    })),
  }
}

/** Display name of one route alias, taken from its catalog entry when declared there. */
function routeEntry(options: ResolvedConfig, id: string): LlmCatalogEntry {
  const declared = options.models.find(model => model.id === id)
  return { id, name: declared?.name ?? id }
}

/**
 * The provider's advisory grouping for selection surfaces: the routing
 * aliases (cost/balanced/quality order; tiers aimed at one id collapse to a
 * single entry) plus the directly addressable models — the live model listing
 * discovered from the gateway minus the aliases, falling back to declared
 * catalog entries while discovery has not answered yet. Pure metadata —
 * selection still submits plain provider/model pairs.
 */
function providerCatalog(options: ResolvedConfig, liveUpstreams: readonly string[]): LlmProviderCatalog {
  const aliasIds = new Set(Object.values(options.routes))
  const routes: LlmCatalogEntry[] = []
  for (const alias of [options.routes.cost, options.routes.balanced, options.routes.quality]) {
    if (routes.some(route => route.id === alias)) continue
    routes.push(routeEntry(options, alias))
  }
  const liveNames = liveUpstreams
    .filter(name => !aliasIds.has(name))
  const models: LlmCatalogEntry[] = []
  const seen = new Set<string>()
  for (const name of liveNames) {
    seen.add(name)
    models.push({ id: name, name })
  }
  for (const model of options.models) {
    if (aliasIds.has(model.id) || seen.has(model.id)) continue
    seen.add(model.id)
    models.push({ id: model.id, name: model.name ?? model.id })
  }
  return { routes, models, credentialEnv: options.apiKeyEnv }
}

/** Install the LiteLLM route and dynamic settings. */
export function apply(ctx: Context, config: Config): void {
  const entry: Config = {
    provider: config.provider ?? DEFAULT_CONFIG.provider,
    baseURL: config.baseURL ?? DEFAULT_CONFIG.baseURL,
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_CONFIG.apiKeyEnv,
    models: config.models ?? DEFAULT_CONFIG.models,
    routes: config.routes ?? DEFAULT_CONFIG.routes,
    plans: config.plans ?? DEFAULT_CONFIG.plans,
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

  const modelInfo = new LiteLlmModelInfoService({
    baseURL: () => options().baseURL,
    apiKey: () => resolveCredentialValue(options().apiKeyEnv),
  })
  const profiles = (): ReadonlyMap<string, import('@deepseek-ai/dsh-llm-pi-ai').ResolvedPiAiProviderProfile> => {
    const resolved = options()
    return resolveProfiles({ [resolved.provider]: modelProfiles(resolved, modelInfo.uniqueUpstreams) })
  }
  const resolveCredentialValue = async (ref: import('@deepseek-ai/dsh-credentials').CredentialRef): Promise<string> => {
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? await credentials.resolve(ref)
      : launchEnvironmentOf(ctx).get(ref)
    if (hit !== undefined && hit.value.length > 0) return assertUsableApiKey(hit.value, 'llm-litellm-gateway', ref)
    throw new LlmError(`llm-litellm-gateway: no credential resolved from ${ref}`, 'MISSING_CREDENTIAL')
  }
  const resolveApiKey = async (_provider: string, resolved: import('@deepseek-ai/dsh-llm-pi-ai').ResolvedPiAiProviderProfile): Promise<string> => {
    const ref = resolved.apiKeyEnv
    if (ref === undefined) throw new LlmError('llm-litellm-gateway: apiKeyEnv is required', 'MISSING_CREDENTIAL')
    return resolveCredentialValue(ref)
  }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    resolveAttachments: () => ctx.get('attachments'),
  })

  const plansReader = new LiteLlmPlansReader({
    baseURL: () => options().baseURL,
    apiKey: () => resolveCredentialValue(options().apiKeyEnv),
    liveModelNames: () => modelInfo.uniqueUpstreams,
  })

  const usage = new LiteLlmUsageLedger()
  ctx.plugin(LiteLlmGatewayRemote, {
    ledger: usage,
    readPlans: () => plansReader.snapshot(options().plans),
    mapUpstream: alias => modelInfo.upstreamOf(alias),
  })
  ctx.on('llm/stream', (request, next) => (async function* () {
    const chunks: import('@deepseek-ai/dsh-llm').StreamChunk[] = []
    let thrown = false
    try {
      for await (const chunk of next()) {
        chunks.push(chunk)
        yield chunk
      }
    } catch (error: unknown) {
      thrown = true
      throw error
    } finally {
      usage.record(request, chunks, thrown)
    }
  })())

  let registration: AdapterRegistrationHandle | undefined
  let registrationFacts: unknown
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensure = (): void => {
    const resolved = options()
    const facts = {
      provider: resolved.provider,
      retryPolicy: resolved.retryPolicy,
      liveVersion: modelInfo.currentVersion,
    }
    if (deepEqualJson(facts, registrationFacts)) return
    if (registration === undefined) registration = ctx.llm.registerAdapter([resolved.provider], adapter)
    else registration.replace([resolved.provider])
    registrationFacts = facts
    const entries: LlmConfigurableProvider[] = [{
      provider: resolved.provider,
      displayName: 'LiteLLM Gateway',
      settingsNs: NS,
      settingsPath: [],
      catalog: providerCatalog(resolved, modelInfo.uniqueUpstreams),
    }]
    if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(entries)
    else if (!deepEqualJson(entries, directoryFacts)) directory.replace(entries)
    directoryFacts = entries
  }
  ensure()

  // Discovery refreshes asynchronously and re-runs ensure() when the gateway's
  // live model listing differs: the route mounts immediately with configured
  // models, then upgrades to the gateway's real catalog once /model/info
  // answers. Failures stay soft — the configured models keep serving.
  const refreshDiscovery = async (): Promise<void> => {
    // Discovery is advisory end to end: a failed read keeps the configured
    // models serving instead of failing the loader fiber. Credentials may be
    // seeded after this plugin boots, so a failed attempt retries with a
    // bounded backoff before giving up until the next settings change.
    const attempts = [0, 5_000, 20_000, 60_000]
    for (const delay of attempts) {
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      try {
        await modelInfo.refresh()
        ensure()
        return
      } catch { /* soft: retry or keep configured models */ }
    }
  }
  refreshDiscovery().catch(() => { /* unreachable */ })

  installSettingsSection(ctx, NS, Schema, entry, {
    validate: resolveConfig,
    setSource: (source) => { current = source },
    onChange: () => {
      ensure()
      void refreshDiscovery()
    },
  })
}
