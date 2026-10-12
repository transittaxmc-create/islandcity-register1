// app/components/guia-panel.tsx
// Guide page inside the Help Center: search + index + deep links.
// Content lives in guia-content.ts. Firm UI, no animations.
'use client'
import { useMemo, useState } from 'react'
import { GUIDE_ENTRIES, GUIDE_SECTIONS, searchGuide, type GuideEntry, type GuideGo } from './guia-content'

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="mt-1.5 text-[13px] leading-5">
      <span className="font-bold text-[#10243f]">{k}: </span>
      <span className="text-slate-600">{v}</span>
    </div>
  )
}

function GoButton({ go, onGo }: { go: GuideGo; onGo?: (t: GuideGo) => void }) {
  return (
    <button
      onClick={() => onGo && onGo(go)}
      className="mt-2.5 rounded-lg bg-[#40b9a1]/15 px-3 py-1.5 text-xs font-bold text-[#0f766e]"
    >
      {go.label} →
    </button>
  )
}

function EntryCard({ e, onGo }: { e: GuideEntry; onGo?: (t: GuideGo) => void }) {
  return (
    <article id={`guia-${e.id}`} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-[15px] font-bold text-[#10243f]">{e.title}</h3>
      <Row k="What" v={e.what} />
      {e.how && <Row k="How" v={e.how} />}
      {e.calc && <Row k="Formula" v={e.calc} />}
      {e.source && <Row k="Data" v={e.source} />}
      {e.go && <GoButton go={e.go} onGo={onGo} />}
    </article>
  )
}

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
}

export default function GuiaPanel({ onGo }: { onGo?: (t: GuideGo) => void }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => searchGuide(q), [q])
  const searching = q.trim().length > 0

  return (
    <div className="max-w-4xl">
      <div className="mb-2 text-xs font-semibold text-[#086bc9]">Help Center</div>
      <h2 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Guide</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Every screen, number, and field in Dual Register — what it is, how to use it, and where the data comes from.
      </p>

      <div className="mt-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Search anything… (e.g. bank balance, match, transfers)"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#40b9a1]"
        />
      </div>

      {searching ? (
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-500">
            {results.length} result{results.length === 1 ? '' : 's'} for “{q.trim()}”
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {results.map((e) => (
              <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button onClick={() => scrollTo(`guia-${e.id}`)} className="text-left text-[14px] font-bold text-[#0f766e]">
                  {e.title}
                </button>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {GUIDE_SECTIONS.find((s) => s.id === e.section)?.title}
                </p>
                <p className="mt-1 text-[13px] text-slate-600">{e.what}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => scrollTo(`guia-${e.id}`)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                    Read in the guide ↓
                  </button>
                  {e.go && <GoButton go={e.go} onGo={onGo} />}
                </div>
              </div>
            ))}
            {results.length === 0 && (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                No matches. Try fewer words (e.g. “balance”, “daily”, “sync”).
              </p>
            )}
          </div>
          {/* full index below results so anchors exist */}
          <div className="mt-8 flex flex-col gap-8">
            {GUIDE_SECTIONS.map((s) => (
              <section key={s.id} id={`guia-sec-${s.id}`} className="scroll-mt-24">
                <h2 className="mb-3 text-lg font-bold text-[#10243f]">{s.title}</h2>
                <div className="flex flex-col gap-3">
                  {GUIDE_ENTRIES.filter((e) => e.section === s.id).map((e) => (
                    <EntryCard key={e.id} e={e} onGo={onGo} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Index</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {GUIDE_SECTIONS.map((s) => {
                const n = GUIDE_ENTRIES.filter((e) => e.section === s.id).length
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(`guia-sec-${s.id}`)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <span>{s.title}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-8">
            {GUIDE_SECTIONS.map((s) => (
              <section key={s.id} id={`guia-sec-${s.id}`} className="scroll-mt-24">
                <h2 className="mb-3 text-lg font-bold text-[#10243f]">{s.title}</h2>
                <div className="flex flex-col gap-3">
                  {GUIDE_ENTRIES.filter((e) => e.section === s.id).map((e) => (
                    <EntryCard key={e.id} e={e} onGo={onGo} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
