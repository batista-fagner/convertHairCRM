import { useState, useEffect, useMemo } from 'react'
import { BarChart3, Loader2, TrendingUp, Layers, Megaphone } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const GROUP_OPTIONS = [
  { key: 'ad', label: 'Anúncio', icon: Megaphone },
  { key: 'adset', label: 'Conjunto', icon: Layers },
  { key: 'campaign', label: 'Campanha', icon: TrendingUp },
]

function fmtMoney(n) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  const s = Number(seconds)
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`
  return `${(s / 86400).toFixed(1)} d`
}

function pct(part, total) {
  if (!total) return '—'
  return `${Math.round((part / total) * 1000) / 10}%`
}

// Agrupa as linhas por anúncio/conjunto/campanha, somando as métricas
function groupRows(rows, groupBy) {
  const keyFn = {
    ad: (r) => r.adName || r.adId,
    adset: (r) => r.adsetName || '—',
    campaign: (r) => r.campaignName || '—',
  }[groupBy]

  const groups = new Map()
  for (const r of rows) {
    const key = keyFn(r)
    if (!groups.has(key)) {
      groups.set(key, {
        name: key,
        total: 0,
        leadEventCount: 0,
        qualifiedCount: 0,
        disqualifiedCount: 0,
        premiumCount: 0,
        spend: 0,
        weightedQualifySeconds: 0,
        qualifiedWithTime: 0,
      })
    }
    const g = groups.get(key)
    g.total += r.total
    g.leadEventCount += r.leadEventCount
    g.qualifiedCount += r.qualifiedCount
    g.disqualifiedCount += r.disqualifiedCount
    g.premiumCount += r.premiumCount
    g.spend += r.spend || 0
    if (r.avgSecondsToQualify) {
      g.weightedQualifySeconds += Number(r.avgSecondsToQualify) * r.qualifiedCount
      g.qualifiedWithTime += r.qualifiedCount
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      ...g,
      cpql: g.qualifiedCount > 0 ? g.spend / g.qualifiedCount : null,
      avgSecondsToQualify: g.qualifiedWithTime > 0 ? g.weightedQualifySeconds / g.qualifiedWithTime : null,
    }))
    .sort((a, b) => b.total - a.total)
}

export default function Analytics() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groupBy, setGroupBy] = useState('ad')

  useEffect(() => {
    fetch(`${API}/leads/analytics/ads`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError('Erro ao carregar dados de performance'))
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => (rows ? groupRows(rows, groupBy) : []), [rows, groupBy])

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Analytics</h2>
          <p className="text-sm text-slate-400 mt-0.5">Performance dos leads por anúncio (WhatsApp CTWA)</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGroupBy(opt.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                groupBy === opt.key ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <opt.icon className="w-3.5 h-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-6 h-6 text-slate-300 mx-auto animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhum dado ainda</p>
          <p className="text-slate-400 text-sm mt-1">
            Assim que leads de anúncios com attribution completa chegarem, o relatório aparece aqui.
          </p>
        </div>
      )}

      {!loading && !error && grouped.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">{GROUP_OPTIONS.find((o) => o.key === groupBy).label}</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Leads</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Evento "Lead"</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Qualificado</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Não qualificado</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Premium</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Gasto</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">CPQL</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Tempo p/ qualificar</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[220px] truncate" title={g.name}>{g.name}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{g.total}</td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {g.leadEventCount}
                      {g.leadEventCount < g.total && (
                        <span className="text-amber-600 text-xs ml-1" title="Nem todo lead teve o evento enviado ao Meta confirmado — pode indicar falha no envio">
                          ({pct(g.leadEventCount, g.total)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-emerald-700 font-semibold">{g.qualifiedCount}</span>
                      <span className="text-slate-400 text-xs ml-1">({pct(g.qualifiedCount, g.total)})</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-600">{g.disqualifiedCount}</span>
                      <span className="text-slate-400 text-xs ml-1">({pct(g.disqualifiedCount, g.total)})</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-amber-700 font-semibold">{g.premiumCount}</span>
                      <span className="text-slate-400 text-xs ml-1">({pct(g.premiumCount, g.total)})</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmtMoney(g.spend)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-700">{fmtMoney(g.cpql)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtDuration(g.avgSecondsToQualify)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3">
        Gasto e CPQL somam desde o início da campanha (lifetime). Evento "Lead" mostra quantos leads realmente confirmaram o envio ao Meta — divergência da coluna "Leads" pode indicar falha no CAPI.
      </p>
    </div>
  )
}
