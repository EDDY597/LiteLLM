# Agent Note: LiteLLM 网关策略插件

Status: implemented

[English](2026-08-24-litellm-gateway-plugin.md) | 中文

## 问题

LiteLLM 部署需要一个可安装的 DSH 插件，用来提供本机端点、凭据引用、虚拟模型别名与单一重试责任方策略。把这些事实作为不受约束的通用提供方重复录入，会允许 DSH 与 LiteLLM 的重试叠加，也会让预期路由名称只存在于隐含约定中。

## 决策

`dsh-llm-litellm-gateway` 基于现有 `dsh-llm-pi-ai` 适配器，拥有一条可热插拔的 OpenAI Chat Completions 路由。默认值是提供方 `litellm-gateway`、端点 `http://127.0.0.1:4000/v1`、凭据引用 `LITELLM_MASTER_KEY`、直接模型 `deepseek-main`，以及 `dsh-cost`、`dsh-balanced`、`dsh-quality` 三个虚拟模型。settings 原子替换注册级事实，并按操作解析端点、凭据与模型目录事实。

插件只接受 DSH 重试策略 `normal` 且 `maxRetries: 0`。pi-ai SDK 同样只尝试一次；重试、复杂度路由与跨模型 fallback 仅由 LiteLLM 管理。

该包复用 `dsh-llm-pi-ai` 导出的适配器、profile 解析器与认证桥接。传输转换、流式输出、工具调用、回放元数据、凭据存储和附件处理因此保持单一实现。

快速回答功能不存在。当前 LLM middleware API 无法用零前缀便宜模型调用替换完整 agent 请求，同时改变 agent loop（智能体循环）记录的模型来源。提供这种包装层会记录所选完整任务别名，而不是实际快速模型，也无法从会话日志派生独立 `quickAnswer` 统计。插件只能在原生事件生产路径出现后开放该功能。

## 考虑过的替代方案

**只配置 `dsh-llm-pi-ai`。** 通用适配器可以访问 LiteLLM，但不会强制部署路由别名，也不会拒绝第二个 DSH 重试责任方。独立插件使这些策略事实成为加载期配置。

**在插件中复制 OpenAI 客户端。** 独立客户端会重复 SSE 解析、工具调用组装、回放、凭据、附件与失败规范化行为。复用通用适配器可让这些义务留在既有归属方中。

**通过 `llm/stream` 拦截快速回答。** 拦截器在 loop 记录所选模型后才能看到完整组装请求，无法产生正确模型来源或零前缀持久请求，因此不开放该选项。

## 后果

网关路由可以安装、通过 settings 修改和移除，无需重启 DSH，也不会扰动进行中的操作。部署以 `dsh-balanced` 作为默认模型选择时，需另行配置 `dsh-agent-default-model`。

DSH 记录所选 LiteLLM 虚拟模型及其返回用量。实际后端模型、复杂度档位、分类原因、重试、fallback 及其总成本仍以 LiteLLM 审计记录为准。聚焦配置与生命周期测试固定路由默认值、零重试、别名处理、实时替换与 dispose；提供方协议行为继续由 `dsh-llm-pi-ai` 覆盖。
