// ============================================================
// MesaManager — AI Provider / Orchestrator
// ============================================================
// processWithAI is the main entry point.
// Returns null if AI is unavailable → caller uses parseAssistantIntent fallback.
// Returns an AIResponseKind object on success.

import { callAssistantChat } from './ollama';
import {
  AI_TOOLS, ALLOWED_TOOLS,
  executeConsultarEstado,
  executeConsultarMesasLibres,
  executeBuscarMejorMesa,
  executeBuscarReserva,
  executeConsultarReservasHoy,
} from './tools';
import {
  addUserMessage,
  addAssistantMessage,
  addToolResult,
  updateContext,
  isEndOfSession,
} from './conversation';
import { buildRestaurantContext, buildSystemPrompt } from './context';
import type {
  AIResponseKind,
  ConversationSession,
  StoreSnapshot,
  AIToolCall,
  AIMessage,
} from './types';

// Mutation tool names — these produce proposals, not direct execution
const MUTATION_TOOLS = new Set([
  'crear_reserva',
  'modificar_reserva',
  'cancelar_reserva',
  'sentar_reserva',
]);

// ── Active request guard ──────────────────────────────────────
let activeController: AbortController | null = null;

function abortPreviousRequest(): AbortController {
  activeController?.abort();
  activeController = new AbortController();
  return activeController;
}

// ── Main entry ───────────────────────────────────────────────
export async function processWithAI(
  command: string,
  session: ConversationSession,
  store: StoreSnapshot,
  assistantName: string
): Promise<AIResponseKind | null> {
  // ── End of session detection ─────────────────────────────
  if (isEndOfSession(command)) {
    return { kind: 'end_session', text: 'Perfecto.' };
  }

  // ── Build/update system message ──────────────────────────
  const restaurantContext = buildRestaurantContext(store);
  const systemPrompt = buildSystemPrompt(assistantName, restaurantContext);
  // Always update the first (system) message with fresh context
  if (session.messages[0]?.role === 'system') {
    session.messages[0].content = systemPrompt;
  }

  // ── Add user turn ────────────────────────────────────────
  addUserMessage(session, command);

  // ── Call AI (with abort control) ─────────────────────────
  const controller = abortPreviousRequest();
  console.info('[AI] Processing:', command);

  const aiResponse = await callAssistantChat(
    { messages: session.messages, tools: AI_TOOLS, restaurantContext },
    controller.signal
  );

  if (!aiResponse) {
    // AI unavailable — remove the user message we just added so fallback
    // processes it cleanly (it will call parseAssistantIntent directly)
    session.messages.pop();
    return null;
  }

  console.info('[AI] finish_reason:', aiResponse.finish_reason, 'tool_calls:', aiResponse.tool_calls?.length ?? 0);

  // ── Handle tool calls ────────────────────────────────────
  if (aiResponse.finish_reason === 'tool_calls' && aiResponse.tool_calls?.length) {
    // Validate whitelist
    const invalid = aiResponse.tool_calls.find((tc) => !ALLOWED_TOOLS.has(tc.function.name));
    if (invalid) {
      console.warn('[AI] Blocked unknown tool:', invalid.function.name);
      addAssistantMessage(session, 'No puedo hacer eso ahora mismo.');
      return { kind: 'text', text: 'No puedo hacer eso ahora mismo.' };
    }

    // Add assistant message with tool_calls (required by spec)
    session.messages.push({
      role: 'assistant',
      content: aiResponse.content ?? '',
      tool_calls: aiResponse.tool_calls,
    });

    // Execute each tool
    const toolResults: Array<{ id: string; result: string }> = [];
    for (const tc of aiResponse.tool_calls) {
      const result = await executeTool(tc, store, session, assistantName);
      toolResults.push({ id: tc.id, result: JSON.stringify(result.data) });

      // Mutation tools produce a proposal — return it immediately
      if (result.kind === 'proposal') {
        addToolResult(session, tc.id, JSON.stringify(result.data));
        return {
          kind: 'proposal',
          summary: result.proposal!.summary,
          operation: result.proposal!.operation,
          paymentRequest: result.proposal?.paymentRequest,
          prepayment: result.proposal?.prepayment,
        };
      }
    }

    // Add tool results to history
    for (const tr of toolResults) {
      addToolResult(session, tr.id, tr.result);
    }

    // Make a second AI call to get the natural-language response
    const controller2 = abortPreviousRequest();
    const followUp = await callAssistantChat(
      { messages: session.messages, tools: AI_TOOLS, restaurantContext },
      controller2.signal
    );

    if (!followUp || !followUp.content) {
      // Fallback: summarise results ourselves
      const summaries = toolResults.map((tr) => tr.result).join('\n');
      addAssistantMessage(session, summaries);
      return { kind: 'text', text: formatFallbackSummary(toolResults) };
    }

    const text = followUp.content.trim();
    addAssistantMessage(session, text);
    return { kind: 'text', text };
  }

  // ── Plain text response ──────────────────────────────────
  const text = aiResponse.content?.trim() ?? '';
  if (!text) return null;

  addAssistantMessage(session, text);
  return { kind: 'text', text };
}

