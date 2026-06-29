import { useState, useEffect, useRef, useCallback } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { io } from 'socket.io-client'
import { Flame, Snowflake, UserPlus, XCircle, Phone, Mail, UserCheck, Loader2, X, MessageCircle, PauseCircle, Bot, MoreVertical, Pencil, Trash2, Play, Eye, Handshake, Trophy, HeadphonesIcon } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'

const COLUMNS = [
  { id: 'novo',            title: 'Novo Lead',       icon: UserPlus,        accent: 'slate',   dot: 'bg-slate-400' },
  { id: 'atendimento',     title: 'Atendimento',     icon: HeadphonesIcon,  accent: 'indigo',  dot: 'bg-indigo-400' },
  { id: 'nao-qualificado', title: 'Não qualificado', icon: Snowflake,       accent: 'cyan',    dot: 'bg-cyan-400' },
  { id: 'qualificado',     title: 'Qualificado',     icon: Flame,           accent: 'rose',    dot: 'bg-rose-500' },
  { id: 'contactado',      title: 'Contactado',      icon: Phone,           accent: 'teal',    dot: 'bg-teal-400' },
  { id: 'ja-fez-prompt',   title: 'Já fez prompt',   icon: Play,            accent: 'violet',  dot: 'bg-violet-400' },
  { id: 'ja-apresentado',  title: 'Já apresentado',  icon: Eye,             accent: 'blue',    dot: 'bg-blue-400' },
  { id: 'em-negociacao',   title: 'Em negociação',   icon: Handshake,       accent: 'amber',   dot: 'bg-amber-400' },
  { id: 'vendeu',          title: 'Vendeu',           icon: Trophy,          accent: 'emerald', dot: 'bg-emerald-500' },
  { id: 'perdido',         title: 'Lead perdido',    icon: XCircle,         accent: 'red',     dot: 'bg-red-400' },
]

const COLUMN_STYLES = {
  slate:   'bg-slate-50 border-slate-200',
  indigo:  'bg-indigo-50/60 border-indigo-200',
  cyan:    'bg-cyan-50/60 border-cyan-200',
  rose:    'bg-rose-50/60 border-rose-200',
  violet:  'bg-violet-50/60 border-violet-200',
  blue:    'bg-blue-50/60 border-blue-200',
  amber:   'bg-amber-50/60 border-amber-200',
  teal:    'bg-teal-50/60 border-teal-200',
  emerald: 'bg-emerald-50/60 border-emerald-200',
  red:     'bg-red-50/60 border-red-200',
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500',
  'bg-blue-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500',
]

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function timeAgo(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days}d`
}

function formatPhone(phone) {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

function lastMessage(lead) {
  const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : []
  for (let i = ctx.length - 1; i >= 0; i--) {
    if (ctx[i]?.content) return ctx[i].content
  }
  return null
}

const TEMP_BADGE = {
  quente: { label: '🔥 Quente', className: 'bg-rose-100 text-rose-700' },
  morno:  { label: '🌤 Morno',  className: 'bg-amber-100 text-amber-700' },
  frio:   { label: '❄️ Frio',   className: 'bg-cyan-100 text-cyan-700' },
}

// Visual puro do card (reusado no card e no DragOverlay)
function CardContent({ lead, overlay = false }) {
  const msg = lastMessage(lead)
  const temp = TEMP_BADGE[lead.temperature]
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-3 select-none ${
        overlay ? 'shadow-xl rotate-2 cursor-grabbing' : 'shadow-sm hover:shadow-md'
      } ${lead._handoff ? 'ring-2 ring-rose-400' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-full ${getAvatarColor(lead.name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
          {getInitials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="font-semibold text-slate-800 text-sm truncate">{lead.name}</p>
            <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(lead.waLastMessageAt || lead.updatedAt)}</span>
          </div>
          {formatPhone(lead.phone) && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
              <Phone className="w-3 h-3" /> {formatPhone(lead.phone)}
            </p>
          )}
          {lead.email && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
              <Mail className="w-3 h-3 shrink-0" /> {lead.email}
            </p>
          )}
        </div>
      </div>

      {msg && <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 italic">"{msg}"</p>}

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {lead.isMql && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🎯 MQL</span>}
        {temp && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${temp.className}`}>{temp.label}</span>}
        {lead._handoff && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-600 text-white font-medium flex items-center gap-0.5">
            <UserCheck className="w-3 h-3" /> Passar pro closer
          </span>
        )}
      </div>
    </div>
  )
}

