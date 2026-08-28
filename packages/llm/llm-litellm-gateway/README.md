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

## Web settings card

When the browser half is installed, the Plugins settings page adds a dedicated LiteLLM card. It stages the provider id, gateway URL, credential reference, model catalog, and three route aliases through the `llm-litellm-gateway` Settings Scope. The route section draws Cost Saving, Balanced, and High Quality as virtual-model-to-alias edges; it does not expose LiteLLM's internal backend tiers as DSH model ids.

The same card includes a process-local usage dashboard. It reports request outcomes and disjoint input/output/cache token buckets by the virtual model selected by DSH, with a refresh action and an empty state. Counters reset when the Host process restarts; persistent spend and the actual upstream model remain LiteLLM concerns.

The same refresh also fills the Plans & balances panel. Configure `plans` entries naming the LiteLLM billing objects to track — `{ id, name?, kind: 'key' | 'budget', target }` where `target` is the api key value or `budget_id` — and each refresh queries the gateway's admin endpoints (`/key/info`, `/budget/info`) with the same master-key credential as requests. Per-entry failures list under the table while sound rows stay readable; a missing credential fails the whole read loudly. The panel shows spend against the cap plus the remainder and reset time when a budget exists — exactly what LiteLLM accounts, nothing more.

A live /model/info refresh also merges the gateway's real model names into the route provider's directory (the 路由模型 bucket and the model picker), so discovered models like deepseek-v4-flash appear without hand-editing models config.

The plugin also contributes a plain-text badge to the composer tool row's left seat (`conversation.input.left`, beside the attach control). Once at least one completed response carried an upstream model name, the badge shows that concrete id — for example `qwen3.5-plus` — under the `badge.tip` tooltip; it renders nothing before then and refreshes when the owning session finishes a turn. The value rides this plugin's own `litellmGateway.activeModel` Remote over the shared ledger above; nothing but the name crosses the wire.

## Model selection surface

The provider publishes its declared routing slice through the configurable-provider directory (`LlmConfigurableProvider.catalog`): the cost/balanced/quality aliases in order (tiers aimed at one id collapse to one entry), the direct models left after removing those aliases, and the shared `credentialEnv` reference. Selection surfaces use this to split the model menu into Routes, Route models, and DSH models panes and to mark entries unavailable while the credential reference does not resolve. Selecting any entry still submits the plain provider/model pair; membership stays advisory and validation belongs to the adapter as before.

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
- **Upstream visibility is best-effort and process-wide** — the composer badge names whatever backend the last completed gateway response reported, whenever one session finished such a request; it is not per-session attribution, and a response without a recognizable pi-ai replay envelope leaves the previous reading. LiteLLM logs remain the authority for tiers, classification reasons, and fallback chains.
- **Balances reflect LiteLLM's own accounting** — the Plans & balances panel reads the gateway's key/budget records, so an upstream coding plan whose quota is not mirrored as a LiteLLM budget stays invisible, and admin endpoints are derived from `baseURL` by dropping a trailing `/v1`.
- **The model catalog is configured, not discovered** — the four defaults are deployment assumptions; context windows, output limits, and additional virtual models must be written in settings after gateway validation.
- **Route labels follow configuration** — route entries display the `models[].name` of the matching alias or fall back to the alias id itself; localized labels live in the settings card only.
