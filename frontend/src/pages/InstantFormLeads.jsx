import { useState, useEffect } from 'react'
import { FileSpreadsheet, Loader2, Star, X, Phone, Mail, Calendar } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const STATUS_LABEL = {
  novo: 'Novo',
  contatado: 'Contatado',
  convertido: 'Convertido',
  perdido: 'Perdido',
}

const STATUS_CLASS = {
  novo: 'bg-slate-100 text-slate-600',
  contatado: 'bg-blue-100 text-blue-700',
  convertido: 'bg-green-100 text-green-700',
  perdido: 'bg-red-100 text-red-600',
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtPhone(phone) {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) return phone
  const ddi = digits.length > 11 ? digits.slice(0, digits.length - 11) : ''
  const rest = digits.slice(-11)
  const ddd = rest.slice(0, 2)
  const num = rest.slice(2)
  const mid = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`
  return `${ddi ? '+' + ddi + ' ' : ''}(${ddd}) ${mid}`
}

function AnswersModal({ lead, onClose }) {
  if (!lead) return null
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="font-bold text-slate-800">{lead.name}</p>
            <p className="text-xs text-slate-400">Respostas do Formulário Instantâneo</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="flex flex-wrap gap-3 text-xs text-slate-500 pb-3 border-b border-slate-100">
            <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {fmtPhone(lead.phone)}</span>
            {lead.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {lead.email}</span>}
            <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {fmtDate(lead.createdAt)}</span>
          </div>
          {(!lead.formAnswers || lead.formAnswers.length === 0) && (
            <p className="text-sm text-slate-400 text-center py-6">Nenhuma resposta registrada pra esse lead.</p>
          )}
          {(lead.formAnswers || []).map((field, i) => (
            <div key={i} className="bg-slate-50 rounded-lg p-3">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{field.name}</p>
              <p className="text-sm text-slate-800">{field.values?.[0] || '—'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function InstantFormLeads() {
  const [leads, setLeads] = useState([])
  const [stats, setStats] = useState({ total: 0, mql30: 0, comum: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all | true | false
  const [selectedLead, setSelectedLead] = useState(null)

  const load = () => {
    setLoading(true)
    const qs = filter === 'all' ? '' : `?mql30=${filter}`
    Promise.all([
      fetch(`${API}/instant-form-leads${qs}`).then((r) => r.json()),
      fetch(`${API}/instant-form-leads/stats`).then((r) => r.json()),
    ])
      .then(([leadsData, statsData]) => {
        setLeads(Array.isArray(leadsData) ? leadsData : [])
        setStats(statsData || { total: 0, mql30: 0, comum: 0 })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filter])

  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Formulário Instantâneo</h2>
          <p className="text-sm text-slate-400 mt-0.5">Leads capturados do formulário "ConvertHair50" (Meta Lead Ads), com as respostas completas</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Total de leads</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <p className="text-xs text-amber-600 uppercase tracking-wide flex items-center gap-1"><Star className="w-3.5 h-3.5" /> MQL+30</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.mql30}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Volume comum</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{stats.comum}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'true', label: 'MQL+30' },
            { id: 'false', label: 'Comum' },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                filter === opt.id ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-12">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando leads...
          </div>
        ) : leads.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">Nenhum lead do Formulário Instantâneo ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="px-5 py-2.5">Nome</th>
                  <th className="px-5 py-2.5">Telefone</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Volume</th>
                  <th className="px-5 py-2.5">Recebido em</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/60 transition">
                    <td className="px-5 py-3 font-medium text-slate-800">{lead.name}</td>
                    <td className="px-5 py-3 text-slate-500">{fmtPhone(lead.phone)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLASS[lead.status] || STATUS_CLASS.novo}`}>
                        {STATUS_LABEL[lead.status] || lead.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {lead.formMql30 ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                          <Star className="w-3 h-3" /> MQL+30
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Comum</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{fmtDate(lead.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setSelectedLead(lead)}
                        className="text-xs font-medium text-violet-600 hover:text-violet-700 transition"
                      >
                        Ver respostas
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnswersModal lead={selectedLead} onClose={() => setSelectedLead(null)} />
    </div>
  )
}
