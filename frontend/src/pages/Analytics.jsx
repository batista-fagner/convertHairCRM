import { useState, useEffect, useMemo, useRef } from 'react'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { BarChart3, Loader2, TrendingUp, Layers, Megaphone, X, Check, XCircle, Star, Clock, CalendarRange } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const GROUP_OPTIONS = [
  { key: 'ad', label: 'Anúncio', icon: Megaphone },
  { key: 'adset', label: 'Conjunto', icon: Layers },
  { key: 'campaign', label: 'Campanha', icon: TrendingUp },
]

const PERIOD_OPTIONS = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'all', label: 'Tudo' },
]

function toDateInputValue(d) {
  return d.toISOString().slice(0, 10)
}

// Converte o período selecionado em from/to (ISO date, from inclusivo / to exclusivo)
function periodToRange(period) {
  if (period === 'all') return { from: null, to: null }
  const now = new Date()
  const to = new Date(now)
  to.setDate(to.getDate() + 1)
  const from = new Date(now)
  if (period === 'today') {
    from.setHours(0, 0, 0, 0)
  } else if (period === '7d') {
    from.setDate(from.getDate() - 6)
    from.setHours(0, 0, 0, 0)
  } else if (period === '30d') {
    from.setDate(from.getDate() - 29)
    from.setHours(0, 0, 0, 0)
  }
  return { from: toDateInputValue(from), to: toDateInputValue(to) }
}

// Converte um range { from, to } (Date, do calendário) em from/to ISO (to exclusivo, dia seguinte)
function customRangeToRange(customFrom, customTo) {
  if (!customFrom) return { from: null, to: null }
  const end = customTo || customFrom
  const toExclusive = new Date(end)
  toExclusive.setDate(toExclusive.getDate() + 1)
  return { from: toDateInputValue(customFrom), to: toDateInputValue(toExclusive) }
}

function fmtShortDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  const s = Number(seconds)
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`
  return `${(s / 86400).toFixed(1)} d`
}

function pct(part, total) {
  if (!total) return '—'
  return `${Math.round((part / total) * 1000) / 10}%`
}

// Agrupa as linhas por anúncio/conjunto/campanha, somando as métricas
function groupRows(rows, groupBy) {
  const keyFn = {
    ad: (r) => r.adName || r.adId,
    adset: (r) => r.adsetName || '—',
    campaign: (r) => r.campaignName || '—',
  }[groupBy]

  const groups = new Map()
  for (const r of rows) {
    const key = keyFn(r)
    if (!groups.has(key)) {
      groups.set(key, {
        name: key,
        adId: r.adId,
        adIds: new Set(),
        total: 0,
        leadEventCount: 0,
        qualifiedCount: 0,
        disqualifiedCount: 0,
        premiumCount: 0,
        spend: 0,
        weightedQualifySeconds: 0,
        qualifiedWithTime: 0,
      })
    }
    const g = groups.get(key)
    g.adIds.add(r.adId)
    g.total += r.total
    g.leadEventCount += r.leadEventCount
    g.qualifiedCount += r.qualifiedCount
    g.disqualifiedCount += r.disqualifiedCount
    g.premiumCount += r.premiumCount
    g.spend += r.spend || 0
    if (r.avgSecondsToQualify) {
      g.weightedQualifySeconds += Number(r.avgSecondsToQualify) * r.qualifiedCount
      g.qualifiedWithTime += r.qualifiedCount
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      ...g,
      cpql: g.qualifiedCount > 0 ? g.spend / g.qualifiedCount : null,
      avgSecondsToQualify: g.qualifiedWithTime > 0 ? g.weightedQualifySeconds / g.qualifiedWithTime : null,
      drillAdId: g.adIds.size === 1 ? [...g.adIds][0] : null,
    }))
    .sort((a, b) => b.total - a.total)
}

function HourlyChart({ from, to }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    fetch(`${API}/leads/analytics/hourly?${params.toString()}`)
      .then((r) => r.json())
      .then((rows) => setData(Array.isArray(rows) ? rows : []))
      .catch(() => setError('Erro ao carregar distribuição por horário'))
  }, [from, to])

  const total = useMemo(() => (data ? data.reduce((s, r) => s + r.count, 0) : 0), [data])
  const max = useMemo(() => (data ? Math.max(1, ...data.map((r) => r.count)) : 1), [data])
  const peak = useMemo(() => (data && total > 0 ? data.reduce((a, b) => (b.count > a.count ? b : a)) : null), [data, total])
  const lowest = useMemo(
    () => (data && total > 0 ? data.filter((r) => r.count > 0).reduce((a, b) => (b.count < a.count ? b : a), data.find((r) => r.count > 0)) : null),
    [data, total],
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mt-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-600" />
          <h3 className="text-sm font-semibold text-slate-800">Leads por horário do dia</h3>
        </div>
        {peak && lowest && (
          <div className="flex items-center gap-4 text-xs">
            <span className="text-emerald-700 font-medium">
              🔥 Pico: {String(peak.hour).padStart(2, '0')}h ({peak.count} leads)
            </span>
            <span className="text-slate-500 font-medium">
              🧊 Menor: {String(lowest.hour).padStart(2, '0')}h ({lowest.count} leads)
            </span>
          </div>
        )}
      </div>

      {data === null && !error && (
        <div className="py-10 text-center">
          <Loader2 className="w-5 h-5 text-slate-300 mx-auto animate-spin" />
        </div>
      )}
      {error && <p className="text-red-500 text-sm text-center py-6">{error}</p>}
      {data && total === 0 && <p className="text-slate-400 text-sm text-center py-6">Nenhum lead no período selecionado.</p>}

      {data && total > 0 && (
        <div className="flex items-end gap-1 h-40">
          {data.map((r) => {
            const heightPct = (r.count / max) * 100
            const isPeak = peak && r.hour === peak.hour && r.count > 0
            return (
              <div key={r.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                {/* Tooltip customizado — aparece instantaneamente (sem o delay do title nativo) */}
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-75 z-10 whitespace-nowrap">
                  <div className="bg-slate-800 text-white text-[11px] font-medium rounded-md px-2 py-1 shadow-lg">
                    {String(r.hour).padStart(2, '0')}h — {r.count} lead{r.count === 1 ? '' : 's'}
                  </div>
                  <div className="w-2 h-2 bg-slate-800 rotate-45 mx-auto -mt-1" />
                </div>
                <div
                  className={`w-full rounded-t transition-all ${isPeak ? 'bg-emerald-500' : 'bg-violet-400'} group-hover:opacity-80`}
                  style={{ height: `${Math.max(heightPct, r.count > 0 ? 3 : 0)}%` }}
                />
                <span className="text-[9px] text-slate-400 mt-1">{r.hour % 3 === 0 ? String(r.hour).padStart(2, '0') : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LeadDrillDown({ adId, adName, from, to, onClose }) {
  const [leads, setLeads] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    fetch(`${API}/leads/analytics/ads/${adId}/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch(() => setError('Erro ao carregar leads'))
  }, [adId, from, to])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">{adName}</h3>
            <p className="text-xs text-slate-400 mt-0.5">Leads individuais deste anúncio</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {leads === null && !error && (
            <div className="p-10 text-center">
              <Loader2 className="w-5 h-5 text-slate-300 mx-auto animate-spin" />
            </div>
          )}
          {error && <p className="text-red-500 text-sm p-6 text-center">{error}</p>}
          {leads && leads.length === 0 && (
            <p className="text-slate-400 text-sm p-6 text-center">Nenhum lead nesse período.</p>
          )}
          {leads && leads.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Nome</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600">Evento Lead</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600">Qualificado</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600">Premium</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Data</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{l.name}</td>
                    <td className="px-3 py-2.5 text-center">
                      {l.leadEventSent ? (
                        <Check className="w-4 h-4 text-emerald-600 inline" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-300 inline" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {l.isMql ? (
                        <Check className="w-4 h-4 text-emerald-600 inline" />
                      ) : l.vendeCabelo === false ? (
                        <XCircle className="w-4 h-4 text-red-400 inline" />
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {l.isPremium ? <Star className="w-4 h-4 text-amber-500 inline fill-amber-500" /> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 text-xs">
                      {new Date(l.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// Botão + popover de calendário pra escolher um intervalo de datas customizado
// (ontem, anteontem, ou qualquer range) além dos atalhos rápidos.
function DateRangePicker({ active, appliedRange, onApply }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(appliedRange || undefined)
  const containerRef = useRef(null)

  useEffect(() => {
    if (open) setDraft(appliedRange || undefined)
  }, [open, appliedRange])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const apply = () => {
    if (!draft?.from) return
    onApply({ from: draft.from, to: draft.to || draft.from })
    setOpen(false)
  }

  const label = active && appliedRange
    ? appliedRange.from.getTime() === appliedRange.to.getTime()
      ? fmtShortDate(appliedRange.from)
      : `${fmtShortDate(appliedRange.from)} - ${fmtShortDate(appliedRange.to)}`
    : 'Escolher datas'

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
          active ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <CalendarRange className="w-3.5 h-3.5" />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 bg-white rounded-xl border border-slate-200 shadow-xl p-3">
          <DayPicker
            mode="range"
            locale={ptBR}
            selected={draft}
            onSelect={setDraft}
            disabled={{ after: new Date() }}
            defaultMonth={draft?.to || draft?.from || new Date()}
            classNames={{
              today: 'font-bold text-violet-600',
              selected: '!bg-violet-600 !text-white',
              range_middle: '!bg-violet-100 !text-violet-800',
              range_start: '!bg-violet-600 !text-white',
              range_end: '!bg-violet-600 !text-white',
              chevron: 'fill-violet-600',
            }}
          />
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 mt-1">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              onClick={apply}
              disabled={!draft?.from}
              className="px-3 py-1.5 rounded-md text-xs font-bold bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white transition"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Analytics() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groupBy, setGroupBy] = useState('ad')
  const [period, setPeriod] = useState('today')
  const [customRange, setCustomRange] = useState(null) // { from: Date, to: Date }
  const [selectedAd, setSelectedAd] = useState(null)

  const range = useMemo(
    () => (period === 'custom' && customRange ? customRangeToRange(customRange.from, customRange.to) : periodToRange(period)),
    [period, customRange],
  )

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    fetch(`${API}/leads/analytics/ads?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError('Erro ao carregar dados de performance'))
      .finally(() => setLoading(false))
  }, [range.from, range.to])

  const grouped = useMemo(() => (rows ? groupRows(rows, groupBy) : []), [rows, groupBy])

  const summary = useMemo(() => {
    if (!rows) return null
    return rows.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        qualifiedCount: acc.qualifiedCount + r.qualifiedCount,
        disqualifiedCount: acc.disqualifiedCount + r.disqualifiedCount,
        premiumCount: acc.premiumCount + r.premiumCount,
      }),
      { total: 0, qualifiedCount: 0, disqualifiedCount: 0, premiumCount: 0 },
    )
  }, [rows])

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Analytics</h2>
          <p className="text-sm text-slate-400 mt-0.5">Performance dos leads por anúncio (WhatsApp CTWA)</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                period === opt.key ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <DateRangePicker
            active={period === 'custom'}
            appliedRange={customRange}
            onApply={(r) => { setCustomRange(r); setPeriod('custom') }}
          />
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 font-medium">Leads</p>
            <p className="text-2xl font-semibold text-slate-800 mt-1">{summary.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 font-medium">Qualificados</p>
            <p className="text-2xl font-semibold text-emerald-700 mt-1">{summary.qualifiedCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 font-medium">Não qualificados</p>
            <p className="text-2xl font-semibold text-slate-600 mt-1">{summary.disqualifiedCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 font-medium">Premium</p>
            <p className="text-2xl font-semibold text-amber-700 mt-1">{summary.premiumCount}</p>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {GROUP_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setGroupBy(opt.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              groupBy === opt.key ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <opt.icon className="w-3.5 h-3.5" />
            {opt.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-6 h-6 text-slate-300 mx-auto animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhum dado ainda</p>
          <p className="text-slate-400 text-sm mt-1">
            Assim que leads de anúncios com attribution completa chegarem, o relatório aparece aqui.
          </p>
        </div>
      )}

      {!loading && !error && grouped.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">{GROUP_OPTIONS.find((o) => o.key === groupBy).label}</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Leads</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Evento "Lead"</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Qualificado</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Não qualificado</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Premium</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Gasto</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">CPQL</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Tempo p/ qualificar</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, i) => (
                  <tr
                    key={i}
                    className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ${g.drillAdId ? 'cursor-pointer' : ''}`}
                    onClick={() => g.drillAdId && setSelectedAd({ adId: g.drillAdId, adName: g.name })}
                    title={g.drillAdId ? 'Clique para ver os leads deste anúncio' : undefined}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[220px] truncate" title={g.name}>{g.name}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{g.total}</td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {g.leadEventCount}
                      {g.leadEventCount < g.total && (
                        <span className="text-amber-600 text-xs ml-1" title="Nem todo lead teve o evento enviado ao Meta confirmado — pode indicar falha no envio">
                          ({pct(g.leadEventCount, g.total)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-emerald-700 font-semibold">{g.qualifiedCount}</span>
                      <span className="text-slate-400 text-xs ml-1">({pct(g.qualifiedCount, g.total)})</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-600">{g.disqualifiedCount}</span>
                      <span className="text-slate-400 text-xs ml-1">({pct(g.disqualifiedCount, g.total)})</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-amber-700 font-semibold">{g.premiumCount}</span>
                      <span className="text-slate-400 text-xs ml-1">({pct(g.premiumCount, g.total)})</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmtMoney(g.spend)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-700">{fmtMoney(g.cpql)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtDuration(g.avgSecondsToQualify)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3">
        {period === 'all'
          ? 'Gasto e CPQL somam desde o início da campanha (lifetime).'
          : 'Gasto e CPQL refletem o período selecionado.'}{' '}
        Evento "Lead" mostra quantos leads realmente confirmaram o envio ao Meta — divergência da coluna "Leads" pode indicar falha no CAPI. Clique numa linha de Anúncio pra ver os leads individuais.
      </p>

      <HourlyChart from={range.from} to={range.to} />

      {selectedAd && (
        <LeadDrillDown
          adId={selectedAd.adId}
          adName={selectedAd.adName}
          from={range.from}
          to={range.to}
          onClose={() => setSelectedAd(null)}
        />
      )}
    </div>
  )
}
