/**
 * Package-owned invariant companion for the LiteLLM gateway policy.
 *
 * The plugin owns no independent event relationship: configuration resolution
 * validates route policy, and the LLM registry owns route membership and disposal.
 * The empty installer keeps that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-llm-litellm-gateway/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-litellm-gateway'

/** Cordis companion plugin name. */
export const name = 'llm-litellm-gateway-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: configuration and the LLM registry own all mutable relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
