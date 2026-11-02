import { useState, useEffect, useRef } from 'react'
import { Bot, Save, RotateCcw, Loader2, CheckCircle2, Send, Trash2, MessageCircle, Sparkles, ToggleLeft, ToggleRight, CalendarCheck } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const STAGE_BADGE = {
  abertura: { label: 'Abertura', cls: 'bg-slate-100 text-slate-600' },
  conversando: { label: 'Conversando', cls: 'bg-blue-100 text-blue-700' },
  agendado: { label: 'Agendado', cls: 'bg-emerald-100 text-emerald-700' },
  sem_interesse: { label: 'Sem interesse', cls: 'bg-red-100 text-red-700' },
  humano: { label: 'Passa pra equipe', cls: 'bg-amber-100 text-amber-700' },
}

// Simulador: começa pela abertura que o Efraim manda depois do quiz, com nome e
// respostas de um lead real do funil (editáveis), e segue a conversa como se
// você fosse o lead.
function EfraimSimulator() {
  const [sample, setSample] = useState({ name: '', quizResponses: [] })
  const [messages, setMessages] = useState([])
  const [slots, setSlots] = useState(null)
  const [agendaSummary, setAgendaSummary] = useState('')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('abertura')
  const [error, setError] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/efraim/sample`).then((r) => r.json()).then(setSample).catch(() => {})
  }, [])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  const call = async (message, history) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/efraim/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, name: sample.name, quizResponses: sample.quizResponses, slots }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Erro ao chamar a IA')
      setSlots(data.slots)
      if (data.agendaSummary !== undefined) setAgendaSummary(data.agendaSummary)
      setStage(data.stage)
      return data
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  const start = async () => {
    setMessages([])
    setSlots(null)
    const data = await call('', [])
    if (data) setMessages([{ role: 'assistant', content: data.reply, bubbles: data.bubbles }])
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    const data = await call(text, history)
    if (!data) return
    setMessages((prev) => [
      ...prev,
      data.botDoLead
        ? { role: 'note', content: 'Efraim identificou o atendimento automático da loja e não respondeu — espera a pessoa de verdade.' }
        : { role: 'assistant', content: data.reply, bubbles: data.bubbles, reuniaoHuman: data.reuniaoHuman },
    ])
  }

  const badge = STAGE_BADGE[stage] || STAGE_BADGE.conversando
  const answers = (sample.quizResponses || []).filter((a) => a.question && a.answer)

  return (
    <div className="flex flex-col h-full min-h-0 bg-amber-50/50 rounded-xl border border-amber-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Efraim</p>
            <p className="text-[10px] text-slate-400">Simulador — você é o lead</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
          <button onClick={() => { setMessages([]); setSlots(null); setStage('abertura') }} title="Limpar conversa" className="p-1.5 text-slate-400 hover:text-red-400 transition">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-2.5 bg-white/70 border-b border-amber-100 text-[11px] text-slate-500 space-y-1">
        <div className="flex items-center gap-2">
          <label htmlFor="efraim-sim-name" className="shrink-0 font-medium text-slate-600">Lead:</label>
          <input
            id="efraim-sim-name"
            value={sample.name || ''}
            onChange={(e) => setSample((s) => ({ ...s, name: e.target.value }))}
            className="flex-1 min-w-0 text-xs border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
        {answers.length > 0 && (
          <p className="leading-relaxed">
            <span className="font-medium text-slate-600">Quiz:</span>{' '}
            {answers.map((a) => a.answer).join(' · ')}
          </p>
        )}
        {agendaSummary && (
          <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
            <span className="font-medium text-slate-500">Agenda:</span> {agendaSummary}
          </p>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-3">
            <MessageCircle className="w-8 h-8 opacity-30" />
            <p className="text-sm max-w-xs">O Efraim fala primeiro: gere a mensagem que ele manda 3 minutos depois que a pessoa termina o quiz.</p>
            <button
              onClick={start}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 rounded-lg transition"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Gerar abertura
            </button>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'note') {
            return <p key={i} className="text-center text-[11px] text-slate-400 italic px-6">{m.content}</p>
          }
          // No WhatsApp cada bolha é uma mensagem, com 5s entre elas — o
          // simulador mostra separadas pra bater com o que o lead recebe.
          const bubbles = m.bubbles?.length ? m.bubbles : [m.content]
          return (
            <div key={i} className="space-y-1.5">
              {bubbles.map((text, b) => (
                <div key={b} className={`flex items-end gap-1.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-amber-500 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                  }`}>
                    {text}
                    {m.reuniaoHuman && b === bubbles.length - 1 && (
                      <p className="flex items-center gap-1 text-[10px] mt-1 font-medium text-emerald-600">
                        <CalendarCheck className="w-3 h-3" /> Reunião gravada no card: {m.reuniaoHuman}
                      </p>
                    )}
                  </div>
                  {m.role !== 'user' && b > 0 && <span className="text-[10px] text-slate-400 shrink-0">+5s</span>}
                </div>
              ))}
            </div>
          )
        })}
        {loading && messages.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 px-3 py-2 rounded-2xl rounded-bl-sm">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            </div>
          </div>
        )}
        {error && <p className="text-center text-xs text-red-500">{error}</p>}
      </div>

      <div className="p-3 bg-white border-t border-slate-200 flex items-end gap-2">
        <textarea
          id="efraim-sim-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={messages.length ? 'Responda como o lead... (Enter envia)' : 'Gere a abertura primeiro'}
          disabled={!messages.length}
          rows={1}
          className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 max-h-24 disabled:bg-slate-50"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading || !messages.length}
          className="p-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function EfraimConfigBar() {
  const [config, setConfig] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`${API}/efraim/config`).then((r) => r.json()).then(setConfig).catch(() => {})
    fetch(`${API}/quiz`).then((r) => r.json()).then((d) => setQuizzes(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const save = async (patch) => {
    setSaving(true)
    try {
      const res = await fetch(`${API}/efraim/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setConfig(await res.json())
    } catch {}
    finally { setSaving(false) }
  }

  if (!config) return null
  const toggleSlug = (slug) => {
    const next = config.quizSlugs.includes(slug) ? config.quizSlugs.filter((s) => s !== slug) : [...config.quizSlugs, slug]
    save({ quizSlugs: next })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <button
        onClick={() => save({ enabled: !config.enabled })}
        disabled={saving}
        className={`flex items-center gap-2 text-sm font-medium transition ${config.enabled ? 'text-emerald-600' : 'text-slate-500'}`}
      >
        {config.enabled ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
        {config.enabled ? 'Ligado — chama quem deixa o contato no quiz' : 'Desligado — ninguém recebe mensagem'}
      </button>
      <label className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border cursor-pointer transition ${
        config.followupEnabled ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'
      }`}>
        <input type="checkbox" id="efraim-followup" checked={!!config.followupEnabled}
          onChange={() => save({ followupEnabled: !config.followupEnabled })} disabled={saving} className="accent-amber-500" />
        Follow-up (2 toques)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 font-medium">Quizzes:</span>
        {quizzes.map((q) => (
          <label key={q.id} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border cursor-pointer transition ${
            config.quizSlugs.includes(q.slug) ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'
          }`}>
            <input type="checkbox" id={`efraim-quiz-${q.slug}`} checked={config.quizSlugs.includes(q.slug)} onChange={() => toggleSlug(q.slug)} disabled={saving} className="accent-amber-500" />
            {q.name || q.slug}
          </label>
        ))}
      </div>
      {saving && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
      <p className="basis-full text-[11px] text-slate-400">
        Sai pelo mesmo número da Sofia, 3 min depois do contato, só entre 8h e 21h. Não chama quem respondeu "Quero comprar cabelo" ou "Não é o meu momento", nem quem já conversou no WhatsApp ou teve o card movido.
        Com o follow-up ligado, quem não responde recebe 2 toques: 3h depois e na manhã seguinte. Cada resposta do lead reinicia a contagem; depois do 2º toque ele para de puxar, mas segue respondendo se a pessoa aparecer.
      </p>
    </div>
  )
}

