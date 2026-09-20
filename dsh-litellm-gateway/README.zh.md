# `@deepseek-ai/dsh-llm-litellm-gateway`

[English](README.md) | 中文

这是 DeepSeek Harness 的可热插拔 LiteLLM 网关策略插件。插件复用 `@deepseek-ai/dsh-llm-pi-ai` 的 OpenAI Chat Completions 传输、流式输出、工具调用、回放转换与凭据解析。上游提供方、复杂度路由、重试和 fallback 由 LiteLLM 管理。

```yaml
- id: llm
  name: '@deepseek-ai/dsh-llm'
- id: llm-litellm-gateway
  name: '@deepseek-ai/dsh-llm-litellm-gateway'
  config:
    baseURL: http://127.0.0.1:4000/v1
    apiKeyEnv: LITELLM_MASTER_KEY
    retryPolicy:
      mode: normal
      maxRetries: 0
```

默认提供方路由是 `litellm-gateway`，提供 `deepseek-main`、`dsh-cost`（`Cost Saving`）、`dsh-balanced`（`Balanced`）与 `dsh-quality`（`High Quality`）。部署可以替换 `models` 及 `routes.cost`、`routes.balanced`、`routes.quality` 别名。以此网关作为部署默认值时，应把 `@deepseek-ai/dsh-agent-default-model` 配置为 `{ provider: litellm-gateway, model: dsh-balanced }`；模型选择仍由该独立服务管理。

`apiKeyEnv` 是凭据引用，不是密钥值。每次请求先通过可选的凭据服务解析它，否则通过启动环境解析。默认引用是 `LITELLM_MASTER_KEY`。凭据缺失或不可用时，请求会在网络 I/O 前失败。

settings namespace 是 `llm-litellm-gateway`，变更在下一次请求生效。提供方 id 或重试策略变化会原子替换路由注册；端点、凭据和模型变化则由每个操作的一份不可变 profile 快照解析。卸载插件会移除其路由和可配置提供方目录条目。

DSH 重试策略只允许 `normal` 且 `maxRetries: 0`。pi-ai SDK 同样只尝试一次，因此只有 LiteLLM 可以重试或选择 fallback。除非部署另行提供认证、网络隔离和访问控制，否则网关应只绑定 `127.0.0.1`。

## Web 设置卡片

安装浏览器端后，Plugins 设置页会出现专用 LiteLLM 卡片。卡片通过 `llm-litellm-gateway` Settings Scope 暂存并保存提供方 id、网关地址、凭据引用、模型目录和三个路由别名。路由区域把「成本优先」「均衡」「高质量」绘制为虚拟模型到别名的连线，不会把 LiteLLM 内部后端档位伪装成 DSH 模型 id。

同一卡片还包含进程内用量面板，按 DSH 选择的虚拟模型展示请求结果以及互不重叠的输入、输出和 cache token 桶，支持刷新并提供空状态。Host 重启后计数清零；持久化 spend 和实际上游模型仍由 LiteLLM 管理。

同一刷新会从 LiteLLM 的 `/global/spend/report` 读取最近 30 天的支出，并在「套餐与余额」面板中列出所有实时部署，无需额外配置。该报表依赖 LiteLLM 数据库；未连接数据库时，模型行的金额显示为不可用，卡片会点明此前提而不会伪造零值。可选的 `plans` 条目——`{ id, name?, kind: 'key' | 'budget', target }`——通过 `/key/info` 或 `/budget/info` 补充上限、剩余金额与重置时间。各数据源失败独立列在可用行下方，所有读取均使用模型流量所用的同一 master key 凭据。

一次 `/model/info` 实时刷新会把直连部署并入路由提供方目录。选择器提交 LiteLLM 的稳定部署 id，同时显示具体上游名称；忽略大小写后同名的条目相邻排列，且只有冲突条目增加供应商前缀，例如 `opencode/deepseek-v4-flash`。因此相似部署可以区分并直连选择，无需手改 `models`。

插件还会在 composer 工具行左端座位（`conversation.input.left`，附件控件旁）贡献一个纯文本徽标。pi-ai 把 LiteLLM 响应标头交给插件；插件用 `x-litellm-model-id` 查询实时部署目录，并且仅在该流成功完成后提交标签。首次取得精确部署前不渲染徽标，所属会话结束一轮时刷新。取值走 `litellmGateway.activeModel` Remote，跨线传输的只有显示名。

## 模型选择界面

提供方通过可配置提供方目录（`LlmConfigurableProvider.catalog`）发布自己的路由切片：按顺序的 cost/balanced/quality 别名（指向同一 id 的档位合并为一条）、剔除别名后的直连模型，以及共享的 `credentialEnv` 引用。选择界面据此把模型菜单拆为「路由」「路由模型」「DSH模型」三组，并在凭据引用未解析时把相关条目标记为不可用。选择任一条目仍提交普通的 provider/model 对；目录成员资格保持 advisory，校验仍归适配器。

## 模型体验

### LiteLLM 虚拟模型请求

#### 模型看到的内容

所选 LiteLLM 虚拟模型通过 OpenAI Chat Completions 接收 `GenerateOptions.system`、`GenerateOptions.messages`、`GenerateOptions.tools`、模型能力允许的图片与采样值。本插件不增加模型可见的路由指令。DSH 记录所选虚拟模型 id；实际后端模型、档位、分类原因与 fallback 链由 LiteLLM 日志管理。

#### Token 影响

本插件不增加提示词 token。LiteLLM 启发式复杂度路由不会增加分类模型调用；其他 LiteLLM 分类器配置与提供方重试可能产生不归入 DSH 所选虚拟模型身份的额外用量。

#### KV Cache 影响

本插件保留传给适配器的组装请求前缀。更改所选虚拟模型、网关路由结果、端点或模型目录可能选择不同的提供方 cache；cache 可用性、affinity 与淘汰仍由 LiteLLM 和上游提供方管理。

## 已知限制与暂缓事项

- **不开放快速回答**：DSH 尚无原生路径，无法用零前缀模型调用替换完整 agent（智能体）步骤，同时记录实际模型、独立 `quickAnswer` 用量和可回放的会话事件。`llm/stream` 包装层会把响应错误归因到所选完整任务别名，因此插件通过不提供该功能来保持禁用。
- **上游可见性是进程级的**：composer 徽标显示最近一次成功完成且携带 `x-litellm-model-id` 的网关响应所对应的精确部署；它不按会话归因。缺少该标头的响应保留上一次读数。档位、分类原因和 fallback 链仍以 LiteLLM 日志为准。
- **余额依赖 LiteLLM 记账**：模型累计支出需要 LiteLLM 数据库，剩余金额还需要对应的 key 或 budget 上限。master key 无法读取仅存在于上游提供方账户中的订阅配额；DSH 只能显示 LiteLLM 已暴露或镜像的配额。
- **发现的部署会补充配置模型**：`/model/info` 提供稳定部署 id 与显示名；部署需要非默认上下文窗口或输出上限时，这些值仍来自显式 `models` 条目。
- **路由标签跟随配置**：路由条目显示匹配别名的 `models[].name`，缺失时退回别名 id 本身；本地化文案仅存在于设置卡片。
