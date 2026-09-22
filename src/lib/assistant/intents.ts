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
  // Strip indefinite articles before common nouns so "una reserva", "una mesa", "un hueco" don't become 1
  const cleaned = text.replace(/\buna?\s+(?:reserva|mesa|cita|vez|sala|terraza|pregunta|duda)\b/gi, ' ');
  const digit = cleaned.match(/\b(\d{1,3})\b/);
  if (digit) return Number(digit[1]);
  for (const [key, val] of Object.entries(numberWords)) {
    const re = new RegExp(`\\b${key}\\b`, 'i');
    if (re.test(cleaned)) return val;
  }
  return undefined;
}

function localIso(date: Date) {
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function extractDate(text: string, now: Date = new Date()): string | undefined {
  const norm = text.toLocaleLowerCase('es-ES').trim();
  const iso = norm.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]; if (iso) return iso;
  const numeric = norm.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](20\d{2}))?\b/);
  if (numeric) return localIso(new Date(Number(numeric[3] ?? now.getFullYear()), Number(numeric[2]) - 1, Number(numeric[1])));
  const result = new Date(now); result.setHours(12, 0, 0, 0);
  if (/\bpasado\s+mañana\b/.test(norm)) { result.setDate(result.getDate() + 2); return localIso(result); }
  if (/\bmañana\b/.test(norm)) { result.setDate(result.getDate() + 1); return localIso(result); }
  if (/\bhoy\b|\besta\s+noche\b|\beste\s+mediod[ií]a\b/.test(norm)) return localIso(result);
  if (/\bmediod[ií]a\b/.test(norm)) return localIso(result);
  const inDays = norm.match(/\ben\s+(\w+)\s+d[ií]as?\b/);
  if (inDays) {
    const n = numberWords[inDays[1]] ?? Number(inDays[1]);
    if (n && !isNaN(n)) { result.setDate(result.getDate() + n); return localIso(result); }
  }
  if (/\b(este\s+)?fin\s+de\s+semana\b/.test(norm)) {
    const toSat = (6 - result.getDay() + 7) % 7 || 7;
    result.setDate(result.getDate() + toSat); return localIso(result);
  }
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const wanted = days.findIndex((day) => norm.includes(day));
  if (wanted >= 0) {
    let delta = (wanted - result.getDay() + 7) % 7;
    if (delta === 0 || /\bpr[oó]ximo\b/.test(norm)) delta = delta === 0 ? 7 : delta;
    // Si el día calculado ya pasó esta semana (delta > 0 pero cae en el pasado
    // por ser hoy ese mismo día a otra hora, ya cubierto arriba), no hay caso extra.
    // El caso real: delta > 0 pero la fecha resultante es "ayer" o antes → ir a siguiente semana.
    const candidate = new Date(result);
    candidate.setDate(result.getDate() + delta);
    const todayStart = new Date(result); todayStart.setHours(0, 0, 0, 0);
    if (candidate < todayStart && !/\bpasad[oa]\b|\búltim[oa]\b/.test(norm)) delta += 7;
    result.setDate(result.getDate() + delta); return localIso(result);
  }
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
  const cleaned = raw.replace(/\buna?\s+(?:reserva|mesa|cita|persona|personas|comensal|comensales|pax|noche|tarde|pregunta|duda|vez)\b/gi, ' ');
  const norm = cleaned.toLocaleLowerCase('es-ES').trim();
  if (/\bmediod[ií]a\b/.test(norm)) return '12:00';
  if (/\bmedianoche\b/.test(norm)) return '00:00';
  const digitalMatch = norm.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (digitalMatch) { const h = String(Number(digitalMatch[1])).padStart(2, '0'); return `${h}:${digitalMatch[2]}`; }
  const hMatch = norm.match(/\b([01]?\d|2[0-3])\s*h\s*([0-5]\d)?\b/);
  if (hMatch) { const h = String(Number(hMatch[1])).padStart(2, '0'); const m = hMatch[2] ? hMatch[2] : '00'; return `${h}:${m}`; }
  const isPM = /\b(de\s+la\s+(tarde|noche)|pm|p\.m\.)\b/.test(norm);
  const isAM = /\b(de\s+la\s+(mañana|madrugada)|am|a\.m\.)\b/.test(norm);
  const hasTimeContext =
    /\b(la|las|a\s+la|a\s+las|sobre\s+la|sobre\s+las|en\s+punto|de\s+la\s+(tarde|noche|mañana|madrugada)|y\s+(media|cuarto)|menos\s+cuarto)\b/.test(norm) ||
    /\b\d{1,2}\s*(?:de\s+la\s+(?:tarde|noche|mañana|madrugada)|pm|am)\b/.test(norm);
  if (!hasTimeContext) return undefined;
  const spokenMatch =
    norm.match(/(?:a\s+las?|sobre\s+las?|eso\s+de\s+las?|\bla\b|\blas\b)\s*(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintid[oó]s|veintitr[eé]s|\d{1,2})(?:\s+(?:y|menos)\s+(media|cuarto|\d{1,2}))?/i) ||
    norm.match(/(?:(?:a|sobre)\s+)?(?:la|las|eso\s+de\s+(?:la|las))?\s*(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintid[oó]s|veintitr[eé]s|\d{1,2})(?:\s+(?:y|menos)\s+(media|cuarto|\d{1,2}))?/i);
  if (spokenMatch) {
    const rawH = spokenMatch[1].toLocaleLowerCase('es-ES');
    let h = hourWordMap[rawH] ?? Number(rawH);
    if (isNaN(h) || h < 0 || h > 23) return undefined;
    let m = 0;
    const minPart = spokenMatch[2];
    if (minPart) {
      if (minPart === 'media') m = 30;
      else if (minPart === 'cuarto') { if (norm.includes('menos cuarto')) { h = (h - 1 + 24) % 24; m = 45; } else m = 15; }
      else { const numM = Number(minPart); if (!isNaN(numM) && numM >= 0 && numM < 60) m = numM; }
    }
    if (isPM) { if (h < 12) h += 12; }
    else if (isAM) { if (h === 12) h = 0; }
    else if (h >= 1 && h <= 11) h += 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return undefined;
}

