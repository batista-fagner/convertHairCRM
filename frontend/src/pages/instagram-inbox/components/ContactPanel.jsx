import { useEffect, useState } from 'react'
import { Sparkles, PauseCircle, RotateCcw, MessageCircle, ExternalLink, Mail, Clock } from 'lucide-react'
import { getAvatarColor, getInitials, formatDuration, timeAgo } from '../../../lib/format'
import { igInboxApi } from '../../../lib/igInboxApi'

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      {children}
    </div>
  )
}

function OriginBlock({ contact, originEvent }) {
  if (contact.originType === 'comment') {
    return (
      <div className="rounded-xl border border-slate-200 p-3 space-y-2">
        {originEvent?.postThumbnail ? (
          <img src={originEvent.postThumbnail} alt="" className="w-full h-28 object-cover rounded-lg" />
        ) : null}
        <p className="text-xs text-slate-600">
          Comentou: <span className="italic text-slate-500">"{contact.originCommentText || 'sem texto salvo'}"</span>
        </p>
        {originEvent?.postPermalink && (
          <a
            href={originEvent.postPermalink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[11px] text-fuchsia-600 hover:text-fuchsia-700 font-semibold"
          >
            Ver post <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <MessageCircle className="w-3.5 h-3.5" />
        Iniciou via DM direta (sem post/anúncio de origem)
      </p>
    </div>
  )
}

function CommentTimeline({ events }) {
  if (events === null) return <p className="text-xs text-slate-400">Carregando…</p>
  if (events.length === 0) return null

  return (
    <Field label="Jornada (comentários)">
      <div className="space-y-2">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 text-xs">
            <span className="text-slate-300 mt-0.5">•</span>
            <div className="min-w-0">
              <p className="text-slate-600 truncate">"{e.commentText}"</p>
              <p className="text-[10px] text-slate-400">
                {timeAgo(e.createdAt)} {e.matchedAutomationId ? '· disparou automação' : '· sem automação'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Field>
  )
}

export default function ContactPanel({ contact, onToggleAi, onResetContext }) {
  const name = contact.igUsername ? `@${contact.igUsername}` : `ig_${contact.senderIgId?.slice(-6) || '?'}`
  const [events, setEvents] = useState(null)

  useEffect(() => {
    let cancelled = false
    igInboxApi
      .listCommentEvents(contact.id)
      .then((data) => {
        if (!cancelled) setEvents(data)
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
    return () => {
      cancelled = true
    }
  }, [contact.id])

  const originEvent = events?.find((e) => e.postId === contact.originPostId) || events?.[0]

  const timeToLead =
    contact.email && contact.emailCapturedAt
      ? formatDuration(new Date(contact.emailCapturedAt).getTime() - new Date(contact.createdAt).getTime())
      : null

  return (
    <aside className="w-80 shrink-0 bg-white border-l border-slate-200 overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Identidade */}
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className={`w-16 h-16 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white text-xl font-bold`}
          >
            {getInitials(name.replace('@', ''))}
          </div>
          <p className="text-sm font-semibold text-slate-800">{name}</p>
        </div>

        {/* Origem */}
        <Field label="Origem">
          <OriginBlock contact={contact} originEvent={originEvent} />
        </Field>

        {/* Status da IA */}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {contact.aiPaused ? (
              <PauseCircle className="w-4 h-4 text-amber-500" />
            ) : (
              <Sparkles className="w-4 h-4 text-fuchsia-500" />
            )}
            <span className="text-xs font-semibold text-slate-700">Agente IA</span>
          </div>
          <button
            onClick={() => onToggleAi(!contact.aiPaused)}
            className={`relative w-10 h-5 rounded-full transition ${contact.aiPaused ? 'bg-slate-300' : 'bg-fuchsia-500'}`}
            title={contact.aiPaused ? 'Reativar' : 'Pausar'}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                contact.aiPaused ? 'left-0.5' : 'left-[22px]'
              }`}
            />
          </button>
        </div>

        <button
          onClick={onResetContext}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reiniciar contexto
        </button>

        {/* Email / tempo até virar lead */}
        {contact.email && (
          <Field label="Lead capturado">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                {contact.email}
              </p>
              {timeToLead && (
                <p className="text-xs text-emerald-600 flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  Qualificado em {timeToLead}
                </p>
              )}
            </div>
          </Field>
        )}

        <CommentTimeline events={events} />
      </div>
    </aside>
  )
}
