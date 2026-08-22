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
  z.object({ action: z.literal('require_prepayment'), reference: z.string().min(1), amount: z.number().positive() }),
]);

export type AssistantIntent = z.infer<typeof assistantIntentSchema>;
export type AssistantMutationIntent = Extract<AssistantIntent, { action: 'create_reservation' | 'update_reservation' | 'cancel_reservation' | 'require_prepayment' }>;

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

export function parseAssistantIntent(raw: string): AssistantIntent {
  const text = raw.toLocaleLowerCase('es-ES').trim();
  const tableMatch = text.match(/mesa\s+([a-záéíóúüñ0-9-]+)/i);
  const partyMatches = [...text.matchAll(/(?:para|somos)\s+([a-záéíóúüñ0-9]+)/gi)];
  const partySize = partyMatches.map((match) => extractNumber(match[1])).find((value) => value !== undefined);
  const reservationReference = text.match(/\b(res-\d{4}-\d{6})\b/i)?.[1]?.toUpperCase();
  const date = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  const time = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)?.[0];

  if (reservationReference && /(cancela|cancelar|anula|anular)/.test(text)) {
    return assistantIntentSchema.parse({ action: 'cancel_reservation', reference: reservationReference });
  }
  if (reservationReference && /(anticipo|depósito|deposito|garantía|garantia)/.test(text)) {
    const amountMatch = text.match(/(?:anticipo|depósito|deposito|garantía|garantia)(?:\s+de)?\s+(\d+(?:[.,]\d{1,2})?)/);
    if (amountMatch) return assistantIntentSchema.parse({ action: 'require_prepayment', reference: reservationReference, amount: Number(amountMatch[1].replace(',', '.')) });
  }
  if (reservationReference && /(mueve|cambia|modifica|actualiza)/.test(text) && (date || time || partySize)) {
    return assistantIntentSchema.parse({ action: 'update_reservation', reference: reservationReference, date, time, partySize });
  }
  if (/(crea|crear|haz|nueva)\s+(?:una\s+)?reserva/.test(text) && date && time && partySize) {
    const name = text.match(/(?:para|a nombre de)\s+([a-záéíóúüñ][a-záéíóúüñ\s'-]*?)(?=\s+(?:el\s+)?20\d{2}-|\s+para\s+\d|$)/i)?.[1]?.trim();
    if (name) return assistantIntentSchema.parse({ action: 'create_reservation', guestName: name, date, time, partySize });
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
