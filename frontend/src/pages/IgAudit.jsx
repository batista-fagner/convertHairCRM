import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ScanSearch, Loader2, FileDown, RefreshCw, Trash2, AlertTriangle, CheckCircle2, X,
  Settings2, ExternalLink, PlayCircle, Megaphone, Link2, Clock,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const STAGES = [
  { key: 'analisado', label: 'Analisado', cls: 'bg-slate-100 text-slate-600' },
  { key: 'pdf-enviado', label: 'PDF enviado', cls: 'bg-sky-50 text-sky-700' },
  { key: 'ligacao-feita', label: 'Ligação feita', cls: 'bg-violet-50 text-violet-700' },
  { key: 'reuniao-marcada', label: 'Reunião marcada', cls: 'bg-emerald-50 text-emerald-700' },
  { key: 'sem-interesse', label: 'Sem interesse', cls: 'bg-red-50 text-red-600' },
]
const stageOf = (k) => STAGES.find((s) => s.key === k) || STAGES[0]

const nota = (n) => (n === null || n === undefined || n === '' ? '–' : Number(n).toFixed(1).replace('.', ','))
const scoreCls = (n) => (n >= 7 ? 'text-emerald-600' : n >= 5 ? 'text-amber-600' : 'text-red-600')
const barCls = (n) => (n >= 7 ? 'bg-emerald-500' : n >= 5 ? 'bg-amber-500' : 'bg-red-500')
const verdictCls = (r) => (r === 'Sim' ? 'text-emerald-600' : r === 'Parcialmente' ? 'text-amber-600' : 'text-red-600')
const fmtInt = (n) => (n === null || n === undefined || n === '' ? '–' : Number(n).toLocaleString('pt-BR'))
const ADS_LABEL = {
  utiliza: 'Utiliza tráfego pago',
  nao_encontrado: 'Não foram encontrados anúncios ativos',
  nao_confirmado: 'Não foi possível confirmar',
}

