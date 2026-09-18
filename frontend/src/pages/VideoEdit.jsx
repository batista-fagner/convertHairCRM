import { useState, useEffect, useRef } from 'react'
import { Player } from '@remotion/player'
import {
  Clapperboard, Upload, Loader2, Trash2, AlertCircle, X,
  CheckCircle2, Sparkles, RefreshCw,
} from 'lucide-react'
import { VideoEditComposition } from '../remotion/VideoEditComposition'
import { deriveTimeline } from '../remotion/timeline'
import { FPS, WIDTH, HEIGHT } from '../remotion/constants'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

// Estados intermediários — enquanto algum job estiver aqui, a lista faz
// polling. plan_ready/failed são estados finais desta etapa (render ainda não
// existe, Etapa 5).
const TRANSIENT_STATUSES = new Set(['uploaded', 'preparing', 'audio_ready', 'transcribing', 'planning'])

const STATUS_LABEL = {
  uploaded: 'Enviado, na fila',
  preparing: 'Preparando vídeo',
  audio_ready: 'Áudio pronto',
  transcribing: 'Transcrevendo',
  planning: 'Montando o plano',
  plan_ready: 'Pronto pra revisar',
  queued: 'Na fila de render',
  rendering: 'Renderizando',
  done: 'Concluído',
  failed: 'Falhou',
}

const STATUS_COLOR = {
  uploaded: 'bg-slate-100 text-slate-600',
  preparing: 'bg-blue-50 text-blue-700',
  audio_ready: 'bg-blue-50 text-blue-700',
  transcribing: 'bg-indigo-50 text-indigo-700',
  planning: 'bg-indigo-50 text-indigo-700',
  plan_ready: 'bg-emerald-50 text-emerald-700',
  queued: 'bg-blue-50 text-blue-700',
  rendering: 'bg-indigo-50 text-indigo-700',
  done: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
}

