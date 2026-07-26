import { useState, useEffect, useRef } from 'react'
import { Image, Video, Upload, Loader2, Trash2, AlertCircle, X, Clock, CheckCircle2, XCircle, RefreshCw, Send } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const STATUS_LABEL = {
  scheduled: { label: 'Agendado', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  processing: { label: 'Processando', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: Loader2 },
  published: { label: 'Publicado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  failed: { label: 'Falhou', className: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
}

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function InstagramPosts() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  const load = () => {
    fetch(`${API}/ig-posts`)
      .then(r => r.json())
      .then(d => setPosts(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // Posts em processamento/agendados mudam de status sozinhos via cron no
    // backend — dá um refresh periódico pra refletir isso sem precisar F5.
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Posts no Instagram</h2>
          <p className="text-sm text-slate-400 mt-0.5">Suba imagem ou vídeo, escreva legenda + hashtags e publique agora ou agende.</p>
        </div>
        {!uploadOpen && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Upload className="w-4 h-4" /> Novo post
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
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando posts...
        </div>
      ) : posts.length === 0 && !uploadOpen ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Image className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhum post ainda</p>
          <p className="text-slate-400 text-sm mt-1">Suba o primeiro pra publicar ou agendar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map(p => (
            <PostCard key={p.id} post={p} onChanged={load} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function UploadForm({ onCancel, onDone, onError }) {
  const [mediaType, setMediaType] = useState('IMAGE')
  const [file, setFile] = useState(null)
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [scheduleMode, setScheduleMode] = useState('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const submit = async () => {
    onError('')
    if (!file) { onError(`Selecione ${mediaType === 'IMAGE' ? 'uma imagem (JPEG/PNG)' : 'um vídeo MP4'}`); return }
    if (scheduleMode === 'later' && !scheduledAt) { onError('Escolha a data/hora do agendamento'); return }
    setUploading(true)
    try {
      const fullCaption = [caption.trim(), hashtags.trim()].filter(Boolean).join('\n\n')
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mediaType', mediaType)
      fd.append('caption', fullCaption)
      if (scheduleMode === 'later') fd.append('scheduledAt', new Date(scheduledAt).toISOString())
      const res = await fetch(`${API}/ig-posts`, { method: 'POST', body: fd })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro no upload') }
      onDone()
    } catch (e) {
      onError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-semibold text-slate-800 text-sm">Novo post</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo de mídia</label>
          <div className="flex gap-2">
            <button
              onClick={() => { setMediaType('IMAGE'); setFile(null); if (fileRef.current) fileRef.current.value = '' }}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition ${mediaType === 'IMAGE' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              <Image className="w-4 h-4" /> Imagem
            </button>
            <button
              onClick={() => { setMediaType('VIDEO'); setFile(null); if (fileRef.current) fileRef.current.value = '' }}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition ${mediaType === 'VIDEO' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              <Video className="w-4 h-4" /> Vídeo (Reels)
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Arquivo ({mediaType === 'IMAGE' ? 'JPEG/PNG, máx 20MB' : 'MP4, máx 100MB'})
          </label>
          <input
            ref={fileRef}
            type="file"
            accept={mediaType === 'IMAGE' ? 'image/jpeg,image/png' : 'video/mp4'}
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Legenda</label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={3}
            placeholder="Escreva a legenda do post..."
            className="w-full text-sm border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Hashtags (opcional)</label>
          <textarea
            value={hashtags}
            onChange={e => setHashtags(e.target.value)}
            rows={2}
            placeholder="#megahair #cabelo #salaodebeleza"
            className="w-full text-sm border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Quando publicar</label>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setScheduleMode('now')}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition ${scheduleMode === 'now' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              <Send className="w-4 h-4" /> Publicar agora
            </button>
            <button
              onClick={() => setScheduleMode('later')}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition ${scheduleMode === 'later' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              <Clock className="w-4 h-4" /> Agendar
            </button>
          </div>
          {scheduleMode === 'later' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              min={toDatetimeLocal(new Date().toISOString())}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          )}
        </div>

        {mediaType === 'VIDEO' && (
          <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Vídeo é processado pelo Instagram antes de publicar — pode levar de alguns segundos a alguns minutos. O card fica como "Processando" até publicar sozinho.
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          <button
            onClick={submit}
            disabled={uploading}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
          >
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Subindo...</> : <><Upload className="w-4 h-4" /> Subir</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function PostCard({ post, onChanged, onError }) {
  const [busy, setBusy] = useState(false)
  const status = STATUS_LABEL[post.status] || STATUS_LABEL.scheduled
  const StatusIcon = status.icon
  const editable = post.status === 'scheduled' || post.status === 'failed'

  const publishNow = async () => {
    onError('')
    setBusy(true)
    try {
      const res = await fetch(`${API}/ig-posts/${post.id}/publish-now`, { method: 'POST' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao publicar') }
      onChanged()
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Excluir este post?')) return
    onError('')
    try {
      const res = await fetch(`${API}/ig-posts/${post.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao excluir') }
      onChanged()
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {post.mediaType === 'VIDEO' ? (
        <video src={post.publicUrl} controls className="w-full h-44 bg-slate-900 object-contain" />
      ) : (
        <img src={post.publicUrl} alt="post" className="w-full h-44 object-cover bg-slate-100" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${status.className}`}>
            <StatusIcon className={`w-3 h-3 ${post.status === 'processing' ? 'animate-spin' : ''}`} /> {status.label}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {editable && (
              <button onClick={publishNow} disabled={busy} className="p-1 text-slate-400 hover:text-violet-600 disabled:opacity-50" title={post.status === 'failed' ? 'Tentar de novo' : 'Publicar agora'}>
                {post.status === 'failed' ? <RefreshCw className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            )}
            <button onClick={remove} className="p-1 text-slate-400 hover:text-red-600" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <p className="text-xs text-slate-500 line-clamp-3 whitespace-pre-line">{post.caption || 'Sem legenda'}</p>
        {post.scheduledAt && post.status === 'scheduled' && (
          <p className="text-xs text-amber-600 mt-2">Agendado pra {new Date(post.scheduledAt).toLocaleString('pt-BR')}</p>
        )}
        {post.status === 'failed' && post.errorMessage && (
          <p className="text-xs text-red-500 mt-2">{post.errorMessage}</p>
        )}
        {post.status === 'published' && post.publishedAt && (
          <p className="text-xs text-emerald-600 mt-2">Publicado em {new Date(post.publishedAt).toLocaleString('pt-BR')}</p>
        )}
      </div>
    </div>
  )
}
