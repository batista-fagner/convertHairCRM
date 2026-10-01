import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  UserPlus, PhoneCall, Snowflake, CalendarClock, XCircle, Trophy,
  Phone, Mail, Globe, Loader2, X, Plus, Check, Pencil, Trash2, Upload,
  StickyNote, Building2, MapPin, Layers, Link2, FileText, Sparkles,
  ChevronLeft, ChevronRight,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

// Script de ligação (pesquisa de mercado B2B) — doc editável, ajustado direto ali sem precisar de deploy.
const SCRIPT_URL = 'https://claude.ai/artifact/26FCQfziRLHkEm7WMW5ZnQ'
// Cola visual (cheat sheet colorido, em ordem de fala) — mesmo conteúdo do script, editável direto na página.
const COLA_URL = 'https://claude.ai/artifact/LvD5bxXBN68DT8BApMLSUR'

// Ícone bonito pras 6 raias originais (seedadas no banco na migração) —
// qualquer raia criada depois cai no ícone genérico (Layers).
const DEFAULT_STAGE_ICONS = {
  'novo': UserPlus,
  'tentando-contato': PhoneCall,
  'sem-resposta': Snowflake,
  'agendado': CalendarClock,
  'nao-interessado': XCircle,
  'fechado': Trophy,
}

const COLUMN_STYLES = {
  slate:   'bg-slate-50 border-slate-200',
  indigo:  'bg-indigo-50/60 border-indigo-200',
  cyan:    'bg-cyan-50/60 border-cyan-200',
  amber:   'bg-amber-50/60 border-amber-200',
  red:     'bg-red-50/60 border-red-200',
  emerald: 'bg-emerald-50/60 border-emerald-200',
  fuchsia: 'bg-fuchsia-50/60 border-fuchsia-200',
  lime:    'bg-lime-50/60 border-lime-200',
  teal:    'bg-teal-50/60 border-teal-200',
  violet:  'bg-violet-50/60 border-violet-200',
}

// Ciclo de cores por posição no board — todas as raias passam por aqui
// (não existe mais distinção fixa/custom), então a cor acompanha a ordem,
// não a origem da raia.
const STAGE_COLOR_CYCLE = ['slate', 'indigo', 'cyan', 'amber', 'red', 'emerald', 'fuchsia', 'lime', 'teal', 'violet']
const STAGE_DOT = {
  slate: 'bg-slate-400', indigo: 'bg-indigo-400', cyan: 'bg-cyan-400', amber: 'bg-amber-400',
  red: 'bg-red-400', emerald: 'bg-emerald-500', fuchsia: 'bg-fuchsia-400', lime: 'bg-lime-500',
  teal: 'bg-teal-400', violet: 'bg-violet-400',
}

// Todas as raias do board vêm daqui — as 6 originais e as criadas depois,
// sem distinção (todas editáveis/excluíveis/reordenáveis).
function useStages() {
  const [stages, setStages] = useState([])
  const load = useCallback(() => fetch(`${API}/coldcall/stages`).then((r) => r.json()).then((d) => setStages(Array.isArray(d) ? d : [])).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  return { stages, reload: load, setStages }
}

function formatDateTime(value) {
  if (!value) return null
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isOverdue(value) {
  if (!value) return false
  return new Date(value).getTime() < Date.now()
}

function toDatetimeLocalValue(value) {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ProspectCard({ prospect, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: prospect.id })
  const stop = (e) => e.stopPropagation()

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md cursor-pointer select-none transition ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-slate-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800 text-sm truncate">{prospect.companyName}</p>
          {(prospect.city || prospect.state) && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5 truncate">
              <MapPin className="w-3 h-3 shrink-0" /> {[prospect.city, prospect.state].filter(Boolean).join(' - ')}
            </p>
          )}
        </div>
      </div>

      {prospect.phone && (
        <a
          href={`tel:${prospect.phone}`}
          onClick={stop}
          onPointerDown={stop}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2 py-1.5 transition w-fit"
        >
          <Phone className="w-3.5 h-3.5" /> {prospect.phone}
        </a>
      )}

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {prospect.assignedTo && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
            👤 {prospect.assignedTo}
          </span>
        )}
        {prospect.nextContactAt && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1 ${
              isOverdue(prospect.nextContactAt) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            <CalendarClock className="w-3 h-3" /> {formatDateTime(prospect.nextContactAt)}
          </span>
        )}
        {prospect.notes && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium flex items-center gap-1">
            <StickyNote className="w-3 h-3" /> Nota
          </span>
        )}
      </div>
    </div>
  )
}

