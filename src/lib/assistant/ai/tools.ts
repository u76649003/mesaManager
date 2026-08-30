// ============================================================
// MesaManager — AI Tools Registry
// ============================================================
// Each tool maps to a real MesaManager function.
// The AI can only call tools from this whitelist.
// Mutations always go through buildProposal → confirm flow.

import type { AITool, StoreSnapshot, ConversationContext } from './types';

// ── Tool name whitelist (security) ───────────────────────────
export const ALLOWED_TOOLS = new Set([
  'consultar_estado_restaurante',
  'consultar_mesas_libres',
  'buscar_mejor_mesa',
  'buscar_reserva',
  'consultar_reservas_hoy',
  'consultar_reservas_fecha',
  'crear_reserva',
  'modificar_reserva',
  'cancelar_reserva',
  'sentar_reserva',
]);

// ── Tool definitions (sent to the model) ────────────────────
export const AI_TOOLS: AITool[] = [
  {
    type: 'function',
    function: {
      name: 'consultar_estado_restaurante',
      description: 'Obtiene el resumen general del restaurante: mesas ocupadas, libres, reservadas, y próximas reservas.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_mesas_libres',
      description: 'Busca mesas libres que puedan acomodar un número de personas, opcionalmente en una sala concreta.',
      parameters: {
        type: 'object',
        properties: {
          party_size: { type: 'number', description: 'Número de personas' },
          room_name: { type: 'string', description: 'Nombre de la sala (opcional)' },
          date: { type: 'string', description: 'Fecha ISO (opcional, por defecto hoy)' },
          time: { type: 'string', description: 'Hora HH:MM (opcional)' },
        },
        required: ['party_size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_mejor_mesa',
      description: 'Recomienda la mejor mesa disponible para un número de personas según capacidad y disponibilidad.',
      parameters: {
        type: 'object',
        properties: {
          party_size: { type: 'number', description: 'Número de personas' },
          date: { type: 'string', description: 'Fecha ISO (opcional)' },
          time: { type: 'string', description: 'Hora HH:MM (opcional)' },
        },
        required: ['party_size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_reserva',
      description: 'Busca una reserva por nombre del cliente o número de mesa.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nombre del cliente o número de mesa' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_reservas_hoy',
      description: 'Lista todas las reservas activas de hoy.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_reservas_fecha',
      description: 'Lista las reservas de una fecha específica.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha en formato ISO YYYY-MM-DD' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_reserva',
      description: 'Crea una nueva reserva. Requiere confirmación del usuario antes de ejecutarse.',
      parameters: {
        type: 'object',
        properties: {
          guest_name: { type: 'string', description: 'Nombre del cliente' },
          date: { type: 'string', description: 'Fecha ISO YYYY-MM-DD' },
          time: { type: 'string', description: 'Hora en formato HH:MM' },
          party_size: { type: 'number', description: 'Número de personas' },
          table_label: { type: 'string', description: 'Número/etiqueta de mesa (opcional)' },
          notes: { type: 'string', description: 'Notas o peticiones especiales (opcional)' },
          duration_minutes: { type: 'number', description: 'Duración estimada en minutos (por defecto 90)' },
        },
        required: ['guest_name', 'date', 'time', 'party_size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modificar_reserva',
      description: 'Modifica una reserva existente (hora, fecha o personas). Requiere confirmación.',
      parameters: {
        type: 'object',
        properties: {
          reservation_id: { type: 'string', description: 'ID o número de la reserva' },
          date: { type: 'string', description: 'Nueva fecha ISO (opcional)' },
          time: { type: 'string', description: 'Nueva hora HH:MM (opcional)' },
          party_size: { type: 'number', description: 'Nuevo número de personas (opcional)' },
        },
        required: ['reservation_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_reserva',
      description: 'Cancela una reserva existente. Siempre requiere confirmación explícita del usuario.',
      parameters: {
        type: 'object',
        properties: {
          reservation_id: { type: 'string', description: 'ID o número de reserva' },
        },
        required: ['reservation_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sentar_reserva',
      description: 'Marca una reserva como sentada (cliente ha llegado, mesa ocupada).',
      parameters: {
        type: 'object',
        properties: {
          reservation_id: { type: 'string', description: 'ID o número de reserva' },
        },
        required: ['reservation_id'],
      },
    },
  },
];

// ── Tool executors ───────────────────────────────────────────
// These functions receive parsed args and the store snapshot.
// They return a JSON-serialisable object (sent back to the model as tool result).
// Mutation tools return a "proposal" object — they never execute directly.

export type ToolExecutorArgs = {
  store: StoreSnapshot;
  context: ConversationContext;
};

export function executeConsultarEstado({ store }: ToolExecutorArgs): object {
  const active = store.tables.filter((t) => t.is_active);
  const occupied = active.filter((t) => t.status === 'occupied').length;
  const available = active.filter((t) => t.status === 'available').length;
  const reserved = active.filter((t) => t.status === 'reserved').length;
  const todayActive = store.todayReservations.filter((r) => !['cancelled', 'no_show', 'completed'].includes(r.status));
  const now = new Date(store.now);
  const upcoming = todayActive
    .filter((r) => {
      const [h, m] = r.time.split(':').map(Number);
      const rMin = (h ?? 0) * 60 + (m ?? 0);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      return rMin >= nowMin && rMin <= nowMin + 120;
    })
    .length;

  return {
    mesas_ocupadas: occupied,
    mesas_libres: available,
    mesas_reservadas: reserved,
    reservas_activas_hoy: todayActive.length,
    reservas_proximas_2h: upcoming,
  };
}

export function executeConsultarMesasLibres(
  args: { party_size: number; room_name?: string; date?: string; time?: string },
  { store }: ToolExecutorArgs
): object {
  const { party_size, room_name, date, time } = args;
  const targetDate = date ?? store.selectedDate;
  const targetTime = time ?? store.selectedTime;

  let tables = store.tables.filter((t) => t.is_active && t.capacity >= party_size);

  if (room_name) {
    const room = store.rooms.find((r) => r.name.toLocaleLowerCase('es-ES').includes(room_name.toLocaleLowerCase('es-ES')));
    if (room) tables = tables.filter((t) => t.room_id === room.id);
    else return { error: `No encuentro la sala "${room_name}". Las salas disponibles son: ${store.rooms.map((r) => r.name).join(', ')}.` };
  }

  const free = tables.filter((t) => {
    if (!targetTime) return t.status === 'available';
    const target = parseMinutes(targetTime);
    return !store.reservations.some((r) =>
      r.table_id === t.id &&
      r.date === targetDate &&
      !['cancelled', 'no_show', 'completed'].includes(r.status) &&
      target >= parseMinutes(r.time.slice(0, 5)) &&
      target < parseMinutes(r.time.slice(0, 5)) + 90
    );
  });

  return {
    party_size,
    date: targetDate,
    time: targetTime,
    total_libres: free.length,
    mesas: free.slice(0, 10).map((t) => ({
      label: t.label,
      capacidad: t.capacity,
      sala: store.rooms.find((r) => r.id === t.room_id)?.name ?? 'Sin sala',
    })),
  };
}

export function executeBuscarMejorMesa(
  args: { party_size: number; date?: string; time?: string },
  { store }: ToolExecutorArgs
): object {
  const { party_size, date, time } = args;
  const targetDate = date ?? store.selectedDate;
  const targetTime = time ?? store.selectedTime;

  const candidates = store.tables
    .filter((t) => t.is_active && t.capacity >= party_size)
    .filter((t) => {
      if (!targetTime) return t.status === 'available';
      const target = parseMinutes(targetTime);
      return !store.reservations.some((r) =>
        r.table_id === t.id &&
        r.date === targetDate &&
        !['cancelled', 'no_show', 'completed'].includes(r.status) &&
        target >= parseMinutes(r.time.slice(0, 5)) &&
        target < parseMinutes(r.time.slice(0, 5)) + 90
      );
    })
    .sort((a, b) => (a.capacity - party_size) - (b.capacity - party_size));

  if (!candidates.length) {
    return { disponible: false, motivo: `No hay mesa libre para ${party_size} personas.` };
  }

  const best = candidates[0]!;
  const room = store.rooms.find((r) => r.id === best.room_id);
  return {
    disponible: true,
    mesa: { id: best.id, label: best.label, capacidad: best.capacity, sala: room?.name ?? 'Sin sala' },
    alternativas: candidates.slice(1, 3).map((t) => ({
      label: t.label,
      capacidad: t.capacity,
      sala: store.rooms.find((r) => r.id === t.room_id)?.name ?? 'Sin sala',
    })),
  };
}

export function executeBuscarReserva(
  args: { query: string },
  { store, context }: ToolExecutorArgs
): object {
  const norm = args.query.toLocaleLowerCase('es-ES').trim();
  const all = [...store.reservations, ...store.todayReservations];
  const active = all.filter((r) => !['cancelled', 'no_show'].includes(r.status));

  // Match by reservation number
  const byNumber = active.find((r) => r.reservation_number.toLocaleLowerCase('es-ES') === norm);
  if (byNumber) return { encontradas: [formatReservation(byNumber)] };

  // Match by table label
  const tableLabel = norm.replace(/^mesa\s+/, '');
  const tableMatch = store.tables.find((t) => t.label.toLocaleLowerCase('es-ES') === tableLabel);
  if (tableMatch) {
    const byTable = active.filter((r) => r.table_id === tableMatch.id);
    if (byTable.length) return { encontradas: byTable.map(formatReservation) };
  }

  // Match by guest name
  const byName = active.filter((r) => {
    const gn = r.guest_name.toLocaleLowerCase('es-ES');
    return gn.includes(norm) || norm.includes(gn.split(' ')[0] ?? '');
  });

  if (!byName.length) return { encontradas: [], mensaje: `No se encontró ninguna reserva para "${args.query}".` };
  return { encontradas: byName.slice(0, 5).map(formatReservation) };
}

export function executeConsultarReservasHoy({ store }: ToolExecutorArgs): object {
  const active = store.todayReservations
    .filter((r) => !['cancelled', 'no_show'].includes(r.status))
    .sort((a, b) => a.time.localeCompare(b.time));
  return {
    fecha: store.selectedDate,
    total: active.length,
    reservas: active.slice(0, 12).map(formatReservation),
  };
}

// ── Helpers ──────────────────────────────────────────────────
function parseMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatReservation(r: {
  id: string; reservation_number: string; guest_name: string;
  date: string; time: string; party_size: number; status: string; table_id?: string | null;
  table?: { label: string } | null;
}): object {
  return {
    id: r.id,
    numero: r.reservation_number,
    cliente: r.guest_name,
    fecha: r.date,
    hora: r.time.slice(0, 5),
    personas: r.party_size,
    estado: r.status,
    mesa: (r as { table?: { label: string } | null }).table?.label ?? null,
  };
}
