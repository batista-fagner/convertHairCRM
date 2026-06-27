import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Key, Webhook, MessageCircle, Share2, Bot, Save, RotateCcw, Loader2, CheckCircle2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const integrations = [
  { icon: Key, label: 'Meta Ads API', description: 'Conecte sua conta do Meta para puxar métricas de campanhas', color: 'bg-blue-50 text-blue-600', status: 'Não conectado' },
  { icon: MessageCircle, label: 'uazapi (WhatsApp)', description: 'Envio automático de WhatsApp para follow-up de leads', color: 'bg-emerald-50 text-emerald-600', status: 'Não conectado' },
  { icon: Webhook, label: 'Resend (Email)', description: 'API de email para disparo de sequências automáticas', color: 'bg-violet-50 text-violet-600', status: 'Não conectado' },
  { icon: Share2, label: 'RapidAPI (Instagram)', description: 'Enriquecimento de leads via análise de perfil Instagram', color: 'bg-orange-50 text-orange-600', status: 'Não conectado' },
]

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
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-800 text-sm flex items-center gap-2">
            Prompt da IA SDR (Sofia)
            {isCustom ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Personalizado</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Padrão</span>
            )}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Define a personalidade e o comportamento da Sofia no WhatsApp.
            O contexto do lead e o formato de resposta são adicionados automaticamente.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            className="w-full h-72 text-sm text-slate-700 border border-slate-200 rounded-lg p-3 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-violet-300"
            placeholder="Escreva aqui o prompt da Sofia..."
          />
          <div className="flex items-center justify-between mt-3">
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
                Salvar prompt
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function Settings() {
  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Configurações</h2>
        <p className="text-sm text-slate-400 mt-0.5">Integrações e configurações da plataforma</p>
      </div>

      <SdrPromptEditor />

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
  )
}