function Column({ column, prospects, onOpen, isFirst, isLast, onRenameStage, onDeleteStage, onMoveStage }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const Icon = column.icon
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(column.title)

  const startRename = () => { setTitleDraft(column.title); setRenaming(true) }
  const submitRename = () => {
    const trimmed = titleDraft.trim()
    setRenaming(false)
    if (trimmed && trimmed !== column.title) onRenameStage(column, trimmed)
  }

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between px-2 mb-2 gap-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${column.dot}`} />
          {renaming ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false) }}
              onBlur={submitRename}
              maxLength={40}
              className="min-w-0 flex-1 text-sm font-semibold text-slate-700 border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          ) : (
            <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5 min-w-0">
              <Icon className="w-4 h-4 text-slate-400 shrink-0" /> <span className="truncate">{column.title}</span>
            </h3>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!renaming && (
            <>
              <button
                onClick={() => onMoveStage(column, 'left')}
                disabled={isFirst}
                title="Mover raia pra esquerda"
                className="p-1 text-slate-300 hover:text-violet-500 disabled:opacity-0 disabled:pointer-events-none transition"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onMoveStage(column, 'right')}
                disabled={isLast}
                title="Mover raia pra direita"
                className="p-1 text-slate-300 hover:text-violet-500 disabled:opacity-0 disabled:pointer-events-none transition"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button onClick={startRename} title="Renomear raia" className="p-1 text-slate-300 hover:text-violet-500 transition">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDeleteStage(column)} title="Excluir raia" className="p-1 text-slate-300 hover:text-red-500 transition">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{prospects.length}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-xl border border-dashed p-2 space-y-2 min-h-[120px] overflow-y-auto transition ${COLUMN_STYLES[column.accent]} ${
          isOver ? 'ring-2 ring-violet-300' : ''
        }`}
      >
        {prospects.map((p) => <ProspectCard key={p.id} prospect={p} onOpen={() => onOpen(p)} />)}
        {prospects.length === 0 && <p className="text-[11px] text-slate-400 text-center py-6">Vazio</p>}
      </div>
    </div>
  )
}

function NewStageColumn({ onCreate }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const trimmed = title.trim()
    if (!trimmed) { setOpen(false); return }
    setSaving(true)
    setError('')
    try {
      await onCreate(trimmed)
      setTitle('')
      setOpen(false)
    } catch (e) {
      setError(e.message || 'Erro ao criar raia')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-72 shrink-0 h-11 self-start px-3 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-violet-300 hover:text-violet-500 transition text-sm font-medium"
      >
        <Plus className="w-4 h-4" /> Nova raia
      </button>
    )
  }

  return (
    <div className="flex flex-col w-72 shrink-0 gap-2 bg-white rounded-xl border border-slate-200 p-3 h-fit">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        placeholder="Nome da raia"
        maxLength={40}
        className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
      />
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Criar
        </button>
        <button onClick={() => setOpen(false)} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1.5">Cancelar</button>
      </div>
    </div>
  )
}

