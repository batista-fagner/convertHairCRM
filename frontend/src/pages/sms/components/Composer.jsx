import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, BellOff, Sparkles } from 'lucide-react'
import { countSegments } from '../../../lib/format'

export default function Composer({ contact, onSend, sending }) {
  const [text, setText] = useState('')
  const areaRef = useRef(null)

  // Auto-grow limitado — não deixa o campo comer a thread.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  if (contact.optedOut) {
    return (
      <div className="px-5 py-4 border-t border-slate-200 bg-rose-50">
        <div className="flex items-start gap-2.5 text-rose-700">
          <BellOff className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">This contact opted out</p>
            <p className="text-xs text-rose-600">
              They replied “{contact.optOutKeyword || 'STOP'}”. You can’t message them until they text START,
              or until you record new consent.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const info = countSegments(text)
  const multiSegment = info.segments > 1
  const isUcs2 = info.encoding === 'UCS-2'

  function submit() {
    const value = text.trim()
    if (!value || sending) return
    onSend(value)
    setText('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white px-5 py-3">
      {!contact.aiPaused && (
        <div className="flex items-center gap-1.5 text-[11px] text-sky-600 mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>The AI agent is handling this conversation — sending a message will pause it.</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          className="flex-1 resize-none px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || sending}
          className="h-10 w-10 shrink-0 rounded-xl bg-sky-500 text-white flex items-center justify-center hover:bg-sky-600 disabled:opacity-40 disabled:hover:bg-sky-500 transition"
          title="Send (Enter)"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>

      {/* Contador de segmento: SMS cobra por segmento, não por mensagem. */}
      <div className="flex items-center gap-2 mt-1.5 text-[11px]">
        <span className={multiSegment ? 'text-amber-600 font-medium' : 'text-slate-400'}>
          {info.length} chars · {info.segments} SMS
        </span>
        {isUcs2 && (
          <span className="text-amber-600">Emoji/unicode detected — 70 chars per segment</span>
        )}
        <span className="ml-auto text-slate-300">Enter to send · Shift+Enter for a new line</span>
      </div>
    </div>
  )
}
