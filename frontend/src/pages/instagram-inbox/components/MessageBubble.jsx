import { Check, AlertCircle } from 'lucide-react'
import { formatTime } from '../../../lib/format'

export default function MessageBubble({ message, contactName }) {
  const { direction, source, body, status, errorMessage, createdAt } = message

  // Eventos de sistema (ex.: "contexto reiniciado") viram um chip centralizado, não uma bolha.
  if (message.meta?.systemEvent) {
    return (
      <div className="flex justify-center my-1">
        <span className="px-3 py-1 rounded-full bg-slate-200/70 text-slate-500 text-[11px] font-medium">{body}</span>
      </div>
    )
  }

  const isInbound = direction === 'inbound'
  const isFailed = status === 'failed'

  const bubbleClass = isInbound
    ? 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'
    : isFailed
      ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-tr-sm'
      : source === 'operator'
        ? 'bg-violet-500 text-white rounded-tr-sm'
        : source === 'system'
          ? 'bg-slate-500 text-white rounded-tr-sm'
          : 'bg-fuchsia-500 text-white rounded-tr-sm'

  const footerClass = isInbound
    ? 'text-slate-400'
    : isFailed
      ? 'text-rose-500'
      : source === 'operator'
        ? 'text-violet-200'
        : source === 'system'
          ? 'text-slate-200'
          : 'text-fuchsia-100'

  const label = isInbound
    ? contactName || 'Contato'
    : source === 'operator'
      ? 'Você'
      : source === 'system'
        ? 'Sistema'
        : 'IA'

  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[70%] px-3.5 py-2 rounded-2xl text-sm break-words shadow-sm ${bubbleClass}`}>
        <p className="whitespace-pre-wrap leading-relaxed">{body}</p>

        <div className={`flex items-center gap-1.5 text-[10px] mt-1 ${footerClass}`}>
          <span className="font-medium">{label}</span>
          <span className="opacity-80">{formatTime(createdAt)}</span>
          {!isInbound && (
            <span className="ml-auto flex items-center">
              {isFailed ? <AlertCircle className="w-3 h-3" title="Falhou" /> : <Check className="w-3 h-3" title="Enviado" />}
            </span>
          )}
        </div>

        {isFailed && errorMessage && (
          <p className="text-[10px] text-rose-600 mt-1 border-t border-rose-200 pt-1">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}
