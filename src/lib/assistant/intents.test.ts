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

test('prepares a Bizum email request with explicit amount and reservation', () => {
  assert.deepEqual(parseAssistantIntent('Informa la reserva RES-2026-000123 por Bizum de 35 euros'), {
    action: 'send_payment_request', reference: 'RES-2026-000123', method: 'bizum', amount: 35,
  });
});

test('understands today reservations by voice', () => {
  assert.deepEqual(parseAssistantIntent('qué reservas tengo hoy'), { action: 'list_today_reservations' });
  assert.deepEqual(parseAssistantIntent('dime las reservas para hoy de la mesa 1'), { action: 'list_today_reservations', tableLabel: '1' });
});

test('understands free tables by voice', () => {
  assert.deepEqual(parseAssistantIntent('dime qué mesas tengo libres'), { action: 'list_free_tables' });
});

test('parses standalone party size utterances like 4 personas', () => {
  assert.equal(parseAssistantIntent('4 personas').partySize, 4);
  assert.equal(parseAssistantIntent('somos 4').partySize, 4);
});

import { extractTime } from './intents';

test('parses spoken Spanish hours correctly', () => {
  assert.equal(extractTime('reserva a la una de la tarde'), '13:00');
  assert.equal(extractTime('a las dos y media'), '14:30');
  assert.equal(extractTime('las nueve de la noche'), '21:00');
  assert.equal(extractTime('a las diez de la mañana'), '10:00');
});

test('parses colloquial terrace and table time phrases correctly', () => {
  const result = parseAssistantIntent('eh la terraza la uno a las una', new Date(2026, 7, 22));
  assert.equal(result.action, 'draft_reservation');
  assert.equal(result.tableLabel, '1');
  assert.equal(result.time, '13:00');
});
