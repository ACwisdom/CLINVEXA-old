import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { ArchiveSkillConfirmDialog } from '@/app/learning/archive-skill-confirm-dialog'
import { CodeEditor } from '@/components/chat/code-editor'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CountSkeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  editLearningNode,
  getLearningNode,
  getSkills,
  getToolsets,
  getUsageAnalytics,
  setSkillEnabled,
  setToolsetEnabled
} from '@/hermes'
import { useI18n } from '@/i18n'
import { isDesktopToolsetVisible } from '@/lib/desktop-toolsets'
import { compactNumber } from '@/lib/format'
import { BookOpen, Globe } from '@/lib/icons'
import { queryClient, writeCache } from '@/lib/query-client'
import { invalidateSlashCompletions } from '@/lib/slash-completion-cache'
import { normalize } from '@/lib/text'
import { useStoreSelector } from '@/lib/use-session-slice'
import { $gateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import type { SkillInfo, ToolsetInfo } from '@/types/hermes'

import { useOnProfileSwitch } from '../hooks/use-on-profile-switch'
import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import {
  CapRow,
  DetailColumn,
  DetailPane,
  ListColumn,
  ListStrip,
  ListStripButton,
  ListStripMenu,
  type ListStripMenuToggle,
  MasterDetail,
  ToolChip
} from '../master-detail'
import { PanelEmpty, PanelPill } from '../overlays/panel'
import { PageSearchShell } from '../page-search-shell'
import { SETTINGS_ROUTE } from '../routes'
import { ComputerUsePanel } from '../settings/computer-use-panel'
import { asText, includesQuery, toolNames, toolsetDisplayLabel } from '../settings/helpers'
import { TerminalBackendPanel } from '../settings/terminal-backend-panel'
import { ToolsetConfigPanel } from '../settings/toolset-config-panel'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

import {
  type CapabilityCategory,
  capabilityLanguage,
  type CapabilityLanguage,
  categoryDescription,
  categoryLabel,
  classifySkill,
  localizedSkillDescription,
  localizedSkillTitle,
  localizeToolset
} from './capability-localization'
import { SkillsHub } from './hub'
import { McpTab } from './mcp-tab'
import { $skillsCategory, $skillsSortDesc, $toolsetsSortDesc } from './store'

const SKILLS_MODES = ['skills', 'toolsets', 'mcp', 'hub'] as const

// Skills + toolsets live in the RQ cache so switching tabs/pages paints the
// cached lists instantly (no reload flash) and mount only fires a deduped
// background refetch. A profile swap globally invalidates (see store/profile),
// so these plain keys refetch against the new backend automatically.
const SKILLS_QUERY_KEY = ['skills-list'] as const
const TOOLSETS_QUERY_KEY = ['toolsets-list'] as const

// Optimistic write-through: toggles/bulk/archive repaint instantly; the next
// background refetch reconciles with the backend.
const setSkills = writeCache<SkillInfo[]>(SKILLS_QUERY_KEY)
const setToolsets = writeCache<ToolsetInfo[]>(TOOLSETS_QUERY_KEY)

// Per-tool call counts come from a 365-day message scan — heavy, and purely
// cosmetic (Toolsets usage badges). Cache the result module-wide with a TTL so
// bouncing between tabs/pages doesn't re-run the scan every time. Keyed by
// profile: analytics are profile-scoped, so a switch must not show the previous
// profile's counts. `useRefreshHotkey` still forces a fresh pull.
const TOOL_CALLS_TTL_MS = 10 * 60 * 1000
const toolCallsCache = new Map<string, { at: number; value: Record<string, number> }>()

async function loadToolCalls(force = false): Promise<Record<string, number>> {
  const key = normalizeProfileKey($activeGatewayProfile.get())
  const cached = toolCallsCache.get(key)

  if (!force && cached && Date.now() - cached.at < TOOL_CALLS_TTL_MS) {
    return cached.value
  }

  const analytics = await getUsageAnalytics(365)

  const value = Object.fromEntries((analytics.tools ?? []).map(e => [e.tool, e.count]))

  // Only cache if the active profile hasn't changed during the request — else a
  // switch mid-flight would file this result under the wrong profile's key.
  if (normalizeProfileKey($activeGatewayProfile.get()) === key) {
    toolCallsCache.set(key, { at: Date.now(), value })
  }

  return value
}

const usageOf = (skill: SkillInfo): number => (typeof skill.usage === 'number' ? skill.usage : 0)

function filteredSkills(
  skills: SkillInfo[],
  query: string,
  desc: boolean,
  category: CapabilityCategory,
  language: CapabilityLanguage
): SkillInfo[] {
  const q = normalize(query)
  const sign = desc ? 1 : -1

  return skills
    .filter(
      skill =>
        classifySkill(skill) === category &&
        (!q ||
          includesQuery(skill.name, q) ||
          includesQuery(localizedSkillTitle(skill, language), q) ||
          includesQuery(localizedSkillDescription(skill, language), q) ||
          includesQuery(categoryLabel(category, language), q))
    )
    .sort((a, b) => sign * (usageOf(b) - usageOf(a)) || asText(a.name).localeCompare(asText(b.name)))
}

const toolsetCalls = (toolset: ToolsetInfo, toolCalls: Record<string, number>): number =>
  toolNames(toolset).reduce((sum, name) => sum + (toolCalls[name] ?? 0), 0)

function filteredToolsets(
  toolsets: ToolsetInfo[],
  query: string,
  toolCalls: Record<string, number>,
  desc: boolean,
  language: CapabilityLanguage
): ToolsetInfo[] {
  const q = normalize(query)
  const sign = desc ? 1 : -1

  return toolsets
    .filter(toolset => {
      if (!isDesktopToolsetVisible(toolset.name)) {
        return false
      }

      if (!q) {
        return true
      }

      const localized = localizeToolset(toolset, language)

      return (
        includesQuery(toolset.name, q) ||
        includesQuery(localized.title, q) ||
        includesQuery(localized.description, q) ||
        toolNames(toolset).some(name => includesQuery(name, q))
      )
    })
    .sort(
      (a, b) =>
        sign * (toolsetCalls(b, toolCalls) - toolsetCalls(a, toolCalls)) ||
        toolsetDisplayLabel(a).localeCompare(toolsetDisplayLabel(b))
    )
}

const visibleToolsetCount = (toolsets: ToolsetInfo[]) => toolsets.filter(ts => isDesktopToolsetVisible(ts.name)).length

interface SkillsViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function SkillsView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: SkillsViewProps) {
  const { isSavingLocale, locale, setLocale, t } = useI18n()
  const language = capabilityLanguage(locale)
  const [mode, setMode] = useRouteEnumParam('tab', SKILLS_MODES, 'skills')
  // $gateway only feeds the MCP tab — gate the subscription so Skills/Toolsets/Hub
  // tabs don't re-render on connect/disconnect/reconnect.
  const gateway = useStoreSelector($gateway, g => (mode === 'mcp' ? g : null))

