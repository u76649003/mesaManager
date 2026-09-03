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
  z.object({ action: z.literal('list_today_reservations'), tableLabel: z.string().optional() }),
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

export function extractNumber(text: string): number | undefined {
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

const hourWordMap: Record<string, number> = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23,
};

export function extractTime(raw: string): string | undefined {
  const norm = raw.toLocaleLowerCase('es-ES').trim();

  // 1. Digital 24h format: "13:30", "21:00", "09.15", "14.00"
  const digitalMatch = norm.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (digitalMatch) {
    const h = String(Number(digitalMatch[1])).padStart(2, '0');
    return `${h}:${digitalMatch[2]}`;
  }

  // 2. Hour with 'h' format: "13h", "13 h", "13h30"
  const hMatch = norm.match(/\b([01]?\d|2[0-3])\s*h\s*([0-5]\d)?\b/);
  if (hMatch) {
    const h = String(Number(hMatch[1])).padStart(2, '0');
    const m = hMatch[2] ? hMatch[2] : '00';
    return `${h}:${m}`;
  }

  // 3. AM / PM context check
  const isPM = /\b(de\s+la\s+(tarde|noche)|pm|p\.m\.)\b/.test(norm);
  const isAM = /\b(de\s+la\s+mañana|am|a\.m\.)\b/.test(norm);

  // 4. Time context requirement to avoid confusing non-time numbers
  const hasTimeContext =
    /\b(la|las|a\s+la|a\s+las|sobre\s+la|sobre\s+las|en\s+punto|de\s+la\s+(tarde|noche|mañana)|y\s+(media|cuarto)|menos\s+cuarto)\b/.test(norm) ||
    /\b\d{1,2}\s*(?:de\s+la\s+(?:tarde|noche|mañana)|pm|am)\b/.test(norm);

  if (!hasTimeContext) return undefined;

  // 5. Match spoken hours (prioritize explicit time indicators like 'a las' or 'la/las')
  const spokenMatch =
    norm.match(
      /(?:a\s+las?|sobre\s+las?|eso\s+de\s+las?|\bla\b|\blas\b)\s*(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintid[oó]s|veintitr[eé]s|\d{1,2})(?:\s+(?:y|menos)\s+(media|cuarto|\d{1,2}))?/i,
    ) ||
    norm.match(
      /(?:(?:a|sobre)\s+)?(?:la|las|eso\s+de\s+(?:la|las))?\s*(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintid[oó]s|veintitr[eé]s|\d{1,2})(?:\s+(?:y|menos)\s+(media|cuarto|\d{1,2}))?/i,
    );

  if (spokenMatch) {
    const rawH = spokenMatch[1].toLocaleLowerCase('es-ES');
    let h = hourWordMap[rawH] ?? Number(rawH);
    if (isNaN(h) || h < 0 || h > 23) return undefined;

    let m = 0;
    const minPart = spokenMatch[2];
    if (minPart) {
      if (minPart === 'media') m = 30;
      else if (minPart === 'cuarto') {
        if (norm.includes('menos cuarto')) {
          h = (h - 1 + 24) % 24;
          m = 45;
        } else {
          m = 15;
        }
      } else {
        const numM = Number(minPart);
        if (!isNaN(numM) && numM >= 0 && numM < 60) m = numM;
      }
    }

    // Convert 12h to 24h format for restaurant usage if no explicit AM/PM
    if (isPM) {
      if (h < 12) h += 12;
    } else if (isAM) {
      if (h === 12) h = 0;
    } else if (h >= 1 && h <= 11) {
      // Restaurant heuristics: 1..6 PM (13:00..18:00), 7..11 PM (19:00..23:00)
      h += 12;
    }

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return undefined;
}

function extractTableLabel(text: string): string | undefined {
  const directMesa = text.match(/\bmesa\s+([a-záéíóúüñ0-9-]+)\b/i);
  if (directMesa) return normalizeTableLabel(directMesa[1]);

  const roomTable = text.match(/\b(?:terraza|interior|sala|comedor|bar|vip)\s+(?:la\s+)?([a-záéíóúüñ0-9-]+)\b/i);
  if (roomTable) return normalizeTableLabel(roomTable[1]);

  const laNum = text.match(/\b(?:la|n[úu]mero|num)\s+([a-záéíóúüñ0-9]+)\b/i);
  if (laNum) return normalizeTableLabel(laNum[1]);

  return undefined;
}

function normalizeTableLabel(raw: string): string {
  const norm = raw.toLowerCase().trim();
  const num = hourWordMap[norm];
  if (num !== undefined) return String(num);
  return norm;
}

export function parseAssistantIntent(raw: string, now = new Date()): AssistantIntent {
  const text = raw.toLocaleLowerCase('es-ES').trim();
  const tableLabel = extractTableLabel(text);
  const partyMatches = [...text.matchAll(/(?:para|somos)\s+([a-záéíóúüñ0-9]+)/gi)];
  const partySize = partyMatches.map((match) => extractNumber(match[1])).find((value) => value !== undefined);
  const reservationReference = text.match(/\b(res-\d{4}-\d{6})\b/i)?.[1]?.toUpperCase();
  const date = extractDate(text, now);
  const time = extractTime(text);

  if (/(qu[eé]\s+)?reservas?.*(hoy|esta noche)|reservas?\s+(de\s+)?hoy|qui[eé]n\s+viene\s+hoy/i.test(text)) {
    return { action: 'list_today_reservations', ...(tableLabel ? { tableLabel } : {}) };
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

  if (tableLabel && /(libre|disponible|cabe|puedo|reservar)/.test(text)) {
    return assistantIntentSchema.parse({
      action: 'check_table',
      tableLabel,
      partySize,
    });
  }

  if (/(mejor|recomienda|recomiendas|qué mesa|que mesa|dónde pongo|donde pongo)/.test(text)) {
    const size = partySize ?? extractNumber(text);
    if (size) return assistantIntentSchema.parse({ action: 'recommend_table', partySize: size });
  }

  // Conversational reservation intent with or without explicit verb
  const hasReservationParams =
    Boolean(tableLabel) ||
    Boolean(time) ||
    Boolean(partySize) ||
    /(reservar?|crea|crear|haz|nueva|ponme|dame|hacer?|reserva|mesa|terraza|comedor|sala|interior)\b/.test(text);

  if (hasReservationParams) {
    const nameMatch = text.match(/(?:a nombre de|nombre)\s+([a-záéíóúüñ][a-záéíóúüñ\s'-]*?)(?=\s+(?:el|para|a las?|en)\b|$)/i)?.[1]?.trim();
    const cleanName = (nameMatch && !['terraza', 'sala', 'comedor', 'interior', 'hoy', 'mañana', 'uno', 'dos', 'tres'].includes(nameMatch.toLowerCase())) ? nameMatch : undefined;
    return {
      action: 'draft_reservation',
      tableLabel,
      guestName: cleanName,
      date: date ?? localIso(now),
      time,
      partySize,
    };
  }

  return { action: 'help' };
}