// ── Lenient time extractor (used when field context IS time) ─────────────────
function extractTimeLenient(norm: string): string | undefined {
  const m =
    norm.match(/(?:a\s+)?las?\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiuno|\d{1,2})/i) ||
    norm.match(/^(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|\d{1,2})\s*(?:y\s+(?:media|cuarto))?$/i);
  if (!m) return undefined;
  const rawH = m[1].toLocaleLowerCase('es-ES');
  let h = hourWordMap[rawH] ?? Number(rawH);
  if (isNaN(h) || h < 0 || h > 23) return undefined;
  let mins = 0;
  if (/y\s+media/.test(norm)) mins = 30;
  else if (/y\s+cuarto/.test(norm)) mins = 15;
  else if (/menos\s+cuarto/.test(norm)) { h = (h - 1 + 24) % 24; mins = 45; }
  if (h >= 1 && h <= 11) h += 12;
  return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// ── Context-aware guest name extractor ──────────────────────────────────────

const NAME_BLACKLIST = new Set([
  'hoy', 'mañana', 'pasado', 'tarde', 'noche', 'mediodía', 'medianoche',
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
  'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'veinte',
  'personas', 'persona', 'pax', 'comensales', 'comensal',
  'mesa', 'mesas', 'terraza', 'interior', 'sala', 'comedor', 'bar', 'vip',
  'reserva', 'reservas', 'reservar', 'cancelar', 'modificar', 'cambiar',
  'quiero', 'quiera', 'quisiera', 'poner', 'hacer', 'ponme', 'dame', 'haz',
  'nueva', 'nuevo', 'si', 'sí', 'no', 'ok', 'vale', 'bueno', 'bien', 'claro',
  'para', 'con', 'por', 'desde', 'hasta', 'sobre', 'entre',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'en', 'a', 'y', 'o', 'e',
  'que', 'qué', 'quien', 'quién', 'como', 'cómo', 'cuando', 'cuándo',
  'hay', 'tiene', 'tienen', 'tengo', 'tenemos',
]);