function ProspectModal({ prospect, onClose, onSave, onDelete }) {
  if (!prospect) return null
  const [assignedTo, setAssignedTo] = useState(prospect.assignedTo || '')
  const [nextContactAt, setNextContactAt] = useState(toDatetimeLocalValue(prospect.nextContactAt))
  const [notes, setNotes] = useState(prospect.notes || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave(prospect.id, {
        assignedTo: assignedTo.trim() || null,
        nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null,
        notes: notes.trim() || null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 truncate">{prospect.companyName}</h3>
            {(prospect.city || prospect.state) && (
              <p className="text-xs text-slate-500">{[prospect.city, prospect.state].filter(Boolean).join(' - ')}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Dados do lote (CSV) — sempre visíveis, com rótulo, mesmo quando
              vazios ("Não informado") pra deixar claro que é o CSV que não
              tinha o dado, e não uma falha da tela. */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Dados do lote (CSV)</p>

            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-slate-400 shrink-0" />
              {prospect.phone ? (
                <a href={`tel:${prospect.phone}`} className="font-medium text-emerald-700 hover:underline">{prospect.phone}</a>
              ) : <span className="text-slate-400 italic">Telefone não informado</span>}
            </div>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <Mail className="w-4 h-4 text-slate-400 shrink-0" />
              {prospect.email ? (
                <a href={`mailto:${prospect.email}`} className="font-medium text-blue-700 hover:underline truncate">{prospect.email}</a>
              ) : <span className="text-slate-400 italic">E-mail não informado</span>}
            </div>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <Globe className="w-4 h-4 text-slate-400 shrink-0" />
              {prospect.website ? (
                <a
                  href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-slate-700 hover:underline truncate"
                >
                  {prospect.website}
                </a>
              ) : <span className="text-slate-400 italic">Site não informado</span>}
            </div>

            {prospect.sourceUrl && (
              <div className="flex items-center gap-2 text-sm min-w-0">
                <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
                <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-slate-500 hover:underline truncate">
                  Fonte: {prospect.sourceUrl}
                </a>
              </div>
            )}

            {prospect.b2bEvidence && (
              <div className="flex items-start gap-2 text-xs text-slate-500 pt-1 border-t border-slate-200 mt-1">
                <span className="font-semibold shrink-0">Evidência B2B:</span>
                <span className="italic">{prospect.b2bEvidence}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Responsável</label>
            <input
              type="text"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Quem vai ligar..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Próximo contato</label>
            <input
              type="datetime-local"
              value={nextContactAt}
              onChange={(e) => setNextContactAt(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Anotações da ligação..."
              className="w-full resize-none text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100">
          <button
            onClick={() => { onDelete(prospect.id); onClose() }}
            className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition"
          >
            <Trash2 className="w-3.5 h-3.5" /> Excluir
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ColdCall() {
  const { stages, reload: reloadStages, setStages } = useStages()
  const [board, setBoard] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)
  const boardRef = useRef(board)
  boardRef.current = board

  // stages já vem ordenado por position (backend) — todas editáveis/excluíveis/reordenáveis.
  const columns = useMemo(() => stages.map((s, i) => ({
    id: s.stageKey,
    dbId: s.id,
    title: s.title,
    icon: DEFAULT_STAGE_ICONS[s.stageKey] || Layers,
    accent: STAGE_COLOR_CYCLE[i % STAGE_COLOR_CYCLE.length],
    dot: STAGE_DOT[STAGE_COLOR_CYCLE[i % STAGE_COLOR_CYCLE.length]],
  })), [stages])
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const loadBoard = useCallback(() => {
    return fetch(`${API}/coldcall/kanban`)
      .then((r) => r.json())
      .then((d) => setBoard(d && typeof d === 'object' && !Array.isArray(d) ? d : {}))
      .catch(() => {})
  }, [])

  useEffect(() => { loadBoard().finally(() => setLoading(false)) }, [loadBoard])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragStart = (event) => setActiveId(event.active.id)
  const handleDragEnd = (event) => {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const prospectId = active.id
    const target = over.id
    let current = null
    let prospect = null
    for (const col of columnsRef.current) {
      const found = (boardRef.current[col.id] || []).find((p) => p.id === prospectId)
      if (found) { current = col.id; prospect = found; break }
    }
    if (!prospect || current === target) return

    setBoard((prev) => {
      const next = { ...prev }
      next[current] = (prev[current] || []).filter((p) => p.id !== prospectId)
      next[target] = [{ ...prospect, kanbanStage: target }, ...(prev[target] || [])]
      return next
    })

    fetch(`${API}/coldcall/${prospectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanbanStage: target }),
    }).catch((e) => console.error('Erro ao mover prospect', e))
  }

  const findProspect = (id) => {
    for (const stage of Object.keys(board)) {
      const found = (board[stage] || []).find((p) => p.id === id)
      if (found) return found
    }
    return null
  }
  const activeProspect = activeId ? findProspect(activeId) : null

  const saveProspect = async (id, patch) => {
    const res = await fetch(`${API}/coldcall/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const fresh = await res.json()
    setBoard((prev) => {
      const next = { ...prev }
      const stage = fresh.kanbanStage || 'novo'
      if (next[stage]) next[stage] = next[stage].map((p) => (p.id === id ? fresh : p))
      return next
    })
  }

  const deleteProspect = async (id) => {
    setBoard((prev) => {
      const next = {}
      for (const stage of Object.keys(prev)) next[stage] = prev[stage].filter((p) => p.id !== id)
      return next
    })
    await fetch(`${API}/coldcall/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const createStage = useCallback(async (title) => {
    const res = await fetch(`${API}/coldcall/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Erro ao criar raia')
    const stage = await res.json()
    setStages((prev) => [...prev, stage])
    setBoard((prev) => ({ ...prev, [stage.stageKey]: [] }))
  }, [setStages])

  const renameStage = useCallback(async (column, title) => {
    setStages((prev) => prev.map((s) => (s.id === column.dbId ? { ...s, title } : s)))
    await fetch(`${API}/coldcall/stages/${column.dbId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => reloadStages())
  }, [setStages, reloadStages])

  const deleteStage = useCallback(async (column) => {
    const res = await fetch(`${API}/coldcall/stages/${column.dbId}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      alert(err?.message || 'Não foi possível excluir essa raia')
      return
    }
    setStages((prev) => prev.filter((s) => s.id !== column.dbId))
  }, [setStages])

  const moveStage = useCallback(async (column, direction) => {
    const res = await fetch(`${API}/coldcall/stages/${column.dbId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    })
    if (!res.ok) { reloadStages(); return }
    const updated = await res.json()
    setStages(Array.isArray(updated) ? updated : [])
  }, [setStages, reloadStages])

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API}/coldcall/import`, { method: 'POST', body: formData })
      const result = await res.json()
      setImportResult(result)
      await loadBoard()
    } catch (e) {
      setImportResult({ error: true })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Cold Call</h2>
          <p className="text-sm text-slate-500">Prospecção B2B — importe uma lista e organize as ligações por raia.</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={SCRIPT_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3.5 py-2 rounded-lg transition"
          >
            <FileText className="w-4 h-4" /> Script da ligação
          </a>
          <a
            href={COLA_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3.5 py-2 rounded-lg transition"
          >
            <Sparkles className="w-4 h-4" /> Cola da ligação
          </a>
          {importResult && !importResult.error && (
            <span className="text-xs text-emerald-600 font-medium">
              {importResult.imported} importado(s), {importResult.skipped} ignorado(s) (duplicado/sem nome)
            </span>
          )}
          {importResult?.error && <span className="text-xs text-red-600 font-medium">Erro ao importar CSV</span>}
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3.5 py-2 rounded-lg transition"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Importar CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 flex-1 overflow-x-auto pb-2">
            {columns.map((col, i) => (
              <Column
                key={col.id}
                column={col}
                prospects={board[col.id] || []}
                onOpen={setSelected}
                isFirst={i === 0}
                isLast={i === columns.length - 1}
                onRenameStage={renameStage}
                onDeleteStage={deleteStage}
                onMoveStage={moveStage}
              />
            ))}
            <NewStageColumn onCreate={createStage} />
          </div>
          <DragOverlay dropAnimation={null}>
            {activeProspect ? <ProspectCard prospect={activeProspect} onOpen={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <ProspectModal
        key={selected?.id}
        prospect={selected}
        onClose={() => setSelected(null)}
        onSave={saveProspect}
        onDelete={deleteProspect}
      />
    </div>
  )
}