  const [query, setQuery] = useState('')

  const {
    data: skills,
    isError: skillsFailed,
    error: skillsError
  } = useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: getSkills,
    staleTime: 0
  })

  const { data: toolsets, isError: toolsetsFailed } = useQuery({
    queryKey: TOOLSETS_QUERY_KEY,
    queryFn: getToolsets,
    staleTime: 0
  })

  // tool name -> call count over the analytics window. null = still loading
  // (badges show skeletons); {} = loaded empty / unavailable backend.
  const [toolCalls, setToolCalls] = useState<Record<string, number> | null>(null)
  // Bumped on profile switch so a slow analytics load from profile A can't set
  // toolCalls after the user moved to B.
  const toolCallsEpoch = useRef(0)
  const skillsSortDesc = useStore($skillsSortDesc)
  const toolsetsSortDesc = useStore($toolsetsSortDesc)
  const skillsCategory = useStore($skillsCategory)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selectedToolset, setSelectedToolset] = useState<string | null>(null)

  const refreshCapabilities = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TOOLSETS_QUERY_KEY })
    ])

    invalidateSlashCompletions()

    // An explicit refresh is the one time we bypass the analytics TTL — but
    // only if the badges are already on screen; otherwise let the lazy load
    // pick it up when Toolsets is first shown. Guard the async set against a
    // profile switch landing before it resolves.
    if (toolCallsCache.size > 0) {
      const epoch = toolCallsEpoch.current

      loadToolCalls(true)
        .then(value => toolCallsEpoch.current === epoch && setToolCalls(value))
        .catch(() => toolCallsEpoch.current === epoch && setToolCalls({}))
    }
  }, [])

  const refreshToolsets = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: TOOLSETS_QUERY_KEY })
  }, [])

  useRefreshHotkey(refreshCapabilities)

  // Per-tool call counts feed ONLY the Toolsets tab's usage badges/sort, and
  // the query behind them is a 365-day message scan — heavy. Fetch it lazily
  // the first time Toolsets is shown, never on Skills or MCP, so it can't
  // starve the MCP tab's config load. Absent → toolsets sort A–Z until it lands.
  useEffect(() => {
    if (mode !== 'toolsets' || toolCalls !== null) {
      return
    }

    let cancelled = false
    // Guard the setter by epoch too: when toolCalls is already null at switch
    // time, setToolCalls(null) is a no-op so this effect never re-runs to flip
    // `cancelled` — the epoch check catches that gap.
    const epoch = toolCallsEpoch.current
    const live = () => !cancelled && toolCallsEpoch.current === epoch

    loadToolCalls()
      .then(value => live() && setToolCalls(value))
      .catch(() => live() && setToolCalls({}))

    return () => void (cancelled = true)
  }, [mode, toolCalls])

  // On a profile switch the analytics cache is profile-keyed, but our local
  // toolCalls state isn't — leaving it non-null would keep the lazy effect from
  // ever re-running, so badges/sort would show the previous profile's counts.
  // Reset to null so the next Toolsets view reloads for the active profile.
  useOnProfileSwitch(() => {
    toolCallsEpoch.current += 1
    setToolCalls(null)
  })

  const visibleSkills = useMemo(
    () => (skills ? filteredSkills(skills, query, skillsSortDesc, skillsCategory, language) : []),
    [language, query, skills, skillsCategory, skillsSortDesc]
  )

  const visibleToolsets = useMemo(
    () => (toolsets ? filteredToolsets(toolsets, query, toolCalls ?? {}, toolsetsSortDesc, language) : []),
    [language, query, toolCalls, toolsets, toolsetsSortDesc]
  )

  // Bulk actions ("All" master switch, "Disable unused") and the master-switch
  // state target the WHOLE tab, never the search-filtered view — a tab-wide
  // control that silently scoped to the current query would be a lie.
  const bulkSkills = skills ?? []
  const bulkToolsets = useMemo(() => (toolsets ?? []).filter(ts => isDesktopToolsetVisible(ts.name)), [toolsets])

  // Rotating placeholder nudges from the user's own data — teach that search
  // understands categories and tool names, not just titles.
  const searchHints = useMemo(() => {
    if (mode === 'skills' && skills?.length) {
      return skills
        .filter(skill => classifySkill(skill) === skillsCategory)
        .slice(0, 5)
        .map(skill => t.common.tryHint(localizedSkillTitle(skill, language)))
    }

    if (mode === 'toolsets' && toolsets?.length) {
      return toolsets
        .filter(ts => isDesktopToolsetVisible(ts.name) && toolNames(ts).length > 0)
        .slice(0, 5)
        .map(ts => t.common.tryHint(toolNames(ts)[0]))
    }

    return undefined
  }, [language, mode, skills, skillsCategory, toolsets, t])

  const changeLanguage = (value: string) => {
    const next = value === 'en' ? 'en' : 'zh'

    void setLocale(next).catch(err => notifyError(err, t.language.saveError))
  }

  // Keep a valid selection: fall back to the first visible row when the
  // current selection is filtered out (or nothing is selected yet).
  const activeToolset = useMemo(
    () => visibleToolsets.find(ts => ts.name === selectedToolset) ?? visibleToolsets[0] ?? null,
    [selectedToolset, visibleToolsets]
  )

  // Single toggles are optimistic and silent on success (the row repaints
  // immediately — a toast per flip would spam rapid customization). Errors
  // revert and notify.
  async function handleToggleSkill(skill: SkillInfo, enabled: boolean) {
    setSkills(current => current?.map(row => (row.name === skill.name ? { ...row, enabled } : row)) ?? current)

    try {
      await setSkillEnabled(skill.name, enabled)
      // A disabled skill loses its `/name` command, so the composer's cached
      // `/` list has to be dropped along with the row repaint.
      invalidateSlashCompletions()
    } catch (err) {
      setSkills(
        current => current?.map(row => (row.name === skill.name ? { ...row, enabled: !enabled } : row)) ?? current
      )
      notifyError(err, t.skills.failedToUpdate(skill.name))
    }
  }

  async function handleToggleToolset(toolset: ToolsetInfo, enabled: boolean) {
    setToolsets(
      current =>
        current?.map(row => (row.name === toolset.name ? { ...row, enabled, available: enabled } : row)) ?? current
    )

    try {
      await setToolsetEnabled(toolset.name, enabled)
    } catch (err) {
      setToolsets(
        current =>
          current?.map(row => (row.name === toolset.name ? { ...row, enabled: !enabled, available: !enabled } : row)) ??
          current
      )
      notifyError(err, t.skills.failedToUpdate(toolsetDisplayLabel(toolset)))
    }
  }

  // Sequential on purpose: each toggle is a config read-modify-write on the
  // backend; parallel calls would race the disabled-list save.
  async function bulkApply(skillTargets: SkillInfo[], toolsetTargets: ToolsetInfo[], enabled: boolean) {
    if (bulkBusy || skillTargets.length + toolsetTargets.length === 0) {
      return
    }

    setBulkBusy(true)

    let done = 0

    try {
      for (const row of skillTargets) {
        await setSkillEnabled(row.name, enabled)
        setSkills(cur => cur?.map(r => (r.name === row.name ? { ...r, enabled } : r)) ?? cur)
        done += 1
      }

      for (const row of toolsetTargets) {
        await setToolsetEnabled(row.name, enabled)
        setToolsets(cur => cur?.map(r => (r.name === row.name ? { ...r, enabled, available: enabled } : r)) ?? cur)
        done += 1
      }

      notify({ kind: 'success', title: t.skills.bulkUpdated(done), message: '' })
    } catch (err) {
      notifyError(err, t.skills.failedToUpdate(mode === 'skills' ? t.skills.tabSkills : t.skills.tabToolsets))
    } finally {
      invalidateSlashCompletions()
      setBulkBusy(false)
    }
  }

  const bulkToggle = (enabled: boolean) =>
    mode === 'skills'
      ? bulkApply(
          bulkSkills.filter(row => row.enabled !== enabled),
          [],
          enabled
        )
      : bulkApply(
          [],
          bulkToolsets.filter(row => row.enabled !== enabled),
          enabled
        )

  // "Never used" = zero recorded activity. The pruning move for a 100+ skill
  // install: keep the workhorses, shed the noise.
  const disableUnused = () =>
    bulkApply(
      bulkSkills.filter(skill => skill.enabled && usageOf(skill) === 0),
      [],
      false
    )

  // One switch line covering enable-all/disable-all.
  const bulkSwitch = (allEnabled: boolean): ListStripMenuToggle => ({
    checked: allEnabled,
    disabled: bulkBusy,
    label: t.skills.all,
    onToggle: checked => void bulkToggle(checked)
  })

  const allSkillsEnabled = bulkSkills.length > 0 && bulkSkills.every(s => s.enabled)
  const allToolsetsEnabled = bulkToolsets.length > 0 && bulkToolsets.every(ts => ts.enabled)

  const sortButton = (desc: boolean, flip: () => void) => (
    <ListStripButton onClick={flip}>{desc ? t.skills.sortMostUsedDesc : t.skills.sortLeastUsedAsc}</ListStripButton>
  )

  // Full-bleed empty state, matching the MCP tab (spans both columns, not a
  // cramped note in the left rail). Query-aware, and says "tools" not the
  // internal "toolsets".
  const capabilityEmpty = (noun: string) => {
    const q = query.trim()

    return (
      <div className="flex h-full min-h-0 flex-1">
        <PanelEmpty
          description={q ? t.skills.emptyNothingMatches(q) : t.skills.emptyNoneAvailable(noun)}
          icon="search"
          title={t.skills.emptyNoneFound(noun)}
        />
      </div>
    )
  }

  // Learned/local skills are editable + archivable, mirroring the memory
  // graph (same /api/learning/node endpoints — delete archives, restorable
  // via `hermes curator restore`).
  const [skillEditor, setSkillEditor] = useState<null | { content: string; name: string }>(null)
  const [skillDraft, setSkillDraft] = useState('')
  const [skillSaving, setSkillSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<null | string>(null)
  // Bumped on profile switch so an in-flight openSkillEditor fetch from profile
  // A can't reopen the editor with A's content after switching to B.
  const skillEditorEpoch = useRef(0)

  // A profile switch swaps the backend under the open editor/archive dialog —
  // their targets belong to profile A, so a save/archive would hit B. Drop them
  // so nothing edits or archives against the newly active profile.
  useOnProfileSwitch(() => {
    skillEditorEpoch.current += 1
    setSkillEditor(null)
    setSkillDraft('')
    setArchiveTarget(null)
  })

  const openSkillEditor = async (name: string) => {
    const epoch = skillEditorEpoch.current

    try {
      const node = await getLearningNode(name)

      if (skillEditorEpoch.current !== epoch) {
        return
      }

      setSkillEditor({ content: node.content, name })
      setSkillDraft(node.content)
    } catch (err) {
      notifyError(err, name)
    }
  }

  const saveSkillEdit = async () => {
    if (!skillEditor) {
      return
    }

    setSkillSaving(true)

    try {
      await editLearningNode(skillEditor.name, skillDraft)
      notify({
        kind: 'success',
        title: t.skills.skillUpdated,
        message: t.skills.appliesToNewSessions(skillEditor.name)
      })
      setSkillEditor(null)
      void refreshCapabilities()
    } catch (err) {
      notifyError(err, skillEditor.name)
    } finally {
      setSkillSaving(false)
    }
  }

  const skillEditorPane = skillEditor && (
    <DetailPane
      actions={
        <Button disabled={skillSaving} onClick={() => void saveSkillEdit()} size="xs">
          {skillSaving ? t.common.saving : t.common.save}
        </Button>
      }
      id="skill-editor"
      onClose={() => setSkillEditor(null)}
      title={<span className="text-xs font-normal text-muted-foreground/60">{skillEditor.name}/SKILL.md</span>}
    >
      <CodeEditor
        filePath="SKILL.md"
        initialValue={skillEditor.content}
        key={skillEditor.name}
        onCancel={() => setSkillEditor(null)}
        onChange={setSkillDraft}
        onSave={() => void saveSkillEdit()}
      />
    </DetailPane>
  )

  return (
    <PageSearchShell
      {...props}
      activeTab={mode}
      filters={
        mode === 'skills' ? (
          <div aria-label={t.skills.categoryLabel} className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-(--ui-text-tertiary)">{t.skills.categoryLabel}</span>
            {(['medical', 'office'] as const).map(category => (
              <Button
                aria-pressed={skillsCategory === category}
                key={category}
                onClick={() => $skillsCategory.set(category)}
                size="xs"
                variant={skillsCategory === category ? 'default' : 'outline'}
              >
                {categoryLabel(category, language)}
              </Button>
            ))}
            <span className="min-w-0 truncate text-xs text-(--ui-text-quaternary)">
              {categoryDescription(skillsCategory, language)}
            </span>
          </div>
        ) : undefined
      }
      onSearchChange={setQuery}
      onTabChange={id => setMode(id as (typeof SKILLS_MODES)[number])}
      // MCP manages a handful of entries with the editor right there —
      // searching it is noise.
      searchHidden={mode === 'mcp'}
      searchHints={searchHints}
      searchPlaceholder={
        mode === 'skills'
          ? t.skills.searchSkills
          : mode === 'hub'
            ? t.skills.hub.searchPlaceholder
            : t.skills.searchToolsets
      }
      searchTrailingAction={
        <div className="flex items-center gap-2" title={t.skills.languageHint}>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-(--ui-text-tertiary)">
            <Globe className="size-3.5" />
            {t.skills.languageLabel}
          </span>
          <Select disabled={isSavingLocale} onValueChange={changeLanguage} value={language}>
            <SelectTrigger aria-label={t.skills.languageLabel} className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">简体中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
      searchValue={query}
      tabs={[
        { id: 'skills', label: t.skills.tabSkills, meta: skills?.length ?? null },
        { id: 'toolsets', label: t.skills.tabToolsets, meta: toolsets ? visibleToolsetCount(toolsets) : null },
        { id: 'mcp', label: t.skills.tabMcp },
        { id: 'hub', label: t.skills.tabHub }
      ]}
    >
      {mode === 'hub' ? (
        <SkillsHub language={language} query={query} />
      ) : mode === 'mcp' ? (
        <McpTab gateway={gateway} language={language} />
      ) : (skillsFailed || toolsetsFailed) && (!skills || !toolsets) ? (
        <PanelEmpty
          action={
            <Button onClick={() => void refreshCapabilities()} size="sm">
              {t.skills.refresh}
            </Button>
          }
          description={skillsError instanceof Error ? skillsError.message : undefined}
          icon="error"
          title={t.skills.skillsLoadFailed}
        />
      ) : !skills || !toolsets ? (
        <PageLoader label={t.skills.loading} />
      ) : mode === 'skills' ? (
        visibleSkills.length === 0 ? (
          capabilityEmpty('skills')
        ) : (
          <section aria-label={t.skills.tabSkills} className="flex h-full min-h-0 flex-1 flex-col">
            <ListStrip
              left={sortButton(skillsSortDesc, () => $skillsSortDesc.set(!$skillsSortDesc.get()))}
              right={
                <ListStripMenu
                  items={[{ disabled: bulkBusy, label: t.skills.disableUnused, onSelect: () => void disableUnused() }]}
                  label={t.skills.tabSkills}
                  toggle={bulkSwitch(allSkillsEnabled)}
                />
              }
            />
            <div className="skills-card-scroll">
              <div className="skills-card-grid">
                {visibleSkills.map(skill => (
                  <SkillCard
                    busy={bulkBusy}
                    key={skill.name}
                    language={language}
                    onArchive={() => setArchiveTarget(skill.name)}
                    onEdit={() => void openSkillEditor(skill.name)}
                    onToggle={enabled => void handleToggleSkill(skill, enabled)}
                    skill={skill}
                  />
                ))}
              </div>
              <p className="mt-5 text-sm text-(--ui-text-secondary)">{t.skills.changesApplyNewSessions}</p>
            </div>
            {skillEditorPane}
          </section>
        )
      ) : visibleToolsets.length === 0 ? (
        capabilityEmpty('tools')
      ) : (
        <MasterDetail split="wide">
          <ListColumn
            header={
              <ListStrip
                left={sortButton(toolsetsSortDesc, () => $toolsetsSortDesc.set(!$toolsetsSortDesc.get()))}
                right={<ListStripMenu label={t.skills.tabToolsets} toggle={bulkSwitch(allToolsetsEnabled)} />}
              />
            }
          >
            {visibleToolsets.map(toolset => {
              const localized = localizeToolset(toolset, language)
              const label = localized.title
              const calls = toolCalls ? toolsetCalls(toolset, toolCalls) : null

              return (
                <CapRow
                  active={activeToolset?.name === toolset.name}
                  busy={bulkBusy}
                  enabled={toolset.enabled}
                  key={toolset.name}
                  meta={
                    calls === null ? (
                      <CountSkeleton />
                    ) : calls > 0 ? (
                      `×${compactNumber(calls)}`
                    ) : language === 'zh' ? (
                      `${toolNames(toolset).length} 个工具`
                    ) : (
                      `${toolNames(toolset).length} tools`
                    )
                  }
                  onSelect={() => setSelectedToolset(toolset.name)}
                  onToggle={checked => void handleToggleToolset(toolset, checked)}
                  subtitle={`${categoryLabel('office', language)} · ${localized.description}`}
                  title={label}
                  toggleLabel={t.skills.toggleToolset(label, !toolset.enabled)}
                />
              )
            })}
          </ListColumn>
          <DetailColumn footer={t.skills.changesApplyNewSessions}>
            {activeToolset && (
              <ToolsetDetail
                language={language}
                onConfiguredChange={refreshToolsets}
                toolCalls={toolCalls ?? {}}
                toolset={activeToolset}
              />
            )}
          </DetailColumn>
        </MasterDetail>
      )}
      {archiveTarget && (
        <ArchiveSkillConfirmDialog
          onApply={() => {
            const name = archiveTarget
            const snapshot = skills

            setSkills(current => current?.filter(skill => skill.name !== name) ?? current)
            invalidateSlashCompletions()

            if (skillEditor?.name === name) {
              setSkillEditor(null)
            }

            return () => setSkills(snapshot)
          }}
          onClose={() => setArchiveTarget(null)}
          onFailure={(err, name) => notifyError(err, name)}
          open
          skillId={archiveTarget}
          skillName={archiveTarget}
        />
      )}
    </PageSearchShell>
  )
}

// Shared inspector header — mirrors Messaging's PlatformDetail so Skills and
// Tools share one title/description block and tab switches don't jump.
function DetailHeader({
  description,
  pills,
  title
}: {
  description: React.ReactNode
  pills?: React.ReactNode
  title: string
}) {
  return (
    <header>
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h3>
        {pills}
      </div>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {description}
      </p>
    </header>
  )
}

interface SkillCardProps {
  language: CapabilityLanguage
  onArchive: () => void
  onEdit: () => void
  onToggle: (enabled: boolean) => void
  busy: boolean
  skill: SkillInfo
}

function SkillCard({ language, onArchive, onEdit, onToggle, busy, skill }: SkillCardProps) {
  const { t } = useI18n()
  const title = localizedSkillTitle(skill, language)
  const editable = skill.provenance === 'agent'

  return (
    <article aria-label={title} className="skills-card">
      <header className="skills-card-heading">
        <BookOpen aria-hidden="true" className="size-5 shrink-0" />
        <h3>{title}</h3>
        <Switch aria-label={title} checked={skill.enabled} disabled={busy} onCheckedChange={onToggle} />
      </header>
      <p className="skills-card-description">{localizedSkillDescription(skill, language) || t.skills.noDescription}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-(--ui-text-secondary)">
        <span>{categoryLabel(classifySkill(skill), language)}</span>
        {skill.provenance && <span>· {t.skills.provenance[skill.provenance]}</span>}
        {usageOf(skill) > 0 && (
          <span>
            · {language === 'zh' ? '使用 ' : 'Used '}
            {compactNumber(usageOf(skill))}
            {language === 'zh' ? ' 次' : ' times'}
          </span>
        )}
      </div>
      <details className="skills-card-management">
        <summary>{language === 'zh' ? '管理技能' : 'Manage skill'}</summary>
        <p className="my-3 break-all text-sm text-(--ui-text-secondary)">{skill.name}</p>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onEdit} size="sm" variant="outline">
              {t.skills.edit}
            </Button>
            <Button className="text-destructive hover:text-destructive" onClick={onArchive} size="sm" variant="text">
              {t.skills.archive}
            </Button>
          </div>
        )}
      </details>
    </article>
  )
}

