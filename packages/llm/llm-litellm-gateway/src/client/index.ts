/** Browser half of the hot-pluggable LiteLLM Gateway settings plugin. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LiteLlmGatewayCard } from './LiteLlmGatewayCard.tsx'
import { CurrentModelBadge } from './badge.tsx'
import { LiteLlmGatewayController } from './controller.ts'
import { en, zh } from './locales.ts'

/** Settings namespace served by the Host plugin. */
export const NS = 'llm-litellm-gateway'
/** Browser services required by the card and composer-badge contributions. */
export const inject = ['slots', 'locale', 'remote', 'remote.litellmGateway', 'settingsScope']

/** Register the LiteLLM card only while the plugin package is installed. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-litellm-gateway: dictionaries')
  const remote = (ctx.remote as unknown as { litellmGateway: import('./controller.ts').LiteLlmUsageRemote }).litellmGateway
  const controller = new LiteLlmGatewayController(
    ctx.settingsScope.bind({ namespace: NS }),
    remote,
  )
  const face = controller.inject()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => face,
  }, LiteLlmGatewayCard))
  // Seed the dashboard on first render; the card keeps the explicit refresh
  // action so a user can re-read counters after a request completes.
  void face.refreshUsage()
  // Composer tool-row reading of the router's latest upstream model. The
  // component renders nothing until a completed response names one, so
  // deployments without traffic cost no tool-row space.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'litellm-current-model',
    locale: NS,
    inject: () => ({
      read: async () => {
        const result = await remote.activeModel()
        return result.ok ? result.value : null
      },
    }),
  }, CurrentModelBadge))
}

export type { LiteLlmGatewayFace, LiteLlmGatewayState, LiteLlmUsageRemote } from './controller.ts'
