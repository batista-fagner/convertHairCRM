import { useState, useEffect, useRef } from 'react'
import { Settings as SettingsIcon, Key, Webhook, MessageCircle, Share2, Bot, Save, RotateCcw, Loader2, CheckCircle2, Send, Trash2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const integrations = [
  { icon: Key, label: 'Meta Ads API', description: 'Conecte sua conta do Meta para puxar métricas de campanhas', color: 'bg-blue-50 text-blue-600', status: 'Não conectado' },
  { icon: MessageCircle, label: 'uazapi (WhatsApp)', description: 'Envio automático de WhatsApp para follow-up de leads', color: 'bg-emerald-50 text-emerald-600', status: 'Não conectado' },
  { icon: Webhook, label: 'Resend (Email)', description: 'API de email para disparo de sequências automáticas', color: 'bg-violet-50 text-violet-600', status: 'Não conectado' },
  { icon: Share2, label: 'RapidAPI (Instagram)', description: 'Enriquecimento de leads via análise de perfil Instagram', color: 'bg-orange-50 text-orange-600', status: 'Não conectado' },
]

const STAGE_LABEL = {
  abertura: 'Abertura',
  qualificacao: 'Qualificação',
  quente: 'Qualificado',
  frio: 'Não qualificado',
  perdido: 'Perdido',
  encerrado: 'Encerrado',
}

const STAGE_COLOR = {
  abertura: 'bg-slate-100 text-slate-600',
  qualificacao: 'bg-blue-100 text-blue-700',
  quente: 'bg-emerald-100 text-emerald-700',
  frio: 'bg-cyan-100 text-cyan-700',
  perdido: 'bg-red-100 text-red-700',
  encerrado: 'bg-gray-100 text-gray-500',
}

function ChatSimulator() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastStage, setLastStage] = useState('abertura')
  const [lastTemp, setLastTemp] = useState('morno')
  const messagesRef = useRef(null)

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  const clear = () => {
    setMessages([])
    setLastStage('abertura')
    setLastTemp('morno')
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)

    try {
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch(`${API}/settings/sdr-simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, stage: data.stage, temperature: data.temperature, handoff: data.handoff }])
      setLastStage(data.stage)
      setLastTemp(data.temperature)
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Erro ao chamar a IA.', stage: lastStage }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-indigo-50/60 rounded-xl border border-indigo-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Sofia</p>
            <p className="text-[10px] text-slate-400">Simulador de conversa</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STAGE_COLOR[lastStage] || 'bg-slate-100 text-slate-500'}`}>
            {STAGE_LABEL[lastStage] || lastStage}
          </span>
          <button onClick={clear} title="Limpar conversa" className="p-1.5 text-slate-400 hover:text-red-400 transition">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-2">
            <MessageCircle className="w-8 h-8 opacity-30" />
            <p className="text-sm">Mande uma mensagem para testar a Sofia</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-violet-600 text-white rounded-br-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
            }`}>
              {msg.content}
              {msg.handoff && (
                <p className="text-[10px] mt-1 text-emerald-600 font-medium">✓ Handoff — closer notificado</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 px-3 py-2 rounded-2xl rounded-bl-sm">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Digite como se fosse o lead... (Enter para enviar)"
          rows={1}
          className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 max-h-24"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="p-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

const MODELS = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Mais rápido e barato' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Mais preciso e contextual' },
]

function ModelSelector() {
  const [model, setModel] = useState('gpt-5.4-mini')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/settings/sdr-model`)
      .then(r => r.json())
      .then(d => setModel(d.value || 'gpt-5.4-mini'))
      .catch(() => {})
  }, [])

  const select = async (val) => {
    setModel(val)
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`${API}/settings/sdr-model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-xs text-slate-500 font-medium shrink-0">Modelo de IA:</span>
      <div className="flex gap-2">
        {MODELS.map(m => (
          <button
            key={m.value}
            onClick={() => select(m.value)}
            disabled={saving}
            title={m.description}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              model === m.value
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-violet-400 hover:text-violet-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {saved && <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Salvo</span>}
    </div>
  )
}

function SdrPromptEditor() {
  const [value, setValue] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/settings/sdr-prompt`)
      .then((r) => r.json())
      .then((d) => {
        setValue(d.value || '')
        setDefaultPrompt(d.default || '')
        setIsCustom(!!d.isCustom)
      })
      .catch((e) => console.error('Erro ao carregar prompt', e))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API}/settings/sdr-prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const d = await res.json()
      setValue(d.value || '')
      setIsCustom(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      console.error('Erro ao salvar prompt', e)
    } finally {
      setSaving(false)
    }
  }

  const restoreDefault = () => setValue(defaultPrompt)

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-600" />
          <p className="font-semibold text-slate-800 text-sm">Prompt da IA SDR (Sofia)</p>
          {isCustom ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Personalizado</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Padrão</span>
          )}
        </div>
        <ModelSelector />
      </div>

      {/* Split layout — responsivo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: '680px' }}>

        {/* Editor */}
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden h-full">
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="px-3 pt-3 flex-1 flex flex-col min-h-0">
                <p className="text-[10px] text-slate-400 mb-1.5">Edite a personalidade e as regras da Sofia</p>
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  spellCheck={false}
                  className="flex-1 text-sm text-slate-700 border border-slate-200 rounded-lg p-3 font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Escreva aqui o prompt da Sofia..."
                />
              </div>
              <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-100 shrink-0">
                <button
                  onClick={restoreDefault}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
                </button>
                <div className="flex items-center gap-3">
                  {saved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> Salvo
                    </span>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !value.trim()}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chat */}
        <div className="h-full">
          <ChatSimulator />
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Configurações</h2>
        <p className="text-sm text-slate-400 mt-0.5">Integrações e configurações da plataforma</p>
      </div>

      <SdrPromptEditor />

      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Integrações</p>
        <div className="space-y-3">
          {integrations.map(({ icon: Icon, label, description, color, status }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-slate-400">{status}</span>
                <button className="text-xs font-medium text-violet-600 hover:text-violet-700 border border-violet-200 hover:border-violet-400 px-3 py-1.5 rounded-lg transition">
                  Conectar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