const putWithProgress = (url, file, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest()
  xhr.open('PUT', url)
  if (file.type) xhr.setRequestHeader('Content-Type', file.type)
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
  }
  xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload falhou (HTTP ${xhr.status})`)))
  xhr.onerror = () => reject(new Error('Upload falhou — verifique sua conexão'))
  xhr.send(file)
})

export default function VideoEdit() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const pollRef = useRef(null)

  const load = () => {
    fetch(`${API}/video-edit`)
      .then((r) => r.json())
      .then((d) => setJobs(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Polling só enquanto algo estiver em andamento — não fica batendo na API à
  // toa quando tudo já chegou num estado final.
  useEffect(() => {
    const hasTransient = jobs.some((j) => TRANSIENT_STATUSES.has(j.status))
    clearInterval(pollRef.current)
    if (hasTransient) pollRef.current = setInterval(load, 4000)
    return () => clearInterval(pollRef.current)
  }, [jobs])

  const selected = jobs.find((j) => j.id === selectedId) || null

  const remove = async (id) => {
    if (!confirm('Excluir esta edição? Os arquivos no armazenamento também são apagados.')) return
    setError('')
    try {
      const res = await fetch(`${API}/video-edit/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao excluir') }
      if (selectedId === id) setSelectedId(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Editor de Vídeo</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Suba um vídeo e escreva como editar — a IA monta o gancho, a legenda e o zoom automaticamente.
          </p>
        </div>
        {!uploadOpen && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Upload className="w-4 h-4" /> Nova edição
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {uploadOpen && (
        <UploadForm
          onCancel={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); load() }}
          onError={setError}
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : jobs.length === 0 && !uploadOpen ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Clapperboard className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhuma edição ainda</p>
          <p className="text-slate-400 text-sm mt-1">Suba o primeiro vídeo pra ver a IA montar o gancho</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <div className="space-y-2">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} selected={job.id === selectedId} onSelect={() => setSelectedId(job.id)} onDelete={() => remove(job.id)} />
            ))}
          </div>
          <div>
            {selected ? <JobDetail job={selected} /> : (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
                Selecione uma edição na lista pra ver os detalhes
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function JobRow({ job, selected, onSelect, onDelete }) {
  const isTransient = TRANSIENT_STATUSES.has(job.status)
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left bg-white rounded-xl border p-3.5 transition ${selected ? 'border-violet-400 ring-1 ring-violet-200' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 truncate">{job.name}</p>
        <span
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1 text-slate-300 hover:text-red-600 flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        {isTransient && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLOR[job.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {STATUS_LABEL[job.status] ?? job.status}
        </span>
      </div>
      {job.status === 'failed' && job.errorMessage && (
        <p className="text-[11px] text-red-500 mt-1.5 line-clamp-2">{job.errorMessage}</p>
      )}
    </button>
  )
}

function JobDetail({ job }) {
  if (job.status === 'failed') {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-6">
        <div className="flex items-center gap-2 text-red-600 mb-2">
          <AlertCircle className="w-4 h-4" />
          <p className="font-semibold text-sm">Essa edição falhou</p>
        </div>
        <p className="text-sm text-slate-500">{job.errorMessage || 'Erro desconhecido'}</p>
      </div>
    )
  }

  if (!job.plan) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <Loader2 className="w-6 h-6 text-slate-300 mx-auto mb-3 animate-spin" />
        <p className="text-slate-500 font-medium text-sm">{STATUS_LABEL[job.status] ?? job.status}</p>
        <p className="text-slate-400 text-xs mt-1">Isso leva alguns segundos a minutos, dependendo do tamanho do vídeo</p>
      </div>
    )
  }

  const timeline = deriveTimeline(job.plan)

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
      <div className="mx-auto md:mx-0">
        <Player
          component={VideoEditComposition}
          inputProps={job.plan}
          durationInFrames={timeline.durationInFrames}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          fps={FPS}
          style={{ width: 260, aspectRatio: `${WIDTH} / ${HEIGHT}`, borderRadius: 12, overflow: 'hidden' }}
          controls
          loop
          acknowledgeRemotionLicense
        />
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Instrução</p>
          <p className="text-sm text-slate-700">{job.instruction || <span className="text-slate-400">Nenhuma — a IA usou o próprio critério editorial</span>}</p>
        </div>

        <div className="bg-white rounded-xl border border-violet-200 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">Por que esse gancho</p>
          </div>
          <p className="text-sm text-slate-700">{job.plan.hook?.reason}</p>
        </div>

        {job.plan.warnings?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1.5">Avisos</p>
            <ul className="text-sm text-amber-800 space-y-1">
              {job.plan.warnings.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          </div>
        )}

        {job.transcript?.text && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Transcrição</p>
            <p className="text-sm text-slate-600 max-h-32 overflow-y-auto">{job.transcript.text}</p>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Plano pronto — o botão de renderizar e baixar o vídeo final chega na próxima etapa
        </div>
      </div>
    </div>
  )
}

function UploadForm({ onCancel, onDone, onError }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState('idle') // idle | uploading | creating
  const [progress, setProgress] = useState(0)

  const pickFile = (f) => {
    setFile(f)
    if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  const submit = async () => {
    onError('')
    if (!file) { onError('Selecione um vídeo'); return }
    if (!name.trim()) { onError('Dê um nome pra essa edição'); return }

    try {
      setPhase('uploading')
      setProgress(0)
      const presign = await fetch(`${API}/video-edit/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      if (!presign.ok) { const d = await presign.json().catch(() => ({})); throw new Error(d.message || 'Erro ao preparar upload') }
      const { uploadUrl, storagePath } = await presign.json()

      await putWithProgress(uploadUrl, file, setProgress)

      setPhase('creating')
      const res = await fetch(`${API}/video-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), instruction: instruction.trim(), storagePath }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao criar a edição') }
      onDone()
    } catch (e) {
      onError(e.message)
      setPhase('idle')
    }
  }

  const busy = phase !== 'idle'

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-semibold text-slate-800 text-sm">Nova edição</p>
        {!busy && <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Vídeo (MP4, MOV, M4V ou WEBM)</label>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
            disabled={busy}
            onChange={(e) => pickFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome</label>
          <input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Anúncio depoimento setembro"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Instrução de edição (opcional)</label>
          <textarea
            value={instruction}
            disabled={busy}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="Ex: Corte a frase mais forte do meio e coloque como gancho, com zoom nos momentos de impacto"
            className="w-full text-sm border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {!busy && <button onClick={onCancel} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>}
          <button
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition min-w-[160px] justify-center"
          >
            {phase === 'uploading' && <><RefreshCw className="w-4 h-4 animate-spin" /> Enviando {progress}%</>}
            {phase === 'creating' && <><Loader2 className="w-4 h-4 animate-spin" /> Criando...</>}
            {phase === 'idle' && <><Upload className="w-4 h-4" /> Enviar e editar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
