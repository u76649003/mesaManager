import { z } from 'zod';

export const assistantIntentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('check_table'),
    tableLabel: z.string().min(1),
    partySize: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal('recommend_table'),
    partySize: z.number().int().positive(),
  }),
  z.object({ action: z.literal('help') }),
  z.object({ action: z.literal('list_today_reservations') }),
  z.object({ action: z.literal('list_reservations_date'), date: z.iso.date() }),
  z.object({ action: z.literal('list_free_tables') }),
  z.object({ action: z.literal('draft_reservation'), tableLabel: z.string().optional(), guestName: z.string().optional(), date: z.iso.date().optional(), time: z.string().optional(), partySize: z.number().int().positive().optional() }),
  z.object({
    action: z.literal('create_reservation'), guestName: z.string().min(1), date: z.iso.date(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), partySize: z.number().int().positive(),
    durationMinutes: z.number().int().min(15).max(720).optional(),
  }),
  z.object({
    action: z.literal('update_reservation'), reference: z.string().min(1), date: z.iso.date().optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), partySize: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal('cancel_reservation'), reference: z.string().min(1) }),
  z.object({ action: z.literal('seat_reservation'), reference: z.string().min(1) }),
  z.object({ action: z.literal('require_prepayment'), reference: z.string().min(1), amount: z.number().positive() }),
  z.object({ action: z.literal('send_payment_request'), reference: z.string().min(1), method: z.enum(['online', 'bizum']), amount: z.number().positive() }),
]);

export type AssistantIntent = z.infer<typeof assistantIntentSchema>;
export type AssistantMutationIntent = Extract<AssistantIntent, { action: 'create_reservation' | 'update_reservation' | 'cancel_reservation' | 'seat_reservation' | 'require_prepayment' | 'send_payment_request' }>;

const numberWords: Record<string, number> = {
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, dieciséis: 16, veinte: 20,
};

function extractNumber(text: string): number | undefined {
  const digit = text.match(/\b(\d{1,3})\b/);
  if (digit) return Number(digit[1]);
  const word = Object.entries(numberWords).find(([key]) => text.includes(key));
  return word?.[1];
}

function localIso(date: Date) {
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractDate(text: string, now: Date): string | undefined {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]; if (iso) return iso;
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}))?\b/);
  if (numeric) return localIso(new Date(Number(numeric[3] ?? now.getFullYear()), Number(numeric[2]) - 1, Number(numeric[1])));
  const result = new Date(now); result.setHours(12, 0, 0, 0);
  if (/\bpasado mañana\b/.test(text)) { result.setDate(result.getDate() + 2); return localIso(result); }
  if (/\bmañana\b/.test(text)) { result.setDate(result.getDate() + 1); return localIso(result); }
  if (/\bhoy\b/.test(text)) return localIso(result);
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const wanted = days.findIndex((day) => text.includes(day));
  if (wanted >= 0) { let delta = (wanted - result.getDay() + 7) % 7; if (delta === 0) delta = 7; result.setDate(result.getDate() + delta); return localIso(result); }
  return undefined;
}

