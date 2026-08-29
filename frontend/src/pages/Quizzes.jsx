import { useState, useEffect } from 'react'
import {
  ListChecks, Plus, Trash2, ChevronUp, ChevronDown, Save, Eye,
  Copy, CheckCircle2, ExternalLink, Loader2, Image as ImageIcon, Zap, UploadCloud,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const QUIZ_PUBLIC_BASE = import.meta.env.VITE_QUIZ_PUBLIC_URL || 'https://converthair.vercel.app/q'
const MAX_QUESTIONS = 6

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
    presentation: {
      badgeTitle: 'Oficina de Vendas',
      badgeSubtitle: '',
      badgeDateLine: '',
      photoUrl: '',
      title: 'Título do',
      titleHighlight: 'Evento',
      subtitleBox: '',
      bodyText: '',
      buttonLabel: 'QUERO PARTICIPAR',
      autoRedirectSeconds: null,
    },
    questions: [],
    finalStep: {
      title: 'Sua vaga está',
      titleHighlight: 'quase garantida!',
      progressLabel: 'Falta pouco!',
      bodyText: 'Para confirmar sua presença, entre agora no grupo exclusivo do WhatsApp.',
      buttonLabel: 'ENTRAR NO GRUPO DO WHATSAPP',
      autoRedirectSeconds: 4,
    },
  }
}

function emptyQuestion() {
  return {
    id: uid(),
    question: '',
    isMqlQuestion: false,
    mqlEventName: '',
    options: [
      { id: uid(), label: '', isMqlAnswer: false },
      { id: uid(), label: '', isMqlAnswer: false },
    ],
  }
}

