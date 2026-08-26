import { useState, useEffect } from 'react'
import { Users, MessageCircle, Loader2, RefreshCw, Sparkles, TrendingUp, AlertCircle, Clock } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const STAGE_LABEL = {
  novo: 'Novo', atendimento: 'Em atendimento', qualificado: 'Qualificado',
  negociacao: 'Em negociação', convertido: 'Convertido', perdido: 'Perdido',
}

function timeAgo(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

function LeadCard({ lead, onAnalyze, analyzing }) {
  const insights = lead.conversationInsights
  const msgsPerDay = lead.mensagensPorDia ?? insights?.messagesPerDayMentioned ?? null
  const msgsPerDaySource = lead.mensagensPorDia != null ? 'qualificação' : (insights?.messagesPerDayMentioned != null ? 'mencionado na conversa' : null)

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-800 truncate">{lead.name || 'Sem nome'}</p>
          <p className="text-sm text-slate-400">{lead.phone}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-medium whitespace-nowrap">
            {STAGE_LABEL[lead.kanbanStage] || lead.kanbanStage}
          </span>
          {lead.isMql && (
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium whitespace-nowrap">
              🎯 Qualificado
            </span>
          )}
          {lead.vendeCabelo && (
            <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium whitespace-nowrap">
              Vende cabelo
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
        <div className="flex items-center gap-1.5 text-slate-500">
          <MessageCircle className="w-4 h-4 text-slate-400 shrink-0" />
          <span>
            {msgsPerDay != null ? (
              <>
                <span className="font-semibold text-slate-700">{msgsPerDay}</span> msgs/dia
                {msgsPerDaySource && <span className="text-slate-400"> ({msgsPerDaySource})</span>}
              </>
            ) : 'Msgs/dia: não informado'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500">
          <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
          <span>{lead.investeAnuncio ? 'Investe em anúncio' : lead.investeAnuncio === false ? 'Não investe em anúncio' : 'Anúncio: não informado'}</span>
        </div>
      </div>

      {insights ? (
        <div className="space-y-2 mb-3">
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Dores mencionadas
            </p>
            <p className="text-sm text-slate-700">{insights.painPoints || 'Nenhuma dor específica mencionada na conversa.'}</p>
          </div>
          {insights.otherNotes && (
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
              <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Outras informações
              </p>
              <p className="text-sm text-slate-700">{insights.otherNotes}</p>
            </div>
          )}
          <p className="text-xs text-slate-400 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> analisado {timeAgo(insights.generatedAt)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-400 italic mb-3">Conversa ainda não analisada.</p>
      )}

      <button
        onClick={() => onAnalyze(lead.id)}
        disabled={analyzing}
        className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50 transition"
      >
        {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {insights ? 'Reanalisar conversa' : 'Analisar conversa'}
      </button>
    </div>
  )
}

export default function GroupWorkshop() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [analyzingAll, setAnalyzingAll] = useState(false)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    fetch(`${API}/group-workshop/leads`)
      .then(r => r.json())
      .then(setLeads)
      .catch(() => setError('Erro ao carregar leads'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleAnalyze(id) {
    setAnalyzingId(id)
    try {
      const res = await fetch(`${API}/group-workshop/leads/${id}/analyze`, { method: 'POST' })
      const updated = await res.json()
      setLeads(prev => prev.map(l => l.id === id ? updated : l))
    } catch {
      setError('Erro ao analisar conversa')
    } finally {
      setAnalyzingId(null)
    }
  }

  async function handleAnalyzeAll() {
    setAnalyzingAll(true)
    try {
      await fetch(`${API}/group-workshop/analyze-all`, { method: 'POST' })
      load()
    } catch {
      setError('Erro ao analisar leads')
    } finally {
      setAnalyzingAll(false)
    }
  }

  const analyzedCount = leads.filter(l => l.conversationInsights).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" /> Entraram no Grupo
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Leads que entraram no grupo do Workshop — {leads.length} pessoa(s), {analyzedCount} já analisada(s).
          </p>
        </div>
        <button
          onClick={handleAnalyzeAll}
          disabled={analyzingAll || loading}
          className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition"
        >
          {analyzingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Analisar pendentes
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-20">Ninguém entrou no grupo ainda.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {leads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onAnalyze={handleAnalyze} analyzing={analyzingId === lead.id} />
          ))}
        </div>
      )}
    </div>
  )
}
