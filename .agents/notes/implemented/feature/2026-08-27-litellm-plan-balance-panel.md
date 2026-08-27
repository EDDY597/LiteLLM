# Agent Note: LiteLLM plan-balance panel over gateway billing objects

Status: implemented

English | [中文](2026-08-27-litellm-plan-balance-panel.zh.md)

## Problem

The user routes paid upstream models through one LiteLLM gateway and wants to see, inside DSH's plugin settings, how much of each paid model's coding-plan quota or prepaid balance remains. DSH itself never sees that number: requests only carry the virtual alias, and spend accounting lives in the gateway. Without a read path, checking a balance means leaving the product for LiteLLM's own UI or API.

## Decision

The plugin configuration grows an optional `plans` list — `{ id, name?, kind: 'key' | 'budget', target }` naming the LiteLLM billing object to track (an api key value or a `budget_id`). A new host-side `LiteLlmPlansReader` queries the gateway's admin endpoints (`/key/info`, `/budget/info`, derived from `baseURL` by dropping a trailing `/v1`) with the same master-key credential used for model traffic, resolving it per refresh so credential rotations apply immediately; an unresolvable credential fails the whole read loudly instead of returning partial numbers.

Field extraction tolerates proxy-version drift (some responses nest the info object under `{ data }`) and reads spend/cap/reset fields by common name. Each entry's failure is isolated into the snapshot's `failures` row while sound entries stay readable; there is no retry loop — the card's existing refresh button re-reads both dashboards, and the two settle independently. The results reach the browser as a new `litellmGateway/plans` Remote method beside `usage`/`activeModel`, and the settings card renders them as a table (name, kind, used, cap, remaining, reset) with per-entry failure rows beneath.

## Alternatives considered

**Query each upstream provider's native balance API.** Would show subscription-quota truth directly, but every provider speaks a different auth and response dialect, and credentials would multiply beyond the single shared master-key seam. The gateway already owns unified spend accounting; mirroring native quotas as LiteLLM budgets is the deployment-side fix, and the README limitation says so explicitly.

**Poll balances on an interval from the client.** Keeps numbers fresh without user action but adds a background request cycle whose data is stale anyway between polls; the existing explicit-refresh interaction for usage was already the accepted freshness contract on this card.

**Fold balances into the usage snapshot payload.** One fewer remote method, but couples two independently failing reads to one strict wire schema and forces balance errors to blank the usage table; separate methods keep each panel's error state honest.

## Consequences

Deployments get a zero-new-infrastructure balance view the moment they describe their billing objects in config; entries cost one admin GET per refresh and nothing when absent. Accepted costs: numbers are only as current as the last click, they reflect LiteLLM's ledger rather than upstream-native quota counters unless mirrored as budgets, and admin-route derivation assumes the conventional `/v1` split rather than a configurable admin base. Coverage pins config validation (duplication, closed kinds, non-empty targets, detached copies), endpoint/auth construction for both kinds, `{ data }` unwrapping, no-cap omission, failure isolation including malformed JSON and transport throws, and loud credential rejection before any request.