function ToolsetDetail({
  language,
  toolset,
  toolCalls,
  onConfiguredChange
}: {
  language: CapabilityLanguage
  toolset: ToolsetInfo
  toolCalls: Record<string, number>
  onConfiguredChange: () => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const tools = toolNames(toolset)
  const localized = localizeToolset(toolset, language)
  const label = localized.title

  return (
    <>
      {/* "Configured" as a resting state is noise — only the warn state earns a pill. */}
      <DetailHeader
        description={localized.description || t.skills.noDescription}
        pills={
          <>
            <PanelPill>{categoryLabel('office', language)}</PanelPill>
            {!toolset.configured && <PanelPill tone="warn">{t.skills.needsKeys}</PanelPill>}
          </>
        }
        title={label}
      />
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tools.map(name => (
            <ToolChip key={name}>
              {name}
              {(toolCalls[name] ?? 0) > 0 && (
                <span className="ml-1 text-(--ui-text-quaternary)">×{compactNumber(toolCalls[name])}</span>
              )}
            </ToolChip>
          ))}
        </div>
      )}
      {toolset.name === 'vision' && (
        // Vision has no provider matrix — model resolution runs through the
        // auxiliary model config. Point at the actual home (Settings → Models,
        // aux "vision" row) via an internal deep link instead of leaving the
        // detail pane empty.
        <div className="grid gap-1.5">
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {t.skills.visionModelHint}
          </p>
          <div>
            <Button
              onClick={() => navigate(`${SETTINGS_ROUTE}?tab=config:model&aux=vision`)}
              size="xs"
              variant="textStrong"
            >
              {t.skills.visionModelLink}
            </Button>
          </div>
        </div>
      )}
      {toolset.name === 'computer_use' && <ComputerUsePanel onConfiguredChange={onConfiguredChange} />}
      {toolset.name === 'terminal' && <TerminalBackendPanel onConfiguredChange={onConfiguredChange} />}
      <ToolsetConfigPanel key={toolset.name} onConfiguredChange={onConfiguredChange} toolset={toolset.name} />
    </>
  )
}
