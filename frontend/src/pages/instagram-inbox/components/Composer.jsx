import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, Sparkles } from 'lucide-react'

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
        <div className="flex items-center gap-1.5 text-[11px] text-fuchsia-600 mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>A IA está conduzindo esta conversa — enviar uma mensagem vai pausá-la.</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma mensagem…"
          className="flex-1 resize-none px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100 transition"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || sending}
          className="h-10 w-10 shrink-0 rounded-xl bg-fuchsia-500 text-white flex items-center justify-center hover:bg-fuchsia-600 disabled:opacity-40 disabled:hover:bg-fuchsia-500 transition"
          title="Enviar (Enter)"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-1.5 text-[11px]">
        <span className="ml-auto text-slate-300">Enter para enviar · Shift+Enter para quebrar linha</span>
      </div>
    </div>
  )
}
