import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { socketOptions } from '../lib/auth'
import { ChevronLeft, ChevronRight, CalendarClock, Phone, MessageCircle, KanbanSquare, Loader2, X } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'
const TZ = 'America/Sao_Paulo'
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const STAGE_TITLES = {
  novo: 'Novo Lead', atendimento: 'Atendimento', 'nao-qualificado': 'Não qualificado', qualificado: 'Qualificado',
  contactado: 'Contactado', 'ja-fez-prompt': 'Já fez prompt', 'ja-apresentado': 'Já apresentado',
  'em-negociacao': 'Em negociação', vendeu: 'Vendeu', perdido: 'Lead perdido',
}

const waLink = (phone) => `https://wa.me/${String(phone).replace(/\D/g, '')}`
// Mesmo formato do Kanban/Cold Call: sem +55 (falhava via iPhone/Continuity).
const telLink = (phone) => {
  const digits = String(phone).replace(/\D/g, '')
  return `tel:${digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits}`
}

// Chave do dia (YYYY-MM-DD) no fuso de São Paulo — a reunião é gravada em UTC.
const dayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: TZ })
const timeOf = (date) => new Date(date).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const fullDate = (date) => new Date(date).toLocaleString('pt-BR', {
  timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
})

function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function Agenda() {
  const navigate = useNavigate()
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [customStages, setCustomStages] = useState({})

  // Raias criadas no Kanban (ex.: prospeccao-sdr) → título legível.
  useEffect(() => {
    fetch(`${API}/leads/kanban-stages`).then((r) => r.json())
      .then((list) => setCustomStages(Object.fromEntries(list.map((cs) => [cs.stageKey, cs.title])))).catch(() => {})
  }, [])

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

  const load = useCallback(async () => {
    // Folga de 1 dia nas pontas cobre a diferença de fuso entre UTC e São Paulo.
    const from = new Date(days[0]); from.setDate(from.getDate() - 1)
    const to = new Date(days[41]); to.setDate(to.getDate() + 2)
    try {
      const res = await fetch(`${API}/leads/meetings?from=${from.toISOString()}&to=${to.toISOString()}`)
      if (!res.ok) throw new Error()
      setMeetings(await res.json())
      setError('')
    } catch {
      setError('Não foi possível carregar a agenda. Recarregue a página.')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  // Agendou/remarcou/desmarcou no card do Kanban → o backend emite lead:updated.
  useEffect(() => {
    const socket = io(SOCKET_URL, socketOptions())
    socket.on('lead:updated', load)
    socket.on('lead:deleted', load)
    return () => socket.disconnect()
  }, [load])

  const byDay = useMemo(() => {
    const map = {}
    for (const m of meetings) (map[dayKey(m.meetingAt)] ||= []).push(m)
    return map
  }, [meetings])

  const upcoming = useMemo(
    () => meetings.filter((m) => new Date(m.meetingAt).getTime() >= Date.now() - 60 * 60 * 1000).slice(0, 12),
    [meetings],
  )

  const shift = (delta) => setCursor(({ year, month }) => {
    const d = new Date(year, month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const todayKey = localKey(today)
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const monthCount = meetings.filter((m) => {
    const [y, mo] = dayKey(m.meetingAt).split('-').map(Number)
    return y === cursor.year && mo === cursor.month + 1
  }).length

  return (
    <div className="p-4 md:p-6 flex flex-col lg:flex-row gap-6">
      <section className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200">
        <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 capitalize">{monthLabel}</h2>
          <span className="text-xs text-slate-500">{monthCount} {monthCount === 1 ? 'reunião' : 'reuniões'}</span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
              className="px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Hoje</button>
            <button onClick={() => shift(-1)} aria-label="Mês anterior" className="p-1.5 text-slate-600 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={() => shift(1)} aria-label="Próximo mês" className="p-1.5 text-slate-600 rounded-lg hover:bg-slate-100"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </header>

        {error && <p className="px-4 py-2 text-sm text-red-600 bg-red-50">{error}</p>}

        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 border-b border-slate-200">
              {WEEKDAYS.map((w) => <div key={w} className="px-2 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const key = localKey(d)
                const items = byDay[key] || []
                const outside = d.getMonth() !== cursor.month
                return (
                  <div key={key} className={`min-h-[104px] border-b border-r border-slate-100 p-1.5 ${outside ? 'bg-slate-50/60' : ''}`}>
                    <div className={`text-xs mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                      key === todayKey ? 'bg-violet-600 text-white font-semibold' : outside ? 'text-slate-300' : 'text-slate-600'}`}>
                      {d.getDate()}
                    </div>
                    <div className="flex flex-col gap-1">
                      {items.slice(0, 3).map((m) => {
                        const past = new Date(m.meetingAt).getTime() < Date.now()
                        return (
                          <button key={m.id} onClick={() => setSelected(m)}
                            className={`text-left text-[11px] leading-tight px-1.5 py-1 rounded-md truncate border ${
                              past ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100'}`}>
                            <span className="font-semibold tabular-nums">{timeOf(m.meetingAt)}</span> {m.name || 'Sem nome'}
                          </button>
                        )
                      })}
                      {items.length > 3 && (
                        <button onClick={() => setSelected(items[3])} className="text-[11px] text-slate-500 text-left px-1.5">+{items.length - 3} mais</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
        {selected && (
          <div className="bg-white rounded-xl border border-violet-200 p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800 truncate">{selected.name || 'Sem nome'}</p>
                <p className="text-sm text-violet-700 capitalize">{fullDate(selected.meetingAt)}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fechar" className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <dl className="mt-3 text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-slate-500">Raia</dt><dd className="text-slate-700">{STAGE_TITLES[selected.kanbanStage] || customStages[selected.kanbanStage] || selected.kanbanStage || '—'}</dd>
              {selected.utmCampaign && <><dt className="text-slate-500">Campanha</dt><dd className="text-slate-700 truncate">{selected.utmCampaign}</dd></>}
              {selected.instagram && <><dt className="text-slate-500">Instagram</dt><dd className="text-slate-700 truncate">@{selected.instagram.replace(/^@/, '')}</dd></>}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.phone && (
                <>
                  <a href={telLink(selected.phone)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><Phone className="w-4 h-4" /> Ligar</a>
                  <a href={waLink(selected.phone)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-50 text-green-700 hover:bg-green-100"><MessageCircle className="w-4 h-4" /> WhatsApp</a>
                </>
              )}
              <button onClick={() => navigate(`/kanban?lead=${selected.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700"><KanbanSquare className="w-4 h-4" /> Abrir card</button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200">
          <h3 className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-violet-600" /> Próximas reuniões
          </h3>
          {loading ? (
            <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : upcoming.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nenhuma reunião neste período. Agende pelo botão “Reunião” no card do lead, no Kanban.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setSelected(m)} className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 ${selected?.id === m.id ? 'bg-violet-50' : ''}`}>
                    <p className="text-sm font-medium text-slate-800 truncate">{m.name || 'Sem nome'}</p>
                    <p className="text-xs text-slate-500 capitalize tabular-nums">{fullDate(m.meetingAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
