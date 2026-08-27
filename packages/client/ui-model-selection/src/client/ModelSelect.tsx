/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown. The root menu lists
 * the directory's buckets — Routes / Route models (a provider-declared
 * routing slice riding `SessionModels.routing`) and DSH models (every other
 * provider group) — each drilling into its own list. Reasoning-effort levels
 * merge into the model lists themselves: they render as an indented subgroup
 * directly beneath whichever model row is currently selected.
 *
 * Data and submission ride the SAME per-session ModelDirectory as the /model
 * popup; exact-model reasoning metadata and the selected effort come from the
 * Host rather than a client-owned vocabulary. A rejected selection announces
 * through the shared transient Toast anchored to the composer card; the
 * in-menu strip with Retry remains the catalog-load surface.
 */
import {
  Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent, type ReactNode,
} from 'react'
import clsx from 'clsx'
import type {
  ModelCatalogModel, ModelReasoningEffort, ModelSelection, SessionRoutingSection,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the bucket row set or one drilled-in list. */
type Pane = 'root' | 'routes' | 'routeModels' | 'dsh'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/**
 * Effort levels offered for one exact model route, in display order. A route
 * without an adapter-configured default leads with the provider-default row.
 */
function effortsOf(reasoning: NonNullable<ModelCatalogModel['reasoning']>, providerDefaultLabel: string): readonly EffortChoice[] {
  return [
    ...reasoning.defaultEffort === undefined
      ? [{ key: 'provider-default', effort: undefined, label: providerDefaultLabel }]
      : [],
    ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name,
      ...effort.description === undefined ? {} : { description: effort.description },
    })),
  ]
}

/** One routing entry paired with its owning slice (availability lives there). */
interface RoutingEntry {
  section: SessionRoutingSection
  model: ModelCatalogModel
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const routing = state.routing
  const routeEntries = useMemo<RoutingEntry[]>(() =>
    routing.flatMap(section => section.routes.map(model => ({ section, model }))), [routing])
  const directEntries = useMemo<RoutingEntry[]>(() =>
    routing.flatMap(section => section.models.map(model => ({ section, model }))), [routing])
  const dshGroups = useMemo(() =>
    state.groups.filter(group => !routing.some(section => section.provider === group.id)),
  [state.groups, routing])

  const matchesCurrent = (provider: string, modelId: string): boolean =>
    state.current !== null && state.current.provider === provider && state.current.model === modelId

  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  // The route and direct-model names resolve against their declared slices;
  // everything else falls through the plain groups lookup.
  const routedName = (entries: readonly RoutingEntry[]): string | undefined =>
    entries.find(({ section, model }) => matchesCurrent(section.provider, model.id))?.model.name
  const routeLabel = routedName(routeEntries)
  const directLabel = routedName(directEntries)
  const usesRoutingEntry = routeLabel !== undefined || directLabel !== undefined
  const routingLabel = routeLabel ?? directLabel ?? ''
  const modelLabel = usesRoutingEntry ? routingLabel : currentChoice?.model.name ?? t('trigger.fallback')
  const unsetLabel = t('cell.unset')

