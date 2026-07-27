import { Search, PauseCircle, Camera, Loader2 } from 'lucide-react'
import { getInitials, getAvatarColor, timeAgo } from '../../../lib/format'

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Não lidas' },
  { key: 'ai_paused', label: 'IA pausada' },
]

function handleName(conv) {
  return conv.igUsername ? `@${conv.igUsername}` : `ig_${conv.senderIgId?.slice(-6) || '?'}`
}

function ConversationRow({ conv, active, onSelect }) {
  const name = handleName(conv)
  const hasUnread = conv.unreadCount > 0

  return (
    <button
      onClick={() => onSelect(conv)}
      className={`w-full text-left px-4 py-3 border-l-4 transition ${
        active
          ? 'border-fuchsia-500 bg-gradient-to-r from-fuchsia-50 to-transparent'
          : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}
        >
          {getInitials(name.replace('@', ''))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate ${hasUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
              {name}
            </p>
            <span className="ml-auto text-[10px] text-slate-400 shrink-0">{timeAgo(conv.lastMessageAt)}</span>
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            <p className={`text-xs truncate flex-1 ${hasUnread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
              {conv.lastMessageDirection === 'outbound' && <span className="text-slate-300 mr-1">→</span>}
              {conv.lastMessagePreview || 'Sem mensagens ainda'}
            </p>

            {conv.aiPaused && <PauseCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" title="IA pausada" />}
            {hasUnread && (
              <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-fuchsia-500 text-white text-[10px] font-bold flex items-center justify-center">
                {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
}) {
  return (
    <aside className="w-80 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="p-3 border-b border-slate-100 space-y-2.5">
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar @usuário"
            className="bg-transparent text-sm text-slate-600 placeholder-slate-400 outline-none w-full"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                filter === f.key ? 'bg-fuchsia-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {loading && (
          <div className="p-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-200 rounded w-2/3" />
                  <div className="h-2.5 bg-slate-100 rounded w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center text-slate-400 py-16 gap-2 px-6 text-center">
            <Camera className="w-9 h-9" />
            <p className="text-sm font-medium">Nenhuma conversa</p>
            <p className="text-xs">
              {search || filter !== 'all'
                ? 'Tente outra busca ou filtro.'
                : 'DMs do Instagram vão aparecer aqui conforme chegarem.'}
            </p>
          </div>
        )}

        {!loading &&
          conversations.map((c) => (
            <ConversationRow key={c.id} conv={c} active={c.id === selectedId} onSelect={onSelect} />
          ))}

        {hasMore && !loading && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full py-3 text-xs font-semibold text-fuchsia-600 hover:bg-fuchsia-50 transition flex items-center justify-center gap-1.5"
          >
            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Carregar mais
          </button>
        )}
      </div>
    </aside>
  )
}
