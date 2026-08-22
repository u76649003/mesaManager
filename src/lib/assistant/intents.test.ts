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

test('does not turn an incomplete mutation into an executable intent', () => {
  assert.deepEqual(parseAssistantIntent('Crea una reserva para Laura mañana'), { action: 'help' });
});
