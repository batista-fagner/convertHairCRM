import { Search, PauseCircle, BellOff, MessageSquare, Loader2 } from 'lucide-react'
import { getInitials, getAvatarColor, timeAgo, formatPhoneUS } from '../../../lib/format'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'ai_paused', label: 'AI paused' },
  { key: 'opted_out', label: 'Opted out' },
]

function ConversationRow({ contact, active, onSelect }) {
  const name = contact.name || formatPhoneUS(contact.phone)
  const hasUnread = contact.unreadCount > 0

  return (
    <button
      onClick={() => onSelect(contact)}
      className={`w-full text-left px-4 py-3 border-l-4 transition ${
        active
          ? 'border-sky-500 bg-gradient-to-r from-sky-50 to-transparent'
          : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}
        >
          {getInitials(name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate ${hasUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
              {name}
            </p>
            <span className="ml-auto text-[10px] text-slate-400 shrink-0">
              {timeAgo(contact.lastMessageAt)}
            </span>
          </div>

          <p className="text-[11px] text-slate-400 truncate">{formatPhoneUS(contact.phone)}</p>

          <div className="flex items-center gap-1.5 mt-0.5">
            <p className={`text-xs truncate flex-1 ${hasUnread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
              {contact.lastMessageDirection === 'outbound' && (
                <span className="text-slate-300 mr-1">→</span>
              )}
              {contact.lastMessagePreview || 'No messages yet'}
            </p>

            {contact.optedOut && <BellOff className="w-3.5 h-3.5 text-slate-400 shrink-0" title="Opted out" />}
            {!contact.optedOut && contact.aiPaused && (
              <PauseCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" title="AI paused" />
            )}
            {hasUnread && (
              <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-sky-500 text-white text-[10px] font-bold flex items-center justify-center">
                {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
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
            placeholder="Search name or number"
            className="bg-transparent text-sm text-slate-600 placeholder-slate-400 outline-none w-full"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                filter === f.key
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
            <MessageSquare className="w-9 h-9" />
            <p className="text-sm font-medium">No conversations</p>
            <p className="text-xs">
              {search || filter !== 'all'
                ? 'Try a different search or filter.'
                : 'Messages will show up here as they come in.'}
            </p>
          </div>
        )}

        {!loading &&
          conversations.map((c) => (
            <ConversationRow key={c.id} contact={c} active={c.id === selectedId} onSelect={onSelect} />
          ))}

        {hasMore && !loading && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full py-3 text-xs font-semibold text-sky-600 hover:bg-sky-50 transition flex items-center justify-center gap-1.5"
          >
            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Load more
          </button>
        )}
      </div>
    </aside>
  )
}
