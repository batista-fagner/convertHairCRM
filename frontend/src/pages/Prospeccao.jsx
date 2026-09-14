import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import { Radar, Loader2, Check, X, Sprout, MessageSquareText } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const API_KEY = import.meta.env.VITE_PROSPECTING_API_KEY || ''
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'

const headers = { 'Content-Type': 'application/json', 'x-api-key': API_KEY }

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Prospeccao() {
  const [prospects, setProspects] = useState([])
  const [stats, setStats] = useState({ total: 0, responded: 0, rate: 0 })
  const [currentSeed, setCurrentSeed] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all | true | false
  const [manualSeed, setManualSeed] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [msgMode, setMsgMode] = useState('ai') // ai | fixed
  const [fixedMessage, setFixedMessage] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)

  const load = () => {
    setLoading(true)
    const qs = filter === 'all' ? '' : `?responded=${filter}`
    Promise.all([
      fetch(`${API}/prospecting/prospects${qs}`, { headers }).then((r) => r.json()),
      fetch(`${API}/prospecting/current-seed`, { headers }).then((r) => r.json()),
    ])
      .then(([listData, seedData]) => {
        setProspects(Array.isArray(listData?.items) ? listData.items : [])
        setStats(listData?.stats || { total: 0, responded: 0, rate: 0 })
        setCurrentSeed(seedData?.username || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    fetch(`${API}/prospecting/message-config`, { headers })
      .then((r) => r.json())
      .then((cfg) => {
        setMsgMode(cfg?.mode === 'fixed' ? 'fixed' : 'ai')
        setFixedMessage(cfg?.fixedMessage || '')
      })
      .catch(() => {})
  }, [])

  const saveMessageConfig = async (patch) => {
    setSavingConfig(true)
    try {
      const res = await fetch(`${API}/prospecting/message-config`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      }).then((r) => r.json())
      setMsgMode(res?.mode === 'fixed' ? 'fixed' : 'ai')
      setFixedMessage(res?.fixedMessage || '')
    } finally {
      setSavingConfig(false)
    }
  }

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })
    socket.on('prospect:created', () => load())
    socket.on('prospect:updated', () => load())
    socket.on('prospect:seed-changed', (payload) => setCurrentSeed(payload?.username || null))
    return () => socket.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleResponded = async (prospect) => {
    setBusyId(prospect.id)
    try {
      await fetch(`${API}/prospecting/prospects/${prospect.id}/respond`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ responded: !prospect.responded }),
      })
      load()
    } finally {
      setBusyId(null)
    }
  }

  const promoteToSeed = async (username) => {
    setBusyId(username)
    try {
      await fetch(`${API}/prospecting/current-seed`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username }),
      })
      setCurrentSeed(username)
    } finally {
      setBusyId(null)
    }
  }

  const setSeedManually = async () => {
    const username = manualSeed.trim().replace(/^@/, '')
    if (!username) return
    await promoteToSeed(username)
    setManualSeed('')
  }

  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center shrink-0">
          <Radar className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Prospecção</h2>
          <p className="text-sm text-slate-400 mt-0.5">Perfis do Instagram prospectados ativamente pela extensão ConvertIQ (reply de story)</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Total prospectado</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <p className="text-xs text-green-600 uppercase tracking-wide">Respondeu</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{stats.responded}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Taxa de resposta</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{(stats.rate * 100).toFixed(1)}%</p>
        </div>
        <div className="bg-white rounded-xl border border-violet-200 p-4">
          <p className="text-xs text-violet-600 uppercase tracking-wide flex items-center gap-1"><Sprout className="w-3.5 h-3.5" /> Semente atual</p>
          <p className="text-sm font-bold text-violet-700 mt-1 truncate">{currentSeed ? `@${currentSeed}` : '—'}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex items-center gap-2">
        <input
          type="text"
          value={manualSeed}
          onChange={(e) => setManualSeed(e.target.value)}
          placeholder="Definir semente manualmente (username do Instagram)"
          className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
        />
        <button
          onClick={setSeedManually}
          className="text-xs font-medium px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition"
        >
          Usar como semente
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquareText className="w-4 h-4 text-violet-600" />
          <h3 className="text-sm font-semibold text-slate-800">Mensagem enviada no reply do story</h3>
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={() => saveMessageConfig({ mode: 'ai' })}
            disabled={savingConfig}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
              msgMode === 'ai' ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            IA gera (personalizada)
          </button>
          <button
            onClick={() => saveMessageConfig({ mode: 'fixed' })}
            disabled={savingConfig}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
              msgMode === 'fixed' ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            Texto fixo
          </button>
        </div>

        {msgMode === 'fixed' && (
          <>
            <textarea
              value={fixedMessage}
              onChange={(e) => setFixedMessage(e.target.value)}
              onBlur={() => saveMessageConfig({ fixedMessage })}
              rows={6}
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200 font-mono"
            />
            <p className="text-xs text-slate-400 mt-2">
              Use <code className="bg-slate-100 px-1 rounded">{'{saudacao}'}</code> pra "Doutor"/"Doutora" (decidido automaticamente pelo nome do perfil) e{' '}
              <code className="bg-slate-100 px-1 rounded">{'{nome}'}</code> pro primeiro nome.
            </p>
          </>
        )}
        {msgMode === 'ai' && (
          <p className="text-xs text-slate-400">A IA gera uma mensagem curta e personalizada ("soft open") com base no nome do perfil, sem citar produto/venda.</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'true', label: 'Respondeu' },
            { id: 'false', label: 'Não respondeu' },
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
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando prospects...
          </div>
        ) : prospects.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">Nenhum perfil prospectado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="px-5 py-2.5">Perfil</th>
                  <th className="px-5 py-2.5">Mensagem enviada</th>
                  <th className="px-5 py-2.5">Enviado em</th>
                  <th className="px-5 py-2.5">Respondeu</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {prospects.map((p) => (
                  <tr key={p.id} className={`hover:bg-slate-50/60 transition ${p.username === currentSeed ? 'bg-violet-50/50' : ''}`}>
                    <td className="px-5 py-3">
                      <a
                        href={`https://instagram.com/${p.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-slate-800 hover:text-violet-600 transition"
                      >
                        @{p.username}
                      </a>
                      {p.fullName && <p className="text-xs text-slate-400">{p.fullName}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-500 max-w-xs truncate" title={p.message}>{p.message}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{fmtDate(p.sentAt)}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleResponded(p)}
                        disabled={busyId === p.id}
                        className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full transition ${
                          p.responded ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {p.responded ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {p.responded ? 'Respondeu' : 'Marcar'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.username === currentSeed ? (
                        <span className="text-xs font-medium text-violet-600">Semente atual</span>
                      ) : (
                        <button
                          onClick={() => promoteToSeed(p.username)}
                          disabled={busyId === p.username}
                          className="text-xs font-medium text-violet-600 hover:text-violet-700 transition"
                        >
                          Usar como próxima semente
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
