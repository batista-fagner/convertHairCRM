import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, Plus, Wifi, WifiOff, FlaskConical, X, Loader2 } from 'lucide-react'
import ConversationList from './components/ConversationList'
import MessageThread from './components/MessageThread'
import ContactPanel from './components/ContactPanel'
import { smsApi } from '../../lib/smsApi'
import { useSmsSocket } from '../../hooks/useSmsSocket'
import { formatPhoneUS } from '../../lib/format'

const PAGE_SIZE = 30

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function SmsInbox() {
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
  const [showNewContact, setShowNewContact] = useState(false)
  const [showSimulate, setShowSimulate] = useState(false)

  const selectedRef = useRef(null)
  selectedRef.current = selected

  function notify(message, tone = 'info') {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 4000)
  }

  // --- Busca com debounce (a base é grande, não dá pra buscar a cada tecla) ---
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadConversations = useCallback(
    async (targetPage = 1) => {
      targetPage === 1 ? setLoadingList(true) : setLoadingMore(true)
      try {
        const res = await smsApi.listConversations({
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
      setStats(await smsApi.stats())
    } catch {
      /* header stats são cosméticos — silencia */
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // --- Thread ---
  // Sem useCallback de propósito: ela usa `upsertConversation`, que fecha sobre
  // `filter`. Memoizar aqui congelaria o filtro do primeiro render.
  async function openConversation(contact) {
    setSelected(contact)
    setLoadingThread(true)
    setMessages([])
    try {
      const res = await smsApi.listMessages(contact.id, { limit: 50 })
      setMessages(res.data)
      setThreadCursor(res.nextBefore)
      setThreadHasMore(res.hasMore)

      if (contact.unreadCount > 0) {
        const updated = await smsApi.markRead(contact.id)
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
      const res = await smsApi.listMessages(selected.id, { before: threadCursor, limit: 50 })
      setMessages((prev) => [...res.data, ...prev])
      setThreadCursor(res.nextBefore)
      setThreadHasMore(res.hasMore)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoadingOlder(false)
    }
  }

  function upsertConversation(contact) {
    setConversations((prev) => {
      const without = prev.filter((c) => c.id !== contact.id)

      // Respeita o filtro ativo: um contato que deixou de ser "não lido" some
      // da lista quando o filtro é "Unread".
      const matches =
        filter === 'all' ||
        (filter === 'unread' && contact.unreadCount > 0) ||
        (filter === 'ai_paused' && contact.aiPaused && !contact.optedOut) ||
        (filter === 'opted_out' && contact.optedOut)

      if (!matches) return without

      return [contact, ...without].sort(
        (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0),
      )
    })
  }

  // --- Realtime ---
  const connected = useSmsSocket({
    onMessage: (m) => {
      if (selectedRef.current?.id === m.contactId) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))

        // O operador está com a conversa aberta na tela — marcar como não lida
        // seria mentira. O backend responde com `sms:contact:updated`, que
        // atualiza a lista e o badge do menu.
        if (m.direction === 'inbound') {
          smsApi.markRead(m.contactId).catch(() => {})
        }
      }
      loadStats()
    },
    onStatus: (s) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === s.id
            ? { ...m, status: s.status, errorCode: s.errorCode, errorMessage: s.errorMessage, deliveredAt: s.deliveredAt }
            : m,
        ),
      )
    },
    onContact: (c) => {
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
      const res = await smsApi.sendMessage(selected.id, text, true)
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]))
      setSelected(res.contact)
      upsertConversation(res.contact)
      if (res.contact.aiPaused && !selected.aiPaused) {
        notify('AI paused for this conversation — you have taken over.')
      }
    } catch (err) {
      notify(
        err.code === 'CONTACT_OPTED_OUT'
          ? 'This contact opted out and cannot receive messages.'
          : err.message,
        'error',
      )
    } finally {
      setSending(false)
    }
  }

  async function handleToggleAi(paused) {
    if (!selected) return
    try {
      const updated = await smsApi.setAiPaused(selected.id, paused)
      setSelected(updated)
      upsertConversation(updated)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  async function handleUpdateContact(patch) {
    if (!selected) return
    try {
      const updated = await smsApi.updateContact(selected.id, patch)
      setSelected(updated)
      upsertConversation(updated)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  async function handleOptIn() {
    if (!selected) return
    try {
      const updated = await smsApi.optIn(selected.id, 'operator_manual_consent')
      setSelected(updated)
      upsertConversation(updated)
      notify('Contact resubscribed.')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-slate-50">
      {/* Toolbar */}
      <div className="h-12 shrink-0 px-5 bg-white border-b border-slate-200 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-sky-500 flex items-center justify-center">
            <MessageSquare className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700">
            {stats?.fromNumber ? formatPhoneUS(stats.fromNumber) : 'SMS'}
          </span>
          {stats?.provider === 'mock' && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">
              Sandbox
            </span>
          )}
        </div>

        {stats && (
          <div className="hidden lg:flex items-center gap-4 text-[11px] text-slate-400 ml-4">
            <span>{stats.totalContacts} contacts</span>
            <span>{stats.unreadConversations} unread</span>
            <span>{stats.messagesLast24h} msgs / 24h</span>
            {stats.optedOut > 0 && <span className="text-rose-500">{stats.optedOut} opted out</span>}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span
            title={connected ? 'Live' : 'Reconnecting…'}
            className={`flex items-center gap-1 text-[11px] font-medium ${
              connected ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? 'Live' : 'Offline'}
          </span>

          {stats?.provider === 'mock' && (
            <button
              onClick={() => setShowSimulate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Simulate reply
            </button>
          )}

          <button
            onClick={() => setShowNewContact(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New contact
          </button>
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
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((v) => !v)}
            />
            {detailsOpen && (
              <div className="hidden xl:block">
                <ContactPanel
                  key={selected.id}
                  contact={selected}
                  onUpdate={handleUpdateContact}
                  onOptIn={handleOptIn}
                />
              </div>
            )}
          </>
        ) : (
          <section className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">Select a conversation</p>
            <p className="text-xs">Pick someone on the left to read and reply to their messages.</p>
          </section>
        )}
      </div>

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onCreated={(contact) => {
            setShowNewContact(false)
            upsertConversation(contact)
            openConversation(contact)
            loadStats()
          }}
          onError={(msg) => notify(msg, 'error')}
        />
      )}

      {showSimulate && (
        <SimulateModal
          defaultPhone={selected?.phone || ''}
          onClose={() => setShowSimulate(false)}
          onDone={() => {
            setShowSimulate(false)
            notify('Incoming message simulated.')
          }}
          onError={(msg) => notify(msg, 'error')}
        />
      )}

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

function NewContactModal({ onClose, onCreated, onError }) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [cohort, setCohort] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!phone.trim() || saving) return
    setSaving(true)
    try {
      onCreated(await smsApi.createContact({ phone, name: name.trim(), cohort: cohort.trim() }))
    } catch (err) {
      onError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New contact" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (US) — e.g. (305) 555-0198"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
        />
        <input
          value={cohort}
          onChange={(e) => setCohort(e.target.value)}
          placeholder="Cohort (optional) — e.g. Cohort 12"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
        />
        <button
          onClick={submit}
          disabled={!phone.trim() || saving}
          className="w-full py-2 rounded-lg bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 disabled:opacity-40 transition flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Create contact
        </button>
      </div>
    </Modal>
  )
}

/** Ferramenta de demo — o backend só aceita com SMS_PROVIDER=mock. */
function SimulateModal({ defaultPhone, onClose, onDone, onError }) {
  const [phone, setPhone] = useState(defaultPhone)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    if (!phone.trim() || !text.trim() || sending) return
    setSending(true)
    try {
      await smsApi.simulateInbound(phone, text)
      onDone()
    } catch (err) {
      onError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title="Simulate an incoming message" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-3">
        Sandbox only. Pretends the contact replied, so you can watch the inbox update live.
      </p>
      <div className="space-y-3">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="From phone (US)"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Message body — try STOP or HELP to see compliance handling"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition resize-none"
        />
        <button
          onClick={submit}
          disabled={!phone.trim() || !text.trim() || sending}
          className="w-full py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-40 transition flex items-center justify-center gap-2"
        >
          {sending && <Loader2 className="w-4 h-4 animate-spin" />}
          Simulate
        </button>
      </div>
    </Modal>
  )
}
