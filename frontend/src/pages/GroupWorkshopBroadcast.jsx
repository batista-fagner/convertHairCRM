import { useEffect, useMemo, useState } from 'react'
import { Send, Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useGroupBroadcastSocket } from '../hooks/useGroupBroadcastSocket'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const DELAY_PRESETS = [
  { label: '5 – 10s (rápido, mais risco)', min: 5, max: 10 },
  { label: '10 – 30s (recomendado)', min: 10, max: 30 },
  { label: '20 – 40s (mais seguro)', min: 20, max: 40 },
]

function formatEta(totalSeconds) {
  if (totalSeconds < 60) return `${Math.ceil(totalSeconds)}s`
  const min = Math.round(totalSeconds / 60)
  return `${min} min`
}

function ConfirmModal({ total, text, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center gap-2 text-amber-600 mb-3">
          <AlertTriangle className="w-5 h-5" />
          <h3 className="font-bold text-slate-800">Confirmar disparo em massa</h3>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Isso vai enviar uma mensagem de WhatsApp pra <strong>{total} pessoa(s)</strong> que entraram no grupo. Não tem como cancelar no meio nem desfazer depois de começar.
        </p>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-sm text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {text}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition flex items-center gap-1.5">
            <Send className="w-4 h-4" /> Enviar pra {total} pessoas
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GroupWorkshopBroadcast({ leads }) {
  const [text, setText] = useState('')
  const [minDelaySec, setMinDelaySec] = useState(10)
  const [maxDelaySec, setMaxDelaySec] = useState(30)
  const [showConfirm, setShowConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')

  const targets = useMemo(() => leads.filter(l => l.phone), [leads])
  const total = targets.length
  const sampleName = targets.find(l => l.name?.trim())?.name?.trim()?.split(/\s+/)[0]

  // Se a página foi recarregada no meio de um disparo, retoma o acompanhamento.
  useEffect(() => {
    fetch(`${API}/group-workshop/broadcast-status`)
      .then(r => r.json())
      .then(d => { if (d.running) setSending(true) })
      .catch(() => {})
  }, [])

  useGroupBroadcastSocket({
    onProgress: (p) => {
      setProgress(p)
      if (p.done) setSending(false)
    },
  })

  const validRange = minDelaySec >= 1 && maxDelaySec >= minDelaySec
  const etaLow = total > 1 ? (total - 1) * minDelaySec : 0
  const etaHigh = total > 1 ? (total - 1) * maxDelaySec : 0
  const canSend = text.trim().length > 0 && total > 0 && validRange && !sending

  async function handleConfirmedSend() {
    setError('')
    setShowConfirm(false)
    setSending(true)
    setProgress({ sent: 0, total, failed: 0, done: false })
    try {
      const res = await fetch(`${API}/group-workshop/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), minDelaySec, maxDelaySec }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Erro ao iniciar o disparo')
      }
    } catch (err) {
      setError(err.message)
      setSending(false)
      setProgress(null)
    }
  }

  const pct = progress && progress.total > 0 ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <label className="block text-sm font-semibold text-slate-800 mb-2">Mensagem</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={sending}
          rows={6}
          placeholder={'Ex: Oi {{nome}}, hoje é o dia! A live começa às 20h...'}
          className="w-full text-sm border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <p className="text-xs text-slate-400 mt-1.5">
          Use <code className="bg-slate-100 px-1 rounded">{'{{nome}}'}</code> pra personalizar com o primeiro nome de cada pessoa
          {sampleName && <> — vira "{sampleName}" pra quem tem nome cadastrado, ou "tudo bem" pra quem não tem.</>}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <label className="block text-sm font-semibold text-slate-800 mb-3">Intervalo entre envios</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {DELAY_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => { setMinDelaySec(p.min); setMaxDelaySec(p.max) }}
              disabled={sending}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition disabled:opacity-50 ${
                minDelaySec === p.min && maxDelaySec === p.max
                  ? 'border-violet-600 bg-violet-50 text-violet-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600">De</span>
          <input
            type="number"
            min={1}
            max={120}
            value={minDelaySec}
            disabled={sending}
            onChange={e => setMinDelaySec(Number(e.target.value))}
            className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-center disabled:bg-slate-50"
          />
          <span className="text-slate-600">até</span>
          <input
            type="number"
            min={1}
            max={120}
            value={maxDelaySec}
            disabled={sending}
            onChange={e => setMaxDelaySec(Number(e.target.value))}
            className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-center disabled:bg-slate-50"
          />
          <span className="text-slate-600">segundos</span>
        </div>
        {!validRange && <p className="text-xs text-rose-600 mt-2">O intervalo "até" precisa ser maior ou igual ao "de".</p>}
        {total > 1 && validRange && (
          <p className="text-xs text-slate-400 mt-3">
            Tempo estimado pra chegar em todo mundo: <strong className="text-slate-600">{formatEta(etaLow)} a {formatEta(etaHigh)}</strong>
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 mb-5">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {progress && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-slate-700">
              {progress.done ? 'Disparo concluído' : 'Enviando...'}
            </span>
            <span className="text-slate-500">{progress.sent + progress.failed} / {progress.total}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${progress.done ? 'bg-emerald-500' : 'bg-violet-600'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {progress.sent} enviada(s)</span>
            {progress.failed > 0 && (
              <span className="flex items-center gap-1 text-rose-600"><XCircle className="w-3.5 h-3.5" /> {progress.failed} falhou(aram)</span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Vai enviar pra <strong className="text-slate-700">{total}</strong> pessoa(s) que entraram no grupo.
        </p>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!canSend}
          className="flex items-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? 'Enviando...' : 'Enviar agora'}
        </button>
      </div>

      {showConfirm && (
        <ConfirmModal
          total={total}
          text={text.trim()}
          onConfirm={handleConfirmedSend}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