function titleCase(s: string): string {
  return s.replace(/\b([a-záéíóúüñ])/gi, (c) => c.toLocaleUpperCase('es-ES'));
}

/**
 * Dedicated guest name extractor.
 * When `isDirectAnswer` is true (system just asked "¿A nombre de quién?"),
 * aggressively treats the whole utterance as a name when it looks like one.
 */
export function extractGuestName(raw: string, isDirectAnswer = false): string | undefined {
  const text = raw.trim();
  const norm = text.toLocaleLowerCase('es-ES');

  const explicit = text.match(
    /(?:(?:a\s+)?nombre\s+de|me\s+llamo|soy|para|el\s+cliente\s+(?:es|se\s+llama?)|se\s+llama?|ponlo\s+a\s+nombre\s+de)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ][A-Za-záéíóúüñÁÉÍÓÚÜÑ\s'·\-]{1,40}?)(?:\s*[.,]|\s+(?:el|la|los|las|para|con|y\s+\d|\d)\b|$)/i,
  );
  if (explicit?.[1]) {
    const candidate = explicit[1].trim();
    if (!NAME_BLACKLIST.has(candidate.toLocaleLowerCase('es-ES'))) return titleCase(candidate);
  }

  if (isDirectAnswer) {
    const words = text.split(/\s+/);
    const allLetters = words.every(w => /^[a-záéíóúüñA-ZÁÉÍÓÚÜÑ'·\-]+$/.test(w));
    const hasNonName = words.some(w => NAME_BLACKLIST.has(w.toLocaleLowerCase('es-ES')));
    const hasDate = extractDate(norm) !== undefined;
    const hasTime = extractTime(norm) !== undefined;
    const hasNumber = /^\d+$/.test(norm.trim()) || !!numberWords[norm.trim()];
    if (allLetters && !hasNonName && !hasDate && !hasTime && !hasNumber && words.length >= 1 && words.length <= 5) {
      return titleCase(text);
    }
  }

  const stripped = text.replace(/^(es|para|soy|me\s+llamo|nombre)\s+/i, '').trim();
  if (stripped && /^[A-Za-záéíóúüñ]/.test(stripped)) {
    const candidate = stripped.split(/\s+(?:el|para|con|de|a\s+las?|\d)\b/i)[0]?.trim() ?? stripped;
    if (candidate && !NAME_BLACKLIST.has(candidate.toLocaleLowerCase('es-ES')) && !/\d/.test(candidate) && candidate.length >= 2) {
      return titleCase(candidate);
    }
  }

  return undefined;
}

export type ReservationField = 'guestName' | 'partySize' | 'date' | 'time' | 'table';

export interface ConversationReply {
  guestName?: string;
  partySize?: number;
  date?: string;
  time?: string;
  tableLabel?: string;
  cancel?: boolean;
  confirmed?: boolean;
  rejected?: boolean;
  unclear?: boolean;
}

/**
 * Context-aware reply extractor for multi-turn reservation flow.
 * Given which field the system expects, extracts it reliably — even from a single word.
 */
export function extractConversationReply(
  raw: string,
  expectedField: ReservationField,
  now: Date = new Date(),
): ConversationReply {
  const norm = raw.toLocaleLowerCase('es-ES').trim();

  // Global: cancel / confirm signals
  if (/\b(cancelar?|deten(er)?|olv[ií]da(lo)?|abortar?|d[eé]jalo|no\s+quiero(?:\s+nada)?|no\s+la\s+hagas?|salir)\b/i.test(norm) || /^(?:para|stop|alto)\s*[.!]?$/i.test(norm)) return { cancel: true };
  if (/^\s*(s[ií]|claro|correcto|confirmo|confirma|exacto|perfecto|adelante|ok|vale|dale|as[ií]\s+es|por\s+supuesto)\s*[.!]?\s*$/i.test(norm)) return { confirmed: true };
  if (/^\s*(no|incorrecto|mal|error|equivocado|no\s+es)\s*[.!]?\s*$/i.test(norm)) return { rejected: true };

  switch (expectedField) {
    case 'guestName': {
      const name = extractGuestName(raw, true);
      return name ? { guestName: name } : { unclear: true };
    }
    case 'partySize': {
      const ctxMatch = norm.match(/\b(?:somos|venimos|[eé]ramos|seremos)\s+([a-záéíóúüñ0-9]+)\b/);
      if (ctxMatch) {
        const n = numberWords[ctxMatch[1]] ?? Number(ctxMatch[1]);
        if (n && !isNaN(n) && n >= 1 && n <= 50) return { partySize: n };
      }
      const n = extractNumber(norm);
      if (n && n >= 1 && n <= 50) return { partySize: n };
      return { unclear: true };
    }
    case 'date': {
      const d = extractDate(norm, now);
      return d ? { date: d } : { unclear: true };
    }
    case 'time': {
      const t = extractTime(norm) ?? extractTimeLenient(norm);
      return t ? { time: t } : { unclear: true };
    }
    case 'table': {
      const tableMatch = norm.match(/\bmesa\s+([a-záéíóúüñ0-9]+)\b/i);
      if (tableMatch?.[1]) return { tableLabel: tableMatch[1] };
      const roomMatch = norm.match(/\b(terraza|interior|sala|comedor|bar|vip)\b/i);
      if (roomMatch?.[1]) return { tableLabel: roomMatch[1] };
      const laNum = norm.match(/\b(?:la|el|n[úu]mero)\s+([a-záéíóúüñ0-9]+)\b/);
      if (laNum?.[1]) return { tableLabel: laNum[1] };
      const n = extractNumber(norm);
      if (n) return { tableLabel: String(n) };
      return { unclear: true };
    }
  }
}

const TABLE_LABEL_BLACKLIST = new Set([
  'reserva', 'reservas', 'mesa', 'mesas', 'cita', 'persona', 'personas',
  'comensal', 'comensales', 'pax', 'hoy', 'mañana', 'pasado', 'noche', 'tarde',
  'una', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'sala', 'terraza', 'comedor', 'interior', 'bar', 'vip',
]);

function extractTableLabel(text: string): string | undefined {
  const directMesa = text.match(/\bmesa\s+([a-záéíóúüñ0-9-]+)\b/i);
  if (directMesa) {
    const cand = normalizeTableLabel(directMesa[1]);
    if (!TABLE_LABEL_BLACKLIST.has(cand.toLowerCase())) return cand;
  }
  const roomTable = text.match(/\b(?:terraza|interior|sala|comedor|bar|vip)\s+(?:la\s+)?([a-záéíóúüñ0-9-]+)\b/i);
  if (roomTable) {
    const cand = normalizeTableLabel(roomTable[1]);
    if (!TABLE_LABEL_BLACKLIST.has(cand.toLowerCase())) return cand;
  }
  const laNum = text.match(/\b(?:la|n[úu]mero|num)\s+([a-záéíóúüñ0-9]+)\b/i);
  if (laNum) {
    const cand = normalizeTableLabel(laNum[1]);
    if (!TABLE_LABEL_BLACKLIST.has(cand.toLowerCase())) return cand;
  }
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
  const date = extractDate(text, now);
  const time = extractTime(text);
  const partyMatches = [...text.matchAll(/(?:para|somos)\s+([a-záéíóúüñ0-9]+)|([a-záéíóúüñ0-9]+)\s*(?:personas?|pax|comensales?)/gi)];
  let partySize = partyMatches.map((match) => extractNumber(match[1] || match[2])).find((value) => value !== undefined && value >= 1 && value <= 30);
  if (!partySize) {
    const isGeneralReservationPhrase = /(?:crear?|hacer?|nueva|quiero|ponme|dame)\s+(?:una\s+)?reserva/i.test(text);
    if (!isGeneralReservationPhrase) {
      const rawNum = extractNumber(text);
      if (rawNum && rawNum >= 1 && rawNum <= 30 && !time && !tableLabel) partySize = rawNum;
    }
  }
  const reservationReference = text.match(/\b(res-\d{4}-\d{6})\b/i)?.[1]?.toUpperCase();

  const isCreateIntent = /(?:crea|crear|hacer|nueva|quiero|ponme|dame)\s+(?:una\s+)?reserva/i.test(text);

  if (!isCreateIntent && /(?:abre|abrir|ver|muestra|mu[eé]strame|ense[ñn]a|ense[ñn]ame)\s+(?:el\s+)?libro\s+de\s+reservas/i.test(text)) {
    if (date) return { action: 'list_reservations_date', date };
    return { action: 'list_today_reservations' };
  }

  if (!isCreateIntent && /(?:qu[eé]|cu[aá]les|tengo|hay|qui[eé]n|ver|dime|mira|mirar|mostrar|mu[eé]strame|ense[ñn]a|ense[ñn]ame|abre|abrir|libro|consulta|consultar|necesito)\s+.*reservas?.*(?:hoy|esta noche)|^\s*reservas?\s+(?:de\s+)?hoy\s*$/i.test(text)) {
    return { action: 'list_today_reservations', ...(tableLabel ? { tableLabel } : {}) };
  }
  if (!isCreateIntent && date && /reservas?/.test(text) && /(qu[eé]|cu[aá]les|tengo|hay|qui[eé]n|ver|dime|mira|mirar|mostrar|mu[eé]strame|ense[ñn]a|ense[ñn]ame|abre|abrir|libro|consulta|consultar|necesito)/i.test(text)) return { action: 'list_reservations_date', date };
  if (/(qu[eé]\s+)?mesas?.*(libres?|disponibles?)|(libres?|disponibles?).*mesas?/.test(text)) return { action: 'list_free_tables' };

  if (reservationReference && /(cancela|cancelar|anula|anular)/.test(text)) return assistantIntentSchema.parse({ action: 'cancel_reservation', reference: reservationReference });
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

  if (tableLabel && /(libre|disponible|cabe|puedo|reservar)/.test(text)) return assistantIntentSchema.parse({ action: 'check_table', tableLabel, partySize });

  if (/(mejor|recomienda|recomiendas|qué mesa|que mesa|dónde pongo|donde pongo)/.test(text)) {
    const size = partySize ?? extractNumber(text);
    if (size) return assistantIntentSchema.parse({ action: 'recommend_table', partySize: size });
  }

  const hasReservationParams =
    Boolean(tableLabel) || Boolean(time) || Boolean(partySize) ||
    /(reservar?|crea|crear|haz|nueva|ponme|dame|hacer?|reserva|mesa|terraza|comedor|sala|interior)\b/.test(text);

  if (hasReservationParams) {
    const nameMatch = text.match(/(?:a nombre de|nombre)\s+([a-záéíóúüñ][a-záéíóúüñ\s'-]*?)(?=\s+(?:el|para|a las?|en)\b|$)/i)?.[1]?.trim();
    const cleanName = (nameMatch && !['terraza', 'sala', 'comedor', 'interior', 'hoy', 'mañana', 'uno', 'dos', 'tres'].includes(nameMatch.toLowerCase())) ? nameMatch : undefined;
    return { action: 'draft_reservation', tableLabel, guestName: cleanName, date, time, partySize };
  }

  return { action: 'help' };
}
