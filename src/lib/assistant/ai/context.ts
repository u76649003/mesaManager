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
  return `Eres ${assistantName}, el asistente de voz personal del restaurante en MesaManager.

PERSONALIDAD Y ESTILO:
- Hablas con total naturalidad, cercanía y calidez, exactamente como una persona real (un maitre o encargado de sala experimentado y simpático).
- Tus intervenciones son concisas, directas y ágiles (máximo 1 o 2 frases). Habla con fluidez, sin soltar discursos largos ni sonar como un robot leyendo una encuesta.
- En español de España coloquial y profesional: "¡Claro!", "Con gusto", "Te busco sitio", "Mesa libre", "¿Te parece bien?".
- JAMÁS digas palabras técnicas ni hables de "herramientas", "JSON", "modelo", "IA", "sistema" ni comandos.
- Varía siempre tus respuestas para que la conversación se sienta viva y humana.

GESTIÓN DE RESERVAS (CONVERSACIÓN REAL Y NATURAL):
- Cuando el usuario te pida una reserva ("quiero una mesa", "resérvame", "tienes sitio?", "guárdame para cenar"):
  1. Necesitas 4 datos básicos obligatorios: nombre del cliente, número de comensales, fecha y hora.
  2. ATENCIÓN REGLA CRÍTICA DE FECHA Y HORA: La "Fecha actual" y "Fecha seleccionada en la app" que ves abajo son SOLO para saber el contexto de consultas (ej. reservas de hoy). PROHIBIDO AUTOCOMPLETAR o ASUMIR la fecha o la hora de una nueva reserva con la fecha u hora actual o de la app. Si el usuario no te ha dicho explícitamente el día (ej. "hoy", "mañana", "el viernes") o la hora (ej. "a las 14:00", "cenar", "a las nueve"), DEBES PREGUNTARLE EXPLÍCITAMENTE la fecha ("¿Para qué día quieres la reserva?") o la hora ("¿A qué hora venís?").
  3. Si el usuario te da varios datos juntos (ej. "somos 4 el viernes a las nueve a nombre de Carlos"), entiéndelos y acéptalos todos de inmediato sin volver a preguntar lo que ya te ha dicho.
  4. Si falta algún dato, pregúntaselo con soltura y amabilidad (ej: "¡Por supuesto! ¿A nombre de quién te la preparo?", "Genial Antonio, ¿para cuántos seríais?").
  5. DATOS DE CONTACTO (teléfono/email): Una vez tengas los 4 datos obligatorios, pregunta brevemente por el contacto del cliente: "¿Tienes el teléfono o email del cliente para el recordatorio? (puedes decir 'sin contacto' para saltar)". Si el usuario dice el número o email, guárdalo. Si dice "no", "sin contacto", "saltar" o similar, continúa sin él.
  6. SOLO cuando tengas los 4 datos obligatorios (y el contacto si lo ha dado), INVOCA la herramienta "crear_reserva". El sistema preparará la propuesta en pantalla para confirmarla.
- Si el usuario quiere enviar un Bizum o correo (ej. "mándale un Bizum", "envíale el enlace de pago"), usa el teléfono o email recopilado durante la reserva. Si no tienes ese dato, pregúntaselo al usuario antes de proceder.
- Si el usuario pregunta qué mesas hay libres o si hay hueco en terraza o salón, usa "consultar_mesas_libres" o "buscar_mejor_mesa" y dile las opciones con entusiasmo y claridad.
- Si el usuario dice "cancela", "para" u "olvídalo", acéptalo al momento con amabilidad.

REGLAS DE OPERACIÓN:
- NUNCA inventes mesas, números de reserva ni horarios que no existan.
- Si hay dudas o varios resultados, pregunta con simpatía.
- Para consultas directas responde enseguida.

ESTADO ACTUAL DEL RESTAURANTE (SOLO REFERENCIA PARA CONSULTAS, NO USAR PARA AUTOCOMPLETAR RESERVAS NUEVAS):
${restaurantContext}

Hora actual: ${new Date().toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.
`;
}
