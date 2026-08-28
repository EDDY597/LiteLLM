# Agent Note: LiteLLM settings, routing, and usage card

Status: implemented

[English](2026-08-25-litellm-settings-usage-card.md) | 中文

## 问题

LiteLLM 网关插件的配置（端点、凭据引用、模型目录和三个路由别名）在宿主侧有 Settings 分节，但在浏览器里没有任何产品界面：调整部署意味着改 YAML，也没有东西可视化每个路由档位指向哪个虚拟模型，或网关对每次请求记了什么账。

## 决策

LiteLLM 网关插件在同一包内同时拥有 Host 提供方和浏览器设置卡片。卡片通过 `llm-litellm-gateway` Settings Scope 写入配置，把三个虚拟模型别名绘制为路由视图，并从 Typert `litellmGateway.usage()` Remote 读取进程内用量面板。

Host 账本从 `llm/stream` 记录 DSH 选择的提供方和虚拟模型、请求结果以及互不重叠的 token 桶。它不会推断 LiteLLM 内部后端模型或持久化 spend 数据，这些事实属于 LiteLLM 自己的观测 API。生成的 Remote 由 `api/remotes` 挂载；只有安装插件包时浏览器端才会贡献 `settings.plugin.item`。

## Alternatives considered

未记录（pre-format Agent Note；备选方案无法从记录中复原）。

## Consequences

路由与用量变更从此可在产品内查看和编辑，无需动组合文件；代价是账本仅限进程内——重启即清零，且上游原生配额与后端档位事实按设计留在 DSH 之外。
