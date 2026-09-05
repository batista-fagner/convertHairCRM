import { useState, useEffect } from 'react'
import { Sparkles, Loader2, RefreshCw, ChevronLeft, ChevronRight, X, Eye, Copy, Check } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const SLIDE_COUNTS = [5, 7, 10]

// Fallback só pro caso de /carousel/options falhar — a lista de verdade vem do
// backend (mesma fonte usada no prompt), pra não existirem duas listas divergindo.
const FALLBACK_OPTIONS = {
  angles: [{ value: 'passo_a_passo', label: 'Passo a passo' }],
  tones: [{ value: 'educativo', label: 'Educativo' }],
}

const PROFILE = {
  name: 'Fagner Batista',
  handle: 'fagnerbatista',
  avatar: 'https://instagram.fvix22-1.fna.fbcdn.net/v/t51.82787-19/658981566_17859014457622286_2898541504340235122_n.jpg?efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDI0LmMyIn0&_nc_ht=instagram.fvix22-1.fna.fbcdn.net&_nc_cat=102&_nc_oc=Q6cZ2gFNAwrkHc23tmLByN1jsn7HihtdYLwx57hx3QWeR8-U92mBEbZQDfwMS5zpLQjDfivRa6MTP9fmG6g-Ui29lyVi&_nc_ohc=CaV74OF5_04Q7kNvwHAa3MY&_nc_gid=HbwA9euscWkaax-A0fdr-Q&edm=AP4sbd4BAAAA&ccb=7-5&oh=00_Af2dI4b75E5fD18HL9es-jS9oJKUo6fajbM5cKwVCP9F8A&oe=69F61EA5&_nc_sid=7a9f4b',
}

// Template "print de tweet": fundo branco, texto preto, sem imagem. Proporção 4:5
// (1080x1350), que é o formato que ocupa mais tela no feed do Instagram.
function SlidePreview({ slide, scale = 1 }) {
  return (
    <div
      className="bg-white overflow-hidden flex flex-col shrink-0"
      style={{ width: 340 * scale, height: 425 * scale }}
    >
      <div className="flex items-center gap-3 px-5 pt-5 pb-3 shrink-0">
        <img src={PROFILE.avatar} alt={PROFILE.name} className="w-10 h-10 rounded-full object-cover" />
        <div>
          <p className="text-sm font-bold text-black leading-tight">{PROFILE.name}</p>
          <p className="text-xs text-slate-500">@{PROFILE.handle}</p>
        </div>
      </div>
      <div className="px-5 pb-6 flex-1 flex items-center">
        <p className="text-[17px] text-black leading-relaxed whitespace-pre-line font-medium">
          {slide.text}
        </p>
      </div>
    </div>
  )
}

