# Agent Note: LiteLLM settings, routing, and usage card

Status: implemented

English | [中文](2026-08-25-litellm-settings-usage-card.zh.md)

## Problem

The LiteLLM gateway plugin's configuration (endpoint, credential reference, model catalog, and the three route aliases) had a host-side Settings section but no product surface in the browser: adjusting the deployment meant editing YAML, and nothing visualized which virtual model each route tier targets or what the gateway accounted per request.

## Decision

The LiteLLM gateway plugin owns a browser settings card in the same package as its Host provider. The card writes through the `llm-litellm-gateway` Settings Scope, renders the three configured virtual-model aliases as a route view, and reads a Typert `litellmGateway.usage()` Remote for a process-local usage dashboard.

The Host ledger records the provider and virtual model selected by DSH, plus request outcome and disjoint token buckets from `llm/stream` chunks. It deliberately does not infer LiteLLM's internal backend model or persist spend data; those facts belong to LiteLLM's own observability APIs. The generated Remote is mounted by `api/remotes`, while the browser half contributes `settings.plugin.item` only when the plugin package is installed.

## Alternatives considered

Not recorded (pre-format Agent Note; alternatives not reconstructible from the record).

## Consequences

Route and usage changes became visible and editable in-product without touching composition files, at the cost of the ledger being process-local only — restart clears counters, and upstream-native quota or backend-tier facts stay outside DSH by design.
