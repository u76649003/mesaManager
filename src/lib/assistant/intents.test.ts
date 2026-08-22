import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAssistantIntent } from './intents.ts';

test('parses a complete create proposal without confusing time with party size', () => {
  assert.deepEqual(parseAssistantIntent('Crea una reserva para Laura 2026-08-23 21:00 para 4'), {
    action: 'create_reservation', guestName: 'laura', date: '2026-08-23', time: '21:00', partySize: 4,
  });
});

test('parses cancellation only with an exact reservation number', () => {
  assert.deepEqual(parseAssistantIntent('Cancela RES-2026-000123'), {
    action: 'cancel_reservation', reference: 'RES-2026-000123',
  });
});

test('parses a prepayment amount and keeps it as a proposal', () => {
  assert.deepEqual(parseAssistantIntent('Pide anticipo de 30,50 para RES-2026-000123'), {
    action: 'require_prepayment', reference: 'RES-2026-000123', amount: 30.5,
  });
});

test('keeps an incomplete reservation as a conversational draft', () => {
  assert.deepEqual(parseAssistantIntent('Reserva la mesa 4 para 3 mañana a las 9', new Date(2026, 7, 22)), {
    action: 'draft_reservation', tableLabel: '4', guestName: undefined, date: '2026-08-23', time: '21:00', partySize: 3,
  });
});

test('queries reservations for another spoken date', () => {
  assert.deepEqual(parseAssistantIntent('qué reservas tengo mañana', new Date(2026, 7, 22)), { action: 'list_reservations_date', date: '2026-08-23' });
});

test('seats only an exact reservation reference', () => {
  assert.deepEqual(parseAssistantIntent('Sienta la reserva RES-2026-000123'), { action: 'seat_reservation', reference: 'RES-2026-000123' });
});

test('understands today reservations by voice', () => {
  assert.deepEqual(parseAssistantIntent('qué reservas tengo hoy'), { action: 'list_today_reservations' });
});

test('understands free tables by voice', () => {
  assert.deepEqual(parseAssistantIntent('dime qué mesas tengo libres'), { action: 'list_free_tables' });
});
