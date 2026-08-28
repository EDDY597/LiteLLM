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

同一刷新动作还会填充「套餐与余额」面板。在配置里添加 `plans` 条目即可跟踪 LiteLLM 计费对象——`{ id, name?, kind: 'key' | 'budget', target }`，其中 `target` 是 api key 值或 `budget_id`——每次刷新会用与请求相同的 master key 凭据查询网关管理端点（`/key/info`、`/budget/info`）。单条失败会列在表格下方而不影响其他行；凭据缺失会让整次读取高声失败。面板展示已用、上限以及存在预算时的剩余额度和重置时间——即 LiteLLM 自己记账的内容，不多不少。

一次 /model/info 的实时刷新还会把网关真实模型名并入该路由提供方的目录（「路由模型」分组与模型选择器），deepseek-v4-flash 这类发现的模型无需手改 models 配置即可出现。

插件还会在 composer 工具行左端座位（`conversation.input.left`，附件控件旁）贡献一个纯文本徽标。只要最近一次完成的响应带出了上游模型名，徽标就会显示该具体 id（例如 `qwen3.5-plus`），悬停提示为 `badge.tip`；在此之前不渲染任何内容，并在所属会话结束一轮后刷新。取值走本插件自己的 `litellmGateway.activeModel` Remote，与上方共享账本；跨线传输的只有模型名。

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
- **上游可见性是尽力而为且进程级**：composer 徽标显示的是最近一次完成的网关响应所报告的后端模型，只要有任一会话完成过这样的请求；它不是按会话的归因，且响应缺少可识别的 pi-ai 回放封套时会保留上一次读数。档位、分类原因与 fallback 链仍以 LiteLLM 日志为准。
- **余额只反映 LiteLLM 自身记账**：「套餐与余额」面板读取网关的 key/budget 记录，上游 coding plan 若未在 LiteLLM 中镜像为 budget 则不可见；管理端点由 `baseURL` 去掉尾部 `/v1` 推导。
- **模型目录来自配置而非发现**：四个默认值是部署假设；网关验证完成后，必须在 settings 中写入上下文窗口、输出上限与其他虚拟模型。
- **路由标签跟随配置**：路由条目显示匹配别名的 `models[].name`，缺失时退回别名 id 本身；本地化文案仅存在于设置卡片。