export default function EfraimSettings() {
  const [value, setValue] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/efraim/prompt`)
      .then((r) => r.json())
      .then((d) => { setValue(d.value || ''); setDefaultPrompt(d.default || ''); setIsCustom(!!d.isCustom) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API}/efraim/prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const d = await res.json()
      setValue(d.value || '')
      setIsCustom(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {}
    finally { setSaving(false) }
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-amber-600" />
        <p className="font-semibold text-slate-800 text-sm">Efraim — agente do funil do quiz</p>
        {isCustom ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Personalizado</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Padrão</span>
        )}
        <span className="text-[11px] text-slate-400">usa o mesmo modelo de IA da Sofia</span>
      </div>

      <EfraimConfigBar />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: '680px' }}>
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden h-full">
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <>
              <div className="px-3 pt-3 flex-1 flex flex-col min-h-0">
                <p className="text-[10px] text-slate-400 mb-1.5">Como o Efraim se apresenta, a abertura e as regras de agendamento. O formato da resposta (JSON) fica no código.</p>
                <textarea
                  id="efraim-prompt"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  spellCheck={false}
                  className="flex-1 text-sm text-slate-700 border border-slate-200 rounded-lg p-3 font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
              <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-100 shrink-0">
                <button onClick={() => setValue(defaultPrompt)} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition">
                  <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
                </button>
                <div className="flex items-center gap-3">
                  {saved && <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><CheckCircle2 className="w-4 h-4" /> Salvo</span>}
                  <button
                    onClick={save}
                    disabled={saving || !value.trim()}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 rounded-lg transition"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="overflow-hidden rounded-xl" style={{ height: '680px' }}>
          <EfraimSimulator />
        </div>
      </div>
    </div>
  )
}
