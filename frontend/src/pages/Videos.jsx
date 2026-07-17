import { useState, useEffect, useRef } from 'react'
import { Video, Upload, Loader2, Trash2, Save, CheckCircle2, AlertCircle, Pencil, X } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

export default function Videos() {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  const load = () => {
    setLoading(true)
    fetch(`${API}/followup/videos`)
      .then(r => r.json())
      .then(d => setVideos(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Vídeos de Follow-up</h2>
          <p className="text-sm text-slate-400 mt-0.5">Suba vídeos pra anexar nas regras de follow-up. Só MP4, até 50MB.</p>
        </div>
        {!uploadOpen && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Upload className="w-4 h-4" /> Subir vídeo
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
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando vídeos...
        </div>
      ) : videos.length === 0 && !uploadOpen ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Video className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhum vídeo ainda</p>
          <p className="text-slate-400 text-sm mt-1">Suba o primeiro pra usar nas regras de follow-up</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map(v => (
            <VideoCard key={v.id} video={v} onChanged={load} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function UploadForm({ onCancel, onDone, onError }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const submit = async () => {
    onError('')
    if (!file) { onError('Selecione um vídeo MP4'); return }
    if (!name.trim()) { onError('Dê um nome pro vídeo'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', name.trim())
      fd.append('caption', caption)
      const res = await fetch(`${API}/followup/videos`, { method: 'POST', body: fd })
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
        <p className="font-semibold text-slate-800 text-sm">Novo vídeo</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Arquivo (MP4, máx 50MB)</label>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Vídeo institucional / Depoimento cliente"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Legenda padrão (opcional)</label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={3}
            placeholder="Legenda que vai junto do vídeo (a regra pode sobrescrever)"
            className="w-full text-sm border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
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

function VideoCard({ video, onChanged, onError }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(video.name)
  const [caption, setCaption] = useState(video.caption || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    onError('')
    setSaving(true)
    try {
      const res = await fetch(`${API}/followup/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, caption }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao salvar') }
      setSaved(true); setEditing(false)
      setTimeout(() => setSaved(false), 2500)
      onChanged()
    } catch (e) {
      onError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Excluir o vídeo "${video.name}"?`)) return
    onError('')
    try {
      const res = await fetch(`${API}/followup/videos/${video.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao excluir') }
      onChanged()
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <video src={video.publicUrl} controls className="w-full h-44 bg-slate-900 object-contain" />
      <div className="p-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={3}
              placeholder="Legenda padrão"
              className="w-full text-xs border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setEditing(false); setName(video.name); setCaption(video.caption || '') }} className="text-xs text-slate-500 px-2 py-1">Cancelar</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-sm font-medium text-slate-800 truncate">{video.name}</p>
              <div className="flex items-center gap-1 flex-shrink-0">
                {saved && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                <button onClick={() => setEditing(true)} className="p-1 text-slate-400 hover:text-violet-600" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={remove} className="p-1 text-slate-400 hover:text-red-600" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">{video.caption || 'Sem legenda padrão'}</p>
          </>
        )}
      </div>
    </div>
  )
}
