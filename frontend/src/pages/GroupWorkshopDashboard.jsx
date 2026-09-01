import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const BAR_COLORS = ['bg-violet-600', 'bg-teal-600', 'bg-amber-500', 'bg-rose-500', 'bg-sky-600', 'bg-slate-500']

function BarRow({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-slate-700 font-medium">{label}</span>
        <span className="text-slate-500">{count} ({pct}%)</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function DistributionCard({ title, data, total }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-slate-400">Sem respostas ainda.</p>
      ) : (
        data.map((d, i) => (
          <BarRow key={d.label} label={d.label} count={d.count} total={total} color={BAR_COLORS[i % BAR_COLORS.length]} />
        ))
      )}
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

function SectionLabel({ children, hint }) {
  return (
    <div className="flex items-baseline gap-2 mb-3 mt-2">
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{children}</h2>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  )
}

export default function GroupWorkshopDashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/group-workshop/quiz-stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => setError('Erro ao carregar dashboard'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  if (error || !stats) {
    return <p className="text-sm text-red-600 py-10 text-center">{error || 'Sem dados.'}</p>
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total no grupo" value={stats.totalLeads} />
        <StatCard label="Vieram do tráfego (quiz)" value={stats.totalTrafego} sub="Responderam o quiz no anúncio" />
        <StatCard label="Da nossa base (Sofia)" value={stats.totalBase} sub="Já eram lead, responderam no chat" />
      </div>

      <SectionLabel hint={`${stats.totalTrafego} pessoa(s) — respondeu o quiz do anúncio`}>Tráfego pago</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <DistributionCard title="Faturamento mensal" data={stats.faturamento} total={stats.totalTrafego} />
        <DistributionCard title="Faz tráfego pago?" data={stats.trafegoPago} total={stats.totalTrafego} />
        <DistributionCard title="Mensagens/dia no WhatsApp" data={stats.mensagensPorDiaTrafego} total={stats.totalTrafego} />
      </div>

      <SectionLabel hint={`${stats.totalBase} pessoa(s) — qualificada pela Sofia no chat, não veio do quiz`}>
        Nossa base
      </SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DistributionCard title="Mensagens/dia no WhatsApp" data={stats.mensagensPorDiaBase} total={stats.totalBase} />
      </div>
    </div>
  )
}
