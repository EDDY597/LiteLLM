import { describe, expect, it, vi } from 'vitest'
import type { LiteLlmPlan } from '../src/config.ts'
import { adminBase } from '../src/model-info.ts'
import { LiteLlmPlansReader } from '../src/plans.ts'
import type { LiteLlmPlansFace, LiteLlmPlansOptions } from '../src/plans.ts'

const plans: LiteLlmPlan[] = [
  { id: 'main-key', name: 'Main coding plan', kind: 'key', target: 'sk-main' },
  { id: 'budget-a', kind: 'budget', target: 'budget/7' },
]

const liveModels = [
  { id: 'deploy-a', name: 'opencode/deepseek-v4-flash', deployment: 'openai/deepseek-v4-flash', upstream: 'deepseek-v4-flash', modelName: 'strong' },
  { id: 'deploy-b', name: 'qwen-3.8', deployment: 'openai/qwen-3.8', upstream: 'qwen-3.8', modelName: 'premium' },
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
  return new LiteLlmPlansReader(
    {
      baseURL: () => 'http://gw:4000/v1',
      apiKey: async () => 'sk-master',
      liveModels: () => liveModels,
    },
    fetchFn,
  )
}

describe('LiteLLM plans reader', () => {
  it('reads model spend rows and plan entries with the master key', async () => {
    const fetchFn = fetchStub([
      jsonResponse([{ 'group-by-day': '2026-08-28', teams: [{ keys: [{ usage: { 'openai/deepseek-v4-flash': { cost: 2.5 } } }] }] }]),
      jsonResponse({ data: { key: 'hash-1', spend: 3.5, max_budget: 20, budget_reset_at: '2026-09-01T00:00:00Z' } }),
      jsonResponse({ budget_id: 'budget/7', spend: 11.25 }),
    ])
    const snapshot = await reader(fetchFn).snapshot(plans)

    expect(adminBase('http://gw:4000/v1')).toBe('http://gw:4000')
    expect(fetchFn.calls[0]?.url).toMatch(
      /^http:\/\/gw:4000\/global\/spend\/report\?start_date=\d{4}-\d{2}-\d{2}&end_date=\d{4}-\d{2}-\d{2}$/,
    )
    expect(fetchFn.calls.slice(1).map(call => call.url)).toEqual([
      'http://gw:4000/key/info?key=sk-main',
      'http://gw:4000/budget/info?budget_id=budget%2F7',
    ])
    for (const call of fetchFn.calls) expect(call.auth).toBe('Bearer sk-master')
    expect(snapshot.generatedAt).toBeGreaterThan(0)
    expect(snapshot.failures).toEqual([])
    // Auto model rows first (models without reported spend default to 0),
    // then the configured plan entries.
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model', spend: 2.5 },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model' },
      {
        id: 'main-key', name: 'Main coding plan', kind: 'key',
        spend: 3.5, maxBudget: 20, remaining: 16.5, resetAt: '2026-09-01T00:00:00Z',
      },
      { id: 'budget-a', name: 'budget-a', kind: 'budget', spend: 11.25 },
    ])
  })

  it('isolates per-source failures instead of failing the whole refresh', async () => {
    const fetchFn = fetchStub([
      jsonResponse([{ model: 'deploy-a', spend: 1 }]),
      jsonResponse({ data: { spend: 2, max_budget: 5 } }),
      new Response('{}', { status: 500 }),
    ])
    const snapshot = await reader(fetchFn).snapshot(plans)
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model', spend: 1 },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model' },
      { id: 'main-key', name: 'Main coding plan', kind: 'key', spend: 2, maxBudget: 5, remaining: 3 },
    ])
    expect(snapshot.failures).toEqual([{ id: 'budget-a', message: 'gateway answered HTTP 500' }])
  })

  it('records malformed JSON bodies and transport throws as failures', async () => {
    const fetchFn = fetchStub([
      new Response('not json', { status: 200 }),
      new Response('not json', { status: 200 }),
      new Error('socket hang up'),
    ])
    const snapshot = await reader(fetchFn).snapshot(plans)
    // Malformed accounting data leaves model spend absent; plan reads fail independently.
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model' },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model' },
    ])
    expect(snapshot.failures.map(failure => failure.id)).toEqual(['accounting', 'main-key', 'budget-a'])
    expect(snapshot.failures[2]?.message).toContain('socket hang up')
  })

  it('fails loudly before any request when the credential cannot resolve', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const refusing = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => { throw new Error('llm-litellm-gateway: no credential resolved from LITELLM_MASTER_KEY') },
        liveModels: () => liveModels,
      },
      fetchFn,
    )
    await expect(refusing.snapshot(plans)).rejects.toThrow('no credential resolved')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('reports a missing LiteLLM database without inventing zero spend', async () => {
    const fetchFn = fetchStub([
      jsonResponse({ detail: { error: 'Database not connected. Connect a database to your proxy' } }, 400),
    ])
    const snapshot = await reader(fetchFn).snapshot([])
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model' },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model' },
    ])
    expect(snapshot.failures).toEqual([{
      id: 'accounting', code: 'DATABASE_NOT_CONNECTED',
      message: 'Database not connected. Connect a database to your proxy',
    }])
  })

  it('skips spend report and model rows when includeSpendReport is false', async () => {
    const fetchFn = fetchStub([
      jsonResponse({ budget_id: 'budget/7', spend: 11.25, max_budget: 50 }),
    ])
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => liveModels,
      },
      fetchFn,
      { includeSpendReport: false },
    )
    // Only pass the budget plan — the key plan has no mock response and would fail.
    const snapshot = await noReportReader.snapshot([{ id: 'budget-a', kind: 'budget', target: 'budget/7' }])
    expect(fetchFn.calls.every(call => !call.url.includes('/global/spend/report'))).toBe(true)
    expect(snapshot.plans).toEqual([
      { id: 'budget-a', name: 'budget-a', kind: 'budget', spend: 11.25, maxBudget: 50, remaining: 38.75 },
    ])
    expect(snapshot.failures).toEqual([])
  })

  it('defaults spend to 0 when the plan response carries no spend field', async () => {
    const fetchFn = fetchStub([jsonResponse({ budget_id: 'budget/7' })])
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => liveModels,
      },
      fetchFn,
      { includeSpendReport: false },
    )
    const snapshot = await noReportReader.snapshot([{ id: 'no-spend', kind: 'budget', target: 'budget/7' }])
    expect(snapshot.plans).toEqual([{ id: 'no-spend', name: 'no-spend', kind: 'budget', spend: 0 }])
  })

  it('falls back to root error shape when detail.error.message is absent', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response('{}', { status: 400 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'bad', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'bad', message: 'gateway answered HTTP 400' }])
  })

  it('propagates non-Error throws from the credential resolver', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const refusing = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => { throw 'not-an-error' as never },
        liveModels: () => liveModels,
      },
      fetchFn,
    )
    await expect(refusing.snapshot([])).rejects.toThrow('not-an-error')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('handles a malformed report payload gracefully during collectModelSpend', async () => {
    const fetchFn = fetchStub([
      jsonResponse('not-an-object'),
      jsonResponse({ budget_id: 'budget/7', spend: 1 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/7' }])
    // Non-object report → collectModelSpend returns without error; model rows are zero-spend.
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model' },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model' },
      { id: 'b', name: 'b', kind: 'budget', spend: 1 },
    ])
  })

  it('falls back to root-level error object when detail has no message field', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 502 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'upstream down' }])
  })

  it('rejects a plan read when the gateway returns valid JSON with HTTP error and no error shape', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response(JSON.stringify({ foo: 'bar' }), { status: 500 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'gateway answered HTTP 500' }])
  })

  it('throws when the credential resolver throws a non-Error value', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const refusing = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => { throw 'string-error' as never },
        liveModels: () => liveModels,
      },
      fetchFn,
    )
    await expect(refusing.snapshot([])).rejects.toThrow('string-error')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rejects a plan read when the gateway returns empty body with HTTP 200', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response('', { status: 200 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'gateway returned invalid JSON' }])
  })

  it('returns the root object when the root already carries a known field even if data also has one', async () => {
    const fetchFn = fetchStub([
      jsonResponse({ spend: 5, key: 'hash-1' }),
    ])
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => [],
      },
      fetchFn,
      { includeSpendReport: false },
    )
    const snapshot = await noReportReader.snapshot([{ id: 'b', kind: 'key', target: 'hash-1' }])
    // Root has 'spend', so unwrap returns root directly.
    expect(snapshot.plans).toEqual([{ id: 'b', name: 'b', kind: 'key', spend: 5 }])
  })

  it('handles a non-Error throw from the credential resolver', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const refusing = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => { throw 42 as never },
        liveModels: () => liveModels,
      },
      fetchFn,
    )
    // Non-Error throws during apiKey() bubble up; snapshot does not catch them.
    await expect(refusing.snapshot([])).rejects.toBe(42)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('handles detail.error as a bare string in responseError', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response(JSON.stringify({ detail: { error: 'bad request' } }), { status: 400 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'bad request' }])
  })

  it('handles root.error.message as a string in responseError', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response(JSON.stringify({ error: { message: 'server went boom' } }), { status: 500 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'server went boom' }])
  })

  it('handles a non-Error thrown during the spend report catch block', async () => {
    // A non-Error throw from fetchFn inside the spend-report try block exercises
    // line 201 path 2/2: error instanceof Error is false → String(error).
    const accountingFetchFn = vi.fn(async () => { throw 'accounting exploded' })
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => [],
      },
      accountingFetchFn,
      { includeSpendReport: true },
    )
    const snapshot = await noReportReader.snapshot([])
    expect(snapshot.failures).toEqual([{ id: 'accounting', message: 'accounting exploded' }])
  })

  it('omits spend on model rows when no model spend is reported', async () => {
    const fetchFn = fetchStub([
      jsonResponse([]), // empty spend report
      jsonResponse({ budget_id: 'budget/7', spend: 1 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/7' }])
    // Model rows without any matching spend default omit the spend field entirely.
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model' },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model' },
      { id: 'b', name: 'b', kind: 'budget', spend: 1 },
    ])
  })

  it('handles a nested usage object in collectModelSpend', async () => {
    const fetchFn = fetchStub([
      jsonResponse([{
        model: 'deploy-a',
        spend: 1,
        usage: {
          'deploy-a': { spend: 0.5 },
          'deploy-b': { spend: 2 },
        },
      }]),
    ])
    const snapshot = await reader(fetchFn).snapshot([])
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'opencode/deepseek-v4-flash', kind: 'model', spend: 1.5 },
      { id: 'model:deploy-b', name: 'qwen-3.8', kind: 'model', spend: 2 },
    ])
  })

  it('returns an empty object from unwrap when given a primitive payload', async () => {
    // unwrap must handle non-object payloads without throwing.
    // A bare JSON number is valid JSON but has no known fields, so unwrap returns {}.
    const fetchFn = fetchStub([
      new Response('42', { status: 200, headers: { 'content-type': 'application/json' } }),
    ])
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => [],
      },
      fetchFn,
      { includeSpendReport: false },
    )
    const snapshot = await noReportReader.snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    // normalizePlan calls unwrap(42) which returns {}; spend defaults to 0.
    expect(snapshot.plans).toEqual([{ id: 'b', name: 'b', kind: 'budget', spend: 0 }])
  })

  it('falls back to root error object when detail.error is not a string', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response(JSON.stringify({ detail: { error: { code: 42 } } }), { status: 400 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    // detail.error is an object, so responseError cannot extract a string; falls through to root.error.
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'gateway answered HTTP 400' }])
  })

  it('falls back to root error shape when root.error.message is not a string', async () => {
    const fetchFn = fetchStub([
      jsonResponse({}),
      new Response(JSON.stringify({ error: { message: 99 } }), { status: 502 }),
    ])
    const snapshot = await reader(fetchFn).snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    // root.error.message is a number, so responseError cannot extract a string; returns undefined → generic message.
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'gateway answered HTTP 502' }])
  })

  it('handles a non-Error throw from fetchFn inside the plan-read catch block', async () => {
    // Non-Error throws from fetchFn are caught by the plan-read catch and String(error) is used (line 236).
    const planFetchFn = vi.fn(async () => { throw 'plan exploded' })
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => [],
      },
      planFetchFn,
      { includeSpendReport: false },
    )
    const snapshot = await noReportReader.snapshot([{ id: 'b', kind: 'budget', target: 'budget/x' }])
    expect(snapshot.failures).toEqual([{ id: 'b', message: 'plan exploded' }])
  })

  it('skips totals entries that lack spend fields in collectModelSpend', async () => {
    const fetchFn = fetchStub([
      jsonResponse([{
        usage: {
          'deploy-a': { total_spend: 3 },
          'broken-entry': 'not-an-object',
          'no-spend-key': { some_other: 'field' },
        },
      }]),
    ])
    const noReportReader = new LiteLlmPlansReader(
      {
        baseURL: () => 'http://gw:4000/v1',
        apiKey: async () => 'sk-master',
        liveModels: () => [{ id: 'deploy-a', name: 'd-a', deployment: 'a', upstream: 'a', modelName: 'a' }],
      },
      fetchFn,
    )
    const snapshot = await noReportReader.snapshot([])
    // only deploy-a has a spend value; broken-entry (primitive) and no-spend-key are skipped.
    expect(snapshot.plans).toEqual([
      { id: 'model:deploy-a', name: 'd-a', kind: 'model', spend: 3 },
    ])
  })
})
