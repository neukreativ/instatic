/**
 * SeoTargetIndex — the Meta tab's right column: navigation + audit context.
 *
 * Search, kind filters, an issues summary chip, the pinned Site defaults
 * card, then the targets grouped under Pages / Templates / Posts section
 * headers — each row shows title, mono route, and per-field health dots.
 * Keyboard: ↑/↓ move the selection, `/` focuses search.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { SearchBar } from '@ui/components/SearchBar'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { Button } from '@ui/components/Button'
import { computeSeoHealth, type SeoHealth } from '@core/seo'
import { cn } from '@ui/cn'
import type { SeoTarget } from '../lib/seoApi'
import { resolveTargetSeo } from '../lib/resolveTargetSeo'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import styles from './SeoTargetIndex.module.css'

type Filter = 'all' | 'pages' | 'posts' | 'templates' | 'issues'

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pages', label: 'Pages' },
  { value: 'posts', label: 'Posts' },
  { value: 'templates', label: 'Templates' },
  { value: 'issues', label: 'Issues' },
]

interface IndexedTarget {
  target: SeoTarget
  health: SeoHealth
}

interface TargetGroup {
  label: string
  items: IndexedTarget[]
}

interface SeoTargetIndexProps {
  workspace: SeoWorkspace
  selectedId: string
  siteDefaultsId: string
  onSelect: (id: string) => void
}

export function SeoTargetIndex({ workspace, selectedId, siteDefaultsId, onSelect }: SeoTargetIndexProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const searchRef = useRef<HTMLInputElement>(null)

  const indexed: IndexedTarget[] = workspace.targets.map((target) => ({
    target,
    health: computeSeoHealth(
      target.seo ?? undefined,
      resolveTargetSeo(target, undefined, workspace.resolveContext),
    ),
  }))

  const issueCount = indexed.filter((item) => item.health.issueCount > 0).length

  const normalizedQuery = query.trim().toLowerCase()
  const visible = indexed.filter(({ target, health }) => {
    if (filter === 'pages' && target.kind !== 'page') return false
    if (filter === 'posts' && target.kind !== 'post') return false
    if (filter === 'templates' && target.kind !== 'template') return false
    if (filter === 'issues' && health.issueCount === 0) return false
    if (normalizedQuery === '') return true
    return (
      target.title.toLowerCase().includes(normalizedQuery) ||
      (target.route ?? '').toLowerCase().includes(normalizedQuery)
    )
  })

  const groups: TargetGroup[] = [
    { label: 'Pages', items: visible.filter(({ target }) => target.kind === 'page') },
    { label: 'Templates', items: visible.filter(({ target }) => target.kind === 'template') },
    { label: 'Posts', items: visible.filter(({ target }) => target.kind === 'post') },
  ].filter((group) => group.items.length > 0)

  // Keyboard order: pinned site row first, then the grouped targets in
  // display order.
  const order: string[] = [siteDefaultsId, ...groups.flatMap((group) => group.items.map(({ target }) => target.id))]

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === '/') {
      event.preventDefault()
      searchRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const currentIndex = order.indexOf(selectedId)
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(order.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1)
    const next = order[nextIndex]
    if (next !== undefined && next !== selectedId) onSelect(next)
  }

  return (
    <section className={styles.index} aria-label="SEO targets">
      <SearchBar
        ref={searchRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Search targets…"
        aria-label="Search SEO targets"
        data-testid="seo-target-search"
      />

      <SegmentedControl
        value={filter}
        options={FILTER_OPTIONS}
        onChange={setFilter}
        size="xs"
        fullWidth
        aria-label="Filter targets"
        data-testid="seo-target-filter"
      />

      {issueCount > 0 && (
        <p className={styles.summary} role="status">
          {issueCount} {issueCount === 1 ? 'target needs' : 'targets need'} attention
        </p>
      )}

      <div
        className={styles.scroller}
        role="listbox"
        aria-label="SEO target list"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        <Button
          type="button"
          variant="ghost"
          className={cn(styles.siteRow, selectedId === siteDefaultsId && styles.rowSelected)}
          role="option"
          aria-selected={selectedId === siteDefaultsId}
          onClick={() => onSelect(siteDefaultsId)}
          data-testid="seo-target-site-defaults"
        >
          <span className={styles.rowMain}>
            <span className={styles.rowTitle}>Site defaults</span>
            <span className={styles.rowSub}>Fallbacks for every target</span>
          </span>
        </Button>

        {groups.map((group) => (
          <div key={group.label} className={styles.group}>
            <h3 className={styles.groupLabel}>{group.label}</h3>
            <div className={styles.groupList}>
              {group.items.map(({ target, health }) => (
                <TargetRow
                  key={target.id}
                  target={target}
                  health={health}
                  selected={selectedId === target.id}
                  onSelect={() => onSelect(target.id)}
                />
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className={styles.empty} role="status">No targets match the current filter.</p>
        )}
      </div>
    </section>
  )
}

function TargetRow({
  target,
  health,
  selected,
  onSelect,
}: {
  target: SeoTarget
  health: SeoHealth
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(styles.row, selected && styles.rowSelected)}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-testid={`seo-target-${target.id}`}
    >
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{target.title}</span>
        <span className={styles.rowSub}>
          {target.route ?? (target.kind === 'template' ? `Entry template${target.tableSlug ? ` · ${target.tableSlug}` : ''}` : '—')}
        </span>
      </span>
      <HealthDots health={health} />
    </Button>
  )
}

/**
 * Compact health indicators: title, description, image, indexing — green
 * when ok, amber for soft issues, red for missing/noindex. Each dot carries
 * a title tooltip naming the field + state for hover discovery.
 */
function HealthDots({ health }: { health: SeoHealth }) {
  return (
    <span className={styles.dots} aria-label={healthSummary(health)}>
      <Dot state={health.title === 'ok' ? 'ok' : health.title === 'long' ? 'warn' : 'bad'} label={`Title: ${health.title}`} />
      <Dot state={health.description === 'ok' ? 'ok' : health.description === 'long' ? 'warn' : 'bad'} label={`Description: ${health.description}`} />
      <Dot state={health.image === 'ok' ? 'ok' : health.image === 'missingAlt' ? 'warn' : 'bad'} label={`Social image: ${health.image}`} />
      <Dot state={health.indexable ? 'ok' : 'bad'} label={health.indexable ? 'Indexable' : 'Noindex'} />
    </span>
  )
}

function healthSummary(health: SeoHealth): string {
  return health.issueCount === 0
    ? 'No SEO issues'
    : `${health.issueCount} SEO ${health.issueCount === 1 ? 'issue' : 'issues'}`
}

function Dot({ state, label }: { state: 'ok' | 'warn' | 'bad'; label: string }) {
  return <span className={cn(styles.dot, styles[`dot_${state}`])} title={label} />
}
