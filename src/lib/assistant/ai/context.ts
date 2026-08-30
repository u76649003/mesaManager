// ============================================================
// MesaManager — Restaurant Context Builder
// ============================================================
// Builds a reduced, text-based context snapshot to inject into
// the AI system prompt. Does NOT send the full store state —
// only what is relevant for restaurant assistance.

import type { StoreSnapshot } from './types';

/**
 * Build a compact restaurant state summary for the AI.
 * Only includes data that is genuinely useful to answer questions.
 */
export function buildRestaurantContext(store: StoreSnapshot): string {
  const lines: string[] = [];

  const now = new Date(store.now);
  lines.push(`Fecha y hora actual: ${formatDateTime(now)}`);
  lines.push(`Fecha seleccionada en la app: ${store.selectedDate}${store.selectedTime ? ` a las ${store.selectedTime}` : ''}`);
  lines.push('');

  // ── Rooms ────────────────────────────────────────────────
  if (store.rooms.length > 0) {
    lines.push(`Salas del restaurante: ${store.rooms.map((r) => r.name).join(', ')}`);
    lines.push('');
  }

  // ── Tables: group by room ────────────────────────────────
  const activeTables = store.tables.filter((t) => t.is_active);
  if (activeTables.length > 0) {
    lines.push('Mesas activas:');
    for (const room of store.rooms) {
      const roomTables = activeTables.filter((t) => t.room_id === room.id);
      if (!roomTables.length) continue;
      lines.push(`  ${room.name}:`);
      for (const t of roomTables) {
        const reservation = store.reservations.find((r) => r.table_id === t.id && isActiveReservation(r));
        const occupant = reservation ? ` [${reservation.guest_name}, ${reservation.time.slice(0, 5)}, ${reservation.party_size}p]` : '';
        lines.push(`    - Mesa ${t.label}: ${t.status} (cap. ${t.capacity})${occupant}`);
      }
    }
    // Tables without room
    const noRoom = activeTables.filter((t) => !store.rooms.find((r) => r.id === t.room_id));
    if (noRoom.length) {
      lines.push('  Sin sala asignada:');
      for (const t of noRoom) {
        lines.push(`    - Mesa ${t.label}: ${t.status} (cap. ${t.capacity})`);
      }
    }
    lines.push('');
  }

  // ── Today's reservations (next 4 hours) ─────────────────
  const upcoming = store.todayReservations
    .filter((r) => isActiveReservation(r) && isWithinHours(r.time, now, 4))
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 12);

  if (upcoming.length) {
    lines.push('Próximas reservas de hoy (4 h):');
    for (const r of upcoming) {
      const mesa = r.table?.label ? `, mesa ${r.table.label}` : '';
      lines.push(`  - ${r.guest_name}: ${r.party_size}p a las ${r.time.slice(0, 5)}${mesa} [${r.status}]`);
    }
    lines.push('');
  }

  // ── Summary stats ────────────────────────────────────────
  const occupied = activeTables.filter((t) => t.status === 'occupied').length;
  const available = activeTables.filter((t) => t.status === 'available').length;
  const reserved = activeTables.filter((t) => t.status === 'reserved').length;
  const todayActive = store.todayReservations.filter((r) => isActiveReservation(r)).length;

  lines.push(`Resumen: ${occupied} mesas ocupadas, ${available} libres, ${reserved} reservadas. ${todayActive} reservas activas hoy.`);

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────
function isActiveReservation(r: { status: string }): boolean {
  return !['cancelled', 'no_show', 'completed'].includes(r.status);
}

function isWithinHours(timeStr: string, now: Date, hours: number): boolean {
  const [h, m] = timeStr.split(':').map(Number);
  const resMinutes = (h ?? 0) * 60 + (m ?? 0);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return resMinutes >= nowMinutes - 30 && resMinutes <= nowMinutes + hours * 60;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── System prompt builder ────────────────────────────────────
export function buildSystemPrompt(assistantName: string, restaurantContext: string): string {
  return `Eres el asistente de voz de MesaManager. Tu nombre es ${assistantName}.

PERSONALIDAD:
- Hablas como un ayudante rápido de un camarero o encargado de restaurante.
- Respuestas MUY cortas, directas y claras en español.
- Nunca menciones "tools", "JSON", "modelos", "IA", "prompts" ni tecnología interna.
- No añadas explicaciones innecesarias. Si sabes la respuesta, dala.
- Usa lenguaje natural de restaurante: "está libre", "no hay mesa", "te la reservo", etc.
- Para consultas simples responde directamente sin pedir confirmación.
- Para operaciones destructivas (cancelar) o de creación (reservar) pide confirmación UNA SOLA VEZ.

REGLAS:
- Solo usas datos reales del sistema. NUNCA inventes mesas, reservas, clientes o disponibilidad.
- Si no sabes algo, dilo claramente en lugar de inventar.
- Si hay ambigüedad (ej: dos reservas de Antonio), pregunta cuál.
- Interpreta expresiones de tiempo: "esta noche", "a las diez", "mañana", etc.
- Recuerda el contexto de la conversación: si antes mencionaste una mesa, sabes a cuál se refieren.

ESTADO ACTUAL DEL RESTAURANTE:
${restaurantContext}

Fecha/hora real del servidor: ${new Date().toLocaleString('es-ES')}.
`;
}