export function parseAssistantIntent(raw: string, now = new Date()): AssistantIntent {
  const text = raw.toLocaleLowerCase('es-ES').trim();
  const tableMatch = text.match(/mesa\s+([a-záéíóúüñ0-9-]+)/i);
  const partyMatches = [...text.matchAll(/(?:para|somos)\s+([a-záéíóúüñ0-9]+)/gi)];
  const partySize = partyMatches.map((match) => extractNumber(match[1])).find((value) => value !== undefined);
  const reservationReference = text.match(/\b(res-\d{4}-\d{6})\b/i)?.[1]?.toUpperCase();
  const date = extractDate(text, now);
  const exactTime = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)?.[0];
  const spokenHour = text.match(/(?:a\s+las?|sobre\s+las?)\s+(\d{1,2})(?:\s+y\s+(media|cuarto))?\b/);
  const time = exactTime ?? (spokenHour ? `${String(Number(spokenHour[1]) + (Number(spokenHour[1]) <= 11 ? 12 : 0)).padStart(2, '0')}:${spokenHour[2] === 'media' ? '30' : spokenHour[2] === 'cuarto' ? '15' : '00'}` : undefined);

  if (/(qu[eé]\s+)?reservas?.*(hoy|esta noche)|reservas?\s+(de\s+)?hoy/.test(text)) {
    return { action: 'list_today_reservations' };
  }
  if (date && /reservas?/.test(text) && /(qué|que|cu[aá]les|tengo|hay|dime|ver)/.test(text)) return { action: 'list_reservations_date', date };
  if (/(qu[eé]\s+)?mesas?.*(libres?|disponibles?)|(libres?|disponibles?).*mesas?/.test(text)) {
    return { action: 'list_free_tables' };
  }

  if (reservationReference && /(cancela|cancelar|anula|anular)/.test(text)) {
    return assistantIntentSchema.parse({ action: 'cancel_reservation', reference: reservationReference });
  }
  if (reservationReference && /(sienta|sentar|acomoda|acomodar)/.test(text)) return { action: 'seat_reservation', reference: reservationReference };
  if (reservationReference && /(anticipo|depósito|deposito|garantía|garantia)/.test(text)) {
    const amountMatch = text.match(/(?:anticipo|depósito|deposito|garantía|garantia)(?:\s+de)?\s+(\d+(?:[.,]\d{1,2})?)/);
    if (amountMatch) return assistantIntentSchema.parse({ action: 'require_prepayment', reference: reservationReference, amount: Number(amountMatch[1].replace(',', '.')) });
  }
  if (reservationReference && /(informa|informar|env[ií]a|enviar|solicita|solicitar|cobra|cobrar)/.test(text) && /(bizum|pasarela|tarjeta|pago)/.test(text)) {
    const amountMatch = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)/);
    if (amountMatch) return assistantIntentSchema.parse({ action: 'send_payment_request', reference: reservationReference, method: /bizum/.test(text) ? 'bizum' : 'online', amount: Number(amountMatch[1].replace(',', '.')) });
  }
  if (reservationReference && /(mueve|cambia|modifica|actualiza)/.test(text) && (date || time || partySize)) {
    return assistantIntentSchema.parse({ action: 'update_reservation', reference: reservationReference, date, time, partySize });
  }
  if (/(crea|crear|haz|nueva)\s+(?:una\s+)?reserva/.test(text) && date && time && partySize) {
    const name = text.match(/(?:para|a nombre de)\s+([a-záéíóúüñ][a-záéíóúüñ\s'-]*?)(?=\s+(?:el\s+)?20\d{2}-|\s+para\s+\d|$)/i)?.[1]?.trim();
    if (name) return assistantIntentSchema.parse({ action: 'create_reservation', guestName: name, date, time, partySize });
  }
  // Broad reservation intent: with OR without details yet
  // Catches: "quiero reservar", "necesito una mesa", "ponme una reserva", "haz una reserva", etc.
  const bareReservationIntent =
    /(reservar?|crea|crear|haz|nueva)\b/.test(text) ||
    (/\b(quiero|necesito|ponme|dame|hacer?)\b/.test(text) && /\breserva\b|\bmesa\b/.test(text));
  if (bareReservationIntent) {
    const name = text.match(/(?:a nombre de|nombre)\s+([a-záéíóúüñ][a-záéíóúüñ\s'-]*?)(?=\s+(?:el|para|a las?)\b|$)/i)?.[1]?.trim();
    return { action: 'draft_reservation', tableLabel: tableMatch?.[1], guestName: name, date, time, partySize };
  }

  if (tableMatch && /(libre|disponible|cabe|puedo|reservar)/.test(text)) {
    return assistantIntentSchema.parse({
      action: 'check_table',
      tableLabel: tableMatch[1],
      partySize,
    });
  }

  if (/(mejor|recomienda|recomiendas|qué mesa|que mesa|dónde pongo|donde pongo)/.test(text)) {
    const size = partySize ?? extractNumber(text);
    if (size) return assistantIntentSchema.parse({ action: 'recommend_table', partySize: size });
  }

  return { action: 'help' };
}
