/**
 * CurrentModelBadge: the plain-text reading beside the composer's attach
 * control (`conversation.input.left`), shown only while the LiteLLM gateway
 * has completed at least one response: the concrete upstream model id that
 * LiteLLM's router actually picked, exactly as its response named it.
 *
 * The value rides this plugin's own `litellmGateway.activeModel` Remote — a
 * process-local reading of the last completed request — and refreshes on
 * mount and on each running→idle turn edge of the owning session, so no
 * polling loop exists. It is deliberately deployment-wide rather than
 * per-session: a second session finishing later replaces the label until its
 * session runs again.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LiteLlmActiveModel } from '../usage.ts'
import css from './badge.module.css'

/** The one owner-share fact the badge reads: whether a turn is streaming. */
interface ZoneSession {
  running: boolean
}

/** Injected face for the badge slot entry. */
export interface LiteLlmBadgeInjected {
  /** Read the latest completed request's upstream model; null before any. */
  read: () => Promise<LiteLlmActiveModel | null>
}

/**
 * Render the current upstream-model badge for the composer tool row.
 * @param props - the input-zone owner share (read-only session facts) +
 * injected remote face + locale seat.
 * @returns the badge span, or nothing while no response has named a model.
 */
export function CurrentModelBadge(
  { session, read, t }: { session: ZoneSession } & LiteLlmBadgeInjected & PropsLocale<'llm-litellm-gateway'>,
) {
  const [active, setActive] = useState<LiteLlmActiveModel | null>(null)
  const wasRunning = useRef(session.running)

  useEffect(() => {
    let cancelled = false
    void read().then((value) => {
      if (!cancelled) setActive(value)
    }).catch(() => { /* transport failure keeps the previous reading */ })
    return () => { cancelled = true }
  }, [read])

  useEffect(() => {
    // A finished stream is when LiteLLM names what it routed to; refetch once
    // per running→idle edge instead of polling while idle.
    if (wasRunning.current && !session.running) {
      void read().then(setActive).catch(() => { /* keep the previous reading */ })
    }
    wasRunning.current = session.running
  }, [session.running, read])

  if (active?.responseModel === undefined) return null
  return (
    <span className={css.badge} title={t('badge.tip')}>{active.responseModel}</span>
  )
}
