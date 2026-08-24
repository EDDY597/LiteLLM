# `@deepseek-ai/dsh-llm-litellm-gateway`

English | [中文](README.zh.md)

Hot-pluggable LiteLLM gateway policy for DeepSeek Harness. The plugin reuses `@deepseek-ai/dsh-llm-pi-ai` for OpenAI Chat Completions transport, streaming, tool calls, replay conversion, and credential resolution. LiteLLM owns upstream providers, complexity routing, retries, and fallback.

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

The default provider route is `litellm-gateway`. It advertises `deepseek-main`, `dsh-cost` (`Cost Saving`), `dsh-balanced` (`Balanced`), and `dsh-quality` (`High Quality`). A deployment may replace `models` and the `routes.cost`, `routes.balanced`, and `routes.quality` aliases. Configure `@deepseek-ai/dsh-agent-default-model` with `{ provider: litellm-gateway, model: dsh-balanced }` when this gateway is the deployment default; model selection remains owned by that separate service.

`apiKeyEnv` is a credential reference, not a secret value. Each request resolves it through the optional credentials service and otherwise through the launch environment. The default reference is `LITELLM_MASTER_KEY`. Missing or unusable credentials fail the request before network I/O.

Settings are registered under `llm-litellm-gateway` and apply to the next request. Provider-id or retry-policy changes atomically replace the route registration; endpoint, credential, and model changes are resolved from one immutable profile snapshot per operation. Unloading the plugin removes its route and configurable-provider directory entry.

The DSH retry policy is restricted to `normal` with `maxRetries: 0`. The pi-ai SDK also performs one attempt, so LiteLLM is the only layer that may retry or select a fallback. The gateway should bind to `127.0.0.1` unless the deployment separately supplies authentication, network isolation, and access control.

## Model Experience

### LiteLLM virtual-model request

#### What the model sees

The selected LiteLLM virtual model receives `GenerateOptions.system`, `GenerateOptions.messages`, `GenerateOptions.tools`, images admitted by the declared model capabilities, and sampling values through OpenAI Chat Completions. This plugin adds no model-visible routing instructions. DSH records the selected virtual model id; LiteLLM logs own the actual backend model, tier, classification reason, and fallback chain.

#### Token effect

The plugin adds no prompt tokens. LiteLLM's heuristic complexity router adds no classification model call; other LiteLLM classifier configurations and provider retries may add usage outside DSH's selected virtual-model identity.

#### KV Cache effect

The plugin preserves the assembled request prefix passed to the adapter. Changing the selected virtual model, gateway routing result, endpoint, or model catalog may select a different provider cache; cache availability, affinity, and eviction remain owned by LiteLLM and the upstream provider.

## Known Limitations and Deferred Work

- **Quick answer is not exposed** — DSH has no native path that can replace a full Agent step with a zero-prefix model call while recording the actual model, independent `quickAnswer` usage, and replayable session events. An `llm/stream` wrapper would misattribute the response to the selected full-task alias, so the plugin leaves this feature disabled by absence.
- **Actual routing is audited in LiteLLM** — DSH records `dsh-cost`, `dsh-balanced`, or `dsh-quality`, not the internal `easy`, `strong`, or `premium` backend selected by the gateway.
- **The model catalog is configured, not discovered** — the four defaults are deployment assumptions; context windows, output limits, and additional virtual models must be written in settings after gateway validation.
