import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Wifi, WifiOff } from 'lucide-react'
import ConversationList from './components/ConversationList'
import MessageThread from './components/MessageThread'
import ContactPanel from './components/ContactPanel'
import { igInboxApi } from '../../lib/igInboxApi'
import { useIgSocket } from '../../hooks/useIgSocket'

const PAGE_SIZE = 30

export default function IgInbox() {
  const [conversations, setConversations] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [threadCursor, setThreadCursor] = useState(null)
  const [threadHasMore, setThreadHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)

  const [detailsOpen, setDetailsOpen] = useState(true)
  const [stats, setStats] = useState(null)
  const [toast, setToast] = useState(null)

  const selectedRef = useRef(null)
  selectedRef.current = selected

  function notify(message, tone = 'info') {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 4000)
  }

  // --- Busca com debounce ---
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadConversations = useCallback(
    async (targetPage = 1) => {
      targetPage === 1 ? setLoadingList(true) : setLoadingMore(true)
      try {
        const res = await igInboxApi.listConversations({
          search: debouncedSearch,
          filter,
          page: targetPage,
          limit: PAGE_SIZE,
        })
        setConversations((prev) => (targetPage === 1 ? res.data : [...prev, ...res.data]))
        setPage(res.page)
        setTotalPages(res.totalPages)
      } catch (err) {
        notify(err.message, 'error')
      } finally {
        setLoadingList(false)
        setLoadingMore(false)
      }
    },
    [debouncedSearch, filter],
  )

  useEffect(() => {
    loadConversations(1)
  }, [loadConversations])

  const loadStats = useCallback(async () => {
    try {
      setStats(await igInboxApi.stats())
    } catch {
      /* stats do header são cosméticos — silencia */
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  async function openConversation(conv) {
    setSelected(conv)
    setLoadingThread(true)
    setMessages([])
    try {
      const res = await igInboxApi.listMessages(conv.id, { limit: 50 })
      setMessages(res.data)
      setThreadCursor(res.nextBefore)
      setThreadHasMore(res.hasMore)

      if (conv.unreadCount > 0) {
        const updated = await igInboxApi.markRead(conv.id)
        upsertConversation(updated)
        setSelected(updated)
      }
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoadingThread(false)
    }
  }

  async function loadOlderMessages() {
    if (!selected || !threadCursor) return
    setLoadingOlder(true)
    try {
      const res = await igInboxApi.listMessages(selected.id, { before: threadCursor, limit: 50 })
      setMessages((prev) => [...res.data, ...prev])
      setThreadCursor(res.nextBefore)
      setThreadHasMore(res.hasMore)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoadingOlder(false)
    }
  }

  function upsertConversation(conv) {
    setConversations((prev) => {
      const without = prev.filter((c) => c.id !== conv.id)

      const matches =
        filter === 'all' || (filter === 'unread' && conv.unreadCount > 0) || (filter === 'ai_paused' && conv.aiPaused)

      if (!matches) return without

      return [conv, ...without].sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
    })
  }

  // --- Realtime ---
  const connected = useIgSocket({
    onMessage: (m) => {
      if (selectedRef.current?.id === m.conversationId) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        if (m.direction === 'inbound') {
          igInboxApi.markRead(m.conversationId).catch(() => {})
        }
      }
      loadStats()
    },
    onConversation: (c) => {
      upsertConversation(c)
      if (selectedRef.current?.id === c.id) setSelected(c)
      loadStats()
    },
  })

  // --- Ações ---
  async function handleSend(text) {
    if (!selected) return
    setSending(true)
    try {
      const res = await igInboxApi.sendMessage(selected.id, text)
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]))
      setSelected(res.conversation)
      upsertConversation(res.conversation)
      if (res.conversation.aiPaused && !selected.aiPaused) {
        notify('IA pausada nesta conversa — você assumiu.')
      }
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSending(false)
    }
  }

  async function handleToggleAi(paused) {
    if (!selected) return
    try {
      const updated = await igInboxApi.setAiPaused(selected.id, paused)
      setSelected(updated)
      upsertConversation(updated)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  async function handleResetContext() {
    if (!selected) return
    if (!window.confirm('Isso zera o que a IA lembra desta conversa. O histórico continua visível. Continuar?')) return
    try {
      const updated = await igInboxApi.resetContext(selected.id)
      setSelected(updated)
      upsertConversation(updated)
      notify('Contexto da IA reiniciado.')
      openConversation(updated)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-slate-50">
      {/* Toolbar */}
      <div className="h-12 shrink-0 px-5 bg-white border-b border-slate-200 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-fuchsia-500 flex items-center justify-center">
            <Camera className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700">Instagram DM Inbox</span>
        </div>

        {stats && (
          <div className="hidden lg:flex items-center gap-4 text-[11px] text-slate-400 ml-4">
            <span>{stats.totalConversations} conversas</span>
            <span>{stats.unreadTotal} não lidas</span>
            <span>{stats.messagesLast24h} msgs / 24h</span>
            {stats.aiPaused > 0 && <span className="text-amber-500">{stats.aiPaused} com IA pausada</span>}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span
            title={connected ? 'Ao vivo' : 'Reconectando…'}
            className={`flex items-center gap-1 text-[11px] font-medium ${connected ? 'text-emerald-600' : 'text-slate-400'}`}
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? 'Ao vivo' : 'Offline'}
          </span>
        </div>
      </div>

      {/* 3 colunas */}
      <div className="flex-1 flex min-h-0">
        <ConversationList
          conversations={conversations}
          selectedId={selected?.id}
          onSelect={openConversation}
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          loading={loadingList}
          hasMore={page < totalPages}
          loadingMore={loadingMore}
          onLoadMore={() => loadConversations(page + 1)}
        />

        {selected ? (
          <>
            <MessageThread
              key={selected.id}
              contact={selected}
              messages={messages}
              loading={loadingThread}
              hasMore={threadHasMore}
              loadingMore={loadingOlder}
              onLoadMore={loadOlderMessages}
              onSend={handleSend}
              sending={sending}
              onToggleAi={handleToggleAi}
              onResetContext={handleResetContext}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((v) => !v)}
            />
            {detailsOpen && (
              <div className="hidden xl:block">
                <ContactPanel
                  key={selected.id}
                  contact={selected}
                  onToggleAi={handleToggleAi}
                  onResetContext={handleResetContext}
                />
              </div>
            )}
          </>
        ) : (
          <section className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Camera className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">Selecione uma conversa</p>
            <p className="text-xs">Escolha alguém à esquerda pra ler e responder as mensagens.</p>
          </section>
        )}
      </div>

      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
            toast.tone === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
