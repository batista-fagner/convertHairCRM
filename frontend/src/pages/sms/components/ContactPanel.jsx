import { useState } from 'react'
import { Check, BellOff, CheckCircle2, Sparkles, PauseCircle } from 'lucide-react'
import { getAvatarColor, getInitials, formatPhoneUS, contactLocalTime } from '../../../lib/format'

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      {children}
    </div>
  )
}

/** Progresso do programa, quando os atributos trouxerem módulo/total. */
function ProgramProgress({ attributes }) {
  const current = Number(attributes?.module)
  const total = Number(attributes?.totalModules)
  if (!current || !total) return null
  const pct = Math.min(100, Math.round((current / total) * 100))

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600">
          Module {current} of {total}
        </span>
        <span className="text-slate-400">{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// O pai passa `key={contact.id}`, então trocar de conversa remonta o painel e
// o estado local nasce já do contato certo — sem efeito de sincronização.
export default function ContactPanel({ contact, onUpdate, onOptIn }) {
  const [name, setName] = useState(contact.name || '')
  const [notes, setNotes] = useState(contact.notes || '')
  const [notesSaved, setNotesSaved] = useState(false)

  const localTime = contactLocalTime(contact.timezone)
  const display = contact.name || formatPhoneUS(contact.phone)

  // Atributos livres do programa — renderizados genericamente para não
  // hardcodar a estrutura do programa do cliente.
  const attrs = Object.entries(contact.attributes || {}).filter(
    ([k]) => k !== 'module' && k !== 'totalModules',
  )

  async function saveNotes() {
    if (notes === (contact.notes || '')) return
    await onUpdate({ notes })
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2000)
  }

  async function saveName() {
    const trimmed = name.trim()
    if (trimmed === (contact.name || '')) return
    await onUpdate({ name: trimmed })
  }

  return (
    <aside className="w-80 shrink-0 bg-white border-l border-slate-200 overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Identidade */}
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className={`w-16 h-16 rounded-full ${getAvatarColor(display)} flex items-center justify-center text-white text-xl font-bold`}
          >
            {getInitials(display)}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            placeholder="Add a name"
            className="text-center text-sm font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-sky-400 outline-none px-2 py-0.5 transition w-full"
          />
          <p className="text-xs text-slate-400">{formatPhoneUS(contact.phone)}</p>
          {localTime && <p className="text-[11px] text-slate-400">{localTime} local time</p>}
        </div>

        {/* Status */}
        <div className="flex flex-col gap-2">
          {contact.optedOut ? (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-rose-700 text-xs font-semibold">
                <BellOff className="w-3.5 h-3.5" /> Opted out
              </div>
              <p className="text-[11px] text-rose-600">
                Replied “{contact.optOutKeyword || 'STOP'}”
                {contact.optedOutAt && ` on ${new Date(contact.optedOutAt).toLocaleDateString('en-US')}`}.
              </p>
              <button
                onClick={onOptIn}
                className="w-full py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 text-[11px] font-semibold hover:bg-rose-100 transition"
              >
                Record new consent & resubscribe
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                {contact.aiPaused ? (
                  <PauseCircle className="w-4 h-4 text-amber-500" />
                ) : (
                  <Sparkles className="w-4 h-4 text-sky-500" />
                )}
                <span className="text-xs font-semibold text-slate-700">AI agent</span>
              </div>
              <button
                onClick={() => onUpdate({ aiPaused: !contact.aiPaused })}
                className={`relative w-10 h-5 rounded-full transition ${
                  contact.aiPaused ? 'bg-slate-300' : 'bg-sky-500'
                }`}
                title={contact.aiPaused ? 'Turn on' : 'Pause'}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    contact.aiPaused ? 'left-0.5' : 'left-[22px]'
                  }`}
                />
              </button>
            </div>
          )}
        </div>

        {/* Tags */}
        {(contact.cohort || contact.tags?.length > 0) && (
          <Field label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {contact.cohort && (
                <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-[11px] font-semibold">
                  {contact.cohort}
                </span>
              )}
              {(contact.tags || []).map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                  {t}
                </span>
              ))}
            </div>
          </Field>
        )}

        {/* Programa */}
        {(contact.programStage || attrs.length > 0 || contact.attributes?.module) && (
          <Field label="Program">
            <div className="space-y-2.5">
              {contact.programStage && (
                <p className="text-xs text-slate-600 font-medium capitalize">{contact.programStage}</p>
              )}
              <ProgramProgress attributes={contact.attributes} />
              {attrs.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-slate-400 capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                  <span className="text-slate-700 font-medium text-right truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          </Field>
        )}

        {/* Notas */}
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={4}
            placeholder="Internal notes (not sent to the contact)"
            className="w-full text-xs text-slate-600 placeholder-slate-400 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition resize-none"
          />
          {notesSaved && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 mt-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
        </Field>

        <Field label="Timezone">
          <p className="text-xs text-slate-600">{contact.timezone || '—'}</p>
        </Field>

        {contact.consentSource && (
          <Field label="Consent">
            <p className="text-xs text-slate-600 flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-500" />
              {contact.consentSource}
            </p>
          </Field>
        )}
      </div>
    </aside>
  )
}
