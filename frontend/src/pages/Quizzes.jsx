import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import {
  ListChecks, Plus, Trash2, ChevronUp, ChevronDown, Save, Eye,
  Copy, CheckCircle2, ExternalLink, Loader2, Image as ImageIcon, Zap, UploadCloud,
  X, Users, BarChart3, CalendarRange, MousePointerClick, DoorOpen, Flag,
  TrendingUp, TrendingDown, ArrowRight,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const QUIZ_PUBLIC_BASE = import.meta.env.VITE_QUIZ_PUBLIC_URL || 'https://converthair.vercel.app/q'
const MAX_QUESTIONS = 7

function uid() {
  return Math.random().toString(36).slice(2, 8)
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function emptyQuiz() {
  return {
    name: '',
    slug: '',
    active: true,
    whatsappUrl: '',
    checkoutUrl: '',
    fbPixelId: '',
    fbAccessToken: '',
    welcomeMessageTemplate: '',
    welcomeMessageVariants: [],
    presentation: {
      badgeTitle: 'Oficina de Vendas',
      badgeSubtitle: '',
      badgeDateLine: '',
      photoUrl: '',
      photoMaxHeight: 340,
      title: 'Título do Evento',
      titleHighlight: 'Evento',
      titleFontSize: 30,
      subtitleBox: '',
      subtitleBoxFontSize: 14,
      subtitleBoxBold: '',
      bodyText: '',
      bodyTextFontSize: 14,
      bodyTextBold: '',
      buttonLabel: 'QUERO PARTICIPAR',
      autoRedirectSeconds: null,
    },
    questions: [],
    finalStep: {
      title: 'Sua vaga está quase garantida!',
      titleHighlight: 'quase garantida!',
      progressLabel: 'Falta pouco!',
      bodyText: 'Para confirmar sua presença, entre agora no grupo exclusivo do WhatsApp.',
      buttonLabel: 'ENTRAR NO GRUPO DO WHATSAPP',
      autoRedirectSeconds: 4,
    },
    salesPage: emptySalesPage(),
  }
}

function emptyQuestion() {
  return {
    id: uid(),
    question: '',
    type: 'choice',
    isMqlQuestion: false,
    mqlEventName: '',
    options: [
      { id: uid(), label: '', isMqlAnswer: false },
      { id: uid(), label: '', isMqlAnswer: false },
    ],
  }
}

function emptyPhoneQuestion() {
  return {
    id: uid(),
    question: 'Qual seu WhatsApp?',
    type: 'phone',
    isMqlQuestion: false,
    mqlEventName: '',
    options: [],
  }
}

// Página de venda pós-quiz — usada só por quizzes com checkoutUrl preenchido
// (ver ConvertHairPage/src/pages/Oferta5Fornecedores.tsx). Layout/cores ficam
// fixos no código da página; só o conteúdo abaixo é editável aqui.
function emptySalesPage() {
  return {
    headlineBadge: 'Você está qualificada',
    headlineTitle: 'Chega de arriscar com fornecedor. Receba os 5 validados por quem já testou na prática',
    headlineHighlight: '5 validados',
    headlineSubtitle: 'Fornecedor errado é prejuízo garantido. Fornecedor certo é risco zero — cabelo de verdade, margem boa e sem susto.',
    dores: [
      { titulo: 'Golpe de fornecedor', texto: 'Paga adiantado e o fornecedor some, atrasa ou manda menos do que combinou.' },
      { titulo: 'Cabelo de baixa qualidade', texto: 'Vem misturado, embola fácil e não é 100% humano de verdade.' },
      { titulo: 'Cliente perdido', texto: 'A cliente reclama, devolve ou nunca mais compra de você por causa da qualidade.' },
    ],
    ofertaBadge: 'O que você recebe',
    ofertaTitle: '5 fornecedores validados pessoalmente, prontos pra você chamar hoje',
    ofertaSubtitle: 'Cada um já foi filtrado pelos 4 critérios abaixo — o mesmo padrão usado por quem já vende cabelo todo santo dia.',
    criterios: ['Fios inteiros, pontas cheias', '100% humano, sem mistura sintética', 'Preço com margem boa de revenda', 'Entrega fácil, sem enrolação'],
    fornecedores: [
      { numero: 1, diferencial: 'Indiano, linha fabril', detalhe: 'Alta escala pra quem revende em volume', imagem: '' },
      { numero: 2, diferencial: 'Indiano, preço de entrada', detalhe: 'Ótimo custo-benefício pra quem tá começando', imagem: '' },
      { numero: 3, diferencial: 'Especialista em coloridos e loiros', detalhe: 'Entrega rápida, ideal pra pedidos urgentes', imagem: '' },
      { numero: 4, diferencial: 'Parceria internacional', detalhe: 'Cabelo brasileiro, importação direta', imagem: '' },
      { numero: 5, diferencial: 'Referência no mercado', detalhe: 'Mais de 30 anos de experiência e confiança', imagem: '' },
    ],
    valorAncoragemTexto: 'Só o fornecedor principal da lista já foi avaliado publicamente em R$ 10.000 de valor percebido.',
    precoDe: 'R$ 997',
    precoPor: 'R$ 47',
    valorRodapeTitulo: 'Cabe fácil no seu orçamento',
    valorRodape: 'Pra quem fatura R$ 10 mil/mês ou mais, isso representa menos de 0,5% do seu faturamento — pra nunca mais depender de sorte na hora de escolher fornecedor.',
    depoimentoTexto: 'Só com essa lista eu economizei mais de R$ 20 mil comprando direto na fonte certa, sem pagar por intermediário.',
    depoimentoAutor: 'Relato real de uma participante do Workshop Como Vender Cabelo Todo Santo Dia',
    garantiaTitulo: 'Contato direto, sem enrolação',
    garantiaTexto: 'Você recebe o nome e o WhatsApp de cada um dos 5 fornecedores. Se algum não responder ou não bater com o combinado, você fala com a gente e a gente resolve.',
    jornada: [
      { titulo: 'Você garante sua vaga', texto: 'Confirma o pagamento e o acesso libera na hora.' },
      { titulo: 'Recebe os 5 contatos', texto: 'Nome e WhatsApp de cada fornecedor chegam direto pra você.' },
      { titulo: 'Fala direto com eles', texto: 'Sem intermediário, você negocia preço e condição na hora.' },
      { titulo: 'Compra com fornecedor validado', texto: 'Cabelo de verdade, sem risco de golpe.' },
      { titulo: 'Vende com mais confiança e mais lucro', texto: '' },
    ],
    ctaTitulo: 'Pare de arriscar com fornecedor. Comece hoje com quem já é validado.',
    ctaBotaoLabel: 'Quero os 5 fornecedores agora',
    faq: [
      { pergunta: 'Funciona pra qualquer estado do Brasil?', resposta: 'Sim — os 5 fornecedores atendem por WhatsApp/envio, independente de onde você está.' },
      { pergunta: 'Recebo os contatos na hora?', resposta: 'Sim, o acesso é liberado automaticamente assim que o pagamento é confirmado.' },
      { pergunta: 'Preciso comprar uma quantidade mínima?', resposta: 'Cada fornecedor tem sua própria condição — isso vem detalhado junto com o contato de cada um.' },
    ],
  }
}

// Preview ao vivo do quiz ainda não salvo — abre a própria página pública
// (ConvertHairPage) na rota especial /q/preview dentro de um iframe e manda o
// JSON do quiz por postMessage a cada mudança, em vez de depender do quiz
// existir salvo no banco (ver Quiz.tsx: slug==="preview" pula o fetch por
// slug e escuta postMessage). "quiz-preview-ready" é a resposta do iframe
// avisando que já montou e está pronto pra receber o primeiro envio.
function QuizPreviewFrame({ quiz }) {
  const iframeRef = useRef(null)

  function sendQuiz() {
    iframeRef.current?.contentWindow?.postMessage({ type: 'quiz-preview-data', quiz }, '*')
  }

  useEffect(() => { sendQuiz() }, [quiz])

  useEffect(() => {
    function handleMessage(event) {
      if (event.data?.type === 'quiz-preview-ready') sendQuiz()
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [quiz])

  return (
    <div className="sticky top-6">
      <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <Eye className="w-3.5 h-3.5" /> Preview ao vivo
      </p>
      <div className="mx-auto rounded-[2rem] border-8 border-slate-900 bg-black overflow-hidden shadow-xl" style={{ width: 320, height: 640 }}>
        <iframe
          ref={iframeRef}
          src={`${QUIZ_PUBLIC_BASE}/preview`}
          onLoad={sendQuiz}
          className="w-full h-full border-0"
          title="Preview do quiz"
        />
      </div>
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Modal com as respostas salvas permanentemente (quiz_submissions) — inclui
// UTM completo pra saber de qual campanha/conjunto/anúncio cada resposta veio.
// Diferente da fila do TrackingService (Redis, expira em 30min e só vira Lead
// se a pessoa entrar no grupo), isso fica pra sempre desde o momento do submit.
// ─────────────────────────── Funil do quiz ───────────────────────────
// Etapas na ordem: "Abriu o quiz" (base 100%, dispara sozinho ao carregar a
// página) → "Clicou pra avançar" (clique real no botão da apresentação, a
// métrica de conexão) → 1 linha por pergunta (quem chegou até ali, incluindo
// quem foi além) → "Completou o quiz". Todas vêm prontas do getFunnel no
// backend, que também devolve o período anterior (pros comparativos) e a
// série diária (pro gráfico de evolução).

/** 'YYYY-MM-DD' no fuso do navegador — o backend interpreta como dia de Brasília. */
function funnelDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

const FUNNEL_PRESETS = [
  { id: 'hoje', label: 'Hoje', range: () => ({ from: funnelDayKey(new Date()), to: funnelDayKey(new Date()) }) },
  { id: '7d', label: 'Últimos 7 dias', range: () => ({ from: funnelDayKey(daysAgo(6)), to: funnelDayKey(new Date()) }) },
  { id: '30d', label: 'Últimos 30 dias', range: () => ({ from: funnelDayKey(daysAgo(29)), to: funnelDayKey(new Date()) }) },
  { id: 'tudo', label: 'Todo o período', range: () => ({ from: null, to: null }) },
]

function fmtDayBr(key) {
  if (!key) return ''
  const [y, m, d] = key.split('-')
  return `${d}/${m}/${y}`
}

function fmtDayShort(key) {
  if (!key) return ''
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

/**
 * Variação vs. período anterior. Retorna null quando não dá pra comparar — sem
 * período anterior, ou com base zero (dividir por zero viraria ∞/"+100%" e
 * passaria uma precisão que o dado não tem).
 */
function funnelDelta(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null
  const diff = ((current - previous) / previous) * 100
  if (Math.abs(diff) < 0.5) return { pct: 0, up: true, unit: '%' }
  return { pct: Math.round(Math.abs(diff)), up: diff > 0, unit: '%' }
}

/**
 * Variação de uma TAXA — em pontos percentuais, não em porcentagem relativa.
 * 3% virando 20% é "+17 p.p.", não "+567%": aplicar variação relativa sobre um
 * número que já é percentual dá um número enorme que não quer dizer nada.
 */
function funnelRateDelta(current, previous) {
  if (previous === null || previous === undefined) return null
  const diff = current - previous
  if (Math.abs(diff) < 1) return null
  return { pct: Math.abs(Math.round(diff)), up: diff > 0, unit: ' p.p.' }
}

function DeltaLabel({ delta, suffix = 'vs. período anterior' }) {
  if (!delta) return <p className="text-xs text-slate-400 mt-1.5">{suffix}</p>
  const Icon = delta.up ? TrendingUp : TrendingDown
  return (
    <p className="text-xs mt-1.5 flex items-center gap-1 flex-wrap">
      <span className={`flex items-center gap-0.5 font-semibold ${delta.up ? 'text-emerald-600' : 'text-red-500'}`}>
        <Icon className="w-3.5 h-3.5" />
        {delta.up ? '+' : '-'}{delta.pct}{delta.unit}
      </span>
      <span className="text-slate-400">{suffix}</span>
    </p>
  )
}

function FunnelStatCard({ icon: Icon, iconClass, label, value, valueSuffix, delta }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1 min-w-[200px]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-3xl font-bold text-slate-800 mt-1 tabular-nums">
        {value}
        {valueSuffix && <span className="text-xl">{valueSuffix}</span>}
      </p>
      <DeltaLabel delta={delta} />
    </div>
  )
}

// Atalhos de período + calendário pra intervalo customizado. Mesmo padrão do
// DateRangePicker do Analytics (DayPicker em popover, fecha ao clicar fora).
function FunnelPeriodPicker({ range, presetId, onChange }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(undefined)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const label = range.from && range.to
    ? `${fmtDayBr(range.from)}  →  ${fmtDayBr(range.to)}`
    : 'Todo o período'

  const applyDraft = () => {
    if (!draft?.from) return
    const to = draft.to || draft.from
    onChange({ from: funnelDayKey(draft.from), to: funnelDayKey(to) }, null)
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen(v => !v)}
          className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm transition ${
            open ? 'border-violet-400 ring-2 ring-violet-100' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <CalendarRange className="w-4 h-4 text-slate-400" />
          <span className="text-slate-700 font-medium tabular-nums">{label}</span>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 z-20 bg-white rounded-xl border border-slate-200 shadow-xl p-3">
            <DayPicker
              mode="range"
              locale={ptBR}
              selected={draft}
              onSelect={setDraft}
              disabled={{ after: new Date() }}
              defaultMonth={new Date()}
              classNames={{
                today: 'font-bold text-violet-600',
                selected: '!bg-violet-600 !text-white',
                range_middle: '!bg-violet-100 !text-violet-800',
                range_start: '!bg-violet-600 !text-white',
                range_end: '!bg-violet-600 !text-white',
                chevron: 'fill-violet-600',
              }}
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 mt-1">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-100 transition">
                Cancelar
              </button>
              <button
                onClick={applyDraft}
                disabled={!draft?.from}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 transition"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>

      {FUNNEL_PRESETS.map(preset => (
        <button
          key={preset.id}
          onClick={() => onChange(preset.range(), preset.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
            presetId === preset.id
              ? 'border-violet-300 bg-violet-50 text-violet-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}

const CHART_METRICS = [
  { id: 'completed', label: 'Conclusões por dia', desc: 'Quantidade de pessoas que completaram o quiz por dia' },
  { id: 'started', label: 'Sessões iniciadas por dia', desc: 'Quantidade de pessoas que abriram o quiz por dia' },
]

// Gráfico de evolução — área + linha num hue só (violeta), escala começando em
// zero e rótulo de eixo em todo valor que a linha alcança. Sem biblioteca de
// gráfico no projeto (ver HourlyChart no Analytics, mesmo padrão manual).
function FunnelDailyChart({ daily }) {
  const [metricId, setMetricId] = useState('completed')
  const [hovered, setHovered] = useState(null)
  const metric = CHART_METRICS.find(m => m.id === metricId)

  const points = (daily || []).map(d => ({ date: d.date, value: d[metricId] ?? 0 }))
  const max = Math.max(1, ...points.map(p => p.value))
  const W = 760, H = 180, padL = 36, padR = 12, padT = 12, padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const xAt = (i) => (points.length <= 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW)
  const yAt = (v) => padT + innerH - (v / max) * innerH

  // Até 7 rótulos no eixo X — mais que isso vira uma parede de datas ilegível.
  const labelStep = Math.max(1, Math.ceil(points.length / 7))
  const ticks = [0, Math.round(max / 2), max].filter((v, i, arr) => arr.indexOf(v) === i)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Evolução de conclusões</h4>
          <p className="text-xs text-slate-400 mt-0.5">{metric.desc}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Exibir:
          <select
            value={metricId}
            onChange={e => setMetricId(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 bg-white outline-none focus:ring-2 focus:ring-violet-200"
          >
            {CHART_METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>

      {points.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Sem dados no período selecionado.</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} role="img" aria-label={metric.desc}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={padL} y1={yAt(t)} x2={W - padR} y2={yAt(t)} stroke="#f1f5f9" strokeWidth="1" />
                <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{t}</text>
              </g>
            ))}

            <path
              d={`M ${xAt(0)},${padT + innerH} ${points.map((p, i) => `L ${xAt(i)},${yAt(p.value)}`).join(' ')} L ${xAt(points.length - 1)},${padT + innerH} Z`}
              fill="#7c3aed"
              fillOpacity="0.12"
            />
            <polyline
              points={points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(' ')}
              fill="none"
              stroke="#7c3aed"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {points.map((p, i) => (
              <g key={p.date}>
                <circle cx={xAt(i)} cy={yAt(p.value)} r={hovered === i ? 5 : 3.5} fill="#7c3aed" stroke="#fff" strokeWidth="2" />
                {/* alvo de hover maior que o ponto, senão fica impossível acertar */}
                <circle
                  cx={xAt(i)}
                  cy={yAt(p.value)}
                  r="14"
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              </g>
            ))}

            {points.map((p, i) => (i % labelStep === 0 || i === points.length - 1) && (
              <text key={`lbl-${p.date}`} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">
                {fmtDayShort(p.date)}
              </text>
            ))}
          </svg>

          {hovered !== null && points[hovered] && (
            <div
              className="absolute pointer-events-none z-10 -translate-x-1/2 -translate-y-full"
              style={{ left: `${(xAt(hovered) / W) * 100}%`, top: `${(yAt(points[hovered].value) / H) * 100}%` }}
            >
              <div className="bg-slate-800 text-white text-[11px] font-medium rounded-md px-2 py-1 shadow-lg whitespace-nowrap mb-2">
                {fmtDayBr(points[hovered].date)} — {points[hovered].value}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Ícone/numeração da coluna "Etapa": perguntas de verdade são numeradas (P1,
// P2...), os degraus de borda (abriu / clicou / completou) ganham ícone, pra
// deixar claro que não são perguntas.
function StepMarker({ step }) {
  if (step.isFinal) {
    return (
      <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
        <Flag className="w-3.5 h-3.5 text-emerald-600" />
      </div>
    )
  }
  if (step.questionIndex === -1) {
    return (
      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
        <DoorOpen className="w-3.5 h-3.5 text-slate-500" />
      </div>
    )
  }
  if (step.questionIndex === -0.5) {
    return (
      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
        <MousePointerClick className="w-3.5 h-3.5 text-slate-500" />
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full bg-violet-50 flex items-center justify-center shrink-0 text-xs font-bold text-violet-700 tabular-nums">
      {step.questionIndex + 1}
    </div>
  )
}

function FunnelModal({ quiz, onClose }) {
  const [range, setRange] = useState(() => FUNNEL_PRESETS[1].range()) // últimos 7 dias
  const [presetId, setPresetId] = useState('7d')
  const [funnel, setFunnel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    fetch(`${API}/quiz/id/${quiz.id}/funnel?${params.toString()}`)
      .then(r => r.json())
      .then(data => { if (active) setFunnel(data) })
      .catch(() => { if (active) setError('Erro ao carregar o funil.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [quiz.id, range.from, range.to])

  const total = funnel?.totalStarted || 0
  const completed = funnel?.totalCompleted || 0
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0
  const prevRate = funnel?.previous && funnel.previous.totalStarted > 0
    ? Math.round((funnel.previous.totalCompleted / funnel.previous.totalStarted) * 100)
    : null

  // Linhas da tabela = etapas do backend + a conclusão como última etapa, pra
  // tudo cair no mesmo layout (barra, conversão e queda calculadas igual).
  const rows = useMemo(() => {
    if (!funnel?.steps) return []
    return [...funnel.steps, { questionIndex: 999, question: 'Completou o quiz', reached: funnel.totalCompleted, isFinal: true }]
  }, [funnel])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-50 rounded-2xl w-[96vw] max-w-6xl max-h-[94vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 bg-white border-b border-slate-200">
          <div>
            <h3 className="text-xl font-bold text-slate-800">{quiz.name}</h3>
            <p className="text-sm text-slate-400 mt-0.5">Acompanhe o desempenho de cada etapa do seu quiz</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition p-1 -mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Período</p>
            <FunnelPeriodPicker
              range={range}
              presetId={presetId}
              onChange={(next, preset) => { setRange(next); setPresetId(preset) }}
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loading && error && <p className="text-red-500 text-sm text-center py-16">{error}</p>}
          {!loading && !error && total === 0 && (
            <p className="text-slate-400 text-base text-center py-16">
              Nenhuma sessão nesse período.
            </p>
          )}

          {!loading && !error && total > 0 && (
            <>
              <div className="flex gap-4 flex-wrap">
                <FunnelStatCard
                  icon={Users}
                  iconClass="bg-violet-50 text-violet-600"
                  label="Total de sessões iniciadas"
                  value={total}
                  delta={funnelDelta(total, funnel.previous?.totalStarted)}
                />
                <FunnelStatCard
                  icon={CheckCircle2}
                  iconClass="bg-emerald-50 text-emerald-600"
                  label="Completaram o quiz"
                  value={completed}
                  delta={funnelDelta(completed, funnel.previous?.totalCompleted)}
                />
                <FunnelStatCard
                  icon={BarChart3}
                  iconClass="bg-sky-50 text-sky-600"
                  label="Taxa de conclusão"
                  value={completionRate}
                  valueSuffix="%"
                  delta={funnelRateDelta(completionRate, prevRate)}
                />
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_130px_170px] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <span>Etapa</span>
                  <span>Sessões</span>
                  <span className="text-right">
                    Taxa de conversão
                    <span className="block font-normal text-[11px] text-slate-400">(em relação ao início)</span>
                  </span>
                  <span className="text-right">Queda na etapa</span>
                </div>

                {rows.map((step, idx) => {
                  const pct = total > 0 ? Math.round((step.reached / total) * 100) : 0
                  const prevReached = idx === 0 ? total : rows[idx - 1].reached
                  const dropPeople = Math.max(0, prevReached - step.reached)
                  const dropPct = prevReached > 0 ? Math.round((dropPeople / prevReached) * 100) : 0
                  const isQuestion = Number.isInteger(step.questionIndex) && step.questionIndex >= 0 && !step.isFinal
                  return (
                    <div
                      key={`${step.questionIndex}-${idx}`}
                      className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_130px_170px] gap-2 md:gap-4 px-5 py-3 border-b border-slate-100 last:border-b-0 items-center"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <StepMarker step={step} />
                        <span className={`text-sm leading-snug ${step.isFinal ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>
                          {isQuestion ? `P${step.questionIndex + 1}. ${step.question}` : step.question}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="h-2.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${step.isFinal ? 'bg-emerald-600' : 'bg-violet-600'}`}
                            style={{
                              width: `${pct}%`,
                              opacity: step.isFinal ? 1 : 0.45 + 0.55 * (1 - idx / Math.max(1, rows.length - 1)),
                            }}
                          />
                        </div>
                        <span className="text-sm text-slate-600 font-medium tabular-nums shrink-0 w-24 text-right">
                          {step.reached} ({pct}%)
                        </span>
                      </div>

                      <span className="text-sm text-slate-600 font-medium tabular-nums md:text-right">{pct}%</span>

                      <span className="text-sm md:text-right tabular-nums">
                        {idx === 0 || dropPeople === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span className="text-red-500 font-medium">
                            ↓ {dropPct}%{' '}
                            <span className="text-slate-400 font-normal">({dropPeople} pessoas)</span>
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>

              <FunnelDailyChart daily={funnel.daily} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SubmissionsModal({ quiz, submissions, loading, onClose, onDelete }) {
  const [expandedId, setExpandedId] = useState(null)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <p className="font-semibold text-slate-800 text-base">Respostas — {quiz.name}</p>
            <p className="text-sm text-slate-400 mt-0.5">{submissions.length} pessoa{submissions.length !== 1 ? 's' : ''} completou o quiz</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {!loading && submissions.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-base">Ninguém completou esse quiz ainda.</div>
          )}
          {!loading && submissions.length > 0 && (
            <table className="w-full text-base">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-sm text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Campanha</th>
                  <th className="px-4 py-2 font-medium">Conjunto/Anúncio</th>
                  <th className="px-4 py-2 font-medium">Origem</th>
                  <th className="px-4 py-2 font-medium">MQL</th>
                  <th className="px-4 py-2 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map(s => (
                  <Fragment key={s.id}>
                    <tr
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{s.utmCampaign || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{s.utmContent || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{[s.utmSource, s.utmMedium].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="px-4 py-2.5">
                        {s.mqlEvents?.length > 0 ? (
                          <span className="text-sm bg-amber-50 text-amber-700 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                            <Zap className="w-3 h-3" /> {s.mqlEvents.join(', ')}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                          className="text-slate-300 hover:text-red-500 transition"
                          title="Excluir resposta"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="space-y-1.5">
                            {(s.answers || []).map((a, i) => (
                              <p key={i} className="text-sm text-slate-600">
                                <span className="text-slate-400">{a.question}:</span> <span className="font-medium">{a.answer}</span>
                              </p>
                            ))}
                            {s.fbclid && <p className="text-sm text-slate-400 mt-2">fbclid: {s.fbclid}</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function QuizBuilder({ quiz, onChange, onSave, saving }) {
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [groupCheck, setGroupCheck] = useState(null)
  const [checkingGroup, setCheckingGroup] = useState(false)
  const [salesPageOpen, setSalesPageOpen] = useState(Boolean(quiz.checkoutUrl))
  const [uploadingFornecedorIdx, setUploadingFornecedorIdx] = useState(null)

  async function checkWhatsappGroup() {
    if (!quiz.whatsappUrl) return
    setCheckingGroup(true)
    setGroupCheck(null)
    try {
      const res = await fetch(`${API}/quiz/check-whatsapp-group?url=${encodeURIComponent(quiz.whatsappUrl)}`)
      setGroupCheck(await res.json())
    } catch (err) {
      setGroupCheck({ ok: false, error: 'Falha ao consultar o servidor' })
    } finally {
      setCheckingGroup(false)
    }
  }

  function set(path, value) {
    onChange(prev => {
      const next = structuredClone(prev)
      let obj = next
      const parts = path.split('.')
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
      obj[parts[parts.length - 1]] = value
      return next
    })
  }

  // Helpers genéricos pra arrays dentro de salesPage (dores, criterios,
  // fornecedores, faq) — path aponta pro array (ex: 'salesPage.dores').
  function addArrayItem(path, item) {
    onChange(prev => {
      const next = structuredClone(prev)
      let obj = next
      const parts = path.split('.')
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
      const key = parts[parts.length - 1]
      obj[key] = [...(obj[key] || []), item]
      return next
    })
  }

  function removeArrayItem(path, idx) {
    onChange(prev => {
      const next = structuredClone(prev)
      let obj = next
      const parts = path.split('.')
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
      const key = parts[parts.length - 1]
      obj[key] = (obj[key] || []).filter((_, i) => i !== idx)
      return next
    })
  }

  function addQuestion() {
    if (quiz.questions.length >= MAX_QUESTIONS) return
    onChange(prev => ({ ...prev, questions: [...prev.questions, emptyQuestion()] }))
  }

  function addPhoneQuestion() {
    if (quiz.questions.length >= MAX_QUESTIONS) return
    onChange(prev => ({ ...prev, questions: [...prev.questions, emptyPhoneQuestion()] }))
  }

  function removeQuestion(id) {
    onChange(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== id) }))
  }

  function moveQuestion(id, dir) {
    const idx = quiz.questions.findIndex(q => q.id === id)
    const next = idx + dir
    if (next < 0 || next >= quiz.questions.length) return
    const arr = [...quiz.questions]
    ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
    onChange(prev => ({ ...prev, questions: arr }))
  }

  function updateQuestion(id, field, value) {
    onChange(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === id ? { ...q, [field]: value } : q),
    }))
  }

  function addOption(qId) {
    onChange(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === qId
        ? { ...q, options: [...q.options, { id: uid(), label: '', isMqlAnswer: false }] }
        : q),
    }))
  }

  function removeOption(qId, optId) {
    onChange(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === qId
        ? { ...q, options: q.options.filter(o => o.id !== optId) }
        : q),
    }))
  }

  function updateOption(qId, optId, field, value) {
    onChange(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === qId
        ? { ...q, options: q.options.map(o => o.id === optId ? { ...o, [field]: value } : o) }
        : q),
    }))
  }

  const publicUrl = quiz.slug ? `${QUIZ_PUBLIC_BASE}/${quiz.slug}` : null

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Config básica */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Configuração</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-500">Nome interno</label>
            <input
              value={quiz.name}
              onChange={e => {
                const name = e.target.value
                onChange(prev => ({ ...prev, name, slug: prev.slug || slugify(name) }))
              }}
              placeholder="Ex: Oficina de Vendas — Ago"
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
          </div>
          <div>
            <label className="text-sm text-slate-500">Slug (URL pública)</label>
            <input
              value={quiz.slug}
              onChange={e => set('slug', slugify(e.target.value))}
              placeholder="oficina-vendas-ago"
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition font-mono"
            />
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-500">Link do grupo do WhatsApp (destino final)</label>
          <div className="flex gap-2 mt-1">
            <input
              value={quiz.whatsappUrl || ''}
              onChange={e => { set('whatsappUrl', e.target.value); setGroupCheck(null) }}
              placeholder="https://chat.whatsapp.com/..."
              className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
            <button
              type="button"
              onClick={checkWhatsappGroup}
              disabled={!quiz.whatsappUrl || checkingGroup}
              className="shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
            >
              {checkingGroup ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Verificar grupo
            </button>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Confere se o número que detecta quem entra no grupo (Sofia) já está dentro desse grupo e como admin —
            precisa disso pra criar o lead e mandar a mensagem de boas-vindas automaticamente. Grupo novo? Adicione
            o número lá antes de testar.
          </p>
          {groupCheck && (
            groupCheck.ok ? (
              <p className={`text-sm mt-1.5 flex items-center gap-1.5 ${groupCheck.isAdmin ? 'text-emerald-600' : 'text-amber-600'}`}>
                <CheckCircle2 size={14} />
                Grupo "{groupCheck.groupName}" — número {groupCheck.instanceNumber} {groupCheck.isAdmin ? 'é admin ✓' : 'está no grupo, mas não é admin (recomendado deixar como admin)'}
              </p>
            ) : (
              <p className="text-sm mt-1.5 text-red-600">{groupCheck.error}</p>
            )
          )}
        </div>
        <div>
          <label className="text-sm text-slate-500">Link de checkout (opcional)</label>
          <input
            value={quiz.checkoutUrl || ''}
            onChange={e => set('checkoutUrl', e.target.value)}
            placeholder="https://pay.kiwify.com.br/... ou link da Hotmart/Stripe"
            className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
          />
          <p className="text-sm text-slate-400 mt-1">
            Preencha só se esse quiz vende um produto (ex: funil de oferta) — a página final de venda usa esse link
            no botão de compra. Vazio = quiz normal, sem oferta.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-500">Meta Pixel ID (opcional)</label>
            <input
              value={quiz.fbPixelId || ''}
              onChange={e => set('fbPixelId', e.target.value)}
              placeholder="vazio = usa o pixel padrão do CRM"
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition font-mono"
            />
          </div>
          <div>
            <label className="text-sm text-slate-500">CAPI Access Token *</label>
            <input
              type="password"
              value={quiz.fbAccessToken || ''}
              onChange={e => set('fbAccessToken', e.target.value)}
              placeholder="obrigatório — os eventos desse quiz só vão via CAPI"
              className={`w-full mt-1 text-base border rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition font-mono ${
                quiz.fbAccessToken?.trim() ? 'border-slate-200' : 'border-red-300'
              }`}
            />
            {!quiz.fbAccessToken?.trim() && (
              <p className="text-sm text-red-600 mt-1">Obrigatório — sem token esse quiz não manda nenhum evento pro Meta.</p>
            )}
          </div>
        </div>
        {(quiz.fbPixelId || quiz.fbAccessToken) && (
          <p className="text-sm text-slate-400 -mt-1">
            Esse quiz vai mandar os eventos (QuizCompleto, MQL-*) pro pixel/token acima, em vez do pixel padrão do CRM.
          </p>
        )}
        <div>
          <label className="text-sm text-slate-500">Mensagem de boas-vindas individual (WhatsApp, ao entrar no grupo)</label>
          <p className="text-sm text-slate-400 mt-0.5 mb-1">Mensagem padrão — usada quando nenhuma regra condicional abaixo bater com a resposta do lead.</p>
          <textarea
            value={quiz.welcomeMessageTemplate || ''}
            onChange={e => set('welcomeMessageTemplate', e.target.value)}
            rows={4}
            placeholder="Vazio = nenhuma mensagem individual (a Sofia/Efraim também não conversa com esse lead)"
            className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 transition"
          />
          <p className="text-sm text-slate-400 mt-1">
            Placeholders: <code className="bg-slate-100 px-1 rounded">{'{nome}'}</code>
            {quiz.questions.map((q, i) => (
              <span key={q.id}> · <code className="bg-slate-100 px-1 rounded">{`{resposta_${i + 1}}`}</code> = "{q.question || `pergunta ${i + 1}`}"</span>
            ))}
            {quiz.questions.length === 0 && ' — adicione perguntas abaixo pra ver os placeholders de resposta disponíveis.'}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-500">Mensagens condicionais por resposta (opcional)</label>
            <button
              onClick={() => onChange(prev => {
                const next = structuredClone(prev)
                next.welcomeMessageVariants = [...(next.welcomeMessageVariants || []), { questionIndex: 1, optionLabel: '', template: '' }]
                return next
              })}
              className="flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700 font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Nova regra
            </button>
          </div>
          <p className="text-sm text-slate-400 mt-0.5 mb-2">Personaliza a mensagem de acordo com a resposta dada numa pergunta específica. A primeira regra que bater é usada; se nenhuma bater, usa a mensagem padrão acima.</p>

          {(quiz.welcomeMessageVariants || []).map((variant, vi) => {
            const q = quiz.questions[variant.questionIndex - 1]
            return (
              <div key={vi} className="border border-slate-200 rounded-lg p-3 mb-2 bg-slate-50/50">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-sm text-slate-500">Pergunta</label>
                    <select
                      value={variant.questionIndex}
                      onChange={e => onChange(prev => {
                        const next = structuredClone(prev)
                        next.welcomeMessageVariants[vi].questionIndex = parseInt(e.target.value, 10)
                        next.welcomeMessageVariants[vi].optionLabel = ''
                        return next
                      })}
                      className="w-full mt-1 text-base border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition bg-white"
                    >
                      {quiz.questions.map((qq, i) => (
                        <option key={qq.id} value={i + 1}>{`Pergunta ${i + 1}: ${qq.question || '(sem texto)'}`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-slate-500">Resposta</label>
                    <select
                      value={variant.optionLabel}
                      onChange={e => onChange(prev => {
                        const next = structuredClone(prev)
                        next.welcomeMessageVariants[vi].optionLabel = e.target.value
                        return next
                      })}
                      className="w-full mt-1 text-base border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition bg-white"
                    >
                      <option value="">Selecione...</option>
                      {(q?.options || []).map(o => (
                        <option key={o.id} value={o.label}>{o.label || '(sem texto)'}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <textarea
                    value={variant.template}
                    onChange={e => onChange(prev => {
                      const next = structuredClone(prev)
                      next.welcomeMessageVariants[vi].template = e.target.value
                      return next
                    })}
                    rows={3}
                    placeholder="Mensagem específica pra quem respondeu essa opção..."
                    className="flex-1 text-base border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 transition bg-white"
                  />
                  <button
                    onClick={() => onChange(prev => {
                      const next = structuredClone(prev)
                      next.welcomeMessageVariants = next.welcomeMessageVariants.filter((_, i) => i !== vi)
                      return next
                    })}
                    className="shrink-0 text-slate-400 hover:text-red-500 transition p-1.5"
                    title="Remover regra"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {publicUrl && (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <p className="text-sm text-slate-400 flex-1 truncate">{publicUrl}</p>
            <button
              onClick={() => navigator.clipboard.writeText(publicUrl)}
              className="shrink-0 text-slate-400 hover:text-violet-600 transition"
              title="Copiar link"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Etapa 1: Apresentação */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-sm font-semibold flex items-center justify-center shrink-0">1</span>
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Apresentação</p>
        </div>
        <div className="pl-7 space-y-3">
          <div>
            <label className="text-sm text-slate-500 flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Foto do expert</label>
            <div className="mt-1 flex items-center gap-3">
              {quiz.presentation.photoUrl && (
                <img src={quiz.presentation.photoUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0" />
              )}
              <label className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500 hover:text-violet-600 border border-dashed border-slate-300 hover:border-violet-300 rounded-lg px-3 py-3 cursor-pointer transition">
                {uploadingPhoto ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                ) : (
                  <><UploadCloud className="w-3.5 h-3.5" /> {quiz.presentation.photoUrl ? 'Trocar foto' : 'Enviar foto do computador'}</>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploadingPhoto}
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setUploadingPhoto(true)
                    try {
                      const formData = new FormData()
                      formData.append('file', file)
                      const res = await fetch(`${API}/quiz/upload-image`, { method: 'POST', body: formData })
                      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Erro no upload')
                      const data = await res.json()
                      set('presentation.photoUrl', data.url)
                    } catch (err) {
                      alert(err.message || 'Erro ao enviar imagem')
                    } finally {
                      setUploadingPhoto(false)
                      e.target.value = ''
                    }
                  }}
                />
              </label>
            </div>
          </div>
          {quiz.presentation.photoUrl && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-500">Altura da foto</label>
                <span className="text-sm text-slate-400 font-mono">{quiz.presentation.photoMaxHeight || 340}px</span>
              </div>
              <input
                type="range"
                min={120}
                max={400}
                value={quiz.presentation.photoMaxHeight || 340}
                onChange={e => set('presentation.photoMaxHeight', Number(e.target.value))}
                className="w-full mt-1.5 accent-violet-600"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-500">Badge — título</label>
              <input
                value={quiz.presentation.badgeTitle}
                onChange={e => set('presentation.badgeTitle', e.target.value)}
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">Badge — subtítulo</label>
              <input
                value={quiz.presentation.badgeSubtitle}
                onChange={e => set('presentation.badgeSubtitle', e.target.value)}
                placeholder="2ª Edição"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-500">Badge — data/horário</label>
            <input
              value={quiz.presentation.badgeDateLine}
              onChange={e => set('presentation.badgeDateLine', e.target.value)}
              placeholder="22 e 23 de Agosto · Online e Gratuito · 9h às 17h"
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-500">Título completo</label>
              <input
                value={quiz.presentation.title}
                onChange={e => set('presentation.title', e.target.value)}
                placeholder="Como vende cabelo todo dia"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">Palavra/trecho pra destacar em azul</label>
              <input
                value={quiz.presentation.titleHighlight}
                onChange={e => set('presentation.titleHighlight', e.target.value)}
                placeholder="vende"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
              {quiz.presentation.titleHighlight && !quiz.presentation.title.includes(quiz.presentation.titleHighlight) && (
                <p className="text-sm text-amber-600 mt-1">Esse trecho precisa aparecer dentro do título acima — hoje não aparece.</p>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-500">Tamanho da fonte do título</label>
              <span className="text-sm text-slate-400 font-mono">{quiz.presentation.titleFontSize || 30}px</span>
            </div>
            <input
              type="range"
              min={20}
              max={60}
              value={quiz.presentation.titleFontSize || 30}
              onChange={e => set('presentation.titleFontSize', Number(e.target.value))}
              className="w-full mt-1.5 accent-violet-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-500">Caixa de subtítulo</label>
              <input
                value={quiz.presentation.subtitleBox}
                onChange={e => set('presentation.subtitleBox', e.target.value)}
                placeholder="Construa seu processo comercial em um fim de semana"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">Palavra/trecho em negrito mais forte</label>
              <input
                value={quiz.presentation.subtitleBoxBold}
                onChange={e => set('presentation.subtitleBoxBold', e.target.value)}
                placeholder="fim de semana"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
              {quiz.presentation.subtitleBoxBold && !quiz.presentation.subtitleBox.includes(quiz.presentation.subtitleBoxBold) && (
                <p className="text-sm text-amber-600 mt-1">Esse trecho precisa aparecer dentro da caixa de subtítulo — hoje não aparece.</p>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-500">Tamanho da fonte da caixa de subtítulo</label>
              <span className="text-sm text-slate-400 font-mono">{quiz.presentation.subtitleBoxFontSize || 14}px</span>
            </div>
            <input
              type="range"
              min={10}
              max={30}
              value={quiz.presentation.subtitleBoxFontSize || 14}
              onChange={e => set('presentation.subtitleBoxFontSize', Number(e.target.value))}
              className="w-full mt-1.5 accent-violet-600"
            />
          </div>
          <div>
            <label className="text-sm text-slate-500">Texto de apoio</label>
            <textarea
              value={quiz.presentation.bodyText}
              onChange={e => set('presentation.bodyText', e.target.value)}
              rows={3}
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
            />
          </div>
          <div>
            <label className="text-sm text-slate-500">Palavra/trecho em negrito mais forte (texto de apoio)</label>
            <input
              value={quiz.presentation.bodyTextBold}
              onChange={e => set('presentation.bodyTextBold', e.target.value)}
              placeholder="fim de semana"
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
            {quiz.presentation.bodyTextBold && !quiz.presentation.bodyText.includes(quiz.presentation.bodyTextBold) && (
              <p className="text-sm text-amber-600 mt-1">Esse trecho precisa aparecer dentro do texto de apoio — hoje não aparece.</p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-500">Tamanho da fonte do texto de apoio</label>
              <span className="text-sm text-slate-400 font-mono">{quiz.presentation.bodyTextFontSize || 14}px</span>
            </div>
            <input
              type="range"
              min={10}
              max={30}
              value={quiz.presentation.bodyTextFontSize || 14}
              onChange={e => set('presentation.bodyTextFontSize', Number(e.target.value))}
              className="w-full mt-1.5 accent-violet-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-500">Texto do botão</label>
              <input
                value={quiz.presentation.buttonLabel}
                onChange={e => set('presentation.buttonLabel', e.target.value)}
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">Auto-redirect pro grupo se não clicar (segundos)</label>
              <input
                type="number"
                min={0}
                value={quiz.presentation.autoRedirectSeconds ?? ''}
                onChange={e => set('presentation.autoRedirectSeconds', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="vazio = desativado"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Etapa 2: Perguntas */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-sm font-semibold flex items-center justify-center shrink-0">2</span>
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
              Perguntas do quiz ({quiz.questions.length}/{MAX_QUESTIONS})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={addPhoneQuestion}
              disabled={quiz.questions.length >= MAX_QUESTIONS}
              className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar campo de telefone
            </button>
            <button
              onClick={addQuestion}
              disabled={quiz.questions.length >= MAX_QUESTIONS}
              className="flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar pergunta
            </button>
          </div>
        </div>

        {quiz.questions.length === 0 && (
          <div className="pl-7 text-center py-8 border border-dashed border-slate-200 rounded-xl text-slate-400 text-base">
            Nenhuma pergunta ainda. Adicione até {MAX_QUESTIONS}.
          </div>
        )}

        <div className="pl-7 space-y-3">
          {quiz.questions.map((q, qi) => (
            <div key={q.id} className={`rounded-xl border p-3 space-y-2 ${q.type === 'phone' ? 'border-emerald-300 bg-emerald-50/40' : q.isMqlQuestion ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-sm font-semibold flex items-center justify-center shrink-0">{qi + 1}</span>
                <input
                  value={q.question}
                  onChange={e => updateQuestion(q.id, 'question', e.target.value)}
                  placeholder="Digite a pergunta..."
                  className="flex-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                />
                {q.type === 'phone' && (
                  <span className="text-sm font-medium text-emerald-700 bg-emerald-100 rounded-lg px-2 py-1 shrink-0">Campo de telefone</span>
                )}
                <button onClick={() => moveQuestion(q.id, -1)} disabled={qi === 0} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button onClick={() => moveQuestion(q.id, 1)} disabled={qi === quiz.questions.length - 1} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition">
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button onClick={() => removeQuestion(q.id)} className="p-1 text-slate-400 hover:text-red-500 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {q.type === 'phone' && (
                <p className="pl-7 text-sm text-slate-400">
                  A pessoa digita o número livremente nessa etapa — sem opções de múltipla escolha.
                </p>
              )}

              {q.type !== 'phone' && (
              <>
              <div className="flex items-center gap-3 pl-7">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={q.isMqlQuestion}
                    onChange={e => updateQuestion(q.id, 'isMqlQuestion', e.target.checked)}
                    className="accent-amber-500 w-3.5 h-3.5"
                  />
                  <span className="text-sm font-medium text-amber-700 flex items-center gap-1"><Zap className="w-3 h-3" /> Pergunta matadora (MQL)</span>
                </label>
                {q.isMqlQuestion && (
                  <input
                    value={q.mqlEventName}
                    onChange={e => updateQuestion(q.id, 'mqlEventName', e.target.value)}
                    placeholder="Nome do evento — ex: MQL-workshop-1"
                    className="flex-1 text-sm border border-amber-200 bg-white rounded-lg px-2.5 py-1 outline-none focus:ring-2 focus:ring-amber-400 transition font-mono"
                  />
                )}
              </div>

              <div className="pl-7 space-y-1.5">
                {q.options.map((opt, oi) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <input
                      value={opt.label}
                      onChange={e => updateOption(q.id, opt.id, 'label', e.target.value)}
                      placeholder={`Opção ${oi + 1}`}
                      className="flex-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    {q.isMqlQuestion && (
                      <label className="flex items-center gap-1 shrink-0 cursor-pointer select-none bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        <input
                          type="checkbox"
                          checked={opt.isMqlAnswer}
                          onChange={e => updateOption(q.id, opt.id, 'isMqlAnswer', e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5"
                        />
                        <span className="text-sm text-amber-700 font-medium">MQL?</span>
                      </label>
                    )}
                    <button
                      onClick={() => removeOption(q.id, opt.id)}
                      disabled={q.options.length <= 2}
                      className="p-1 text-slate-300 hover:text-red-400 disabled:opacity-30 transition shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => addOption(q.id)} className="flex items-center gap-1 text-sm text-slate-400 hover:text-violet-600 transition mt-1">
                  <Plus className="w-3.5 h-3.5" /> Adicionar opção
                </button>
              </div>
              </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Etapa 3: Final */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-sm font-semibold flex items-center justify-center shrink-0">3</span>
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Tela final</p>
        </div>
        <div className="pl-7 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-500">Título completo</label>
              <input
                value={quiz.finalStep.title}
                onChange={e => set('finalStep.title', e.target.value)}
                placeholder="Sua vaga está quase garantida!"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">Palavra/trecho pra destacar em azul</label>
              <input
                value={quiz.finalStep.titleHighlight}
                onChange={e => set('finalStep.titleHighlight', e.target.value)}
                placeholder="quase garantida!"
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
              {quiz.finalStep.titleHighlight && !quiz.finalStep.title.includes(quiz.finalStep.titleHighlight) && (
                <p className="text-sm text-amber-600 mt-1">Esse trecho precisa aparecer dentro do título acima — hoje não aparece.</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-500">Texto de apoio</label>
            <textarea
              value={quiz.finalStep.bodyText}
              onChange={e => set('finalStep.bodyText', e.target.value)}
              rows={2}
              className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-500">Texto do botão</label>
              <input
                value={quiz.finalStep.buttonLabel}
                onChange={e => set('finalStep.buttonLabel', e.target.value)}
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">Animação da barra + auto-redirect (segundos)</label>
              <input
                type="number"
                min={1}
                value={quiz.finalStep.autoRedirectSeconds ?? 4}
                onChange={e => set('finalStep.autoRedirectSeconds', Number(e.target.value) || 1)}
                className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Etapa 4: Página de venda — só usada se checkoutUrl estiver preenchido */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <button
          type="button"
          onClick={() => setSalesPageOpen(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-sm font-semibold flex items-center justify-center shrink-0">4</span>
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Página de venda (oferta)</p>
          </span>
          {salesPageOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        <p className="pl-7 text-sm text-slate-400 -mt-2">
          Só é usada por quizzes que vendem um produto (link de checkout preenchido lá em cima). Layout e cores
          são fixos — aqui você edita só o texto, as fotos e os valores.
        </p>

        {salesPageOpen && (
          <div className="pl-7 space-y-5">
            {/* Headline */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-500">Headline</p>
              <div>
                <label className="text-sm text-slate-500">Badge</label>
                <input
                  value={quiz.salesPage.headlineBadge || ''}
                  onChange={e => set('salesPage.headlineBadge', e.target.value)}
                  className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-500">Título</label>
                  <textarea
                    value={quiz.salesPage.headlineTitle || ''}
                    onChange={e => set('salesPage.headlineTitle', e.target.value)}
                    rows={2}
                    className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-500">Trecho pra destacar (precisa aparecer no título)</label>
                  <input
                    value={quiz.salesPage.headlineHighlight || ''}
                    onChange={e => set('salesPage.headlineHighlight', e.target.value)}
                    className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-500">Subtítulo</label>
                <textarea
                  value={quiz.salesPage.headlineSubtitle || ''}
                  onChange={e => set('salesPage.headlineSubtitle', e.target.value)}
                  rows={2}
                  className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
                />
              </div>
            </div>

            {/* Dores */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-500">Dores (cards da seção 2)</p>
                <button
                  type="button"
                  onClick={() => addArrayItem('salesPage.dores', { titulo: '', texto: '' })}
                  className="flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>
              {(quiz.salesPage.dores || []).map((dor, idx) => (
                <div key={idx} className="flex gap-2 items-start bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="flex-1 space-y-2">
                    <input
                      value={dor.titulo}
                      onChange={e => set(`salesPage.dores.${idx}.titulo`, e.target.value)}
                      placeholder="Título da dor"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    <textarea
                      value={dor.texto}
                      onChange={e => set(`salesPage.dores.${idx}.texto`, e.target.value)}
                      rows={2}
                      placeholder="Texto"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
                    />
                  </div>
                  <button type="button" onClick={() => removeArrayItem('salesPage.dores', idx)} className="shrink-0 text-slate-400 hover:text-red-500 transition p-1.5">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Oferta */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-500">Oferta (seção 3/4)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-500">Badge</label>
                  <input
                    value={quiz.salesPage.ofertaBadge || ''}
                    onChange={e => set('salesPage.ofertaBadge', e.target.value)}
                    className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-500">Título</label>
                  <input
                    value={quiz.salesPage.ofertaTitle || ''}
                    onChange={e => set('salesPage.ofertaTitle', e.target.value)}
                    className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-500">Subtítulo</label>
                <textarea
                  value={quiz.salesPage.ofertaSubtitle || ''}
                  onChange={e => set('salesPage.ofertaSubtitle', e.target.value)}
                  rows={2}
                  className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
                />
              </div>
            </div>

            {/* Critérios (pills) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-500">Critérios de qualidade (selos)</p>
                <button
                  type="button"
                  onClick={() => addArrayItem('salesPage.criterios', '')}
                  className="flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>
              {(quiz.salesPage.criterios || []).map((c, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    value={c}
                    onChange={e => set(`salesPage.criterios.${idx}`, e.target.value)}
                    className="flex-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                  <button type="button" onClick={() => removeArrayItem('salesPage.criterios', idx)} className="shrink-0 text-slate-400 hover:text-red-500 transition p-1.5">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Fornecedores */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-500">Fornecedores (cards com foto)</p>
                <button
                  type="button"
                  onClick={() => addArrayItem('salesPage.fornecedores', { numero: (quiz.salesPage.fornecedores || []).length + 1, diferencial: '', detalhe: '', imagem: '', valor: '' })}
                  className="flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>
              {(quiz.salesPage.fornecedores || []).map((f, idx) => (
                <div key={idx} className="flex gap-3 items-start bg-slate-50 border border-slate-200 rounded-lg p-3">
                  {f.imagem && (
                    <img src={f.imagem} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0" />
                  )}
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-slate-400">Fornecedor {idx + 1}</p>
                    <input
                      value={f.diferencial}
                      onChange={e => set(`salesPage.fornecedores.${idx}.diferencial`, e.target.value)}
                      placeholder="Diferencial (ex: Indiano, linha fabril)"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    <input
                      value={f.detalhe}
                      onChange={e => set(`salesPage.fornecedores.${idx}.detalhe`, e.target.value)}
                      placeholder="Detalhe complementar"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    <input
                      value={f.valor || ''}
                      onChange={e => set(`salesPage.fornecedores.${idx}.valor`, e.target.value)}
                      placeholder="Valor percebido (ex: R$ 2.000) — usado na escada de valor"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    <label className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-violet-600 border border-dashed border-slate-300 hover:border-violet-300 rounded-lg px-3 py-1.5 cursor-pointer transition">
                      {uploadingFornecedorIdx === idx ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                      ) : (
                        <><UploadCloud className="w-3.5 h-3.5" /> {f.imagem ? 'Trocar foto' : 'Enviar foto'}</>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={uploadingFornecedorIdx !== null}
                        onChange={async e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setUploadingFornecedorIdx(idx)
                          try {
                            const formData = new FormData()
                            formData.append('file', file)
                            const res = await fetch(`${API}/quiz/upload-image`, { method: 'POST', body: formData })
                            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Erro no upload')
                            const data = await res.json()
                            set(`salesPage.fornecedores.${idx}.imagem`, data.url)
                          } catch (err) {
                            alert(err.message || 'Erro ao enviar imagem')
                          } finally {
                            setUploadingFornecedorIdx(null)
                            e.target.value = ''
                          }
                        }}
                      />
                    </label>
                  </div>
                  <button type="button" onClick={() => removeArrayItem('salesPage.fornecedores', idx)} className="shrink-0 text-slate-400 hover:text-red-500 transition p-1.5">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Valor */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-500">Ancoragem de valor</p>
              <textarea
                value={quiz.salesPage.valorAncoragemTexto || ''}
                onChange={e => set('salesPage.valorAncoragemTexto', e.target.value)}
                rows={2}
                placeholder="Texto de ancoragem (ex: valor já revelado ao vivo)"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-500">Preço "de" (riscado)</label>
                  <input
                    value={quiz.salesPage.precoDe || ''}
                    onChange={e => set('salesPage.precoDe', e.target.value)}
                    className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-500">Preço "por" (destaque)</label>
                  <input
                    value={quiz.salesPage.precoPor || ''}
                    onChange={e => set('salesPage.precoPor', e.target.value)}
                    className="w-full mt-1 text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                </div>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Card separado, logo abaixo do preço — pra destacar o argumento de "cabe no seu bolso".
              </p>
              <input
                value={quiz.salesPage.valorRodapeTitulo || ''}
                onChange={e => set('salesPage.valorRodapeTitulo', e.target.value)}
                placeholder="Título do card (ex: Cabe fácil no seu orçamento)"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
              <textarea
                value={quiz.salesPage.valorRodape || ''}
                onChange={e => set('salesPage.valorRodape', e.target.value)}
                rows={2}
                placeholder="Texto do card (ex: menos de 0,5% do seu faturamento)"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
              />
            </div>

            {/* Depoimento */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-500">Prova social</p>
              <textarea
                value={quiz.salesPage.depoimentoTexto || ''}
                onChange={e => set('salesPage.depoimentoTexto', e.target.value)}
                rows={2}
                placeholder="Texto do depoimento"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
              />
              <input
                value={quiz.salesPage.depoimentoAutor || ''}
                onChange={e => set('salesPage.depoimentoAutor', e.target.value)}
                placeholder="Atribuição (ex: Relato real de uma participante...)"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>

            {/* Garantia — não é mais exibida na página (substituída pela Jornada abaixo), mantido só como texto de apoio interno */}
            <div className="space-y-3 hidden">
              <p className="text-sm font-semibold text-slate-500">Garantia (não usado mais)</p>
              <input
                value={quiz.salesPage.garantiaTitulo || ''}
                onChange={e => set('salesPage.garantiaTitulo', e.target.value)}
                placeholder="Título"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
              <textarea
                value={quiz.salesPage.garantiaTexto || ''}
                onChange={e => set('salesPage.garantiaTexto', e.target.value)}
                rows={2}
                placeholder="Texto"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
              />
            </div>

            {/* Jornada pós-compra */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-500">Jornada pós-compra (linha do tempo)</p>
                  <p className="text-sm text-slate-400 mt-0.5">O último passo vira a "promessa final", destacado diferente dos outros.</p>
                </div>
                <button
                  type="button"
                  onClick={() => addArrayItem('salesPage.jornada', { titulo: '', texto: '' })}
                  className="flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar passo
                </button>
              </div>
              {(quiz.salesPage.jornada || []).map((passo, idx) => {
                const isLast = idx === (quiz.salesPage.jornada || []).length - 1
                return (
                  <div key={idx} className={`flex gap-2 items-start rounded-lg p-3 border ${isLast ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <span className={`shrink-0 w-6 h-6 rounded-full text-sm font-semibold flex items-center justify-center mt-1 ${isLast ? 'bg-amber-400 text-white' : 'bg-slate-300 text-white'}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 space-y-2">
                      {isLast && <p className="text-sm text-amber-700 font-medium">Este é o passo "destino" (promessa final)</p>}
                      <input
                        value={passo.titulo}
                        onChange={e => set(`salesPage.jornada.${idx}.titulo`, e.target.value)}
                        placeholder="Título do passo"
                        className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                      />
                      <input
                        value={passo.texto || ''}
                        onChange={e => set(`salesPage.jornada.${idx}.texto`, e.target.value)}
                        placeholder="Texto complementar (opcional)"
                        className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                      />
                    </div>
                    <button type="button" onClick={() => removeArrayItem('salesPage.jornada', idx)} className="shrink-0 text-slate-400 hover:text-red-500 transition p-1.5">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* CTA */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-500">Chamada final (CTA)</p>
              <input
                value={quiz.salesPage.ctaTitulo || ''}
                onChange={e => set('salesPage.ctaTitulo', e.target.value)}
                placeholder="Título acima do botão"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
              <input
                value={quiz.salesPage.ctaBotaoLabel || ''}
                onChange={e => set('salesPage.ctaBotaoLabel', e.target.value)}
                placeholder="Texto do botão"
                className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>

            {/* FAQ */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-500">Perguntas rápidas (FAQ)</p>
                <button
                  type="button"
                  onClick={() => addArrayItem('salesPage.faq', { pergunta: '', resposta: '' })}
                  className="flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>
              {(quiz.salesPage.faq || []).map((f, idx) => (
                <div key={idx} className="flex gap-2 items-start bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="flex-1 space-y-2">
                    <input
                      value={f.pergunta}
                      onChange={e => set(`salesPage.faq.${idx}.pergunta`, e.target.value)}
                      placeholder="Pergunta"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    <textarea
                      value={f.resposta}
                      onChange={e => set(`salesPage.faq.${idx}.resposta`, e.target.value)}
                      rows={2}
                      placeholder="Resposta"
                      className="w-full text-base border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
                    />
                  </div>
                  <button type="button" onClick={() => removeArrayItem('salesPage.faq', idx)} className="shrink-0 text-slate-400 hover:text-red-500 transition p-1.5">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 sticky bottom-0 bg-gradient-to-t from-slate-50 pt-4 pb-2">
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-base text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2 rounded-lg transition bg-white">
            <ExternalLink className="w-4 h-4" /> Abrir publicado
          </a>
        )}
        <button
          onClick={onSave}
          disabled={saving || !quiz.name || !quiz.slug || !quiz.fbAccessToken?.trim()}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-base font-medium px-4 py-2 rounded-lg transition"
        >
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : <><Save className="w-4 h-4" /> Salvar</>}
        </button>
      </div>
    </div>
  )
}

export default function Quizzes() {
  const [view, setView] = useState('list')
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState(null)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [submissionsQuiz, setSubmissionsQuiz] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  // O FunnelModal busca os próprios dados (o período é escolhido lá dentro e
  // muda a query), então aqui só guardamos qual quiz está aberto.
  const [funnelQuiz, setFunnelQuiz] = useState(null)

  useEffect(() => { loadQuizzes() }, [])

  async function loadQuizzes() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/quiz`)
      const data = await res.json()
      setQuizzes(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Erro ao carregar quizzes:', err)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setCurrent(emptyQuiz())
    setView('builder')
  }

  function openEdit(quiz) {
    setCurrent(structuredClone({ ...quiz, salesPage: quiz.salesPage || emptySalesPage() }))
    setView('builder')
  }

  async function handleSave() {
    setSaving(true)
    try {
      const method = current.id ? 'PUT' : 'POST'
      const url = current.id ? `${API}/quiz/${current.id}` : `${API}/quiz`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || 'Erro ao salvar')
      }
      await loadQuizzes()
      setTimeout(() => setView('list'), 400)
    } catch (err) {
      alert(err.message || 'Erro ao salvar quiz')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Excluir esse quiz?')) return
    await fetch(`${API}/quiz/${id}`, { method: 'DELETE' })
    loadQuizzes()
  }

  async function toggleActive(quiz) {
    setTogglingId(quiz.id)
    try {
      const res = await fetch(`${API}/quiz/${quiz.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !quiz.active }),
      })
      if (!res.ok) throw new Error('Erro ao atualizar status')
      await loadQuizzes()
    } catch (err) {
      alert(err.message || 'Erro ao ativar/desativar quiz')
    } finally {
      setTogglingId(null)
    }
  }

  async function openSubmissions(quiz) {
    setSubmissionsQuiz(quiz)
    setLoadingSubmissions(true)
    try {
      const res = await fetch(`${API}/quiz/id/${quiz.id}/submissions`)
      const data = await res.json()
      setSubmissions(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Erro ao carregar respostas:', err)
      setSubmissions([])
    } finally {
      setLoadingSubmissions(false)
    }
  }


  async function handleDeleteSubmission(id) {
    if (!confirm('Excluir essa resposta?')) return
    await fetch(`${API}/quiz/submissions/${id}`, { method: 'DELETE' })
    setSubmissions(prev => prev.filter(s => s.id !== id))
  }

  function copyLink(slug, id) {
    navigator.clipboard.writeText(`${QUIZ_PUBLIC_BASE}/${slug}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  if (view === 'builder' && current) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <button onClick={() => setView('list')} className="text-sm text-slate-400 hover:text-slate-600 transition mb-1">← Voltar</button>
          <h2 className="text-xl font-semibold text-slate-800">{current.id ? 'Editar Quiz' : 'Novo Quiz'}</h2>
          <p className="text-base text-slate-400 mt-0.5">Apresentação → até {MAX_QUESTIONS} perguntas → grupo do WhatsApp</p>
        </div>
        <div className="flex gap-6 items-start">
          <div className="flex-1 min-w-0">
            <QuizBuilder quiz={current} onChange={setCurrent} onSave={handleSave} saving={saving} />
          </div>
          <div className="shrink-0">
            <QuizPreviewFrame quiz={current} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quiz Builder</h2>
          <p className="text-base text-slate-400 mt-0.5">Páginas de captação com quiz, tracking de UTM e eventos MQL pro Meta</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> Novo Quiz
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {!loading && quizzes.length === 0 && (
        <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl text-slate-400 text-base">
          Nenhum quiz criado ainda.
        </div>
      )}

      <div className="space-y-3">
        {quizzes.map(quiz => (
          <div key={quiz.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center shrink-0">
                <ListChecks className="w-5 h-5 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-slate-800 text-base">{quiz.name}</p>
                  <button
                    type="button"
                    onClick={() => toggleActive(quiz)}
                    disabled={togglingId === quiz.id}
                    title={quiz.active ? 'Clique pra desativar' : 'Clique pra ativar'}
                    className={`flex items-center gap-1.5 text-sm font-medium px-2 py-0.5 rounded-full transition disabled:opacity-50 ${quiz.active ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                  >
                    {togglingId === quiz.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <span className={`w-6 h-3.5 rounded-full relative transition-colors ${quiz.active ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                        <span className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${quiz.active ? 'translate-x-3' : 'translate-x-0.5'}`} />
                      </span>
                    )}
                    {quiz.active ? 'ativo' : 'inativo'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                    {quiz.questions?.length || 0} pergunta{quiz.questions?.length !== 1 ? 's' : ''}
                  </span>
                  {quiz.questions?.filter(q => q.isMqlQuestion).map(q => (
                    <span key={q.id} className="text-sm bg-amber-50 text-amber-700 px-2 py-0.5 rounded flex items-center gap-1">
                      <Zap className="w-3 h-3" /> {q.mqlEventName || 'sem nome de evento'}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-slate-400 flex-1 truncate">{QUIZ_PUBLIC_BASE}/{quiz.slug}</p>
                  <button onClick={() => copyLink(quiz.slug, quiz.id)} className="shrink-0 flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700 transition">
                    {copiedId === quiz.id ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
                  </button>
                  <a href={`${QUIZ_PUBLIC_BASE}/${quiz.slug}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-400 hover:text-slate-600 transition">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => openEdit(quiz)} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-violet-600 border border-slate-200 hover:border-violet-300 px-3 py-2 rounded-lg transition">
                  Editar
                </button>
                <button onClick={() => openSubmissions(quiz)} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-violet-600 border border-slate-200 hover:border-violet-300 px-3 py-2 rounded-lg transition">
                  Respostas
                </button>
                <button onClick={() => setFunnelQuiz(quiz)} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-violet-600 border border-slate-200 hover:border-violet-300 px-3 py-2 rounded-lg transition">
                  Funil
                </button>
                <button onClick={() => handleDelete(quiz.id)} className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-lg transition">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {submissionsQuiz && (
        <SubmissionsModal
          quiz={submissionsQuiz}
          submissions={submissions}
          loading={loadingSubmissions}
          onClose={() => setSubmissionsQuiz(null)}
          onDelete={handleDeleteSubmission}
        />
      )}

      {funnelQuiz && <FunnelModal quiz={funnelQuiz} onClose={() => setFunnelQuiz(null)} />}
    </div>
  )
}
