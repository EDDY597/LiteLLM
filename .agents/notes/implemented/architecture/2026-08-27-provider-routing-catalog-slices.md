# Agent Note: Provider-declared routing slices and the three-bucket model menu

Status: implemented

English | [中文](2026-08-27-provider-routing-catalog-slices.zh.md)

## Problem

The LiteLLM gateway advertises routing aliases (`dsh-cost`/`dsh-balanced`/`dsh-quality`) and direct virtual models as one flat provider group, so the composer's model seat shows them all as siblings under a generic「模型」root row, and the reasoning-effort picker occupies a root row even though it only matters for one already-selected model. Users also cannot see which concrete backend (for example `qwen3.5-plus`) the router actually picked without leaving DSH. Nothing in the seam distinguishes "route tier" from "direct model": the knowledge lives in the provider plugin, but the only expression available is `LlmConfigurableProvider`, which carried pure configuration pointers.

## Decision

A configurable provider may now publish an advisory **catalog** on its directory entry (`LlmConfigurableProvider.catalog`: `routes`, `models`, optional `credentialEnv`). The registry validates it loudly at registration (non-empty ids/names, per-list uniqueness) and detaches the arrays; nothing about selection semantics changes — entries remain advisory metadata and every submission stays a plain provider/model pair validated by the owning adapter.

The host passes each mounted slice through to the browser as an optional `SessionModels.routing[]` block (`SessionRoutingSection`: provider identity, `credentialRequired`/`credentialReady` resolved through `credentials.describe` presence, and the two entry lists). The web model seat renders three root buckets from that data alone — 路由 / 路由模型 / DSH模型 (en: Routes / Route models / DSH models) — hides bucket rows whose lists are empty, keeps credential-unresolved entries visible but inert with one explanatory hint, and filters the gateway provider out of the DSH pane. Deployment catalogs without a routing slice render exactly the previous single-pane behavior. Reasoning-effort levels lost their root row: they now render as an indented radio subgroup directly beneath whichever model row is currently selected, in every model-listing pane.

All LiteLLM-specific knowledge stays in its plugin: publishing the slice (aliases in cost/balanced/quality order, tiers aimed at one id collapsed to one entry, direct models minus aliases, `credentialEnv`), plus a new `litellmGateway.activeModel` Remote that returns the last completed request's upstream model id, extracted inside the existing usage ledger's `llm/stream` interception from the finish chunk's pi-ai replay envelope (`response.responseModel` — the concrete backend the OpenAI-compatible response named). A failure never moves that reading. The plugin contributes the composer tool row's left slot with a plain-text badge showing the name once any completed response carried one, refreshing on mount and on running→idle turn edges of the owning session — no polling loop, and nothing but the name crosses the wire.

## Alternatives considered

**Teach `ui-model-selection` about LiteLLM specifically.** Fastest path to the requested menu, rejected outright: consumer-specific knowledge in the UI breaks the capability-seam rule the repo already enforces elsewhere, and a second gateway would fork the rendering immediately.

**Generic multi-section catalogs (`sections: {label, models}[]`).** More flexible, but the only current consumer needs exactly routes/direct split plus a credential fact; open-ended sections push labeling policy onto providers with zero evidence and invite heterogeneous menus. Lost to the closed `routes`+`models` shape until a second pattern appears.

**Extend `StreamChunk` (or browser assistant nodes) with the upstream model for every provider.** The replay envelope is adapter-private by design and only the responding adapter knows what `model` means in its wire dialect; threading it into shared runtime vocabulary — or folding `replayState` into generic chat nodes so a transcript-side subscriber could read it — spends core complexity on a display concern owned by one plugin. The gateway-owned ledger extraction reads the same envelope where it is already legitimate.

**Per-session upstream attribution via session-log correlation.** Would make the badge exact under concurrent sessions, but requires a new session→plugin event channel purely for a label. Deferred; the Remote reading documents itself as deployment-wide and failures keep the last good name rather than misattributing.

## Consequences

Menu structure is data-driven end to end: adding a second routing-style provider needs no UI change, while deployments without one keep byte-identical trigger behavior apart from the renamed DSH bucket label. The effort root row is gone — keyboard order and tests changed accordingly, and `/model` remains flat (aliases included) because flattening there loses nothing. Costs accepted: route labels follow provider configuration verbatim (localized cost/balanced/quality copy lives only in the settings card), the badge cannot attribute a backend to a specific session, responses that omit a recognizable replay envelope leave the prior reading standing, and the `routing` block appears on `session.models` responses only when at least one declared slice is served. Coverage pins the registry validation, gateway publication and collapse rules, ledger extraction/detachment, and every new seat interaction (bucket navigation, route pick, direct pick, gating hint, trigger naming) at the unit level.