function LeadCard({ lead, onOpen, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  const [menu, setMenu] = useState(false)
  const msg = lastMessage(lead)
  const temp = TEMP_BADGE[lead.temperature]
  const stop = (e) => { e.stopPropagation() }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md cursor-pointer select-none transition ${isDragging ? 'opacity-30' : ''} ${lead._handoff ? 'ring-2 ring-rose-400' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-full ${getAvatarColor(lead.name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
          {getInitials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="font-semibold text-slate-800 text-sm truncate flex-1">{lead.name}</p>
            <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(lead.waLastMessageAt || lead.updatedAt)}</span>
            {/* Menu fixo ao lado do timestamp */}
            <div className="relative shrink-0" onPointerDown={stop} onClick={stop}>
              <button
                onClick={() => setMenu((v) => !v)}
                className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                title="Ações"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 mt-1 w-36 bg-white rounded-lg border border-slate-200 shadow-lg py-1 z-20">
                    <button
                      onClick={() => { setMenu(false); onEdit(lead) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Editar nome
                    </button>
                    <button
                      onClick={() => { setMenu(false); onDelete(lead) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Excluir
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {formatPhone(lead.phone) && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
              <Phone className="w-3 h-3" /> {formatPhone(lead.phone)}
            </p>
          )}
          {lead.email && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
              <Mail className="w-3 h-3 shrink-0" /> {lead.email}
            </p>
          )}
        </div>
      </div>

      {msg && <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 italic">"{msg}"</p>}

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {lead.isMql && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🎯 MQL</span>}
        {temp && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${temp.className}`}>{temp.label}</span>}
        {lead._handoff && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-600 text-white font-medium flex items-center gap-0.5">
            <UserCheck className="w-3 h-3" /> Passar pro closer
          </span>
        )}
      </div>
    </div>
  )
}

function Column({ column, leads, onOpen, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const Icon = column.icon
  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between px-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${column.dot}`} />
          <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
            <Icon className="w-4 h-4 text-slate-400" /> {column.title}
          </h3>
        </div>
        <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{leads.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-xl border border-dashed p-2 space-y-2 min-h-[120px] overflow-y-auto transition ${COLUMN_STYLES[column.accent]} ${
          isOver ? 'ring-2 ring-violet-300' : ''
        }`}
      >
        {leads.map((lead) => <LeadCard key={lead.id} lead={lead} onOpen={() => onOpen(lead)} onEdit={onEdit} onDelete={onDelete} />)}
        {leads.length === 0 && (
          <p className="text-[11px] text-slate-400 text-center py-6">Sem leads</p>
        )}
      </div>
    </div>
  )
}

function ConversationModal({ lead, onClose, onTogglePause }) {
  if (!lead) return null
  const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : []
  const paused = !!lead.aiPaused
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-3xl h-[88vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
          <div className={`w-11 h-11 rounded-full ${getAvatarColor(lead.name)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
            {getInitials(lead.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800 truncate text-[15px]">{lead.name}</p>
            <p className="text-xs text-slate-500">{formatPhone(lead.phone)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {lead.isMql && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🎯 MQL</span>}
            {TEMP_BADGE[lead.temperature] && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TEMP_BADGE[lead.temperature].className}`}>
                {TEMP_BADGE[lead.temperature].label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition ml-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de controles (crescerá com mais ações no futuro) */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 text-sm">
            {paused ? (
              <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                <PauseCircle className="w-4 h-4" /> IA pausada — você assume a conversa
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <Bot className="w-4 h-4" /> IA respondendo automaticamente
              </span>
            )}
          </div>
          <button
            onClick={() => onTogglePause(lead)}
            className="flex items-center gap-2 text-xs font-medium text-slate-600"
            title={paused ? 'Reativar IA' : 'Pausar IA'}
          >
            <span>{paused ? 'Pausada' : 'Ativa'}</span>
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${paused ? 'bg-slate-300' : 'bg-emerald-500'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${paused ? 'translate-x-0.5' : 'translate-x-[22px]'}`} />
            </span>
          </button>
        </div>

        {/* Conversa */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
          {ctx.length === 0 && (
            <div className="flex flex-col items-center justify-center text-slate-400 py-16 gap-2">
              <MessageCircle className="w-9 h-9" />
              <p className="text-sm">Nenhuma mensagem ainda</p>
            </div>
          )}
          {ctx.map((m, i) => {
            const isLead = m.role === 'user'
            return (
              <div key={i} className={`flex ${isLead ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[70%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                    isLead
                      ? 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'
                      : 'bg-emerald-500 text-white rounded-tr-sm'
                  }`}
                >
                  {m.content}
                  <div className={`text-[9px] mt-0.5 ${isLead ? 'text-slate-400' : 'text-emerald-100'}`}>
                    {isLead ? lead.name.split(' ')[0] : 'SDR'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 text-center">
          <p className="text-[11px] text-slate-400">
            Estágio: <span className="font-medium text-slate-500">{lead.waStage || '—'}</span>
            {' · '}Última msg {timeAgo(lead.waLastMessageAt || lead.updatedAt)}
          </p>
        </div>
      </div>
    </div>
  )
}

function EditNameModal({ lead, onClose, onSave }) {
  const [name, setName] = useState(lead?.name || '')
  const [saving, setSaving] = useState(false)
  if (!lead) return null
  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    await onSave(lead, name.trim())
    setSaving(false)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">Editar nome</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full text-sm text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
          placeholder="Nome do lead"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({ lead, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false)
  if (!lead) return null
  const confirm = async () => {
    setDeleting(true)
    await onConfirm(lead)
    setDeleting(false)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-slate-800">Excluir lead</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Tem certeza que deseja excluir <span className="font-medium text-slate-700">{lead.name}</span>? Essa ação não pode ser desfeita.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          <button
            onClick={confirm}
            disabled={deleting}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-lg"
          >
            {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Excluir
          </button>
        </div>
      </div>
    </div>
  )
}

export default function KanbanLeads() {
  const [board, setBoard] = useState({ novo: [], atendimento: [], 'nao-qualificado': [], qualificado: [], contactado: [], 'ja-fez-prompt': [], 'ja-apresentado': [], 'em-negociacao': [], vendeu: [], perdido: [] })
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const boardRef = useRef(board)
  boardRef.current = board
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const lastDragEnd = useRef(0)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const findLead = useCallback((id) => {
    for (const col of COLUMNS) {
      const f = boardRef.current[col.id].find((l) => l.id === id)
      if (f) return f
    }
    return null
  }, [])

  // Remove o lead de todas as colunas e o insere no topo da coluna alvo
  const placeLead = useCallback((lead, handoff = false) => {
    setBoard((prev) => {
      const next = {}
      for (const col of COLUMNS) next[col.id] = prev[col.id].filter((l) => l.id !== lead.id)
      const target = lead.kanbanStage && next[lead.kanbanStage] ? lead.kanbanStage : 'novo'
      next[target] = [{ ...lead, _handoff: handoff }, ...next[target]]
      return next
    })
    // mantém o modal aberto em sincronia com updates em tempo real
    if (selectedRef.current?.id === lead.id) setSelected((s) => ({ ...s, ...lead }))
  }, [])

  // Atualiza um lead sem trocar de coluna (ex.: pausar IA)
  const updateLeadInPlace = useCallback((updated) => {
    setBoard((prev) => {
      const next = {}
      for (const col of COLUMNS) next[col.id] = prev[col.id].map((l) => (l.id === updated.id ? { ...l, ...updated } : l))
      return next
    })
    if (selectedRef.current?.id === updated.id) setSelected((s) => ({ ...s, ...updated }))
  }, [])

  const removeLead = useCallback((id) => {
    setBoard((prev) => {
      const next = {}
      for (const col of COLUMNS) next[col.id] = prev[col.id].filter((l) => l.id !== id)
      return next
    })
    if (selectedRef.current?.id === id) setSelected(null)
  }, [])

  const saveName = useCallback(async (lead, name) => {
    updateLeadInPlace({ id: lead.id, name }) // otimista
    try {
      const res = await fetch(`${API}/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const fresh = await res.json()
      updateLeadInPlace(fresh)
    } catch (e) {
      console.error('Erro ao salvar nome', e)
    }
  }, [updateLeadInPlace])

  const deleteLead = useCallback(async (lead) => {
    removeLead(lead.id) // otimista
    try {
      await fetch(`${API}/leads/${lead.id}`, { method: 'DELETE' })
    } catch (e) {
      console.error('Erro ao excluir lead', e)
    }
  }, [removeLead])

  const togglePause = useCallback(async (lead) => {
    const paused = !lead.aiPaused
    updateLeadInPlace({ id: lead.id, aiPaused: paused }) // otimista
    try {
      const res = await fetch(`${API}/leads/${lead.id}/ai-pause`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      })
      const fresh = await res.json()
      updateLeadInPlace(fresh)
    } catch (e) {
      console.error('Erro ao alternar pausa da IA', e)
      updateLeadInPlace({ id: lead.id, aiPaused: !paused }) // reverte
    }
  }, [updateLeadInPlace])

  useEffect(() => {
    let active = true
    fetch(`${API}/leads/kanban`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setBoard({
          novo: data.novo || [],
          atendimento: data.atendimento || [],
          'nao-qualificado': data['nao-qualificado'] || [],
          qualificado: data.qualificado || [],
          contactado: data.contactado || [],
          'ja-fez-prompt': data['ja-fez-prompt'] || [],
          'ja-apresentado': data['ja-apresentado'] || [],
          'em-negociacao': data['em-negociacao'] || [],
          vendeu: data.vendeu || [],
          perdido: data.perdido || [],
        })
      })
      .catch((e) => console.error('Erro ao carregar Kanban', e))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('lead:created', (lead) => placeLead(lead))
    socket.on('lead:updated', (lead) => placeLead(lead))
    socket.on('lead:handoff', (lead) => placeLead(lead, true))
    socket.on('lead:deleted', ({ id }) => removeLead(id))
    return () => socket.disconnect()
  }, [placeLead, removeLead])

  const handleDragStart = (event) => setActiveId(event.active.id)

  const handleDragEnd = (event) => {
    setActiveId(null)
    lastDragEnd.current = Date.now()
    const { active, over } = event
    if (!over) return
    const leadId = active.id
    const target = over.id
    let current = null
    let lead = null
    for (const col of COLUMNS) {
      const found = boardRef.current[col.id].find((l) => l.id === leadId)
      if (found) { current = col.id; lead = found; break }
    }
    if (!lead || current === target) return

    setBoard((prev) => {
      const next = { ...prev }
      next[current] = prev[current].filter((l) => l.id !== leadId)
      next[target] = [{ ...lead, kanbanStage: target, _handoff: false }, ...prev[target]]
      return next
    })

    fetch(`${API}/leads/${leadId}/kanban`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanbanStage: target }),
    }).catch((e) => console.error('Erro ao mover lead', e))
  }

  // Abre o modal só se não acabou de arrastar (evita abrir após soltar)
  const openLead = (lead) => {
    if (Date.now() - lastDragEnd.current < 200) return
    setSelected(lead)
  }

  const activeLead = activeId ? findLead(activeId) : null

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Kanban de Leads</h2>
          <p className="text-sm text-slate-500">O agente SDR move os cards automaticamente. Você também pode arrastar.</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <span className="text-slate-500">{connected ? 'Tempo real' : 'Offline'}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 flex-1 overflow-x-auto pb-2">
            {COLUMNS.map((col) => (
              <Column key={col.id} column={col} leads={board[col.id]} onOpen={openLead} onEdit={setEditing} onDelete={setDeleting} />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeLead ? <CardContent lead={activeLead} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <ConversationModal lead={selected} onClose={() => setSelected(null)} onTogglePause={togglePause} />
      <EditNameModal key={editing?.id} lead={editing} onClose={() => setEditing(null)} onSave={saveName} />
      <ConfirmDeleteModal lead={deleting} onClose={() => setDeleting(null)} onConfirm={deleteLead} />
    </div>
  )
}
