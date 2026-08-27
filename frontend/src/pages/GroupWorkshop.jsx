import { useState, useEffect } from 'react'
import { Users, Loader2, RefreshCw, Sparkles, AlertCircle, X, CheckCircle2, Circle } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const STAGE_LABEL = {
  novo: 'Novo', atendimento: 'Em atendimento', qualificado: 'Qualificado',
  negociacao: 'Em negociação', convertido: 'Convertido', perdido: 'Perdido',
}

function formatEntrada(lead) {
  if (!lead.groupJoinedAt) return 'Data desconhecida'
  const d = new Date(lead.groupJoinedAt)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

function QualificacaoBadge({ lead }) {
  if (!lead.conversationInsights) {
    return (
      <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500 font-medium whitespace-nowrap">
        Não analisado
      </span>
    )
  }
  if (lead.isMql) {
    return (
      <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium whitespace-nowrap">
        🎯 Qualificado
      </span>
    )
  }
  return (
    <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium whitespace-nowrap">
      Potencial
    </span>
  )
}

function resumoCurto(lead) {
  const insights = lead.conversationInsights
  if (!insights) return '—'
  return insights.painPoints || insights.otherNotes || 'Sem dores/notas relevantes.'
}

function Signal({ ok, label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-300 shrink-0" />}
      <span className={ok ? '' : 'text-slate-400'}>{label}</span>
    </div>
  )
}

function AnalysisDrawer({ lead, onClose, onAnalyze, analyzing }) {
  const insights = lead?.conversationInsights
  const msgsPerDay = lead?.mensagensPorDia ?? insights?.messagesPerDayMentioned ?? null
  const msgsPerDaySource = lead?.mensagensPorDia != null ? 'qualificação' : (insights?.messagesPerDayMentioned != null ? 'mencionado na conversa' : null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div
        className={`absolute inset-y-0 left-0 w-full max-w-md bg-white shadow-2xl overflow-y-auto transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-800 truncate">{lead?.name || 'Sem nome'}</p>
              <p className="text-sm text-slate-400">{lead?.phone}</p>
              <p className="text-xs text-slate-400 mt-1">Entrou {formatEntrada(lead)}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-5">
            <QualificacaoBadge lead={lead} />
            <span className="text-xs px-2 py-1 rounded-full bg-slate-50 text-slate-300 font-medium border border-slate-200" title="Pontuação ainda não definida">
              Score — em breve
            </span>
          </div>

          {insights ? (
            <>
              <div className="mb-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Resumo da IA</p>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-sm text-slate-700">{insights.painPoints || 'Nenhuma dor específica mencionada na conversa.'}</p>
                </div>
              </div>

              <div className="mb-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sinais identificados</p>
                <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <Signal ok={!!lead.vendeCabelo} label="Vende cabelo / mega hair" />
                  <Signal ok={!!lead.investeAnuncio} label="Investe em anúncio" />
                  <Signal ok={msgsPerDay != null} label="Volume de mensagens/dia informado" />
                  <Signal ok={!!insights.painPoints} label="Dor mencionada na conversa" />
                </div>
              </div>

              <div className="mb-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Principais informações</p>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-slate-500">Mensagens/dia</span>
                    <span className="font-medium text-slate-700 text-right">
                      {msgsPerDay != null ? `${msgsPerDay}${msgsPerDaySource ? ` (${msgsPerDaySource})` : ''}` : 'não informado'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-slate-500">Investe em anúncio</span>
                    <span className="font-medium text-slate-700">
                      {lead.investeAnuncio == null ? 'não informado' : lead.investeAnuncio ? 'Sim' : 'Não'}
                    </span>
                  </div>
                  {insights.otherNotes && (
                    <div className="px-3 py-2">
                      <span className="text-slate-500 block mb-1">Outras notas</span>
                      <span className="font-medium text-slate-700">{insights.otherNotes}</span>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-400 mb-4">Analisado {timeAgo(insights.generatedAt)}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400 italic mb-5">Conversa ainda não analisada.</p>
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
      </div>
    </div>
  )
}

export default function GroupWorkshop() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [analyzingAll, setAnalyzingAll] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

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
  const selectedLead = leads.find(l => l.id === selectedId) || null

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" /> Grupo WhatsApp
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Entrada no grupo</th>
                <th className="px-4 py-3 font-medium">Qualificação IA</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Resumo da IA</th>
                <th className="px-4 py-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{lead.name || 'Sem nome'}</p>
                    <p className="text-xs text-slate-400">{lead.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatEntrada(lead)}</td>
                  <td className="px-4 py-3"><QualificacaoBadge lead={lead} /></td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-slate-50 text-slate-300 font-medium border border-slate-200 whitespace-nowrap" title="Pontuação ainda não definida">
                      em breve
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={resumoCurto(lead)}>
                    {resumoCurto(lead)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedId(lead.id)}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 transition whitespace-nowrap"
                    >
                      Ver análise
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedLead && (
        <AnalysisDrawer
          lead={selectedLead}
          onClose={() => setSelectedId(null)}
          onAnalyze={handleAnalyze}
          analyzing={analyzingId === selectedLead.id}
        />
      )}
    </div>
  )
}
