import { useState, useEffect, useCallback } from 'react'
import { CalendarCheck, Loader2, Plus, Trash2, Sparkles, AlertCircle, Check } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const WEEKDAYS = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7) // 7h às 21h

const emptyWeek = () => Object.fromEntries(WEEKDAYS.map((d) => [d.value, []]))

export default function AgendaAvailability() {
  const [week, setWeek] = useState(emptyWeek)
  const [config, setConfig] = useState({ noticeHours: 3, maxDaysAhead: 14 })
  const [blocks, setBlocks] = useState([])
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState('')
  const [newBlock, setNewBlock] = useState({ date: '', note: '' })

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch(`${API}/agenda/slots`)
      setPreview(res.ok ? await res.json() : null)
    } catch {
      setPreview(null)
    }
  }, [])

  const loadBlocks = useCallback(async () => {
    try {
      const res = await fetch(`${API}/agenda/blocks`)
      if (res.ok) setBlocks(await res.json())
    } catch { /* lista fica como está */ }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${API}/agenda/availability`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        const next = emptyWeek()
        for (const row of data.availability || []) next[row.weekday] = row.hours || []
        setWeek(next)
        if (data.config) setConfig(data.config)
      } catch {
        setError('Não foi possível carregar a disponibilidade.')
      } finally {
        setLoading(false)
      }
    })()
    loadBlocks()
    loadPreview()
  }, [loadBlocks, loadPreview])

  const toggleHour = (weekday, hour) => {
    setWeek((prev) => {
      const hours = prev[weekday] || []
      const next = hours.includes(hour) ? hours.filter((h) => h !== hour) : [...hours, hour].sort((a, b) => a - b)
      return { ...prev, [weekday]: next }
    })
    setSavedAt(null)
  }

  const copyToWeekdays = (weekday) => {
    const hours = week[weekday] || []
    setWeek((prev) => {
      const next = { ...prev }
      for (const d of [1, 2, 3, 4, 5]) next[d] = [...hours]
      return next
    })
    setSavedAt(null)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${API}/agenda/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availability: WEEKDAYS.map((d) => ({ weekday: d.value, hours: week[d.value] || [] })),
          noticeHours: Number(config.noticeHours),
          maxDaysAhead: Number(config.maxDaysAhead),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Erro ao salvar')
      setSavedAt(Date.now())
      loadPreview()
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const addBlock = async () => {
    if (!newBlock.date) return
    setError('')
    try {
      const res = await fetch(`${API}/agenda/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newBlock.date, note: newBlock.note }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Erro ao bloquear')
      setNewBlock({ date: '', note: '' })
      loadBlocks()
      loadPreview()
    } catch (err) {
      setError(err.message || 'Não foi possível bloquear o dia.')
    }
  }

  const removeBlock = async (id) => {
    try {
      await fetch(`${API}/agenda/blocks/${id}`, { method: 'DELETE' })
      loadBlocks()
      loadPreview()
    } catch { /* a lista recarrega na próxima ação */ }
  }

  const totalHours = Object.values(week).reduce((sum, hours) => sum + hours.length, 0)

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <section className="flex-1 min-w-0 flex flex-col gap-6">
        <div className="bg-white rounded-xl border border-slate-200">
          <header className="px-4 py-3 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-violet-600" /> Horários livres por dia da semana
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Marque as horas em que você atende. É daqui que o Efraim tira os horários que oferece no WhatsApp —
              ele sempre começa pelos dias mais próximos e nunca oferece um horário que já tenha reunião marcada.
            </p>
          </header>

          <div className="p-4 flex flex-col gap-3">
            {WEEKDAYS.map((d) => (
              <div key={d.value} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0 text-sm font-medium text-slate-700">{d.label}</span>
                <div className="flex flex-wrap gap-1">
                  {HOURS.map((h) => {
                    const on = (week[d.value] || []).includes(h)
                    return (
                      <button key={h} type="button" onClick={() => toggleHour(d.value, h)}
                        className={`w-11 py-1 text-xs rounded-md border tabular-nums transition ${
                          on ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300'}`}>
                        {h}h
                      </button>
                    )
                  })}
                </div>
                {(week[d.value] || []).length > 0 && d.value >= 1 && d.value <= 5 && (
                  <button type="button" onClick={() => copyToWeekdays(d.value)}
                    className="text-xs text-violet-600 hover:underline">aplicar de seg a sex</button>
                )}
              </div>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 flex flex-wrap items-end gap-4">
            <label className="text-sm text-slate-600">
              <span className="block text-xs text-slate-500 mb-1">Antecedência mínima</span>
              <span className="flex items-center gap-1.5">
                <input type="number" min="0" max="72" value={config.noticeHours}
                  onChange={(e) => { setConfig((c) => ({ ...c, noticeHours: e.target.value })); setSavedAt(null) }}
                  className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm tabular-nums" />
                horas
              </span>
            </label>
            <label className="text-sm text-slate-600">
              <span className="block text-xs text-slate-500 mb-1">Oferecer até</span>
              <span className="flex items-center gap-1.5">
                <input type="number" min="1" max="60" value={config.maxDaysAhead}
                  onChange={(e) => { setConfig((c) => ({ ...c, maxDaysAhead: e.target.value })); setSavedAt(null) }}
                  className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm tabular-nums" />
                dias à frente
              </span>
            </label>
            <div className="ml-auto flex items-center gap-3">
              {savedAt && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Salvo</span>}
              <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar agenda
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200">
          <header className="px-4 py-3 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800">Dias bloqueados</h3>
            <p className="text-xs text-slate-500 mt-1">Feriado, viagem, compromisso. O dia inteiro sai da agenda, mesmo que a semana diga que está livre.</p>
          </header>
          <div className="p-4 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs text-slate-500 mb-1">Data</span>
              <input type="date" value={newBlock.date} onChange={(e) => setNewBlock((b) => ({ ...b, date: e.target.value }))}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
            </label>
            <label className="text-sm flex-1 min-w-[160px]">
              <span className="block text-xs text-slate-500 mb-1">Motivo (opcional)</span>
              <input value={newBlock.note} onChange={(e) => setNewBlock((b) => ({ ...b, note: e.target.value }))}
                placeholder="Feriado, viagem…" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
            </label>
            <button onClick={addBlock} disabled={!newBlock.date}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Bloquear
            </button>
          </div>
          {blocks.length > 0 && (
            <ul className="px-4 pb-4 flex flex-wrap gap-2">
              {blocks.map((b) => (
                <li key={b.id} className="flex items-center gap-2 px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                  <span className="tabular-nums">{b.date.split('-').reverse().join('/')}</span>
                  {b.note && <span className="text-slate-500">· {b.note}</span>}
                  <button onClick={() => removeBlock(b.id)} aria-label="Remover bloqueio" className="text-slate-400 hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
        {error && (
          <p className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <div className="bg-white rounded-xl border border-slate-200">
          <h3 className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" /> O que o Efraim vai oferecer
          </h3>
          <div className="p-4 text-sm">
            {totalHours === 0 ? (
              <p className="text-slate-500">Nenhuma hora marcada ainda. Enquanto a agenda estiver vazia, o Efraim sorteia um horário no próximo dia útil.</p>
            ) : !preview?.next?.length ? (
              <p className="text-slate-500">Sem horário livre nos próximos dias — tudo ocupado ou bloqueado.</p>
            ) : (
              <>
                <p className="text-slate-700">
                  “O melhor horário pra você é <strong>{preview.nextHuman || preview.next.map((s) => s.human).join(' ou ')}</strong>?”
                </p>
                {preview.summary && (
                  <>
                    <p className="mt-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Alternativas que ele conhece</p>
                    <p className="mt-1 text-slate-600 text-xs leading-relaxed">{preview.summary}</p>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
          <p className="font-medium text-slate-700 mb-1">Como funciona</p>
          <p>Quando a pessoa fecha um horário no WhatsApp, o Efraim grava a reunião no card, o horário sai da agenda e os números de
            “Aviso de Reunião Agendada” (em Configurações) recebem a notificação. A reunião aparece no calendário aqui ao lado.</p>
        </div>
      </aside>
    </div>
  )
}
