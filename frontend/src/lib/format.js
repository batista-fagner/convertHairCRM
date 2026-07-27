// Helpers de formatação compartilhados pela inbox de SMS.
// `getInitials` / `getAvatarColor` seguem a mesma lógica do KanbanLeads.jsx —
// duplicados de propósito por ora para não mexer num arquivo grande em produção.

const AVATAR_COLORS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-cyan-500',
]

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

/** Tempo relativo curto, em inglês (a tela é para o cliente americano). */
export function timeAgo(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** `+13055550198` → `+1 (305) 555-0198` */
export function formatPhoneUS(phone) {
  if (!phone) return ''
  const d = String(phone).replace(/\D/g, '')
  const national = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (national.length !== 10) return phone
  return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}

export function formatTime(date) {
  if (!date) return ''
  return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Cabeçalho de dia dentro da thread. */
export function formatDayLabel(date) {
  const d = new Date(date)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Hora local do contato — a base está espalhada por vários fusos dos EUA. */
export function contactLocalTime(timezone) {
  if (!timezone) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    }).format(new Date())
  } catch {
    return null
  }
}

/** `ms` → "2h 14min" / "3d 4h" / "12min" — usado no tempo-até-virar-lead da inbox de IG. */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '—'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return remMins ? `${hours}h ${remMins}min` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours ? `${days}d ${remHours}h` : `${days}d`
}

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXTENDED = '^{}\\[~]|€'

/**
 * Contagem de segmentos de SMS — a cobrança é por segmento, não por mensagem.
 * Um único emoji derruba a mensagem de GSM-7 (160) para UCS-2 (70).
 * Espelha `backend/src/sms/utils/segments.util.ts`.
 */
export function countSegments(text) {
  const body = text ?? ''
  let isGsm7 = true
  let length = 0

  for (const char of body) {
    if (GSM7_BASIC.includes(char)) length += 1
    else if (GSM7_EXTENDED.includes(char)) length += 2
    else {
      isGsm7 = false
      break
    }
  }

  if (!isGsm7) {
    const units = [...body].reduce((acc, c) => acc + (c.codePointAt(0) > 0xffff ? 2 : 1), 0)
    const segments = units === 0 ? 1 : units <= 70 ? 1 : Math.ceil(units / 67)
    const capacity = segments === 1 ? 70 : segments * 67
    return { encoding: 'UCS-2', length: units, segments, remaining: capacity - units }
  }

  const segments = length === 0 ? 1 : length <= 160 ? 1 : Math.ceil(length / 153)
  const capacity = segments === 1 ? 160 : segments * 153
  return { encoding: 'GSM-7', length, segments, remaining: capacity - length }
}
