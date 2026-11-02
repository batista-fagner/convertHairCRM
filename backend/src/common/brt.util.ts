/**
 * Helpers de data no fuso de Brasília — usados pela agenda interna e pelo
 * Efraim. Ficam aqui (e não dentro de um dos dois) porque a agenda não pode
 * importar o serviço do Efraim: ele é que importa a agenda.
 *
 * ⚠️ O Brasil não tem mais horário de verão, então -03:00 é fixo. Se isso
 * mudar, `brtAt` é o único lugar a corrigir.
 */

export const BRT_TZ = 'America/Sao_Paulo';
export const BRT_OFFSET = '-03:00';

export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Partes de data/hora no fuso de Brasília. */
export function brt(d: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const weekdayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    day: get('day'),
    month: get('month'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: weekdayIdx,
  };
}

/** Data com hora cheia (ou hora:minuto) em Brasília. */
export function brtAt(ymd: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${ymd}T${hh}:${mm}:00${BRT_OFFSET}`);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** "15h" / "15h30" */
export function hourHuman(d: Date): string {
  const s = brt(d);
  return s.minute ? `${s.hour}h${String(s.minute).padStart(2, '0')}` : `${s.hour}h`;
}

/** "amanhã (terça, 03/11) às 15h" / "quarta (04/11) às 15h". */
export function formatSlotHuman(slot: Date, now: Date): string {
  const s = brt(slot);
  const today = brt(now).ymd;
  const tomorrow = brt(addDays(now, 1)).ymd;
  const date = `${s.day}/${s.month}`;
  const hour = hourHuman(slot);
  if (s.ymd === today) return `hoje (${date}) às ${hour}`;
  if (s.ymd === tomorrow) return `amanhã (${WEEKDAYS[s.weekday]}, ${date}) às ${hour}`;
  return `${WEEKDAYS[s.weekday]} (${date}) às ${hour}`;
}

/** "terça (03/11)" — o dia, sem hora. */
export function formatDayHuman(slot: Date, now: Date): string {
  const s = brt(slot);
  const today = brt(now).ymd;
  const tomorrow = brt(addDays(now, 1)).ymd;
  const date = `${s.day}/${s.month}`;
  if (s.ymd === today) return `hoje (${date})`;
  if (s.ymd === tomorrow) return `amanhã (${WEEKDAYS[s.weekday]}, ${date})`;
  return `${WEEKDAYS[s.weekday]} (${date})`;
}

/**
 * Lista de horários virando frase, agrupada por dia pra não repetir a data:
 * "amanhã (terça, 03/11) às 10h ou às 11h, ou quarta (04/11) às 16h ou às 17h".
 */
export function formatSlotPairHuman(slots: Date[], now: Date): string {
  const list = slots.filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  if (!list.length) return '';
  const byDay: { ymd: string; slots: Date[] }[] = [];
  for (const slot of list) {
    const ymd = brt(slot).ymd;
    const last = byDay[byDay.length - 1];
    if (last?.ymd === ymd) last.slots.push(slot);
    else byDay.push({ ymd, slots: [slot] });
  }
  return byDay
    .map(({ slots: daySlots }) => {
      const head = formatSlotHuman(daySlots[0], now);
      const rest = daySlots.slice(1).map((s) => `às ${hourHuman(s)}`);
      return rest.length ? `${head} ou ${rest.join(' ou ')}` : head;
    })
    .join(', ou ');
}
