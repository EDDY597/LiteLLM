# Agent Note: LiteLLM gateway policy plugin

Status: implemented

English | [中文](2026-08-24-litellm-gateway-plugin.zh.md)

## Problem

A LiteLLM deployment needs one installable DSH plugin that supplies the local endpoint, credential reference, virtual model aliases, and single-owner retry policy. Re-entering these facts as an unrestricted generic provider permits DSH and LiteLLM retries to multiply and leaves the intended route names implicit.

## Decision

`dsh-llm-litellm-gateway` owns one hot-pluggable OpenAI Chat Completions route over the existing `dsh-llm-pi-ai` adapter. Its defaults are provider `litellm-gateway`, endpoint `http://127.0.0.1:4000/v1`, credential reference `LITELLM_MASTER_KEY`, direct model `deepseek-main`, and the `dsh-cost`, `dsh-balanced`, and `dsh-quality` virtual models. Settings replace registration-level facts atomically and resolve endpoint, credential, and catalog facts per operation.

The plugin accepts only DSH retry policy `normal` with `maxRetries: 0`. The pi-ai SDK also makes one attempt; LiteLLM alone owns retries, complexity routing, and cross-model fallback.

The package reuses the adapter, profile resolver, and auth bridges exported by `dsh-llm-pi-ai`. Transport conversion, streaming, tool calls, replay metadata, credential storage, and attachment handling therefore retain one implementation.

Quick answer is absent. The current LLM middleware API cannot replace a full Agent request with a zero-prefix cheap-model call while changing the model provenance recorded by agent-loop. Shipping that wrapper would record the selected full-task alias instead of the actual quick model and could not derive independent `quickAnswer` statistics from the session log. The feature requires a native event-producing path before this plugin can expose it.

## Alternatives considered

**Configure only `dsh-llm-pi-ai`.** The generic adapter can reach LiteLLM, but it does not enforce the deployment's route aliases or reject a second DSH retry owner. The dedicated plugin makes those policy facts load-time configuration.

**Duplicate an OpenAI client in the plugin.** A separate client would repeat SSE parsing, tool-call assembly, replay, credential, attachment, and failure normalization behavior. Reusing the generic adapter keeps those obligations in their existing owner.

**Intercept `llm/stream` for quick answers.** The interceptor sees the fully assembled request after the loop records its selected model. It cannot produce correct model provenance or a zero-prefix durable request, so the option is not exposed.

## Consequences

The gateway route can be installed, changed through settings, and removed without restarting DSH or disturbing in-flight operations. A deployment configures `dsh-agent-default-model` separately when `dsh-balanced` is its default model selection.

DSH records the selected LiteLLM virtual model and its returned usage. LiteLLM remains the audit source for the actual backend model, complexity tier, classification reason, retry, fallback, and their aggregate cost. Focused configuration and lifecycle tests pin route defaults, zero retries, alias handling, live replacement, and disposal; provider protocol behavior remains covered by `dsh-llm-pi-ai`.
