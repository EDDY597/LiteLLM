import { describe, expect, it, vi } from 'vitest'
import type { LiteLlmPlan } from '../src/config.ts'
import { adminBase, LiteLlmPlansReader } from '../src/plans.ts'

const plans: LiteLlmPlan[] = [
  { id: 'main-key', name: 'Main coding plan', kind: 'key', target: 'sk-main' },
  { id: 'budget-a', kind: 'budget', target: 'budget/7' },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Recording stub returning one response per call in order. */
function fetchStub(responses: Array<Response | Error>): typeof fetch & { calls: Array<{ url: string; auth: string | null }> } {
  const calls: Array<{ url: string; auth: string | null }> = []
  let at = 0
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    calls.push({ url, auth: headers.get('authorization') })
    const next = responses[at++]
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch & { calls: Array<{ url: string; auth: string | null }> }
  fn.calls = calls
  return fn
}

function reader(fetchFn: typeof fetch): LiteLlmPlansReader {
  return new LiteLlmPlansReader({ baseURL: () => 'http://gw:4000/v1', apiKey: async () => 'sk-master' }, fetchFn)
}

describe('LiteLLM plans reader', () => {
  it('queries key and budget endpoints with the master key and normalizes wrapped payloads', async () => {
    const fetchFn = fetchStub([
      jsonResponse({ data: { key: 'hash-1', spend: 3.5, max_budget: 20, budget_reset_at: '2026-09-01T00:00:00Z' } }),
      jsonResponse({ budget_id: 'budget/7', spend: 11.25 }),
    ])
    const snapshot = await reader(fetchFn).snapshot(plans)

    expect(adminBase('http://gw:4000/v1')).toBe('http://gw:4000')
    expect(fetchFn.calls.map(call => call.url)).toEqual([
      'http://gw:4000/key/info?key=sk-main',
      'http://gw:4000/budget/info?budget_id=budget%2F7',
    ])
    for (const call of fetchFn.calls) expect(call.auth).toBe('Bearer sk-master')
    expect(snapshot.generatedAt).toBeGreaterThan(0)
    expect(snapshot.failures).toEqual([])
    expect(snapshot.plans).toEqual([
      {
        id: 'main-key', name: 'Main coding plan', kind: 'key',
        spend: 3.5, maxBudget: 20, remaining: 16.5, resetAt: '2026-09-01T00:00:00Z',
      },
      // No cap configured: spend-only view without invented numbers.
      { id: 'budget-a', name: 'budget-a', kind: 'budget', spend: 11.25 },
    ])
  })

  it('isolates per-entry failures instead of failing the whole refresh', async () => {
    const fetchFn = fetchStub([
      jsonResponse({ spend: 1 }),
      new Response('{}', { status: 500 }),
    ])
    const snapshot = await reader(fetchFn).snapshot(plans)
    expect(snapshot.plans).toEqual([{ id: 'main-key', name: 'Main coding plan', kind: 'key', spend: 1 }])
    expect(snapshot.failures).toEqual([{ id: 'budget-a', message: 'gateway answered HTTP 500' }])
  })

  it('records malformed JSON bodies and transport throws as failures', async () => {
    const fetchFn = fetchStub([
      new Response('not json', { status: 200 }),
      new Error('socket hang up'),
    ])
    const snapshot = await reader(fetchFn).snapshot(plans)
    expect(snapshot.plans).toEqual([])
    expect(snapshot.failures.map(failure => failure.id)).toEqual(['main-key', 'budget-a'])
    expect(snapshot.failures[1]?.message).toContain('socket hang up')
  })

  it('fails loudly before any request when the credential cannot resolve', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const refusing = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => { throw new Error('llm-litellm-gateway: no credential resolved from LITELLM_MASTER_KEY') },
      },
      fetchFn,
    )
    await expect(refusing.snapshot(plans)).rejects.toThrow('no credential resolved')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