  const triggerAria = currentChoice === undefined && !usesRoutingEntry
    ? t('trigger.selectAria')
    : effortLabel === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })

  /**
   * Indented effort subgroup rendered directly beneath the currently selected
   * model row when that route exposes reasoning levels.
   */
  const renderEffortSubrows = (provider: string, model: ModelCatalogModel): ReactNode => {
    if (model.reasoning === undefined || !matchesCurrent(provider, model.id)) return null
    const levels = effortsOf(model.reasoning, t('effort.providerDefault'))
    return (
      <div className={css.effortGroup} role="group" aria-label={t('menu.effort')}>
        {levels.map(level => (
          <button
            ref={itemRef()}
            type="button"
            role="menuitemradio"
            aria-checked={effectiveEffort === level.effort}
            className={clsx(css.option, css.effortOption, effectiveEffort === level.effort && css.selected)}
            key={level.key}
            disabled={busy}
            onClick={() => { chooseEffort(level.effort) }}
          >
            <span className={css.optionCopy}>
              <span className={css.modelName}>{level.label}</span>
              {level.description !== undefined && (
                <span className={css.description}>{level.description}</span>
              )}
            </span>
            <span className={css.check}>
              {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
            </span>
          </button>
        ))}
      </div>
    )
  }

  /** One selectable routing entry row; credential-gated entries stay visible but inert. */
  const renderRoutingItem = ({ section, model }: RoutingEntry): ReactNode => {
    const gated = section.credentialRequired && !section.credentialReady
    const selected = matchesCurrent(section.provider, model.id)
    return (
      <Fragment key={`${section.provider}/${model.id}`}>
        <button
          ref={itemRef()}
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          className={clsx(css.option, selected && css.selected)}
          title={model.name}
          disabled={busy || gated}
          onClick={() => { choose({ provider: section.provider, model: model.id }) }}
        >
          <span className={css.optionCopy}>
            <span className={css.modelName}>{model.name}</span>
            {model.description !== undefined && (
              <span className={css.description}>{model.description}</span>
            )}
          </span>
          <span className={css.check}>
            {selected ? <IconCheckOutline16 /> : null}
          </span>
        </button>
        {renderEffortSubrows(section.provider, model)}
      </Fragment>
    )
  }

  /** One DSH provider-group row list; the selected model may expose its effort subgroup. */
  const renderDshGroup = (group: (typeof dshGroups)[number]): ReactNode => {
    const headingId = `${id}-${group.id}`
    return (
      <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
        <div className={css.groupTitle} id={headingId}>{group.name}</div>
        {group.models.map((model) => {
          const selected = matchesCurrent(group.id, model.id)
          return (
            <Fragment key={model.id}>
              <button
                ref={itemRef()}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={clsx(css.option, selected && css.selected)}
                title={model.name}
                disabled={busy}
                onClick={() => { choose({ provider: group.id, model: model.id }) }}
              >
                <span className={css.optionCopy}>
                  <span className={css.modelName}>{model.name}</span>
                  {model.description !== undefined && (
                    <span className={css.description}>{model.description}</span>
                  )}
                </span>
                <span className={css.check}>
                  {selected ? <IconCheckOutline16 /> : null}
                </span>
              </button>
              {renderEffortSubrows(group.id, model)}
            </Fragment>
          )
        })}
      </section>
    )
  }

  /** Shared routing-pane body: one optional heading per declaring provider. */
  const renderRoutingPane = (entries: readonly RoutingEntry[]): ReactNode => {
    const anyGated = entries.some(({ section }) => section.credentialRequired && !section.credentialReady)
    const multiSection = routing.length > 1
    let previous: SessionRoutingSection | undefined
    return (
      <>
        {anyGated && <div className={css.hint}>{t('routing.noCredential')}</div>}
        <div className={clsx(css.groups, 'scrollable')}>
          {entries.map((entry) => {
            const startsSection = multiSection
              && (previous === undefined || previous.provider !== entry.section.provider)
            previous = entry.section
            return (
              <Fragment key={`${entry.section.provider}/${entry.model.id}`}>
                {startsSection && (
                  <div className={css.groupTitle}>{entry.section.displayName}</div>
                )}
                {renderRoutingItem(entry)}
              </Fragment>
            )
          })}
        </div>
      </>
    )
  }

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  /** Catalog-load status strip shared by every drilled pane. */
  const catalogIssues = (
    <>
      {state.status === 'loading' && (
        <div className={css.status}>{t('status.loading')}</div>
      )}
      {state.error !== null && lastActionRef.current === 'load' && (
        <div className={css.error}>
          <span>{t('error.action', { message: state.error })}</span>
          <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
        </div>
      )}
      {state.failures.map(failure => (
        <div className={css.warning} key={failure.id}>
          <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
          <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
        </div>
      ))}
    </>
  )

  const rootCell = (paneKey: Exclude<Pane, 'root'>, label: string, value: string) => (
    <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane(paneKey) }}>
      <span className={css.cellLabel}>{label}</span>
      <span className={css.cellValue}>{value}</span>
      <IconChevronRightOutline14 className={css.cellChevron} />
    </button>
  )

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel(modelLabel, effortLabel)}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              {routeEntries.length > 0 && rootCell('routes', t('menu.routes'), routeLabel ?? unsetLabel)}
              {directEntries.length > 0 && rootCell('routeModels', t('menu.routeModels'), directLabel ?? unsetLabel)}
              {rootCell('dsh', t('menu.dshModels'), usesRoutingEntry ? unsetLabel : modelLabel)}
            </>
          )}

          {pane === 'routes' && catalogIssues}
          {pane === 'routes' && routeEntries.length > 0 && renderRoutingPane(routeEntries)}

          {pane === 'routeModels' && catalogIssues}
          {pane === 'routeModels' && directEntries.length > 0 && renderRoutingPane(directEntries)}

          {pane === 'dsh' && (
            <>
              {catalogIssues}
              <div className={clsx(css.groups, 'scrollable')}>
                {dshGroups.map(renderDshGroup)}
              </div>
              {state.status === 'ready' &&
                dshGroups.every(group => group.models.length === 0) && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}

/** Trigger title mirrors the visible caption pair. */
function triggerLabel(model: string, effort: string | undefined): string {
  return effort === undefined ? model : `${model} · ${effort}`
}
