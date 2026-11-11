import { useMemo, useState } from 'react'

import { requestCLINVEXAHomeAction } from '@/app/clinvexa-home/events'
import {
  CLINVEXA_HOME_CATEGORIES,
  CLINVEXA_HOME_SHORTCUTS,
  type CLINVEXAHomeCategory,
  type CLINVEXAHomeShortcut
} from '@/app/clinvexa-home/shortcuts'
import { ArrowUpRight, PawPrint } from '@/lib/icons'
import { SummonCopilotBall } from '@/clinvexa/summon-ball'

export type IntroProps = {
  personality?: string
  seed?: number
}

const WORDMARK = 'CLINVEXA'

function ShortcutCard({ shortcut }: { shortcut: CLINVEXAHomeShortcut }) {
  const Icon = shortcut.icon
  const unavailable = shortcut.availability === 'unavailable'
  const loading = shortcut.availability === 'loading'

  return (
    <button
      aria-label={`${shortcut.title}：${shortcut.description}`}
      className="group relative flex min-h-[122px] w-full items-center gap-4 rounded-[16px] border border-[#e2e9f5] bg-white px-5 py-4 text-left shadow-[0_4px_14px_rgba(40,72,122,0.06)] transition-[border-color,box-shadow,transform] duration-150 hover:border-[#8fb5ff] hover:shadow-[0_8px_22px_rgba(40,72,122,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57ff] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
      disabled={unavailable || loading}
      onClick={() => requestCLINVEXAHomeAction(shortcut.action)}
      type="button"
    >
      <span className="grid size-12 shrink-0 place-items-center text-[#0b57ff]">
        <Icon aria-hidden className="size-10 stroke-[1.65]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[18px] font-semibold leading-6 text-[#172033]">{shortcut.title}</span>
          {shortcut.badge && (
            <span className="rounded-md bg-[#e6efff] px-1.5 py-0.5 text-xs font-semibold leading-4 text-[#0b57ff]">
              {shortcut.badge}
            </span>
          )}
        </span>
        <span className="mt-1 block text-[14px] leading-5 text-[#647089]">{loading ? '正在检查现有功能…' : shortcut.description}</span>
        {unavailable && <span className="mt-1 block text-xs leading-4 text-[#b45309]">当前环境不可用，请在医疗工具中检查配置。</span>}
      </span>
      <ArrowUpRight aria-hidden className="size-6 shrink-0 text-[#0b57ff] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </button>
  )
}

export function Intro({ personality: _personality, seed: _seed }: IntroProps) {
  const [activeCategory, setActiveCategory] = useState<CLINVEXAHomeCategory>('clinical')
  const shortcuts = useMemo(
    () => CLINVEXA_HOME_SHORTCUTS.filter(shortcut => shortcut.categories.includes(activeCategory)),
    [activeCategory]
  )

  return (
    <main className="w-full min-w-0 overflow-y-auto pb-[132px]" data-slot="aui_intro">
      <div className="mx-auto w-full !max-w-[1120px] px-6 pt-[48px] !text-left sm:px-[48px] xl:!px-0">
        <div className="grid grid-cols-1 items-start gap-[34px] xl:grid-cols-[minmax(0,1fr)_356px] xl:gap-[56px]">
          <section className="min-w-0">
            <p aria-label={WORDMARK} className="m-0 font-['Collapse'] text-[64px] font-bold leading-[0.92] tracking-[0.02em] text-[#0b57ff]">{WORDMARK}</p>
            <h1 className="mt-[22px] text-[42px] font-bold leading-[1.16] tracking-[-0.035em] text-[#172033]">医生的智能工作助手</h1>
            <p className="mt-[13px] max-w-[720px] text-[16px] leading-7 text-[#647089]">从问诊记录到病历整理，再到 HIS 填写，让重复工作更快、更清楚、更可追溯</p>

            <div aria-label="功能分类" className="mt-[28px] inline-flex h-[56px] rounded-[12px] border border-[#dbe4f1] bg-white p-1 shadow-[0_2px_8px_rgba(40,72,122,0.04)]">
              {CLINVEXA_HOME_CATEGORIES.map(category => {
                const active = category.id === activeCategory
                const CategoryIcon = category.icon
                return (
                  <button
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-[9px] px-6 text-[16px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57ff] focus-visible:ring-offset-2 ${active ? 'bg-[#0b57ff] text-white shadow-[0_3px_8px_rgba(11,87,255,0.22)]' : 'text-[#26334b] hover:bg-[#f4f7fb]'}`}
                    key={category.id}
                    onClick={() => setActiveCategory(category.id)}
                    type="button"
                  >
                    <CategoryIcon aria-hidden className="size-5 stroke-[1.8]" />
                    {category.label}
                  </button>
                )
              })}
            </div>
          </section>

          <aside className="relative min-h-[246px] overflow-hidden rounded-[22px] border border-[#cfeaf0] bg-[#effcff] px-6 py-6 shadow-[0_8px_22px_rgba(57,126,150,0.08)]">
            <div className="flex items-center gap-2 text-[#172033]">
              <span className="grid size-7 place-items-center rounded-full bg-[#16c6bb] text-white"><PawPrint aria-hidden="true" className="size-4" /></span>
              <h2 className="text-[21px] font-bold leading-7">首次使用引导</h2>
            </div>
            <p className="mt-4 max-w-[230px] text-[16px] leading-7 text-[#31445b]">用虚构病例体验一次病历整理，不涉及真实患者数据</p>
            <button
              className="mt-5 min-h-11 rounded-xl bg-[#0b57ff] px-5 text-[16px] font-semibold text-white shadow-[0_5px_12px_rgba(11,87,255,0.22)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57ff] focus-visible:ring-offset-2"
              onClick={() => requestCLINVEXAHomeAction('first-use-demo')}
              type="button"
            >
              开始体验
            </button>
            <PawPrint aria-hidden="true" className="absolute bottom-[-20px] right-[-8px] size-[130px] rotate-[-15deg] text-[#0b57ff]/20" />
          </aside>
        </div>

        <section aria-labelledby="clinvexa-shortcuts-title" className="mt-[34px]">
          <h2 className="text-[25px] font-bold leading-8 tracking-[-0.02em] text-[#172033]" id="clinvexa-shortcuts-title">你可以从这里开始</h2>
          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {shortcuts.map(shortcut => <ShortcutCard key={shortcut.id} shortcut={shortcut} />)}
          </div>
        </section>

        <button
          className="mt-[26px] rounded-md text-[15px] font-semibold text-[#0b57ff] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57ff] focus-visible:ring-offset-2"
          onClick={() => requestCLINVEXAHomeAction('all-medical-tools')}
          type="button"
        >
          查看全部医疗工具
          <ArrowUpRight aria-hidden="true" className="ml-1 inline size-4" />
        </button>
        <div className="mt-4"><SummonCopilotBall /></div>
      </div>
    </main>
  )
}
