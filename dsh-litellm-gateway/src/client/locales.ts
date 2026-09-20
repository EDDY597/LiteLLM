/** LiteLLM gateway settings-card dictionaries. */

export const zh = {
  title: 'LiteLLM Gateway', description: '配置网关、虚拟模型、路由策略和运行用量。',
  provider: 'Provider ID', baseURL: 'Gateway Base URL', apiKeyEnv: 'Gateway Master Key 凭据引用（所有模型共用）',
  models: '模型目录（JSON）', modelsHint: '每项至少包含 id，可选 name、contextWindow、maxTokens。',
  routes: '路由可视化', cost: '成本优先', balanced: '均衡', quality: '高质量',
  target: '目标虚拟模型', routingNote: 'DSH 只发送虚拟模型名，具体上游选择由 LiteLLM 决定。',
  usage: '用量面板', refresh: '刷新', loading: '加载中…', usageError: '用量暂时不可用', emptyUsage: '当前进程还没有 LiteLLM 请求。',
  plans: '套餐与余额',
  plansHint: '自动读取 LiteLLM 中每个模型的用量；可选地在配置里添加 key / budget 条目以显示额度上限。',
  plansError: '套餐暂时不可用（凭据缺失或网关不可达）。',
  emptyPlans: '未配置套餐条目：在插件配置的 plans 列表中添加要跟踪的 key 或 budget。',
  planName: '名称', planKind: '类型', kindKey: 'Key', kindBudget: 'Budget', spendCol: '已用', limitCol: '上限', remainingCol: '剩余', resetAt: '重置时间',
  requests: '请求', successes: '成功', failures: '失败', inputTokens: '输入 tokens', outputTokens: '输出 tokens',
  cacheReadTokens: '缓存读取', cacheWriteTokens: '缓存写入', model: '模型', lastUsed: '最近使用',
  save: '保存', saving: '保存中…', discard: '放弃修改', unsaved: '未保存', readOnly: '此部署的设置为只读。',
  expand: '展开设置', collapse: '收起设置', overridden: '已覆盖', reset: '恢复默认', invalid: 'JSON 格式无效',
  'badge.tip': 'LiteLLM 路由当前命中的上游模型',
} as const

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'LiteLLM Gateway', description: 'Configure the gateway, virtual models, routing policy, and live usage.',
  provider: 'Provider ID', baseURL: 'Gateway Base URL', apiKeyEnv: 'Gateway Master Key credential reference (shared by all models)',
  models: 'Model catalog (JSON)', modelsHint: 'Each item needs id; name, contextWindow, and maxTokens are optional.',
  routes: 'Route visualization', cost: 'Cost saving', balanced: 'Balanced', quality: 'High quality',
  target: 'Target virtual model', routingNote: 'DSH sends virtual model names; LiteLLM owns upstream selection.',
  usage: 'Usage dashboard', refresh: 'Refresh', loading: 'Loading…', usageError: 'Usage is temporarily unavailable', emptyUsage: 'No LiteLLM requests in this process yet.',
  plans: 'Plans & balances',
  plansHint: 'Reads spend for every model LiteLLM serves; optionally add key / budget entries in the plugin settings to show caps.',
  plansError: 'Plans are temporarily unavailable (missing credential or unreachable gateway).',
  emptyPlans: 'No plan entries configured — add the keys or budgets to track under `plans` in the plugin settings.',
  planName: 'Name', planKind: 'Kind', kindKey: 'Key', kindBudget: 'Budget', spendCol: 'Used', limitCol: 'Cap', remainingCol: 'Remaining', resetAt: 'Resets',
  requests: 'Requests', successes: 'Successes', failures: 'Failures', inputTokens: 'Input tokens', outputTokens: 'Output tokens',
  cacheReadTokens: 'Cache read', cacheWriteTokens: 'Cache write', model: 'Model', lastUsed: 'Last used',
  save: 'Save', saving: 'Saving…', discard: 'Discard', unsaved: 'Unsaved', readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings', collapse: 'Hide settings', overridden: 'Overridden', reset: 'Reset', invalid: 'Invalid JSON',
  'badge.tip': 'The upstream model LiteLLM routed to',
} as const

/** The model namespace key union. */
export type LiteLlmLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** LiteLLM gateway settings and usage copy. */
    'llm-litellm-gateway': LiteLlmLocaleKey
  }
}
