import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as LiteLlmGateway from '../src/index.ts'

const NS = settingsNamespace('llm-litellm-gateway')

class MemorySettings extends SettingsProvider {
  private rawDocument: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.rawDocument))
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.rawDocument = { ...this.rawDocument, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(LiteLlmGateway, {})
  return ctx
}

describe('LiteLLM gateway lifecycle', () => {
  it('registers the default route, publishes its routing catalog, and removes both with the fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = ctx.plugin(LiteLlmGateway, {})
    await fiber.await()

    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['litellm-gateway'])
    expect((await ctx.llm.listModels('litellm-gateway')).map(model => model.id)).toEqual([
      'deepseek-main', 'dsh-cost', 'dsh-balanced', 'dsh-quality',
    ])
    expect(ctx.llm.providerRetryPolicy('litellm-gateway')).toMatchObject({ mode: 'normal', maxRetries: 0 })
    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'litellm-gateway',
      displayName: 'LiteLLM Gateway',
      settingsNs: NS,
      settingsPath: [],
      catalog: {
        routes: [
          { id: 'dsh-cost', name: 'Cost Saving' },
          { id: 'dsh-balanced', name: 'Balanced' },
          { id: 'dsh-quality', name: 'High Quality' },
        ],
        models: [{ id: 'deepseek-main', name: 'DeepSeek Main' }],
        credentialEnv: 'LITELLM_MASTER_KEY',
      },
    }])

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('atomically replaces the route and catalog from live settings', async () => {
    const ctx = await boot()

    await ctx.settings.replace(NS, {
      provider: 'private-litellm',
      models: [{ id: 'gateway-main', contextWindow: 131_072, maxTokens: 8_192 }],
      routes: { cost: 'gateway-main', balanced: 'gateway-main', quality: 'gateway-main' },
    })

    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['private-litellm'])
    expect(await ctx.llm.listModels('private-litellm')).toEqual([{
      provider: 'private-litellm',
      id: 'gateway-main',
      name: 'gateway-main',
      inputModalities: ['text'],
    }])
    expect(await ctx.llm.resolveModelInfo('private-litellm', 'gateway-main')).toMatchObject({
      context: { contextWindow: 131_072 },
      defaultMaxTokens: 8_192,
    })
    // Every alias points at one id here, so it is a route first and appears
    // exactly once — in the routes slice.
    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'private-litellm',
      displayName: 'LiteLLM Gateway',
      settingsNs: NS,
      settingsPath: [],
      catalog: {
        routes: [{ id: 'gateway-main', name: 'gateway-main' }],
        models: [],
        credentialEnv: 'LITELLM_MASTER_KEY',
      },
    }])
    await ctx.fiber.dispose()
  })
})