function PromptModal({ onClose }) {
  const [value, setValue] = useState('')
  const [def, setDef] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  useEffect(() => {
    fetch(`${API}/ig-audits/config/prompt`)
      .then((r) => r.json())
      .then((d) => { setValue(d.value); setSaved(d.value); setDef(d.default) })
      .catch(() => setStatus('Não consegui carregar o prompt'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setStatus('')
    try {
      const res = await fetch(`${API}/ig-audits/config/prompt`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
      })
      if (!res.ok) throw new Error()
      const d = await res.json()
      setValue(d.value); setSaved(d.value); setStatus('Salvo. Vale pras próximas análises.')
    } catch { setStatus('Erro ao salvar, tente de novo') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-5 flex flex-col gap-3 max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">Prompt da análise</h3>
            <p className="text-xs text-slate-500">O formato da resposta (notas, erros, capa do PDF) fica fixo no sistema — aqui você muda os critérios e o jeito de avaliar.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        {loading ? (
          <div className="h-64 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <textarea id="ig-audit-prompt" value={value} onChange={(e) => { setValue(e.target.value); setStatus('') }}
            className="w-full flex-1 min-h-[420px] text-xs font-mono text-slate-700 border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        )}
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs font-medium ${status.startsWith('Erro') || status.startsWith('Não') ? 'text-red-600' : 'text-emerald-600'}`}>
            {status || (value !== saved ? 'Alterações não salvas' : '')}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setValue(def)} className="text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 px-3.5 py-2 rounded-lg">Restaurar padrão</button>
            <button onClick={save} disabled={value === saved} className="text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3.5 py-2 rounded-lg">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, subtitle }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function AuditDetail({ audit, onChanged, onDeleted, onRerun }) {
  const [generating, setGenerating] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [notes, setNotes] = useState(audit.notes || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setNotes(audit.notes || ''); setConfirmDelete(false); setPdfError('') }, [audit.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const a = audit.analysis || {}
  const d = audit.data || {}
  const p = d.profile || {}
  const st = d.stats || {}
  const capa = a.capa || {}

  const patch = async (body) => {
    const res = await fetch(`${API}/ig-audits/${audit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) onChanged(await res.json())
  }

  const generatePdf = async () => {
    setGenerating(true); setPdfError('')
    try {
      const { downloadAuditPdf } = await import('../components/IgAuditPdf.jsx')
      await downloadAuditPdf(audit)
    } catch (err) {
      console.error(err)
      setPdfError('Não consegui gerar o PDF. Tente de novo.')
    } finally { setGenerating(false) }
  }

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    await fetch(`${API}/ig-audits/${audit.id}`, { method: 'DELETE' })
    onDeleted(audit.id)
  }

  if (audit.status === 'running') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3 py-24">
        <Loader2 className="w-7 h-7 animate-spin text-violet-500" />
        <p className="text-sm font-medium text-slate-700">Analisando @{audit.username}</p>
        <p className="text-xs">{audit.progress || 'Começando'}… leva cerca de 1 minuto.</p>
      </div>
    )
  }
  if (audit.status === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertTriangle className="w-7 h-7 text-red-500" />
        <p className="text-sm font-medium text-slate-700">A análise de @{audit.username} não terminou</p>
        <p className="text-xs text-slate-500 max-w-md">{audit.error}</p>
        <div className="flex gap-2">
          <button onClick={() => onRerun(audit.id)} className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 px-3.5 py-2 rounded-lg"><RefreshCw className="w-4 h-4" /> Tentar de novo</button>
          <button onClick={remove} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 border border-slate-200 hover:text-red-600 px-3.5 py-2 rounded-lg"><Trash2 className="w-4 h-4" /> {confirmDelete ? 'Confirmar exclusão' : 'Excluir'}</button>
        </div>
      </div>
    )
  }

  const diag = a.diagnostico || {}
  return (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center gap-4">
        {p.picDataUrl ? <img src={p.picDataUrl} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-amber-400" /> : <div className="w-14 h-14 rounded-full bg-slate-100" />}
        <div className="min-w-0">
          <a href={`https://instagram.com/${p.username}`} target="_blank" rel="noreferrer" className="text-base font-bold text-slate-800 hover:text-violet-600 flex items-center gap-1">
            @{p.username} <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <p className="text-xs text-slate-500">{p.fullName} · {fmtInt(p.followers)} seguidores · {fmtInt(p.mediaCount)} publicações</p>
        </div>
        <div className="ml-auto flex items-center gap-5">
          <div className="text-right">
            <p className={`text-4xl font-bold leading-none tabular-nums ${scoreCls(a.notaGeral)}`}>{nota(a.notaGeral)}<span className="text-base text-slate-400 font-medium"> /10</span></p>
            <p className="text-[10px] tracking-wider text-slate-400 mt-1">NOTA GERAL</p>
          </div>
        </div>
        <div className="w-full flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
          <button onClick={generatePdf} disabled={generating} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 px-4 py-2 rounded-lg">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Gerar PDF
          </button>
          <select id="ig-audit-stage" value={audit.stage} onChange={(e) => patch({ stage: e.target.value })} aria-label="Etapa"
            className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300">
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={() => onRerun(audit.id)} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 px-3.5 py-2 rounded-lg"><RefreshCw className="w-4 h-4" /> Reanalisar</button>
          <button onClick={remove} className="flex items-center gap-1.5 text-xs font-medium text-slate-400 border border-slate-200 hover:text-red-600 hover:border-red-200 px-3.5 py-2 rounded-lg ml-auto">
            <Trash2 className="w-4 h-4" /> {confirmDelete ? 'Confirmar exclusão' : ''}
          </button>
          {pdfError && <span className="w-full text-xs text-red-600">{pdfError}</span>}
        </div>
      </div>

      {/* Capa (o que abre o PDF) */}
      <Section title="Capa do PDF" subtitle="É a primeira coisa que ela lê.">
        <p className="text-lg font-bold text-slate-800 leading-snug">{capa.manchete}</p>
        <p className="text-sm text-slate-600 mt-1">{capa.subtitulo}</p>
        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          {(capa.alertas || []).map((al, i) => (
            <div key={i} className="bg-red-50 rounded-lg p-3">
              <p className="text-2xl font-bold text-red-600 tabular-nums">{al.numero}</p>
              <p className="text-xs font-semibold text-slate-800 mt-1">{al.titulo}</p>
              <p className="text-xs text-slate-600 mt-1">{al.explicacao}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-slate-700">{capa.custoDeEsperar}</div>
        <div className="mt-3 bg-slate-900 text-amber-100 rounded-lg p-3 text-sm font-semibold">{capa.chamada}</div>
      </Section>

      {/* Notas por categoria */}
      <Section title="Notas por categoria">
        <div className="divide-y divide-slate-100">
          {(a.notas || []).map((n, i) => (
            <div key={i} className="py-2.5 grid grid-cols-[150px_70px_36px_1fr] gap-3 items-start">
              <span className="text-xs font-semibold text-slate-700">{n.categoria}</span>
              <div className="h-1.5 bg-slate-100 rounded-full mt-1.5"><div className={`h-1.5 rounded-full ${barCls(n.nota)}`} style={{ width: `${Math.max(4, (n.nota || 0) * 10)}%` }} /></div>
              <span className={`text-xs font-bold tabular-nums text-right ${scoreCls(n.nota)}`}>{nota(n.nota)}</span>
              <div className="text-xs text-slate-600">
                <p className="font-medium text-slate-700">{n.resumo}</p>
                <p className="mt-0.5"><span className="text-slate-400">Visto:</span> {n.observado}</p>
                <p className="mt-0.5 text-emerald-700"><span className="text-slate-400">Fazer:</span> {n.solucao}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Diagnóstico final */}
      <Section title="Diagnóstico final">
        <div className="grid sm:grid-cols-3 gap-3">
          {[['Transmite confiança?', diag.transmiteConfianca], ['Pronto pra anúncios?', diag.prontoParaAnuncios], ['Converte seguidoras?', diag.prontoParaConverter]].map(([q, v]) => (
            <div key={q} className="border border-slate-200 rounded-lg p-3">
              <p className="text-[11px] text-slate-500">{q}</p>
              <p className={`text-base font-bold ${verdictCls(v?.resposta)}`}>{v?.resposta || '–'}</p>
              <p className="text-xs text-slate-600 mt-1">{v?.porque}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 bg-amber-50 rounded-lg p-3">
          <p className="text-[10px] font-bold tracking-wider text-amber-800">PRINCIPAL GARGALO</p>
          <p className="text-sm font-semibold text-slate-800 mt-1">{diag.principalGargalo}</p>
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Os 5 principais erros">
          <ol className="flex flex-col gap-3">
            {(a.erros || []).map((e, i) => (
              <li key={i} className="text-xs text-slate-600">
                <p className="text-sm font-semibold text-slate-800">{i + 1}. {e.titulo}</p>
                <p className="mt-0.5"><span className="text-slate-400">Vimos:</span> {e.oQueVimos}</p>
                <p className="mt-0.5"><span className="text-slate-400">Importa porque:</span> {e.porQueImporta}</p>
                <p className="mt-0.5 text-emerald-700"><span className="text-slate-400">Resolver:</span> {e.comoResolver}</p>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="As 5 maiores oportunidades">
          <ul className="flex flex-col gap-3">
            {(a.oportunidades || []).map((o, i) => (
              <li key={i} className="text-xs text-slate-600"><p className="text-sm font-semibold text-slate-800">{o.titulo}</p><p className="mt-0.5">{o.descricao}</p></li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Plano de ação de 7 dias">
        <div className="divide-y divide-slate-100">
          {(a.plano7Dias || []).map((dd, i) => (
            <div key={i} className="py-2 grid grid-cols-[56px_1fr] gap-3 text-xs">
              <span className="font-bold text-amber-700">Dia {dd.dia || i + 1}</span>
              <div><p className="font-semibold text-slate-800">{dd.titulo}</p><p className="text-slate-600 mt-0.5">{dd.acao}</p></div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Público e reels">
          <div className="text-xs text-slate-600 flex flex-col gap-1.5">
            <p><span className="text-slate-400">Público principal:</span> {a.publicoAlvo?.principal}</p>
            <p><span className="text-slate-400">Linguagem:</span> {a.publicoAlvo?.linguagem}</p>
            <p><span className="text-slate-400">Clareza:</span> {a.publicoAlvo?.clareza}</p>
            <p className="mt-1"><span className="text-slate-400">Padrão dos reels:</span> {a.padroesReels}</p>
            {a.destaquesFaltando?.length > 0 && <p className="mt-1"><span className="text-slate-400">Destaques que faltam:</span> {a.destaquesFaltando.join(', ')}</p>}
          </div>
        </Section>
        <Section title="Dados coletados" subtitle="Fatos medidos — a IA não inventa número.">
          <div className="text-xs text-slate-600 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-400" /> Última publicação: há {fmtInt(st.diasDesdeUltimaPublicacao)} dias</span>
            <span>Posts em 30 dias: {fmtInt(st.postsUltimos30Dias)}</span>
            <span><PlayCircle className="w-3.5 h-3.5 text-slate-400 inline mr-1" />Média de views: {fmtInt(st.mediaViews)}</span>
            <span>Reels lidos: {fmtInt(st.reelsAnalisados)}</span>
            <span>Interação média: {st.taxaEngajamentoPct ?? '–'}%</span>
            <span>Destaques: {fmtInt(d.highlights?.count)}</span>
            <span className="col-span-2 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5 text-slate-400" /> {ADS_LABEL[d.ads?.status] || '–'}{d.ads?.pageName ? ` (${d.ads.pageName})` : ''}</span>
            <span className="col-span-2 flex items-center gap-1.5 truncate"><Link2 className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {d.site?.url ? `${d.site.url} (${d.site.kind})` : 'Sem link na bio'}</span>
            <span className="col-span-2 text-slate-400">Stories: não disponível (a ferramenta não lê stories)</span>
          </div>
        </Section>
      </div>

      <Section title="Anotações">
        <textarea id="ig-audit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (audit.notes || '') && patch({ notes })}
          rows={3} placeholder="Ex.: mandei o PDF às 15h, ligar amanhã de manhã"
          className="w-full text-sm text-slate-700 border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </Section>
    </div>
  )
}

export default function IgAudit() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [input, setInput] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const pollRef = useRef(null)

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`${API}/ig-audits`)
      const data = await res.json()
      setList(Array.isArray(data) ? data : [])
    } catch { /* mantém a lista anterior */ } finally { setLoading(false) }
  }, [])

  const loadSelected = useCallback(async (id) => {
    if (!id) return setSelected(null)
    try {
      const res = await fetch(`${API}/ig-audits/${id}`)
      if (res.ok) setSelected(await res.json())
    } catch { /* tenta no próximo ciclo */ }
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { loadSelected(selectedId) }, [selectedId, loadSelected])

  // Enquanto houver análise rodando, atualiza a cada 3s.
  const anyRunning = list.some((x) => x.status === 'running') || selected?.status === 'running'
  useEffect(() => {
    clearInterval(pollRef.current)
    if (!anyRunning) return
    pollRef.current = setInterval(() => { loadList(); if (selectedId) loadSelected(selectedId) }, 3000)
    return () => clearInterval(pollRef.current)
  }, [anyRunning, selectedId, loadList, loadSelected])

  const start = async (e) => {
    e?.preventDefault()
    if (!input.trim()) return
    setStarting(true); setStartError('')
    try {
      const res = await fetch(`${API}/ig-audits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: input }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Não consegui começar a análise')
      setInput('')
      await loadList()
      setSelectedId(data.id)
    } catch (err) { setStartError(err.message) } finally { setStarting(false) }
  }

  const rerun = async (id) => {
    const res = await fetch(`${API}/ig-audits/${id}/rerun`, { method: 'POST' })
    if (res.ok) { const d = await res.json(); await loadList(); setSelectedId(d.id) }
  }

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      {promptOpen && <PromptModal onClose={() => setPromptOpen(false)} />}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Auditoria de Instagram</h2>
          <p className="text-sm text-slate-500">Cole o @ de uma profissional de mega hair, gere o diagnóstico e mande o PDF antes de ligar.</p>
        </div>
        <button onClick={() => setPromptOpen(true)} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 px-3.5 py-2 rounded-lg"><Settings2 className="w-4 h-4" /> Prompt da análise</button>
      </div>

      <form onSubmit={start} className="flex flex-wrap items-center gap-2">
        <input id="ig-audit-input" value={input} onChange={(e) => { setInput(e.target.value); setStartError('') }}
          placeholder="@perfil ou link do Instagram"
          className="flex-1 min-w-[220px] max-w-md text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        <button type="submit" disabled={starting || !input.trim()} className="flex items-center gap-1.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 rounded-lg">
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />} Analisar
        </button>
        <span className="text-xs text-slate-400">Gasta ~9 créditos da Scrape Creators por análise.</span>
        {startError && <span className="w-full text-xs text-red-600">{startError}</span>}
      </form>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <aside className="bg-white border border-slate-200 rounded-xl overflow-y-auto">
          {loading ? (
            <div className="py-10 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : list.length === 0 ? (
            <p className="p-5 text-xs text-slate-500">Nenhuma análise ainda. Cole um @ acima pra começar.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.map((x) => {
                const stg = stageOf(x.stage)
                return (
                  <li key={x.id}>
                    <button onClick={() => setSelectedId(x.id)} className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 ${selectedId === x.id ? 'bg-violet-50/60' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">@{x.username}</p>
                        <p className="text-[11px] text-slate-500 truncate">{x.fullName || '—'} · {new Date(x.createdAt).toLocaleDateString('pt-BR')}</p>
                        <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${stg.cls}`}>{stg.label}</span>
                      </div>
                      {x.status === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                        : x.status === 'error' ? <AlertTriangle className="w-4 h-4 text-red-500" />
                        : <span className={`text-lg font-bold tabular-nums ${scoreCls(Number(x.notaGeral))}`}>{nota(x.notaGeral)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
        <main className="min-h-0 overflow-y-auto">
          {selected ? (
            <AuditDetail
              audit={selected}
              onChanged={(a) => { setSelected(a); loadList() }}
              onDeleted={() => { setSelectedId(null); setSelected(null); loadList() }}
              onRerun={rerun}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 py-24">
              <CheckCircle2 className="w-6 h-6" />
              <p className="text-sm">Escolha uma análise na lista ou analise um perfil novo.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
