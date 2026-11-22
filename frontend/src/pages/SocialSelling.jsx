import { useState, useEffect, useCallback, useRef } from 'react'
import {
  HeartHandshake, Loader2, Check, X, RotateCcw, UserPlus, MessageSquare, Search,
  Puzzle, AlertTriangle, ExternalLink, Save, ChevronDown, ChevronUp,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const TEMPS = {
  muito_quente: { label: 'Muito quente', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  quente: { label: 'Quente', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  morno: { label: 'Morno', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  frio: { label: 'Frio', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
}

const STATUS = {
  novo: { label: 'Aguardando aprovação', cls: 'text-slate-600 bg-slate-100' },
  na_fila: { label: 'Na fila', cls: 'text-violet-700 bg-violet-50' },
  enviando: { label: 'Enviando…', cls: 'text-violet-700 bg-violet-50' },
  dm_enviada: { label: 'DM enviada', cls: 'text-emerald-700 bg-emerald-50' },
  respondeu: { label: 'Respondeu', cls: 'text-emerald-800 bg-emerald-100' },
  falhou: { label: 'Falhou', cls: 'text-red-700 bg-red-50' },
  ignorado: { label: 'Ignorado', cls: 'text-slate-500 bg-slate-100' },
  descartado: { label: 'Descartado', cls: 'text-slate-400 bg-slate-50' },
}

const TABS = [
  { key: 'pendentes', label: 'Aguardando aprovação' },
  { key: 'na_fila', label: 'Na fila' },
  { key: 'dm_enviada', label: 'DM enviada' },
  { key: 'respondeu', label: 'Responderam' },
  { key: 'falhou', label: 'Falharam' },
  { key: 'ignorado', label: 'Ignorados' },
  { key: '', label: 'Todos' },
]

const MODES = [
  { key: 'desligado', label: 'Desligado', hint: 'Só registra' },
  { key: 'aprovar', label: 'Eu aprovo', hint: 'Você clica em Aprovar' },
  { key: 'automatico', label: 'Automático', hint: 'Manda sozinho' },
]

function timeAgo(iso) {
  if (!iso) return '—'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.round(h / 24)}d`
}

async function api(path, options = {}) {
  const res = await fetch(`${API}/social-selling${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`)
  return data
}

function ModePicker({ value, onChange, idPrefix }) {
  return (
    <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg" role="radiogroup">
      {MODES.map((m) => (
        <button key={m.key} id={`${idPrefix}-${m.key}`} type="button" role="radio" aria-checked={value === m.key}
          onClick={() => onChange(m.key)}
          className={`px-2 py-1.5 rounded-md text-xs font-medium transition ${
            value === m.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
          {m.label}
        </button>
      ))}
    </div>
  )
}

function ExtensionChip({ ext, inWindow }) {
  const seen = ext?.lastSeenAt ? new Date(ext.lastSeenAt).getTime() : 0
  const recentError = ext?.lastErrorAt && (!ext.lastScanAt || ext.lastErrorAt > ext.lastScanAt)
  const online = seen && Date.now() - seen < 6 * 3600_000
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
        recentError ? 'bg-red-50 border-red-200 text-red-700' : online ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
        {recentError ? <AlertTriangle className="w-3.5 h-3.5" /> : <Puzzle className="w-3.5 h-3.5" />}
        {recentError ? `Extensão: ${ext.lastError}` : seen ? `Extensão ativa · última varredura ${timeAgo(ext.lastScanAt)}` : 'Extensão ainda não conectou'}
      </span>
      {ext?.lastScanResult && !recentError && <span className="text-slate-400">{ext.lastScanResult}</span>}
      <span className={`px-2 py-1 rounded-full ${inWindow ? 'text-emerald-700 bg-emerald-50' : 'text-slate-500 bg-slate-100'}`}>
        {inWindow ? 'Dentro do horário de envio' : 'Fora do horário de envio'}
      </span>
    </div>
  )
}

function LeadRow({ lead, onAction, busy }) {
  const [open, setOpen] = useState(false)
  const [signals, setSignals] = useState(null)
  const temp = TEMPS[lead.temperature] || TEMPS.frio
  const status = STATUS[lead.status] || STATUS.novo

  useEffect(() => {
    if (!open || signals) return
    api(`/leads/${lead.id}/signals`).then(setSignals).catch(() => setSignals([]))
  }, [open, signals, lead.id])

  return (
    <li className="px-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://www.instagram.com/${lead.username}/`} target="_blank" rel="noreferrer"
              className="text-sm font-semibold text-slate-800 hover:text-violet-700 inline-flex items-center gap-1">
              @{lead.username} <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            {lead.fullName && <span className="text-xs text-slate-500 truncate">{lead.fullName}</span>}
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${temp.cls}`}>{temp.label}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {lead.followedAt && <span className="inline-flex items-center gap-1"><UserPlus className="w-3.5 h-3.5 text-violet-500" /> seguiu {timeAgo(lead.followedAt)}</span>}
            {lead.commentCount > 0 && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MessageSquare className="w-3.5 h-3.5 text-violet-500" />
                {lead.commentCount > 1 ? `${lead.commentCount} comentários · ` : ''}“{(lead.lastCommentText || '').slice(0, 90)}”
              </span>
            )}
          </div>
          {lead.skipReason && <p className="mt-1 text-xs text-slate-400">Motivo: {lead.skipReason}</p>}
          {lead.dmError && lead.status === 'falhou' && <p className="mt-1 text-xs text-red-600">{lead.dmError}</p>}
          {lead.dmMessage && (lead.status === 'dm_enviada' || lead.status === 'respondeu') && (
            <p className="mt-1 text-xs text-slate-500">DM {lead.dmChannel === 'comentario' ? 'pela resposta do comentário' : 'pela extensão'} {timeAgo(lead.dmSentAt)}: “{lead.dmMessage.slice(0, 120)}”</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {['novo', 'falhou', 'ignorado'].includes(lead.status) && !lead.dmSentAt && (
            <button onClick={() => onAction(lead, 'approve')} disabled={busy}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Aprovar
            </button>
          )}
          {!['descartado', 'dm_enviada', 'respondeu', 'enviando'].includes(lead.status) && (
            <button onClick={() => onAction(lead, 'discard')} disabled={busy} aria-label={`Descartar @${lead.username}`}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50">
              <X className="w-4 h-4" />
            </button>
          )}
          {lead.status === 'descartado' && (
            <button onClick={() => onAction(lead, 'restore')} disabled={busy}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" /> Restaurar
            </button>
          )}
          <button onClick={() => setOpen((o) => !o)} aria-label="Histórico de sinais" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && (
        <ul className="mt-2 ml-1 pl-3 border-l-2 border-slate-100 space-y-1">
          {signals === null ? <li className="text-xs text-slate-400">Carregando…</li> : signals.length === 0 ? (
            <li className="text-xs text-slate-400">Sem histórico</li>
          ) : signals.map((s) => (
            <li key={s.id} className="text-xs text-slate-600">
              <span className="text-slate-400 tabular-nums">{new Date(s.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>{' '}
              {s.type === 'follow' ? 'Começou a seguir' : <>Comentou “{s.commentText}” <span className="text-slate-400">({s.intent})</span></>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function SocialSelling() {
  const [overview, setOverview] = useState(null)
  const [config, setConfig] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('pendentes')
  const [temperature, setTemperature] = useState('')
  const [signal, setSignal] = useState('')
  const [search, setSearch] = useState('')
  const [list, setList] = useState({ data: [], total: 0 })
  const [loadingList, setLoadingList] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [previews, setPreviews] = useState({ comment: [], follow: [] })
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const loadOverview = useCallback(async () => {
    try {
      const data = await api('')
      setOverview(data)
      if (!dirtyRef.current) setConfig(data.config)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams()
    if (tab) qs.set('status', tab)
    if (temperature) qs.set('temperature', temperature)
    if (signal) qs.set('signal', signal)
    if (search.trim()) qs.set('search', search.trim())
    try {
      setList(await api(`/leads?${qs}`))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingList(false)
    }
  }, [tab, temperature, signal, search])

  useEffect(() => { loadOverview() }, [loadOverview])
  useEffect(() => {
    const t = setTimeout(loadList, 250)
    return () => clearTimeout(t)
  }, [loadList])
  useEffect(() => {
    const t = setInterval(() => { loadOverview(); loadList() }, 30000)
    return () => clearInterval(t)
  }, [loadOverview, loadList])

  // Prévia das mensagens com exemplos reais de nome/comentário
  useEffect(() => {
    if (!config) return
    const t = setTimeout(async () => {
      try {
        const [comment, follow] = await Promise.all([
          api('/preview', { method: 'POST', body: JSON.stringify({ template: config.comment.message }) }),
          api('/preview', { method: 'POST', body: JSON.stringify({ template: config.follow.message }) }),
        ])
        setPreviews({ comment, follow })
      } catch { /* prévia é opcional */ }
    }, 500)
    return () => clearTimeout(t)
  }, [config?.comment?.message, config?.follow?.message]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (path, value) => {
    setConfig((c) => {
      const next = structuredClone(c)
      const keys = path.split('.')
      let obj = next
      for (const k of keys.slice(0, -1)) obj = obj[k]
      obj[keys[keys.length - 1]] = value
      return next
    })
    setDirty(true)
    setSavedAt(null)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const saved = await api('/config', { method: 'PUT', body: JSON.stringify(config) })
      setConfig(saved)
      setDirty(false)
      setSavedAt(Date.now())
      loadOverview()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const onAction = async (lead, action) => {
    setBusyId(lead.id)
    setError('')
    try {
      await api(`/leads/${lead.id}/${action}`, { method: 'POST' })
      await Promise.all([loadList(), loadOverview()])
    } catch (err) {
      setError(`@${lead.username}: ${err.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const toggleIntent = (intent) => {
    const cur = config.comment.intents || []
    patch('comment.intents', cur.includes(intent) ? cur.filter((i) => i !== intent) : [...cur, intent])
  }

  const byStatus = overview?.byStatus || {}
  const byTemp = overview?.byTemperature || {}

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <HeartHandshake className="w-5 h-5 text-violet-600" /> Social Selling
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quem comentou nos posts da @{config?.myProfile || 'converthair'} e quem começou a seguir. As respostas caem na DM Inbox e a IA continua a conversa.
          </p>
        </div>
        {overview && <ExtensionChip ext={overview.extension} inWindow={overview.inWindow} />}
      </header>

      {error && (
        <p className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Aguardando aprovação', value: byStatus.novo || 0 },
          { label: 'Na fila', value: (byStatus.na_fila || 0) + (byStatus.enviando || 0) },
          { label: 'DMs hoje', value: overview ? `${overview.sentToday.comentario + overview.sentToday.extensao}` : '—', sub: overview ? `${overview.sentToday.comentario} comentário · ${overview.sentToday.extensao}/${overview.config.follow.dailyLimit} seguidor` : '' },
          { label: 'Responderam', value: byStatus.respondeu || 0 },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-2xl font-semibold text-slate-800 tabular-nums">{c.value}</p>
            {c.sub && <p className="text-[11px] text-slate-400">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-col xl:flex-row gap-5">
        <section className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl">
          <div className="px-4 pt-3 border-b border-slate-200">
            <div className="flex gap-1 overflow-x-auto -mb-px">
              {TABS.map((t) => (
                <button key={t.key || 'all'} onClick={() => { setTab(t.key); setLoadingList(true) }}
                  className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition ${
                    tab === t.key ? 'border-violet-600 text-violet-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
            <label className="relative flex-1 min-w-[160px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input id="ss-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar @ ou nome"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg" />
            </label>
            <select id="ss-temp" value={temperature} onChange={(e) => setTemperature(e.target.value)}
              className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
              <option value="">Todas as temperaturas</option>
              {Object.entries(TEMPS).map(([k, t]) => <option key={k} value={k}>{t.label}{byTemp[k] ? ` (${byTemp[k]})` : ''}</option>)}
            </select>
            <select id="ss-signal" value={signal} onChange={(e) => setSignal(e.target.value)}
              className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
              <option value="">Seguiu ou comentou</option>
              <option value="follow">Seguiu</option>
              <option value="comment">Comentou</option>
            </select>
          </div>
          {loadingList ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : list.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">
              Ninguém aqui ainda. Comentários chegam sozinhos pelo webhook; seguidores novos chegam quando a extensão faz a varredura.
            </p>
          ) : (
            <ul>
              {list.data.map((lead) => <LeadRow key={lead.id} lead={lead} onAction={onAction} busy={busyId === lead.id} />)}
            </ul>
          )}
          {list.total > list.data.length && (
            <p className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">Mostrando {list.data.length} de {list.total}.</p>
          )}
        </section>

        {config && (
          <aside className="w-full xl:w-[420px] shrink-0 flex flex-col gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-violet-600" /> Quem comentou</h2>
              <p className="text-xs text-slate-500">Sai pela resposta privada oficial do Instagram (até 7 dias depois do comentário). Não precisa da extensão.</p>
              <ModePicker idPrefix="ss-comment-mode" value={config.comment.mode} onChange={(v) => patch('comment.mode', v)} />
              <div>
                <p className="text-xs text-slate-500 mb-1">Abordar comentários</p>
                <div className="flex gap-2">
                  {['quente', 'morno', 'frio'].map((i) => (
                    <label key={i} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                      <input id={`ss-intent-${i}`} type="checkbox" checked={config.comment.intents.includes(i)} onChange={() => toggleIntent(i)} />
                      {TEMPS[i].label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500">Mensagem</span>
                <textarea id="ss-comment-message" rows={4} value={config.comment.message} onChange={(e) => patch('comment.message', e.target.value)}
                  placeholder="Ex.: {saudacao}! Vi seu comentário aqui no post 😊 …"
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </label>
              {config.comment.message && previews.comment.length > 0 && (
                <div className="text-xs bg-slate-50 rounded-lg p-2.5 space-y-1.5">
                  {previews.comment.slice(0, 2).map((p, i) => (
                    <p key={i} className="text-slate-700"><span className="text-slate-400">“{p.comment}” → </span>{p.text}</p>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Limite por dia
                <input id="ss-comment-limit" type="number" min="1" max="200" value={config.comment.dailyLimit}
                  onChange={(e) => patch('comment.dailyLimit', Number(e.target.value))}
                  className="w-20 px-2 py-1 border border-slate-200 rounded-lg tabular-nums" />
              </label>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2"><UserPlus className="w-4 h-4 text-violet-600" /> Quem começou a seguir</h2>
              <p className="text-xs text-slate-500">A extensão ConvertIQ acha os novos seguidores e manda a DM pelo navegador, no ritmo abaixo.</p>
              <ModePicker idPrefix="ss-follow-mode" value={config.follow.mode} onChange={(v) => patch('follow.mode', v)} />
              <label className="block">
                <span className="text-xs text-slate-500">Mensagem de boas-vindas</span>
                <textarea id="ss-follow-message" rows={4} value={config.follow.message} onChange={(e) => patch('follow.message', e.target.value)}
                  placeholder="Ex.: Oi {nome}! Vi que você começou a seguir a Convert Hair…"
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </label>
              {config.follow.message && previews.follow.length > 0 && (
                <div className="text-xs bg-slate-50 rounded-lg p-2.5 space-y-1.5">
                  {previews.follow.slice(0, 2).map((p, i) => <p key={i} className="text-slate-700">{p.text}</p>)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Limite por dia</span>
                  <input id="ss-follow-limit" type="number" min="1" max="60" value={config.follow.dailyLimit}
                    onChange={(e) => patch('follow.dailyLimit', Number(e.target.value))}
                    className="px-2 py-1 border border-slate-200 rounded-lg tabular-nums" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Intervalo entre DMs (seg)</span>
                  <span className="flex items-center gap-1">
                    <input id="ss-follow-min" type="number" min="30" value={config.follow.minDelaySec}
                      onChange={(e) => patch('follow.minDelaySec', Number(e.target.value))}
                      className="w-full px-2 py-1 border border-slate-200 rounded-lg tabular-nums" />
                    a
                    <input id="ss-follow-max" type="number" min="30" value={config.follow.maxDelaySec}
                      onChange={(e) => patch('follow.maxDelaySec', Number(e.target.value))}
                      className="w-full px-2 py-1 border border-slate-200 rounded-lg tabular-nums" />
                  </span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 pt-1 border-t border-slate-100">
                <label className="inline-flex items-center gap-2 pt-2">
                  <input id="ss-scan-enabled" type="checkbox" checked={config.scan.enabled} onChange={(e) => patch('scan.enabled', e.target.checked)} />
                  Varredura automática a cada
                </label>
                <span className="inline-flex items-center gap-1 pt-2">
                  <input id="ss-scan-interval" type="number" min="30" max="1440" value={config.scan.intervalMin}
                    onChange={(e) => patch('scan.intervalMin', Number(e.target.value))}
                    className="w-20 px-2 py-1 border border-slate-200 rounded-lg tabular-nums" /> min
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h2 className="font-semibold text-slate-800">Geral</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                Envios e varreduras das
                <input id="ss-start" type="number" min="0" max="23" value={config.startHour} onChange={(e) => patch('startHour', Number(e.target.value))}
                  className="w-16 px-2 py-1 border border-slate-200 rounded-lg tabular-nums" />
                às
                <input id="ss-end" type="number" min="1" max="24" value={config.endHour} onChange={(e) => patch('endHour', Number(e.target.value))}
                  className="w-16 px-2 py-1 border border-slate-200 rounded-lg tabular-nums" />
                h (Brasília)
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input id="ss-ai" type="checkbox" checked={config.aiReplies} onChange={(e) => patch('aiReplies', e.target.checked)} />
                A IA da DM Inbox responde quando a pessoa responder
              </label>
              <p className="text-[11px] text-slate-400">
                Variáveis: {overview?.variables?.map((v) => v.key).join(' ')} · alternativas: {'{oi|olá}'}. Seguidor não traz o comentário; comentário quase nunca traz o nome.
              </p>
              <div className="flex items-center justify-end gap-3">
                {savedAt && !dirty && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Salvo</span>}
                <button onClick={save} disabled={saving || !dirty}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
