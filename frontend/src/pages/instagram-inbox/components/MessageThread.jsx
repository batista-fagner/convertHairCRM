import { useLayoutEffect, useRef, useState } from 'react'
import { Camera, PanelRightOpen, PanelRightClose, ArrowDown, Loader2, Sparkles, PauseCircle, RotateCcw } from 'lucide-react'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import { getAvatarColor, getInitials, formatDayLabel } from '../../../lib/format'

function DaySeparator({ label }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  )
}

export default function MessageThread({
  contact,
  messages,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onSend,
  sending,
  onToggleAi,
  onResetContext,
  detailsOpen,
  onToggleDetails,
}) {
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(false)
  const lastCount = useRef(0)

  // Sincroniza a posição de scroll (sistema externo) com as mensagens novas:
  // só rola sozinho se o operador já estava no fim, senão ele perderia o ponto
  // onde estava lendo toda vez que chegasse mensagem. O pai passa
  // `key={contact.id}`, então trocar de conversa remonta e reseta o estado.
  useLayoutEffect(() => {
    if (messages.length === lastCount.current) return
    const grew = messages.length > lastCount.current
    lastCount.current = messages.length
    if (!grew) return

    /* eslint-disable react-hooks/set-state-in-effect -- o indicador depende da
       posição real do scroll no DOM, que só existe depois do layout */
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
      setNewBelow(false)
    } else {
      setNewBelow(true)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [messages, atBottom])

  function handleScroll(e) {
    const el = e.currentTarget
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const bottom = distance < 60
    setAtBottom(bottom)
    if (bottom) setNewBelow(false)
  }

  function jumpToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setNewBelow(false)
  }

  const name = contact.igUsername ? `@${contact.igUsername}` : `ig_${contact.senderIgId?.slice(-6) || '?'}`

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-slate-50">
      {/* Header */}
      <header className="h-16 shrink-0 px-5 bg-white border-b border-slate-200 flex items-center gap-3">
        <div
          className={`w-9 h-9 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}
        >
          {getInitials(name.replace('@', ''))}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
          <p className="text-[11px] text-slate-400 truncate">
            {contact.originType === 'comment' ? 'Veio de um comentário' : 'DM direta'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onResetContext}
            title="Reiniciar o que a IA lembra desta conversa (histórico continua visível)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reiniciar contexto
          </button>

          <button
            onClick={() => onToggleAi(!contact.aiPaused)}
            title={contact.aiPaused ? 'Reativar a IA' : 'Pausar a IA'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              contact.aiPaused
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100'
            }`}
          >
            {contact.aiPaused ? <PauseCircle className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {contact.aiPaused ? 'IA pausada' : 'IA ativa'}
          </button>

          <button
            onClick={onToggleDetails}
            title={detailsOpen ? 'Esconder detalhes' : 'Mostrar detalhes'}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            {detailsOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Thread */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-4 space-y-2 relative">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition flex items-center gap-1.5"
            >
              {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
              Carregar mensagens anteriores
            </button>
          </div>
        )}

        {loading && (
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                <div className={`h-10 rounded-2xl ${i % 2 ? 'bg-fuchsia-200 w-2/5' : 'bg-slate-200 w-1/3'}`} />
              </div>
            ))}
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-slate-400 py-20 gap-2">
            <Camera className="w-10 h-10" />
            <p className="text-sm font-medium">Nenhuma mensagem ainda</p>
          </div>
        )}

        {!loading &&
          messages.map((m, i) => {
            const prev = messages[i - 1]
            const showDay =
              !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
            return (
              <div key={m.id}>
                {showDay && <DaySeparator label={formatDayLabel(m.createdAt)} />}
                <MessageBubble message={m} contactName={name} />
              </div>
            )
          })}

        <div ref={bottomRef} />
      </div>

      {newBelow && (
        <div className="relative">
          <button
            onClick={jumpToBottom}
            className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-fuchsia-500 text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 hover:bg-fuchsia-600 transition"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Nova mensagem
          </button>
        </div>
      )}

      <Composer contact={contact} onSend={onSend} sending={sending} />
    </section>
  )
}