function PreviewModal({ slides, initialIndex, onClose }) {
  const [current, setCurrent] = useState(initialIndex)
  const slide = slides[current]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex items-center gap-6">
        <button
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-20 transition"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl overflow-hidden shadow-2xl">
            <SlidePreview slide={slide} scale={1.25} />
          </div>
          <p className="text-xs text-white/60">{current + 1} de {slides.length}</p>
        </div>

        <button
          onClick={() => setCurrent(c => Math.min(slides.length - 1, c + 1))}
          disabled={current === slides.length - 1}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-20 transition"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition">
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

function CopyButton({ text, label = 'Copiar', className = '' }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium transition ${
        copied ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : 'text-slate-600 hover:text-violet-600 hover:border-violet-300 hover:bg-violet-50'
      } ${className}`}
    >
      {copied ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> {label}</>}
    </button>
  )
}

export default function Content() {
  const [step, setStep] = useState('form')
  const [options, setOptions] = useState(FALLBACK_OPTIONS)
  const [form, setForm] = useState({
    topic: '',
    audience: '',
    angle: 'passo_a_passo',
    tone: 'educativo',
    slideCount: 7,
  })
  const [generating, setGenerating] = useState(false)
  const [carouselId, setCarouselId] = useState(null)
  const [slides, setSlides] = useState([])
  const [caption, setCaption] = useState('')
  const [regenerating, setRegenerating] = useState(null) // index do slide sendo regerado
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/carousel/options`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setOptions)
      .catch(() => {}) // mantém o fallback; não vale quebrar a tela por causa disso
  }, [])

  async function handleGenerateText() {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(`${API}/carousel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, instagramHandle: PROFILE.handle }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Erro ao gerar textos')
      const data = await res.json()
      setCarouselId(data.id)
      setSlides(data.slides)
      setCaption(data.caption || '')
      setStep('slides')
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function persist(payload) {
    if (!carouselId) return
    await fetch(`${API}/carousel/${carouselId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function handleRegenerate(index) {
    setRegenerating(index)
    setError('')
    try {
      const res = await fetch(`${API}/carousel/${carouselId}/regenerate/${index}`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Erro ao regerar slide')
      const data = await res.json()
      setSlides(data.slides)
    } catch (err) {
      setError(err.message)
    } finally {
      setRegenerating(null)
    }
  }

  function handleReset() {
    setStep('form')
    setSlides([])
    setCaption('')
    setCarouselId(null)
    setError('')
  }

  const allText = slides.map(s => `[Slide ${s.index + 1}]\n${s.text}`).join('\n\n')

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {preview !== null && (
        <PreviewModal slides={slides} initialIndex={preview} onClose={() => setPreview(null)} />
      )}

      <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-800">Criação de Conteúdo</h2>
        <p className="text-sm text-slate-500 mt-1">
          Carrossel no formato print de tweet — o texto é gerado aqui, a arte você monta fora
        </p>
      </div>

      {/* ESTADO 1 — Formulário */}
      {step === 'form' && (
        <div className="max-w-xl">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tema do carrossel</label>
              <textarea
                rows={3}
                placeholder="Ex: por que responder 'vou verificar e te aviso' faz você perder venda"
                value={form.topic}
                onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Público-alvo
              </label>
              <input
                placeholder="Ex: dona de loja de mega hair que atende no WhatsApp sozinha"
                value={form.audience}
                onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                Quanto mais específico, mais qualificado o seguidor — é isso que filtra quem não interessa.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Ângulo</label>
              <select
                value={form.angle}
                onChange={e => setForm(f => ({ ...f, angle: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              >
                {options.angles.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1.5">A estrutura da história. O tom abaixo é só como ela soa.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tom de voz</label>
                <select
                  value={form.tone}
                  onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                >
                  {options.tones.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Nº de slides</label>
                <select
                  value={form.slideCount}
                  onChange={e => setForm(f => ({ ...f, slideCount: Number(e.target.value) }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                >
                  {SLIDE_COUNTS.map(n => (
                    <option key={n} value={n}>{n} slides</option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              onClick={handleGenerateText}
              disabled={!form.topic.trim() || generating}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Gerando textos...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Gerar textos</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ESTADO 2 — Revisão */}
      {step === 'slides' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{slides.length} slides · revise, regere o que não ficou bom e copie</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreview(0)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:text-violet-600 hover:border-violet-300 hover:bg-violet-50 transition"
              >
                <Eye className="w-3.5 h-3.5" /> Ver prévia
              </button>
              <CopyButton text={allText} label="Copiar tudo" />
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Recomeçar
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="space-y-4">
            {slides.map((slide) => {
              const isHook = slide.index === 0
              const isCta = slide.index === slides.length - 1
              return (
                <div key={slide.index} className="bg-white rounded-2xl border border-slate-200 p-5 flex gap-5">
                  <div className="shrink-0 flex flex-col items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center text-xs font-bold">
                      {slide.index + 1}
                    </div>
                    {isHook && <span className="text-[10px] font-semibold text-violet-500 uppercase">gancho</span>}
                    {isCta && <span className="text-[10px] font-semibold text-slate-400 uppercase">cta</span>}
                  </div>

                  <div className="flex-1 min-w-0">
                    <textarea
                      rows={5}
                      value={slide.text}
                      onChange={e => {
                        const val = e.target.value
                        setSlides(prev => prev.map(s => s.index === slide.index ? { ...s, text: val } : s))
                      }}
                      onBlur={() => persist({ slides })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 resize-none"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleRegenerate(slide.index)}
                        disabled={regenerating !== null}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:text-violet-600 hover:border-violet-300 hover:bg-violet-50 disabled:opacity-40 transition"
                      >
                        {regenerating === slide.index
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Regerando...</>
                          : <><RefreshCw className="w-3.5 h-3.5" /> Regerar</>}
                      </button>
                      <CopyButton text={slide.text} />
                      <button
                        onClick={() => setPreview(slide.index)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:text-violet-600 hover:border-violet-300 hover:bg-violet-50 transition"
                      >
                        <Eye className="w-3.5 h-3.5" /> Prévia
                      </button>
                    </div>
                  </div>

                  {/* Prévia fiel do que vai virar arte: branco, texto preto */}
                  <div className="shrink-0 rounded-xl border border-slate-200 overflow-hidden">
                    <SlidePreview slide={slide} scale={0.45} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legenda do post */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Legenda do post</h3>
              <CopyButton text={caption} label="Copiar legenda" />
            </div>
            <textarea
              rows={6}
              value={caption}
              onChange={e => setCaption(e.target.value)}
              onBlur={() => persist({ caption })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}
