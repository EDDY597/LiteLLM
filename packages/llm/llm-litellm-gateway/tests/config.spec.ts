import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.ts'

describe('LiteLLM gateway configuration', () => {
  it('resolves the local endpoint, route aliases, and zero-retry policy', () => {
    const resolved = resolveConfig(DEFAULT_CONFIG)
    expect(resolved.provider).toBe('litellm-gateway')
    expect(resolved.baseURL).toBe('http://127.0.0.1:4000/v1')
    expect(resolved.routes).toEqual({ cost: 'dsh-cost', balanced: 'dsh-balanced', quality: 'dsh-quality' })
    expect(resolved.retryPolicy).toMatchObject({ mode: 'normal', maxRetries: 0 })
    expect(resolved.models.map(model => model.id)).toEqual([
      'deepseek-main', 'dsh-cost', 'dsh-balanced', 'dsh-quality',
    ])
  })

  it('adds a configured alias model without losing the direct model', () => {
    const resolved = resolveConfig({
      baseURL: 'http://127.0.0.1:4000/v1',
      apiKeyEnv: 'LITELLM_MASTER_KEY',
      models: [{ id: 'deepseek-main', contextWindow: 131072 }],
      routes: { balanced: 'balanced-local' },
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    })
    expect(resolved.models).toContainEqual({ id: 'deepseek-main', contextWindow: 131072 })
    expect(resolved.models.map(model => model.id)).toContain('balanced-local')
  })

  it('rejects provider retries because LiteLLM owns fallback', () => {
    expect(() => resolveConfig({ retryPolicy: { mode: 'normal', maxRetries: 1 } }))
      .toThrow('configure retries in LiteLLM')
  })
  it('deduplicates route aliases that name the same gateway model', () => {
    const resolved = resolveConfig({
      routes: { cost: 'economy', balanced: 'economy' },
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    })
    expect(resolved.models.filter(model => model.id === 'economy')).toHaveLength(1)
  })
})