function QuizBuilder({ quiz, onChange, onSave, saving }) {
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

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

  function addQuestion() {
    if (quiz.questions.length >= MAX_QUESTIONS) return
    onChange(prev => ({ ...prev, questions: [...prev.questions, emptyQuestion()] }))
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
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Configuração</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">Nome interno</label>
            <input
              value={quiz.name}
              onChange={e => {
                const name = e.target.value
                onChange(prev => ({ ...prev, name, slug: prev.slug || slugify(name) }))
              }}
              placeholder="Ex: Oficina de Vendas — Ago"
              className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Slug (URL pública)</label>
            <input
              value={quiz.slug}
              onChange={e => set('slug', slugify(e.target.value))}
              placeholder="oficina-vendas-ago"
              className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition font-mono"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Link do grupo do WhatsApp (destino final)</label>
          <input
            value={quiz.whatsappUrl || ''}
            onChange={e => set('whatsappUrl', e.target.value)}
            placeholder="https://chat.whatsapp.com/..."
            className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
          />
        </div>
        {publicUrl && (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-400 flex-1 truncate">{publicUrl}</p>
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
          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-[11px] font-semibold flex items-center justify-center shrink-0">1</span>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Apresentação</p>
        </div>
        <div className="pl-7 space-y-3">
          <div>
            <label className="text-xs text-slate-500 flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Foto do expert</label>
            <div className="mt-1 flex items-center gap-3">
              {quiz.presentation.photoUrl && (
                <img src={quiz.presentation.photoUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0" />
              )}
              <label className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 hover:text-violet-600 border border-dashed border-slate-300 hover:border-violet-300 rounded-lg px-3 py-3 cursor-pointer transition">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Badge — título</label>
              <input
                value={quiz.presentation.badgeTitle}
                onChange={e => set('presentation.badgeTitle', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Badge — subtítulo</label>
              <input
                value={quiz.presentation.badgeSubtitle}
                onChange={e => set('presentation.badgeSubtitle', e.target.value)}
                placeholder="2ª Edição"
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Badge — data/horário</label>
            <input
              value={quiz.presentation.badgeDateLine}
              onChange={e => set('presentation.badgeDateLine', e.target.value)}
              placeholder="22 e 23 de Agosto · Online e Gratuito · 9h às 17h"
              className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Título</label>
              <input
                value={quiz.presentation.title}
                onChange={e => set('presentation.title', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Título (destaque colorido)</label>
              <input
                value={quiz.presentation.titleHighlight}
                onChange={e => set('presentation.titleHighlight', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Caixa de subtítulo</label>
            <input
              value={quiz.presentation.subtitleBox}
              onChange={e => set('presentation.subtitleBox', e.target.value)}
              placeholder="Construa seu processo comercial em um fim de semana"
              className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Texto de apoio</label>
            <textarea
              value={quiz.presentation.bodyText}
              onChange={e => set('presentation.bodyText', e.target.value)}
              rows={3}
              className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Texto do botão</label>
              <input
                value={quiz.presentation.buttonLabel}
                onChange={e => set('presentation.buttonLabel', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Auto-redirect pro grupo se não clicar (segundos)</label>
              <input
                type="number"
                min={0}
                value={quiz.presentation.autoRedirectSeconds ?? ''}
                onChange={e => set('presentation.autoRedirectSeconds', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="vazio = desativado"
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Etapa 2: Perguntas */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-[11px] font-semibold flex items-center justify-center shrink-0">2</span>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Perguntas do quiz ({quiz.questions.length}/{MAX_QUESTIONS})
            </p>
          </div>
          <button
            onClick={addQuestion}
            disabled={quiz.questions.length >= MAX_QUESTIONS}
            className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar pergunta
          </button>
        </div>

        {quiz.questions.length === 0 && (
          <div className="pl-7 text-center py-8 border border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
            Nenhuma pergunta ainda. Adicione até {MAX_QUESTIONS}.
          </div>
        )}

        <div className="pl-7 space-y-3">
          {quiz.questions.map((q, qi) => (
            <div key={q.id} className={`rounded-xl border p-3 space-y-2 ${q.isMqlQuestion ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold flex items-center justify-center shrink-0">{qi + 1}</span>
                <input
                  value={q.question}
                  onChange={e => updateQuestion(q.id, 'question', e.target.value)}
                  placeholder="Digite a pergunta..."
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                />
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

              <div className="flex items-center gap-3 pl-7">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={q.isMqlQuestion}
                    onChange={e => updateQuestion(q.id, 'isMqlQuestion', e.target.checked)}
                    className="accent-amber-500 w-3.5 h-3.5"
                  />
                  <span className="text-xs font-medium text-amber-700 flex items-center gap-1"><Zap className="w-3 h-3" /> Pergunta matadora (MQL)</span>
                </label>
                {q.isMqlQuestion && (
                  <input
                    value={q.mqlEventName}
                    onChange={e => updateQuestion(q.id, 'mqlEventName', e.target.value)}
                    placeholder="Nome do evento — ex: MQL-workshop-1"
                    className="flex-1 text-xs border border-amber-200 bg-white rounded-lg px-2.5 py-1 outline-none focus:ring-2 focus:ring-amber-400 transition font-mono"
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
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
                    />
                    {q.isMqlQuestion && (
                      <label className="flex items-center gap-1 shrink-0 cursor-pointer select-none bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        <input
                          type="checkbox"
                          checked={opt.isMqlAnswer}
                          onChange={e => updateOption(q.id, opt.id, 'isMqlAnswer', e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5"
                        />
                        <span className="text-[11px] text-amber-700 font-medium">MQL?</span>
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
                <button onClick={() => addOption(q.id)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-600 transition mt-1">
                  <Plus className="w-3.5 h-3.5" /> Adicionar opção
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Etapa 3: Final */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-[11px] font-semibold flex items-center justify-center shrink-0">3</span>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tela final</p>
        </div>
        <div className="pl-7 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Título</label>
              <input
                value={quiz.finalStep.title}
                onChange={e => set('finalStep.title', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Título (destaque colorido)</label>
              <input
                value={quiz.finalStep.titleHighlight}
                onChange={e => set('finalStep.titleHighlight', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Texto de apoio</label>
            <textarea
              value={quiz.finalStep.bodyText}
              onChange={e => set('finalStep.bodyText', e.target.value)}
              rows={2}
              className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Texto do botão</label>
              <input
                value={quiz.finalStep.buttonLabel}
                onChange={e => set('finalStep.buttonLabel', e.target.value)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Animação da barra + auto-redirect (segundos)</label>
              <input
                type="number"
                min={1}
                value={quiz.finalStep.autoRedirectSeconds ?? 4}
                onChange={e => set('finalStep.autoRedirectSeconds', Number(e.target.value) || 1)}
                className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 transition"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 sticky bottom-0 bg-gradient-to-t from-slate-50 pt-4 pb-2">
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2 rounded-lg transition bg-white">
            <Eye className="w-4 h-4" /> Preview
          </a>
        )}
        <button
          onClick={onSave}
          disabled={saving || !quiz.name || !quiz.slug}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
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
    setCurrent(structuredClone(quiz))
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

  function copyLink(slug, id) {
    navigator.clipboard.writeText(`${QUIZ_PUBLIC_BASE}/${slug}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  if (view === 'builder' && current) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <button onClick={() => setView('list')} className="text-xs text-slate-400 hover:text-slate-600 transition mb-1">← Voltar</button>
          <h2 className="text-lg font-semibold text-slate-800">{current.id ? 'Editar Quiz' : 'Novo Quiz'}</h2>
          <p className="text-sm text-slate-400 mt-0.5">Apresentação → até {MAX_QUESTIONS} perguntas → grupo do WhatsApp</p>
        </div>
        <QuizBuilder quiz={current} onChange={setCurrent} onSave={handleSave} saving={saving} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quiz Builder</h2>
          <p className="text-sm text-slate-400 mt-0.5">Páginas de captação com quiz, tracking de UTM e eventos MQL pro Meta</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
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
        <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
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
                  <p className="font-medium text-slate-800 text-sm">{quiz.name}</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${quiz.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {quiz.active ? 'ativo' : 'inativo'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                    {quiz.questions?.length || 0} pergunta{quiz.questions?.length !== 1 ? 's' : ''}
                  </span>
                  {quiz.questions?.filter(q => q.isMqlQuestion).map(q => (
                    <span key={q.id} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded flex items-center gap-1">
                      <Zap className="w-3 h-3" /> {q.mqlEventName || 'sem nome de evento'}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-400 flex-1 truncate">{QUIZ_PUBLIC_BASE}/{quiz.slug}</p>
                  <button onClick={() => copyLink(quiz.slug, quiz.id)} className="shrink-0 flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition">
                    {copiedId === quiz.id ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
                  </button>
                  <a href={`${QUIZ_PUBLIC_BASE}/${quiz.slug}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-400 hover:text-slate-600 transition">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => openEdit(quiz)} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-violet-600 border border-slate-200 hover:border-violet-300 px-3 py-2 rounded-lg transition">
                  Editar
                </button>
                <button onClick={() => handleDelete(quiz.id)} className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-lg transition">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