// ── Tool executor ────────────────────────────────────────────
async function executeTool(
  tc: AIToolCall,
  store: StoreSnapshot,
  session: ConversationSession,
  _assistantName: string
): Promise<{ kind: 'data' | 'proposal'; data: object; proposal?: { summary: string; operation: Record<string, unknown>; paymentRequest?: 'online' | 'bizum'; prepayment?: boolean } }> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
  } catch {
    console.warn('[AI] Invalid tool args JSON for', tc.function.name);
    return { kind: 'data', data: { error: 'Argumentos inválidos' } };
  }

  console.info('[AI] Executing tool:', tc.function.name, args);

  const toolCtx = { store, context: session.context };

  switch (tc.function.name) {
    case 'consultar_estado_restaurante':
      return { kind: 'data', data: executeConsultarEstado(toolCtx) };

    case 'consultar_mesas_libres': {
      const data = executeConsultarMesasLibres(args as Parameters<typeof executeConsultarMesasLibres>[0], toolCtx);
      // Update structured context with search results
      if ('mesas' in data && Array.isArray((data as { mesas: Array<{ label: string }> }).mesas)) {
        updateContext(session, {
          lastSearchResults: (data as { mesas: Array<{ label: string }> }).mesas.map((m) => m.label),
          partySize: args.party_size as number,
        });
      }
      return { kind: 'data', data };
    }

    case 'buscar_mejor_mesa': {
      const data = executeBuscarMejorMesa(args as Parameters<typeof executeBuscarMejorMesa>[0], toolCtx);
      if ('mesa' in data && (data as { mesa?: { id: string; label: string } }).mesa) {
        const mesa = (data as { mesa: { id: string; label: string } }).mesa;
        updateContext(session, { activeTableId: mesa.id, activeTableLabel: mesa.label, partySize: args.party_size as number });
      }
      return { kind: 'data', data };
    }

    case 'buscar_reserva': {
      const data = executeBuscarReserva(args as { query: string }, toolCtx);
      const encontradas = (data as { encontradas?: Array<{ id: string; numero: string; cliente: string; hora: string }> }).encontradas;
      if (encontradas?.length === 1) {
        updateContext(session, {
          activeReservationId: encontradas[0]!.id,
          activeReservationNumber: encontradas[0]!.numero,
          activeGuestName: encontradas[0]!.cliente,
        });
      } else if (encontradas?.length) {
        updateContext(session, { lastReservationResults: encontradas.map((r) => ({ id: r.id, reservation_number: r.numero, guest_name: r.cliente, time: r.hora })) });
      }
      return { kind: 'data', data };
    }

    case 'consultar_reservas_hoy':
      return { kind: 'data', data: executeConsultarReservasHoy(toolCtx) };

    case 'consultar_reservas_fecha': {
      // Simple data return; actual Supabase query handled by API route
      const dateStr = args.date as string;
      if (!dateStr) return { kind: 'data', data: { error: 'Falta la fecha' } };
      return {
        kind: 'data',
        data: {
          _action: 'fetch_reservations_date',
          date: dateStr,
          // The API route will handle this; we return a marker for the follow-up
        },
      };
    }

    case 'crear_reserva': {
      const { guest_name, date, time, party_size, table_label, notes, duration_minutes } = args as {
        guest_name: string; date: string; time: string; party_size: number;
        table_label?: string; notes?: string; duration_minutes?: number;
      };
      if (!guest_name || !date || !time || !party_size) {
        return { kind: 'data', data: { error: 'Faltan campos obligatorios para crear la reserva' } };
      }
      const noteStr = notes ? ` (Nota: ${notes})` : '';
      const mesaStr = table_label ? `, mesa ${table_label}` : '';
      const summary = `Crear reserva para ${guest_name}, ${party_size} personas, el ${date} a las ${time}${mesaStr}${noteStr}.`;
      const operation: Record<string, unknown> = {
        action: 'create_reservation',
        guest_name,
        party_size,
        date,
        time,
        duration_minutes: duration_minutes ?? 90,
        notes,
      };
      // Resolve table ID if label provided
      if (table_label) {
        const tbl = store.tables.find((t) => t.label.toLocaleLowerCase('es-ES') === table_label.toLocaleLowerCase('es-ES'));
        if (tbl) operation.table_id = tbl.id;
      }
      return { kind: 'proposal', data: { proposal: true, summary }, proposal: { summary, operation } };
    }

    case 'modificar_reserva': {
      const { reservation_id, date, time, party_size } = args as {
        reservation_id: string; date?: string; time?: string; party_size?: number;
      };
      // Try to resolve by ID, number, or from context
      const resolvedId = reservation_id || session.context.activeReservationId;
      if (!resolvedId) return { kind: 'data', data: { error: 'No sé qué reserva modificar' } };

      const changes = [date ? `fecha ${date}` : '', time ? `hora ${time}` : '', party_size ? `${party_size} personas` : ''].filter(Boolean).join(', ');
      const guestRef = session.context.activeGuestName ?? resolvedId;
      const summary = `Modificar la reserva de ${guestRef}: ${changes}.`;
      const operation: Record<string, unknown> = { action: 'update_reservation', reservation_id: resolvedId, date, time, party_size };
      return { kind: 'proposal', data: { proposal: true, summary }, proposal: { summary, operation } };
    }

    case 'cancelar_reserva': {
      const { reservation_id } = args as { reservation_id: string };
      const resolvedId = reservation_id || session.context.activeReservationId;
      if (!resolvedId) return { kind: 'data', data: { error: 'No sé qué reserva cancelar' } };

      const guestRef = session.context.activeGuestName ?? resolvedId;
      const summary = `Cancelar la reserva de ${guestRef}.`;
      const operation: Record<string, unknown> = { action: 'cancel_reservation', reservation_id: resolvedId };
      return { kind: 'proposal', data: { proposal: true, summary }, proposal: { summary, operation } };
    }

    case 'sentar_reserva': {
      const { reservation_id } = args as { reservation_id: string };
      const resolvedId = reservation_id || session.context.activeReservationId;
      if (!resolvedId) return { kind: 'data', data: { error: 'No sé a quién sentar' } };

      const guestRef = session.context.activeGuestName ?? resolvedId;
      const summary = `Sentar a ${guestRef}.`;
      const operation: Record<string, unknown> = { action: 'seat_reservation', reservation_id: resolvedId };
      return { kind: 'proposal', data: { proposal: true, summary }, proposal: { summary, operation } };
    }

    default:
      return { kind: 'data', data: { error: `Tool desconocida: ${tc.function.name}` } };
  }
}

// ── Fallback summary formatter ───────────────────────────────
function formatFallbackSummary(results: Array<{ id: string; result: string }>): string {
  try {
    const first = JSON.parse(results[0]?.result ?? '{}');
    if (first.error) return `No pude completar la operación: ${first.error}`;
    if (first.mesas_libres !== undefined) return `Hay ${first.mesas_libres as number} mesas libres y ${first.mesas_ocupadas as number} ocupadas.`;
    if (first.reservas) return `Tienes ${(first.reservas as unknown[]).length} reservas.`;
  } catch { /* ignore */ }
  return 'Listo.';
}
