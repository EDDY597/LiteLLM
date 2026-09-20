import { describe, expect, it } from 'vitest'
import { LiteLlmModelInfoService, parseModelInfo, supplierName } from '../src/model-info.ts'

const payload = { data: [
  { model_name: 'strong', litellm_params: { model: 'openai/DeepSeek-V4-Flash', api_base: 'https://api.siliconflow.cn/v1' }, model_info: { id: 'siliconflow-id' } },
  { model_name: 'strong', litellm_params: { model: 'openai/deepseek-v4-flash', api_base: 'https://opencode.ai/zen/go/v1' }, model_info: { id: 'opencode-id' } },
  { model_name: 'strong', litellm_params: { model: 'openai/qwen3.5-plus', api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, model_info: { id: 'qwen-id' } },
  { model_name: 'dsh-quality', litellm_params: { model: 'auto_router/complexity_router' }, model_info: { id: 'route-id' } },
] }

describe('LiteLLM model info', () => {
  it('retains deployment ids and derives suppliers from their actual endpoints', () => {
    expect(parseModelInfo(payload)).toEqual([
      { modelName: 'strong', deploymentId: 'siliconflow-id', deployment: 'openai/DeepSeek-V4-Flash', supplier: 'siliconflow', upstream: 'DeepSeek-V4-Flash' },
      { modelName: 'strong', deploymentId: 'opencode-id', deployment: 'openai/deepseek-v4-flash', supplier: 'opencode', upstream: 'deepseek-v4-flash' },
      { modelName: 'strong', deploymentId: 'qwen-id', deployment: 'openai/qwen3.5-plus', supplier: 'dashscope', upstream: 'qwen3.5-plus' },
      { modelName: 'dsh-quality', deploymentId: 'route-id', deployment: 'auto_router/complexity_router', supplier: 'auto_router', upstream: 'complexity_router' },
    ])
    expect(supplierName('openrouter/deepseek/free', undefined)).toBe('openrouter')
  })

  it('groups case-insensitive collisions, labels only collisions, and resolves response deployment ids', async () => {
    const service = new LiteLlmModelInfoService(
      { baseURL: () => 'http://gateway/v1', apiKey: async () => 'master' },
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    )
    await service.refresh()
    expect(service.directDeployments.map(entry => entry.deploymentId)).toEqual([
      'opencode-id', 'siliconflow-id', 'qwen-id',
    ])
    expect(service.directDeployments.map(entry => service.displayName(entry))).toEqual([
      'opencode/deepseek-v4-flash', 'siliconflow/DeepSeek-V4-Flash', 'qwen3.5-plus',
    ])
    expect(service.displayNameOf('opencode-id')).toBe('opencode/deepseek-v4-flash')
    expect(service.displayNameOf('strong')).toBeUndefined()
  })
})
