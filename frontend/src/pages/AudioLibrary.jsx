import { useState, useEffect } from 'react'
import { Music, Upload, Loader2, Trash2, Save, CheckCircle2, AlertCircle, Pencil, X, Zap } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const KINDS = [
  { value: 'music', label: 'Música', hint: 'Trilha de fundo da edição' },
  { value: 'sfx', label: 'Efeito', hint: 'Som de corte/transição' },
]

const fmtDuration = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return null
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Mede a duração no navegador antes de subir — o backend não tem ffprobe
// (nem pode ter, ver o plano), então o único jeito barato de saber o tamanho
// da trilha é o próprio elemento <audio>.
const readDuration = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file)
  const el = new Audio()
  el.preload = 'metadata'
  const done = (value) => { URL.revokeObjectURL(url); resolve(value) }
  el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
  el.onerror = () => done(null)
  el.src = url
})

export default function AudioLibrary() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  const load = () => {
    setLoading(true)
    fetch(`${API}/video-edit/audio`)
      .then(r => r.json())
      .then(d => setAssets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const musics = assets.filter(a => a.kind !== 'sfx')
  const sfx = assets.filter(a => a.kind === 'sfx')

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Biblioteca de Áudio</h2>
          <p className="text-sm text-slate-400 mt-0.5">Trilhas e efeitos usados nas edições de vídeo. Suba uma vez, use em qualquer edição.</p>
        </div>
        {!uploadOpen && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Upload className="w-4 h-4" /> Subir áudio
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
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando áudios...
        </div>
      ) : assets.length === 0 && !uploadOpen ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Music className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhum áudio ainda</p>
          <p className="text-slate-400 text-sm mt-1">Suba uma trilha de fundo ou um efeito de corte pra começar</p>
        </div>
      ) : (
        <div className="space-y-8">
          <Section title="Músicas" empty="Nenhuma trilha ainda" items={musics} onChanged={load} onError={setError} />
          <Section title="Efeitos" empty="Nenhum efeito ainda" items={sfx} onChanged={load} onError={setError} />
        </div>
      )}
    </div>
  )
}

function Section({ title, empty, items, onChanged, onError }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(a => <AudioCard key={a.id} asset={a} onChanged={onChanged} onError={onError} />)}
        </div>
      )}
    </div>
  )
}

function UploadForm({ onCancel, onDone, onError }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('music')
  const [uploading, setUploading] = useState(false)

  const pickFile = (f) => {
    setFile(f)
    // Sugere o nome do arquivo (sem extensão) pra não obrigar a digitar.
    if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  const submit = async () => {
    onError('')
    if (!file) { onError('Selecione um arquivo de áudio'); return }
    if (!name.trim()) { onError('Dê um nome pro áudio'); return }
    setUploading(true)
    try {
      const durationSec = await readDuration(file)
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', name.trim())
      fd.append('kind', kind)
      if (durationSec) fd.append('durationSec', String(durationSec))
      const res = await fetch(`${API}/video-edit/audio`, { method: 'POST', body: fd })
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
        <p className="font-semibold text-slate-800 text-sm">Novo áudio</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Arquivo (MP3, WAV, M4A, AAC, OGG ou FLAC — máx 20MB)</label>
          <input
            type="file"
            accept="audio/*"
            onChange={e => pickFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo</label>
          <div className="flex gap-2">
            {KINDS.map(k => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={`flex-1 text-left border rounded-lg px-3 py-2 transition ${
                  kind === k.value
                    ? 'border-violet-400 bg-violet-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="block text-sm font-medium text-slate-800">{k.label}</span>
                <span className="block text-xs text-slate-400 mt-0.5">{k.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Trilha tensa minimal / Whoosh corte 01"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
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

function AudioCard({ asset, onChanged, onError }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(asset.name)
  const [kind, setKind] = useState(asset.kind || 'music')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isSfx = asset.kind === 'sfx'
  const duration = fmtDuration(asset.durationSec)

  const save = async () => {
    onError('')
    setSaving(true)
    try {
      const res = await fetch(`${API}/video-edit/audio/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind }),
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
    if (!confirm(`Excluir o áudio "${asset.name}"?`)) return
    onError('')
    try {
      const res = await fetch(`${API}/video-edit/audio/${asset.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao excluir') }
      onChanged()
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      {editing ? (
        <div className="space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <div className="flex gap-2">
            {KINDS.map(k => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={`flex-1 text-xs font-medium rounded-lg px-2 py-1.5 border transition ${
                  kind === k.value ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setEditing(false); setName(asset.name); setKind(asset.kind || 'music') }} className="text-xs text-slate-500 px-2 py-1">Cancelar</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{asset.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  isSfx ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'
                }`}>
                  {isSfx ? <Zap className="w-2.5 h-2.5" /> : <Music className="w-2.5 h-2.5" />}
                  {isSfx ? 'Efeito' : 'Música'}
                </span>
                {duration && <span className="text-xs text-slate-400">{duration}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {saved && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              <button onClick={() => setEditing(true)} className="p-1 text-slate-400 hover:text-violet-600" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={remove} className="p-1 text-slate-400 hover:text-red-600" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <audio src={asset.publicUrl} controls preload="metadata" className="w-full h-8" />
        </>
      )}
    </div>
  )
}
