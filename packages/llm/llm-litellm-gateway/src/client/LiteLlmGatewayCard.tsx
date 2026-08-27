/** LiteLLM configuration, route visualization, and usage dashboard card. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LiteLlmGatewayFace } from './controller.ts'
import type { LiteLlmLocaleKey } from './locales.ts'
import css from './styles.module.css'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

type Props = PropsRuntime<'settings.plugin.item'> & PropsLocale<'llm-litellm-gateway'> & InjectFace<LiteLlmGatewayFace>

function Field(props: {
  id: string
  label: string
  value: { text: string; invalid: boolean }
  onChange: (value: string) => void
  multiline?: boolean
  disabled: boolean
}) {
  const Control = props.multiline ? 'textarea' : 'input'
  return (
    <label className={css.field} htmlFor={props.id}>
      <span>{props.label}</span>
      <Control
        id={props.id}
        className={props.value.invalid ? css.invalid : css.input}
        value={props.value.text}
        disabled={props.disabled}
        rows={props.multiline ? 5 : undefined}
        onChange={event => props.onChange(event.target.value)}
      />
    </label>
  )
}

/** Render the plugin card contributed to the configurable settings list. */
export function LiteLlmGatewayCard(props: Props) {
  const { t } = props
  const state = props.useLiteLlmGateway(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const totals = state.usage.value?.totals
  const plans = state.plans.value
  const routes: Array<[keyof typeof state.fields, LiteLlmLocaleKey]> = [['cost', 'cost'], ['balanced', 'balanced'], ['quality', 'quality']]
  const formatAmount = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const formatReset = (resetAt: string): string => {
    const parsed = new Date(resetAt)
    return Number.isNaN(parsed.getTime()) ? resetAt : parsed.toLocaleString()
  }
  return <li className={css.card}>
    <button type="button" className={css.header} aria-expanded={open} onClick={() => setOpen(!open)}><span><strong>{t('title')}</strong><small>{t('description')}</small></span><span className={css.pending}>{state.dirty ? t('unsaved') : ''}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
    {open ? <div className={css.body}>
      {!state.writable ? <p className={css.notice}>{t('readOnly')}</p> : null}
      <div className={css.formGrid}>
        <Field id="litellm-provider" label={t('provider')} value={state.fields.provider} disabled={disabled} onChange={value => props.edit('provider', value)} />
        <Field id="litellm-base-url" label={t('baseURL')} value={state.fields.baseURL} disabled={disabled} onChange={value => props.edit('baseURL', value)} />
        <Field id="litellm-api-key-env" label={t('apiKeyEnv')} value={state.fields.apiKeyEnv} disabled={disabled} onChange={value => props.edit('apiKeyEnv', value)} />
      </div>
      <Field id="litellm-models" label={t('models')} value={state.fields.models} disabled={disabled} multiline onChange={value => props.edit('models', value)} />
      <p className={css.hint}>{t('modelsHint')}</p>
      <section className={css.section}><h4>{t('routes')}</h4><p className={css.hint}>{t('routingNote')}</p><div className={css.routes}>{routes.map(([field, label]) => <div className={css.route} key={field}><span>{t(label)}</span><span className={css.arrow}>→</span><input value={state.fields[field].text} disabled={disabled} aria-label={`${t(label)} ${t('target')}`} onChange={event => props.edit(field, event.target.value)} /></div>)}</div></section>
      <section className={css.section}><div className={css.sectionHeader}><h4>{t('usage')}</h4><button type="button" onClick={props.refreshUsage} disabled={state.usage.status === 'loading'}>{state.usage.status === 'loading' ? t('loading') : t('refresh')}</button></div>{state.usage.status === 'error' ? <p className={css.notice}>{t('usageError')}</p> : null}{state.usage.status !== 'error' && totals !== undefined ? <div className={css.metrics}>{(['requests', 'successes', 'failures', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const).map(metric => <div key={metric}><b>{totals[metric]}</b><span>{t(metric)}</span></div>)}</div> : null}{state.usage.status !== 'error' && state.usage.value?.rows.length === 0 ? <p className={css.hint}>{t('emptyUsage')}</p> : null}{state.usage.value?.rows.length ? <table className={css.table}><thead><tr><th>{t('model')}</th><th>{t('requests')}</th><th>{t('inputTokens')}</th><th>{t('outputTokens')}</th><th>{t('lastUsed')}</th></tr></thead><tbody>{state.usage.value.rows.map(row => <tr key={`${row.provider}:${row.model}`}><td>{row.model}</td><td>{row.requests}</td><td>{row.inputTokens}</td><td>{row.outputTokens}</td><td>{row.lastUsedAt === undefined ? '-' : new Date(row.lastUsedAt).toLocaleString()}</td></tr>)}</tbody></table> : null}</section>
      <section className={css.section}><h4>{t('plans')}</h4><p className={css.hint}>{t('plansHint')}</p>{state.plans.status === 'error' ? <p className={css.notice}>{t('plansError')}</p> : null}{plans !== null && plans.plans.length === 0 && plans.failures.length === 0 ? <p className={css.hint}>{t('emptyPlans')}</p> : null}{plans?.plans.length ? <table className={css.table}><thead><tr><th>{t('planName')}</th><th>{t('planKind')}</th><th>{t('spendCol')}</th><th>{t('limitCol')}</th><th>{t('remainingCol')}</th><th>{t('resetAt')}</th></tr></thead><tbody>{plans.plans.map(plan => <tr key={plan.id}><td>{plan.name}</td><td>{plan.kind === 'key' ? t('kindKey') : t('kindBudget')}</td><td>{formatAmount(plan.spend)}</td><td>{plan.maxBudget === undefined ? '-' : formatAmount(plan.maxBudget)}</td><td>{plan.remaining === undefined ? '-' : formatAmount(plan.remaining)}</td><td>{plan.resetAt === undefined ? '-' : formatReset(plan.resetAt)}</td></tr>)}</tbody></table> : null}{plans?.failures.map(failure => <p key={failure.id} className={css.notice}>⚠ {failure.id}: {failure.message}</p>)}</section>
      <div className={css.footer}><button type="button" onClick={props.discard} disabled={!state.dirty || state.saving}>{t('discard')}</button><button type="button" className={css.primary} onClick={props.save} disabled={!state.dirty || state.invalid || state.saving}>{state.saving ? t('saving') : t('save')}</button></div>
    </div> : null}
  </li>
}
