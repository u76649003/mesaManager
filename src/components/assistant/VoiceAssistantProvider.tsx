'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check, Mic, MicOff, Pencil, Send, Sparkles, Volume2, X } from 'lucide-react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createClient } from '@/lib/supabase/client';
import { createPrepaymentSession } from '@/app/actions/payments';
import { sendAssistantPaymentRequest } from '@/app/actions/emails';
import { parseAssistantIntent, extractNumber, extractTime, extractDate, type AssistantMutationIntent } from '@/lib/assistant/intents';
import {
  executeAssistantOperation, loadAssistantConfiguration, resolveReservation,
  saveAssistantConfiguration, type AssistantOperation,
} from '@/lib/assistant/reservations';
import { useFloorStore } from '@/stores/useFloorStore';
import { useReservationStore } from '@/stores/useReservationStore';
import type { Reservation, Room, Table } from '@/types';
// ── AI conversational layer ─────────────────────────────────────────────────
import { processWithAI } from '@/lib/assistant/ai/provider';
import {
  createSession, clearSession, isSessionTimedOut, isEndOfSession,
} from '@/lib/assistant/ai/conversation';
import { buildSystemPrompt, buildRestaurantContext } from '@/lib/assistant/ai/context';
import type { ConversationSession, StoreSnapshot } from '@/lib/assistant/ai/types';
import { modelManager, type ModelInfo } from '@/lib/assistant/ai/modelManager';

type RecognitionEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: RecognitionEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
declare global { interface Window { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition } }

type PendingProposal = { summary: string; operation: AssistantOperation; prepayment?: boolean; paymentRequest?: 'online' | 'bizum' };
type ReservationDraft = {
  tableLabel?: string;
  guestName?: string;
  date?: string;
  time?: string;
  partySize?: number;
  notes?: string;
  askedNotes?: boolean;
  paymentMethod?: 'none' | 'bizum' | 'online';
  askedPayment?: boolean;
  paymentAmount?: number;
};
type Conversation =
  | { kind: 'free_tables_room' }
  | { kind: 'search_tables'; roomId?: string; partySize?: number }
  | { kind: 'reservation'; draft: ReservationDraft }
  | { kind: 'seat_reference' }
  | { kind: 'await_reference'; nextAction: 'cancel_reservation' | 'seat_reservation' }
  | { kind: 'await_modify_ref' }
  | { kind: 'modify_reservation'; reference: string }
  | { kind: 'search_reservation_query' };
type WakeWordPluginApi = {
  start(options: { name: string }): Promise<{ active: boolean }>;
  stop(): Promise<{ active: boolean }>;
  speak(options: { text: string; expectReply: boolean }): Promise<void>;
  addListener(event: 'wakeCommand', listener: (data: { command: string }) => void): Promise<PluginListenerHandle>;
};
const WakeWord = registerPlugin<WakeWordPluginApi>('WakeWord');
const capacity = (table: Table) => table.capacity ?? table.table_type?.capacity ?? 0;
function overlaps(table: Table, reservations: Reservation[], date: string, time: string | null) {
  if (!time) return table.status !== 'available';
  const target = time.split(':').map(Number).reduce((h, m) => h * 60 + m);
  return reservations.some((r) => r.table_id === table.id && r.date === date && !['cancelled', 'no_show', 'completed'].includes(r.status)
    && target >= r.time.slice(0, 5).split(':').map(Number).reduce((h, m) => h * 60 + m)
    && target < r.time.slice(0, 5).split(':').map(Number).reduce((h, m) => h * 60 + m) + (r.duration_minutes || 90));
}

function evaluateOptimalRoomAndTable(
  partySize: number,
  rooms: Room[],
  tables: Table[],
  reservations: Reservation[],
  date: string,
  time: string | null
) {
  const activeTables = tables.filter((t) => t.is_active && capacity(t) >= partySize && !overlaps(t, reservations, date, time));
  if (!activeTables.length) return null;

  const roomSummaries = rooms.map((room) => {
    const freeInRoom = activeTables.filter((t) => t.room_id === room.id);
    if (!freeInRoom.length) return null;
    freeInRoom.sort((a, b) => (capacity(a) - partySize) - (capacity(b) - partySize));
    return { room, count: freeInRoom.length, bestTable: freeInRoom[0] };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  if (!roomSummaries.length) return null;

  roomSummaries.sort((a, b) => (capacity(a.bestTable) - partySize) - (capacity(b.bestTable) - partySize));

  return { bestRoom: roomSummaries[0].room, bestTable: roomSummaries[0].bestTable, roomSummaries };
}

/**
 * Find a reservation in the local cache by guest name or table label.
 * Returns the matched reservation, an ambiguous list, or null.
 */
function findReservation(
  input: string,
  reservations: Reservation[],
  tables: Table[],
): { reservation: Reservation } | { ambiguous: Reservation[] } | null {
  const raw  = input.trim();
  const norm = raw.toLocaleLowerCase('es-ES')
    .replace(/^(la\s+reserva\s+(de(l?)?\s*)?|reserva\s+(de(l?)?\s*)?|la\s+de\s*)/, '')
    .replace(/^(la\s+)?mesa\s+/, '')
    .trim();
  const active = reservations.filter((r) => !['cancelled', 'no_show'].includes(r.status));

  // 1. Match by table label
  const tbl = tables.find(
    (t) => t.label.toLocaleLowerCase('es-ES') === norm ||
           t.label.toLocaleLowerCase('es-ES') === raw.toLocaleLowerCase('es-ES'),
  );
  if (tbl) {
    const byTable = active.filter((r) => r.table_id === tbl.id);
    if (byTable.length === 1) return { reservation: byTable[0] };
    if (byTable.length > 1)  return { ambiguous: byTable };
  }

  // 2. Match by guest name (substring / first-name prefix)
  const byName = active.filter((r) => {
    const gn = r.guest_name.toLocaleLowerCase('es-ES');
    return gn.includes(norm) || norm.includes(gn.split(' ')[0]);
  });
  if (byName.length === 1) return { reservation: byName[0] };
  if (byName.length > 1)  return { ambiguous: byName };
  return null;
}

/** True when the assistant message is a question or we are mid-conversation. */
function needsReply(message: string, inConversation: boolean) {
  return inConversation || message.trim().endsWith('?');
}

// ===== Style Profile: learns and adapts to each user's conversation style =====
const STYLE_LS_KEY = 'mm-va-style-v1';
type StyleProfile = {
  tone: 'tu' | 'usted' | 'neutral'; // formality
  verbosity: 'short' | 'normal';     // answer length
  preferredRoomId?: string;           // room used most often (>= 3 times)
  preferredPartySize?: number;        // party size used most often (>= 2 times)
  preferredTime?: string;             // time used most often (>= 2 times)
  frequentGuests: string[];           // guest names used frequently
  roomCounts: Record<string, number>;
  partySizeCounts: Record<string, number>;
  timeCounts: Record<string, number>;
  guestCounts: Record<string, number>;
  interactions: number;
};
function defaultStyle(): StyleProfile {
  return {
    tone: 'neutral', verbosity: 'normal', frequentGuests: [],
    roomCounts: {}, partySizeCounts: {}, timeCounts: {}, guestCounts: {}, interactions: 0,
  };
}
function loadStyle(key: string): StyleProfile {
  if (typeof window === 'undefined') return defaultStyle();
  try { const s = localStorage.getItem(key); return s ? { ...defaultStyle(), ...JSON.parse(s) } : defaultStyle(); } catch { return defaultStyle(); }
}
function saveStyle(key: string, s: StyleProfile) {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch {}
}
function evolveStyle(
  s: StyleProfile, command: string,
  extras?: { roomId?: string; partySize?: number; time?: string; guestName?: string }
): StyleProfile {
  const n: StyleProfile = {
    ...s,
    roomCounts: { ...s.roomCounts },
    partySizeCounts: { ...s.partySizeCounts },
    timeCounts: { ...s.timeCounts },
    guestCounts: { ...s.guestCounts },
    frequentGuests: [...(s.frequentGuests || [])],
    interactions: s.interactions + 1,
  };
  const t = command.toLocaleLowerCase('es-ES');
  // Tone
  if (/\b(podría|puede usted|desea|quisiera|me gustaría|le importa)\b/.test(t)) n.tone = 'usted';
  else if (/\b(ponme|dime|hazlo|dale|oye|mira|pon|dame|haz)\b/.test(t)) n.tone = 'tu';
  // Verbosity
  n.verbosity = command.trim().split(/\s+/).length <= 4 ? 'short' : 'normal';

  // Room preference
  if (extras?.roomId) {
    n.roomCounts[extras.roomId] = (n.roomCounts[extras.roomId] ?? 0) + 1;
    const top = Object.entries(n.roomCounts).sort(([, a], [, b]) => b - a)[0];
    if (top && top[1] >= 3) n.preferredRoomId = top[0];
  }
  // Party size preference
  if (extras?.partySize) {
    const k = String(extras.partySize);
    n.partySizeCounts[k] = (n.partySizeCounts[k] ?? 0) + 1;
    const top = Object.entries(n.partySizeCounts).sort(([, a], [, b]) => b - a)[0];
    if (top && top[1] >= 2) n.preferredPartySize = Number(top[0]);
  }
  // Time preference
  if (extras?.time) {
    n.timeCounts[extras.time] = (n.timeCounts[extras.time] ?? 0) + 1;
    const top = Object.entries(n.timeCounts).sort(([, a], [, b]) => b - a)[0];
    if (top && top[1] >= 2) n.preferredTime = top[0];
  }
  // Frequent guest names
  if (extras?.guestName && extras.guestName.length >= 2) {
    const g = extras.guestName.trim().toLocaleLowerCase('es-ES');
    n.guestCounts[g] = (n.guestCounts[g] ?? 0) + 1;
    if (n.guestCounts[g] >= 2 && !n.frequentGuests.includes(extras.guestName.trim())) {
      n.frequentGuests.push(extras.guestName.trim());
    }
  }
  return n;
}
/** Adaptive confirmation question based on detected style */
function confirmQ(s: StyleProfile): string {
  if (s.verbosity === 'short') return '¿Lo hacemos?';
  if (s.tone === 'usted') return '¿Desea confirmar?';
  return '¿Lo confirmas?';
}

export function VoiceAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = ['/login', '/register', '/payment'].some((path) => pathname.startsWith(path));
  const tables = useFloorStore((s) => s.tables);
  const rooms = useFloorStore((s) => s.rooms);
  const reservations = useReservationStore((s) => s.reservations);
  const todayReservations = useReservationStore((s) => s.todayReservations);
  const fetchReservations = useReservationStore((s) => s.fetchReservations);
  const selectedDate = useReservationStore((s) => s.selectedDate);
  const selectedTime = useReservationStore((s) => s.selectedTime);

  // ── buildStoreSnapshot — builds a reduced snapshot for the AI ─────────────
  // Uses closure over store state; called inside answer() to capture current values.
  const buildStoreSnapshot = useCallback((): StoreSnapshot => ({
    tables: tables.map((t) => ({
      id: t.id,
      label: t.label,
      status: t.status,
      capacity: (t.capacity ?? (t as { table_type?: { capacity?: number } }).table_type?.capacity ?? 0),
      room_id: t.room_id ?? '',
      is_active: t.is_active,
    })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name })),
    reservations: reservations.map((r) => ({
      id: r.id,
      reservation_number: r.reservation_number,
      guest_name: r.guest_name,
      date: r.date,
      time: r.time,
      party_size: r.party_size,
      status: r.status,
      table_id: r.table_id ?? null,
    })),
    todayReservations: todayReservations.map((r) => ({
      id: r.id,
      reservation_number: r.reservation_number,
      guest_name: r.guest_name,
      date: r.date,
      time: r.time,
      party_size: r.party_size,
      status: r.status,
      table_id: r.table_id ?? null,
      table: (r as { table?: { label: string } | null }).table ?? null,
    })),
    selectedDate,
    selectedTime,
    now: new Date().toISOString(),
  }), [tables, rooms, reservations, todayReservations, selectedDate, selectedTime]);

  // ── Refs (stable across renders, no subscription cost) ──────────────────────
  const recognitionRef   = useRef<Recognition | null>(null);
  const answerRef        = useRef<(spokenText?: string) => Promise<void>>(async () => {});
  const confirmRef       = useRef<() => Promise<void>>(async () => {});
  const startListenRef   = useRef<() => void>(() => {});
  const conversationRef  = useRef<Conversation | null>(null);
  const proposalRef      = useRef<PendingProposal | null>(null);
  const autoStartedRef   = useRef(false);
  const styleRef         = useRef<StyleProfile>(defaultStyle()); // persisted style profile
  const styleKeyRef      = useRef('');                           // localStorage key, set after tenantId loads
  // ── AI session refs ─────────────────────────────────────────────────────────
  const aiSessionRef     = useRef<ConversationSession | null>(null);  // AI conversation history
  const isSpeakingRef    = useRef(false);                             // true while TTS is outputting
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // inactivity timer

  // ── State ────────────────────────────────────────────────────────────────────
  const [assistantName, setAssistantName] = useState('');
  const [draftName,     setDraftName]     = useState('');
  const [tenantId,      setTenantId]      = useState('');
  const [canConfigure,  setCanConfigure]  = useState(false);
  const [ready,         setReady]         = useState(false);
  const [open,          setOpen]          = useState(false);
  const [listening,     setListening]     = useState(false);
  const [working,       setWorking]       = useState(false);
  const [transcript,    setTranscript]    = useState('');
  const [response,      setResponse]      = useState('');
  const [proposal,      setProposal]      = useState<PendingProposal | null>(null);
  const [handsFree,     setHandsFree]     = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [localAIInfo,   setLocalAIInfo]   = useState<ModelInfo | null>(null);
  const [showAIPanel,   setShowAIPanel]   = useState(false);

  // Keep proposalRef in sync (answer/confirm use the ref to avoid stale closures)
  useEffect(() => { proposalRef.current = proposal; }, [proposal]);

  // ── Load config ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthPage) return;
    loadAssistantConfiguration().then((config) => {
      if (config) {
        setAssistantName(config.assistant_enabled ? config.assistant_name ?? '' : '');
        setDraftName(config.assistant_name ?? '');
        setTenantId(config.tenantId);
        setCanConfigure(config.canConfigure);
        // Load persisted style profile for this tenant
        styleKeyRef.current = `${STYLE_LS_KEY}-${config.tenantId}`;
        styleRef.current = loadStyle(styleKeyRef.current);
      }
    }).catch(() => setResponse('No se pudo cargar la configuración del asistente.')).finally(() => setReady(true));
  }, [isAuthPage]);

  useEffect(() => {
    const changed = (e: Event) => setAssistantName((e as CustomEvent<string>).detail);
    window.addEventListener('assistant-name-changed', changed);
    return () => window.removeEventListener('assistant-name-changed', changed);
  }, []);

  const speechSupported = useMemo(() => typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition), []);

  // ── speak ────────────────────────────────────────────────────────────────────
  /**
   * Speak text. If expectReply=true, auto-start the microphone once TTS finishes
   * (web) or tell the Android service to listen (native).
   * CRITICAL: stops SpeechRecognition before speaking to prevent self-listening.
   */
  const speak = useCallback((text: string, expectReply = false) => {
    if (Capacitor.isNativePlatform()) {
      void WakeWord.speak({ text, expectReply });
    }
    if (!('speechSynthesis' in window)) return;
    // ── Stop microphone BEFORE speaking (prevents self-listening) ───────────
    isSpeakingRef.current = true;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES'; u.rate = 0.95; u.pitch = 1.02;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      isSpeakingRef.current = false;
      setAwaitingReply(false);
      if (expectReply) {
        setTimeout(() => startListenRef.current(), 400);
      }
    };
    u.onend = finish;
    u.onerror = finish;
    // Safety fallback: if browser TTS doesn't trigger onend within estimated time + 4s
    const approxDurationMs = Math.max(3000, (text.length / 15) * 1000 + 4000);
    setTimeout(finish, approxDurationMs);
    window.speechSynthesis.speak(u);
  }, []);

  // ── reply ────────────────────────────────────────────────────────────────────
  /**
   * Set the displayed response and speak it.
   * Automatically determines whether to keep listening based on whether
   * the message ends with '?' or we are mid-conversation.
   */
  const reply = useCallback((message: string) => {
    const expectReply = needsReply(message, conversationRef.current !== null);
    setResponse(message);
    if (expectReply) setAwaitingReply(true);
    speak(message, expectReply);
  }, [speak]);

  // ── Auto-start mic on first load ─────────────────────────────────────────
  // On web: open widget + start SpeechRecognition immediately.
  // On native: speak a greeting with expectReply=true so after TTS the service
  //            automatically enters awaitingCommand mode (no wake phrase needed).
  useEffect(() => {
    if (!ready || isAuthPage || !assistantName || autoStartedRef.current) return;
    autoStartedRef.current = true;
    setOpen(true);
    if (Capacitor.isNativePlatform()) {
      // Small delay to let the WakeWordService initialise TTS fully
      const t = setTimeout(() => reply('Hola, estoy lista. \u00bfEn qu\u00e9 te ayudo?'), 1400);
      return () => clearTimeout(t);
    } else {
      // Web: open widget and kick off microphone after browser is settled
      const t = setTimeout(() => startListenRef.current(), 900);
      return () => clearTimeout(t);
    }
  }, [ready, isAuthPage, assistantName, reply]);

  // ── buildProposal ─────────────────────────────────────────────────────────────
  const buildProposal = useCallback(async (intent: AssistantMutationIntent): Promise<PendingProposal> => {
    if (intent.action === 'create_reservation') {
      return {
        summary: `Crear reserva para ${intent.guestName}, ${intent.partySize} personas, el ${intent.date} a las ${intent.time}. La mesa se asignará al confirmar.`,
        operation: { action: intent.action, guest_name: intent.guestName, party_size: intent.partySize, date: intent.date, time: intent.time, duration_minutes: intent.durationMinutes },
      };
    }
    const reservation = await resolveReservation(intent.reference);
    const who = reservation.guest_name;
    const when = `el ${reservation.date} a las ${reservation.time.slice(0, 5)}`;
    if (intent.action === 'send_payment_request') {
      if (!reservation.guest_email) throw new Error(`${who} no tiene correo registrado.`);
      return {
        summary: `Enviar a ${who} (${reservation.guest_email}) una solicitud de ${intent.amount.toFixed(2)}€ por ${intent.method === 'bizum' ? 'Bizum' : 'pasarela de pago'} para su reserva ${when}.`,
        operation: { action: 'require_prepayment', reservation_id: reservation.id, amount: intent.amount },
        paymentRequest: intent.method,
      };
    }
    if (intent.action === 'seat_reservation') return {
      summary: `Sentar a ${who} ${when}. La mesa quedará marcada como ocupada.`,
      operation: { action: intent.action, reservation_id: reservation.id },
    };
    if (intent.action === 'cancel_reservation') return {
      summary: `Cancelar la reserva de ${who} ${when}.`,
      operation: { action: intent.action, reservation_id: reservation.id },
    };
    if (intent.action === 'require_prepayment') return {
      summary: `Solicitar a ${who} un anticipo de ${intent.amount.toFixed(2)}€ para su reserva ${when}. Stripe generará el enlace; no se capturarán tarjetas aquí.`,
      operation: { action: intent.action, reservation_id: reservation.id, amount: intent.amount },
      prepayment: true,
    };
    // update_reservation
    const changes = [intent.date ? `fecha ${intent.date}` : '', intent.time ? `hora ${intent.time}` : '', intent.partySize ? `${intent.partySize} personas` : ''].filter(Boolean).join(', ');
    return {
      summary: `Modificar la reserva de ${who}: ${changes}. La asignación de mesa se recalculará.`,
      operation: { action: intent.action, reservation_id: reservation.id, date: intent.date, time: intent.time, party_size: intent.partySize },
    };
  }, []);

  // ── AI session helpers ────────────────────────────────────────────────────────
  /** Ensure an AI session exists and is not timed out. */
  const ensureAISession = useCallback((assistantNameLocal: string): ConversationSession => {
    if (!aiSessionRef.current || isSessionTimedOut(aiSessionRef.current)) {
      const snapshot = buildStoreSnapshot();
      const ctx = buildRestaurantContext(snapshot);
      const prompt = buildSystemPrompt(assistantNameLocal, ctx);
      if (aiSessionRef.current) {
        clearSession(aiSessionRef.current, prompt);
      } else {
        aiSessionRef.current = createSession(prompt);
      }
    }
    return aiSessionRef.current!;
  }, [buildStoreSnapshot]);

  // ── answer ────────────────────────────────────────────────────────────────────
  const answer = useCallback(async (spokenText?: string) => {
    const command = spokenText?.trim() || transcript.trim();
    if (!command) return;
    setTranscript(command); setOpen(true); setAwaitingReply(false);

    // Update and persist style profile from this command
    styleRef.current = evolveStyle(styleRef.current, command);
    if (styleKeyRef.current) saveStyle(styleKeyRef.current, styleRef.current);

    // ── Reset conversation state when starting with "Ey" wake phrase ───────────
    const isExplicitEyWake = /^\b(ey|hola)\b/i.test(command) || (assistantName && command.toLocaleLowerCase('es-ES').includes(`ey ${assistantName.toLocaleLowerCase('es-ES')}`));
    if (isExplicitEyWake) {
      conversationRef.current = null;
      if (aiSessionRef.current) {
        clearSession(aiSessionRef.current, '');
      }
    }

    // ── Voice confirmation / cancellation of pending proposals ──────────────
    const currentProposal = proposalRef.current;
    if (currentProposal) {
      const norm = command.toLocaleLowerCase('es-ES').trim();
      const isYes = /^(sí|si)\b/.test(norm)
        || /^(confirma|confirmar|correcto|adelante|vale|ok|hazlo|perfecto|sigue|venga|dale|claro)$/.test(norm);
      const isNo  = /^no\b/.test(norm)
        || /^(cancela|cancelar|descarta|descartar|para|stop|espera|olvida)$/.test(norm);
      if (isYes) { await confirmRef.current(); return; }
      if (isNo)  { setProposal(null); reply('Operación descartada.'); return; }
      // Neither confirm nor cancel → treat as new command and clear proposal
    }

    setProposal(null);
    let message = '';

    // ── Mid-conversation topic switch / query interruption ────────────────────
    const freshIntent = parseAssistantIntent(command);
    if (conversationRef.current !== null) {
      const isTopLevelQuery =
        ['list_free_tables', 'list_today_reservations', 'list_reservations_date', 'recommend_table', 'check_table', 'cancel_reservation', 'seat_reservation'].includes(freshIntent.action) ||
        (freshIntent.action === 'draft_reservation' && (freshIntent.tableLabel || freshIntent.partySize || freshIntent.date || freshIntent.time));

      // Also detect clear question keywords like "qué mesas", "cuáles", "hay disponibles", "ayuda"
      const isExplicitQuestion = /\b(qu[eé]\s+mesas?|cu[aá]les|hay\s+disponibles?|qu[eé]\s+reservas?|ayuda)\b/i.test(command);

      if (isTopLevelQuery || isExplicitQuestion) {
        conversationRef.current = null;
      }
    }

    // ── search_tables: multi-step free-table search (room + partySize) ────────
    if (conversationRef.current?.kind === 'search_tables' ||
        conversationRef.current?.kind === 'free_tables_room') {
      const ctx = conversationRef.current.kind === 'search_tables'
        ? conversationRef.current
        : { kind: 'search_tables' as const, roomId: undefined, partySize: undefined };
      const norm = command.toLocaleLowerCase('es-ES');

      // 1. Extract room if not yet known and there are multiple rooms
      if (!ctx.roomId && rooms.length > 1) {
        const room = rooms.find((r) => norm.includes(r.name.toLocaleLowerCase('es-ES')));
        if (room) { ctx.roomId = room.id; }
        else {
          conversationRef.current = { ...ctx };
          reply(`No reconozco ese salón. Puedes decir ${rooms.map((r) => r.name).join(' o ')}.`);
          return;
        }
      }

      // 2. Extract partySize if not yet known
      if (!ctx.partySize) {
        const numMatch = norm.match(/\b(\d{1,2})\b/);
        if (numMatch) ctx.partySize = Number(numMatch[1]);
      }

      // 3. If partySize still missing, ask for it
      if (!ctx.partySize) {
        conversationRef.current = { ...ctx };
        reply('¿Para cuántas personas?');
        return;
      }

      // 4. We have enough — answer
      conversationRef.current = null;
      setWorking(true);
      try {
        let roomTables: Table[];
        if (ctx.roomId) {
          // Save room preference to style
          styleRef.current = evolveStyle(styleRef.current, command, { roomId: ctx.roomId });
          if (styleKeyRef.current) saveStyle(styleKeyRef.current, styleRef.current);
          const { data } = await createClient().from('tables').select('*, table_type:table_types(*)').eq('room_id', ctx.roomId).eq('is_active', true);
          roomTables = (data ?? []) as Table[];
        } else {
          roomTables = tables.filter((t) => t.is_active);
        }
        const roomName = ctx.roomId ? rooms.find((r) => r.id === ctx.roomId)?.name : null;
        const ps = ctx.partySize!;
        // Save party size preference
        styleRef.current = evolveStyle(styleRef.current, command, { partySize: ps });
        if (styleKeyRef.current) saveStyle(styleKeyRef.current, styleRef.current);
        const free = roomTables.filter((t) => capacity(t) >= ps && !overlaps(t, reservations, selectedDate, selectedTime));
        const prefix = roomName ? `En ${roomName}, ` : '';
        reply(
          free.length
            ? `${prefix}para ${ps} personas tienes ${free.length} mesas libres: ${free.slice(0, 8).map((t) => t.label).join(', ')}${free.length > 8 ? ` y ${free.length - 8} más` : ''}. ¿Quieres que reserve alguna?`
            : `${prefix}no veo mesas libres para ${ps} personas en este momento.`,
        );
      } catch { reply('No he podido consultar las mesas ahora mismo.'); }
      finally { setWorking(false); }
      return;
    }

    // ── search_reservation_query: user searching for a reservation by name/table
    if (conversationRef.current?.kind === 'search_reservation_query') {
      conversationRef.current = null;
      const found = findReservation(command, [...reservations, ...todayReservations], tables);
      if (!found) {
        reply(`No encuentro ninguna reserva para "${command}". Puedes decirme el nombre completo o el número de mesa.`);
        return;
      }
      if ('ambiguous' in found) {
        reply(`Tengo varias: ${found.ambiguous.slice(0, 3).map((r) => `${r.guest_name} a las ${r.time.slice(0, 5)}`).join(', ')}. ¿Cuál buscas?`);
        conversationRef.current = { kind: 'search_reservation_query' };
        return;
      }
      const r = found.reservation;
      const tblLabel = r.table?.label ? `, mesa ${r.table.label}` : '';
      reply(`Aquí la tienes: reserva de ${r.guest_name}, ${r.party_size} personas, el ${r.date} a las ${r.time.slice(0, 5)}${tblLabel}.`);
      return;
    }

    // ── seat_reference: resolve by name / table / reference number ─────────
    if (conversationRef.current?.kind === 'seat_reference') {
      conversationRef.current = null;
      const refMatch = command.match(/\b(res-\d{4}-\d{6})\b/i)?.[1];
      if (refMatch) {
        setWorking(true);
        try {
          const next = await buildProposal({ action: 'seat_reservation', reference: refMatch.toUpperCase() });
          setProposal(next); reply(next.summary + ' ¿Lo confirmas?');
        } catch (e) { reply(e instanceof Error ? e.message : 'No pude localizar esa reserva.'); }
        finally { setWorking(false); }
      } else {
        const found = findReservation(command, [...reservations, ...todayReservations], tables);
        if (!found) { reply('No encuentro esa reserva. ¿Puedes decirme el nombre del cliente o la mesa?'); return; }
        if ('ambiguous' in found) {
          reply(`Hay varias. ¿Cuál? ${found.ambiguous.slice(0, 3).map((r) => `${r.guest_name} a las ${r.time.slice(0, 5)}`).join(', ')}.`);
          conversationRef.current = { kind: 'seat_reference' };
          return;
        }
        const r = found.reservation;
        const next = { summary: `Sentar a ${r.guest_name} a las ${r.time.slice(0, 5)}${r.table?.label ? `, mesa ${r.table.label}` : ''}. La mesa quedará como ocupada.`, operation: { action: 'seat_reservation' as const, reservation_id: r.id } };
        setProposal(next); reply(next.summary + ' ' + confirmQ(styleRef.current));
      }
      return;
    }

    // ── await_reference: resolve by name / table / reference number ─────────
    if (conversationRef.current?.kind === 'await_reference') {
      const nextAction = conversationRef.current.nextAction;
      conversationRef.current = null;
      const refMatch = command.match(/\b(res-\d{4}-\d{6})\b/i)?.[1];
      if (refMatch) {
        setWorking(true);
        try {
          const next = await buildProposal({ action: nextAction, reference: refMatch.toUpperCase() });
          setProposal(next); reply(next.summary + ' ¿Lo confirmas?');
        } catch (e) { reply(e instanceof Error ? e.message : 'No pude localizar esa reserva.'); }
        finally { setWorking(false); }
      } else {
        const found = findReservation(command, [...reservations, ...todayReservations], tables);
        if (!found) { reply('No encuentro esa reserva. Dime el nombre del cliente o la mesa.'); conversationRef.current = { kind: 'await_reference', nextAction }; return; }
        if ('ambiguous' in found) {
          reply(`Hay varias. ¿Cuál? ${found.ambiguous.slice(0, 3).map((r) => `${r.guest_name} a las ${r.time.slice(0, 5)}`).join(', ')}.`);
          conversationRef.current = { kind: 'await_reference', nextAction };
          return;
        }
        const r = found.reservation;
        const actionLabel = nextAction === 'cancel_reservation'
          ? `Cancelar la reserva de ${r.guest_name} del ${r.date} a las ${r.time.slice(0, 5)}`
          : `Sentar a ${r.guest_name} a las ${r.time.slice(0, 5)}${r.table?.label ? `, mesa ${r.table.label}` : ''}`;
        const next = { summary: actionLabel + '.', operation: { action: nextAction, reservation_id: r.id } };
        setProposal(next); reply(next.summary + ' ' + confirmQ(styleRef.current));
      }
      return;
    }

    // ── await_modify_ref: step 1 - collect the reservation to modify ────────
    if (conversationRef.current?.kind === 'await_modify_ref') {
      const refMatch = command.match(/\b(res-\d{4}-\d{6})\b/i)?.[1];
      if (refMatch) {
        conversationRef.current = { kind: 'modify_reservation', reference: refMatch.toUpperCase() };
        reply('¿Qué quieres cambiar? Dime la nueva fecha, hora o número de personas.');
      } else {
        const found = findReservation(command, [...reservations, ...todayReservations], tables);
        if (!found) { reply('No encuentro esa reserva. Dime el nombre del cliente o la mesa.'); return; }
        if ('ambiguous' in found) {
          reply(`Hay varias. ¿Cuál? ${found.ambiguous.slice(0, 3).map((r) => `${r.guest_name} a las ${r.time.slice(0, 5)}`).join(', ')}.`);
          return;
        }
        conversationRef.current = { kind: 'modify_reservation', reference: found.reservation.reservation_number };
        reply(`¿Qué quieres cambiar de la reserva de ${found.reservation.guest_name}? Dime la nueva fecha, hora o número de personas.`);
      }
      return;
    }

    // ── modify_reservation: step 2 - extract what to change and propose ────────
    if (conversationRef.current?.kind === 'modify_reservation') {
      const ref = conversationRef.current.reference;
      // Try to extract new date/time/partySize from the user's reply
      const parsed = parseAssistantIntent(`mueve ${ref} ${command}`);
      if (parsed.action === 'update_reservation' && (parsed.date || parsed.time || parsed.partySize)) {
        conversationRef.current = null; setWorking(true);
        try {
          const next = await buildProposal(parsed);
          setProposal(next); reply(next.summary + ' ¿Lo confirmas?');
        } catch (error) { reply(error instanceof Error ? error.message : 'No pude preparar el cambio.'); }
        finally { setWorking(false); }
      } else {
        reply('No entendí qué quieres cambiar. Puedes decir, por ejemplo, "al jueves a las nueve" o "para cinco personas".');
      }
      return;
    }

    if (conversationRef.current?.kind === 'reservation') {
      const draft = conversationRef.current.draft;
      const parsed = parseAssistantIntent(command);
      if (parsed.action === 'draft_reservation') {
        Object.assign(draft, Object.fromEntries(Object.entries(parsed).filter(([k, v]) => k !== 'action' && v !== undefined)));
      }

      // Robust field extraction from user utterance
      if (!draft.partySize) {
        const num = extractNumber(command);
        if (num && num >= 1 && num <= 30) draft.partySize = num;
      }
      if (!draft.date) {
        const d = extractDate(command);
        if (d) draft.date = d;
      }
      if (!draft.time) {
        const t = extractTime(command);
        if (t) draft.time = t;
      }
      if (!draft.guestName) {
        const nameMatch = command.match(/(?:a nombre de|nombre)\s+([a-záéíóúüñ][a-záéíóúüñ\s'-]*?)(?=\s+(?:el|para|a las?|en)\b|$)/i)?.[1]?.trim();
        const rawClean = command.replace(/^(a nombre de|nombre|para)\s+/i, '').trim();
        const candidate = nameMatch || rawClean;
        if (candidate && !/^\d+$/.test(candidate) && !/\b(qu[eé]|cu[aá]l|d[oó]nde|cu[aá]ntas?|hay|mesas?|cancela|ayuda|hoy|mañana|terraza|interior|sala|comedor|personas?)\b/i.test(candidate)) {
          draft.guestName = candidate;
        }
      }

      // Step-by-step missing field prompts (never auto-assign date!)
      if (!draft.guestName) {
        reply('¿A nombre de quién pongo la reserva?');
        return;
      }
      if (!draft.partySize) {
        reply(`Anotado a nombre de ${draft.guestName}. ¿Para cuántas personas será la reserva?`);
        return;
      }
      if (!draft.date) {
        reply(`Anotado a nombre de ${draft.guestName} para ${draft.partySize} personas. ¿Para qué fecha o día es la reserva? (Puedes decir hoy, mañana, el viernes...)`);
        return;
      }
      if (!draft.time) {
        reply(`Anotado a nombre de ${draft.guestName} para el ${draft.date}. ¿A qué hora vienen?`);
        return;
      }
      if (!draft.tableLabel) {
        const optimal = evaluateOptimalRoomAndTable(draft.partySize, rooms, tables, reservations, draft.date, draft.time);
        if (optimal) {
          draft.tableLabel = optimal.bestTable.label;
        } else {
          const prompt = rooms.length > 1
            ? `Anotado a nombre de ${draft.guestName} para ${draft.partySize} personas el ${draft.date} a las ${draft.time}. ¿En qué salón te gustaría? (${rooms.map(r => r.name).join(', ')})`
            : `Anotado a nombre de ${draft.guestName} para ${draft.partySize} personas el ${draft.date} a las ${draft.time}. ¿Qué mesa prefieres?`;
          reply(prompt);
          return;
        }
      }

        const table = tables.find((t) => t.label.toLocaleLowerCase('es-ES') === draft.tableLabel!.toLocaleLowerCase('es-ES'));
        if (!table) { const bad = draft.tableLabel; draft.tableLabel = undefined; reply(`No encuentro la mesa ${bad}. ¿Qué mesa quieres reservar?`); return; }
        setWorking(true);
        try {
          const { data, error } = await createClient().rpc('assistant_table_candidates', { p_date: draft.date, p_time: draft.time, p_party_size: draft.partySize, p_duration_minutes: 90, p_room_id: null, p_exclude_reservation_id: null });
          if (error) throw error;
          const candidates = (data ?? []) as Array<{ allocation_type: string; allocation_id: string; label: string }>;
          const requested = candidates.find((c) => c.allocation_type === 'table' && c.allocation_id === table.id);
          if (!requested) {
            const alt = candidates[0]; conversationRef.current = null;
            reply(alt ? `La mesa ${table.label} no está disponible o no tiene capacidad. Sí está disponible ${alt.label}. ¿Quieres que reserve esa en su lugar?` : `La mesa ${table.label} no está disponible y no encuentro alternativa válida.`);
            return;
          }

          const noteStr = draft.notes ? ` (Nota: ${draft.notes})` : '';
          const payStr = draft.paymentMethod && draft.paymentMethod !== 'none' && draft.paymentAmount
            ? `. Se enviará solicitud de anticipo de ${draft.paymentAmount.toFixed(2)}€ por ${draft.paymentMethod === 'bizum' ? 'Bizum' : 'pasarela de pago'}`
            : '';

          const summary = `Reservar la mesa ${table.label} para ${draft.guestName}, ${draft.partySize} personas, el ${draft.date} a las ${draft.time}${noteStr}${payStr}.`;

          const next: PendingProposal = {
            summary,
            operation: {
              action: 'create_reservation' as const,
              guest_name: draft.guestName,
              party_size: draft.partySize,
              date: draft.date,
              time: draft.time,
              duration_minutes: 90,
              table_id: table.id,
              notes: draft.notes,
              amount: draft.paymentAmount,
            },
            paymentRequest: draft.paymentMethod && draft.paymentMethod !== 'none' ? draft.paymentMethod : undefined,
          };

          styleRef.current = evolveStyle(styleRef.current, command, { partySize: draft.partySize, time: draft.time, guestName: draft.guestName });
          if (styleKeyRef.current) saveStyle(styleKeyRef.current, styleRef.current);
          conversationRef.current = null; setProposal(next); reply(next.summary + ' ' + confirmQ(styleRef.current));
        } catch { reply('No he podido comprobar la disponibilidad ahora mismo.'); }
        finally { setWorking(false); }
        return;
      }

    // ── Try AI first, fall back to parseAssistantIntent ─────────────────────
    // If AI is available: process with natural language understanding.
    // If AI fails/unavailable: the existing intent parser handles it identically to before.
    const snapshot = buildStoreSnapshot();
    const aiSession = ensureAISession(assistantName);
    setWorking(true);
    let aiHandled = false;
    try {
      const aiResult = await processWithAI(command, aiSession, snapshot, assistantName);
      if (aiResult) {
        aiHandled = true;
        console.info('[VA] AI handled:', aiResult.kind);
        if (aiResult.kind === 'end_session') {
          // Clean up AI session and return to IDLE
          if (aiSessionRef.current) clearSession(aiSessionRef.current, '');
          conversationRef.current = null;
          setWorking(false);
          reply(aiResult.text);
          return;
        }
        if (aiResult.kind === 'proposal') {
          const next: PendingProposal = {
            summary: aiResult.summary,
            operation: aiResult.operation as AssistantOperation,
            paymentRequest: aiResult.paymentRequest,
            prepayment: aiResult.prepayment,
          };
          setWorking(false);
          setProposal(next); reply(next.summary + ' ' + confirmQ(styleRef.current));
          return;
        }
        if (aiResult.kind === 'text') {
          setWorking(false);
          reply(aiResult.text);
          return;
        }
        // kind === 'unavailable' → fall through to legacy parser
      }
    } catch (aiErr) {
      console.warn('[VA] AI error, using fallback:', aiErr);
    } finally {
      if (!aiHandled) setWorking(false);
    }

    // ── Single-shot intents (fallback / Ollama unavailable) ─────────────────
    console.info('[VA] Using parseAssistantIntent fallback');
    const intent = parseAssistantIntent(command);
    if (intent.action === 'check_table') {
      const table = tables.find((t) => t.label.toLocaleLowerCase('es-ES') === intent.tableLabel.toLocaleLowerCase('es-ES'));
      message = !table ? `No encuentro la mesa ${intent.tableLabel}.`
        : overlaps(table, reservations, selectedDate, selectedTime) ? `La mesa ${table.label} no está disponible en la selección actual.`
        : intent.partySize && capacity(table) < intent.partySize ? `Está libre, pero solo tiene capacidad para ${capacity(table)} personas.`
        : `Sí, la mesa ${table.label} está disponible.`;
    } else if (intent.action === 'recommend_table') {
      const best = tables.filter((t) => t.is_active && capacity(t) >= intent.partySize && !overlaps(t, reservations, selectedDate, selectedTime)).sort((a, b) => capacity(a) - capacity(b))[0];
      message = best ? `La mejor opción para ${intent.partySize} personas es la mesa ${best.label}. ¿Quieres que haga la reserva?` : `No veo ninguna mesa libre para ${intent.partySize} personas ahora mismo.`;
    } else if (intent.action === 'list_today_reservations') {
      const active = todayReservations.filter((r) => !['cancelled', 'no_show'].includes(r.status));
      const tbl = intent.tableLabel;
      if (tbl) {
        const filtered = active.filter((r) => r.table?.label.toLocaleLowerCase('es-ES') === tbl.toLocaleLowerCase('es-ES'));
        message = filtered.length
          ? `Para la mesa ${tbl} hoy tienes ${filtered.length} reserva${filtered.length > 1 ? 's' : ''}: ${filtered.map((r) => `${r.guest_name}, ${r.party_size} personas a las ${r.time.slice(0, 5)}`).join('. ')}.`
          : `Para la mesa ${tbl} no hay reservas programadas hoy.`;
      } else {
        message = active.length ? `Hoy tienes ${active.length} reservas. ${active.slice(0, 8).map((r) => `${r.guest_name}, ${r.party_size} personas a las ${r.time.slice(0, 5)}${r.table?.label ? `, mesa ${r.table.label}` : ''}`).join('. ')}${active.length > 8 ? `. Y ${active.length - 8} más.` : '.'}` : 'Hoy no tienes reservas activas.';
      }
    } else if (intent.action === 'list_reservations_date') {
      setWorking(true);
      try {
        const { data, error } = await createClient().from('reservations').select('guest_name, party_size, time, status, table:tables(label)').eq('date', intent.date).not('status', 'in', '(cancelled,no_show)').order('time');
        if (error) throw error;
        const rows = (data ?? []) as unknown as Array<{ guest_name: string; party_size: number; time: string; table?: { label: string } | null }>;
        message = rows.length ? `El ${intent.date} tienes ${rows.length} reservas. ${rows.slice(0, 10).map((r) => `${r.guest_name}, ${r.party_size} personas a las ${r.time.slice(0, 5)}${r.table?.label ? `, mesa ${r.table.label}` : ''}`).join('. ')}.` : `El ${intent.date} no tienes reservas activas.`;
      } catch { message = 'No he podido consultar las reservas de ese día.'; }
      finally { setWorking(false); }
    } else if (intent.action === 'list_free_tables') {
      // Start search_tables conversation: ask for room (if multiple) then partySize
      const mentionedRoom = rooms.find((r) => command.toLocaleLowerCase('es-ES').includes(r.name.toLocaleLowerCase('es-ES')));
      const initPartySize = (intent as { partySize?: number }).partySize;
      // Pre-fill preferred room from learned style if user hasn't mentioned one
      const preferredRoom = !mentionedRoom && styleRef.current.preferredRoomId
        ? rooms.find((r) => r.id === styleRef.current.preferredRoomId)
        : undefined;
      const initRoomId = mentionedRoom?.id ?? preferredRoom?.id;
      conversationRef.current = { kind: 'search_tables', roomId: initRoomId, partySize: initPartySize };
      if (rooms.length > 1 && !initRoomId) {
        message = `¿En qué salón? Puedes decir ${rooms.map((r) => r.name).join(', ')}.`;
      } else if (preferredRoom && !mentionedRoom) {
        // Auto-selected preferred room, skip room question
        message = `Entendido, busco en ${preferredRoom.name}. ¿Para cuántas personas?`;
      } else {
        message = '¿Para cuántas personas?';
      }
    } else if (intent.action === 'draft_reservation') {
      conversationRef.current = { kind: 'reservation', draft: { tableLabel: intent.tableLabel, guestName: intent.guestName, date: intent.date, time: intent.time, partySize: intent.partySize } };
      const draft = conversationRef.current.draft;
      // If all fields are already present, process immediately
      if (draft.tableLabel && draft.partySize && draft.date && draft.time && draft.guestName) { void answerRef.current(command); return; }

      const details: string[] = [];
      if (draft.guestName) details.push(`a nombre de ${draft.guestName}`);
      if (draft.time) details.push(`para las ${draft.time}`);
      if (draft.date) details.push(`el ${draft.date}`);
      if (draft.partySize) details.push(`para ${draft.partySize} personas`);
      if (draft.tableLabel) details.push(`en mesa ${draft.tableLabel}`);

      const prefix = details.length > 0 ? `Tomada nota: ${details.join(', ')}. ` : '';
      const promptText = !draft.tableLabel ? (rooms.length > 1 ? `¿En qué salón o mesa quieres reservar?` : '¿En qué mesa te gustaría?')
        : !draft.partySize ? '¿Para cuántas personas?'
        : !draft.date ? '¿Para qué día?'
        : !draft.time ? '¿A qué hora?'
        : '¿A nombre de quién?';

      message = `${prefix}${promptText}`;
    } else if (intent.action === 'help') {
      // Even when the parser gives up, try to detect a specific intent by keyword
      if (/(sienta|sentar|acomoda)/i.test(command)) {
        conversationRef.current = { kind: 'seat_reference' };
        message = '¿A quién quieres sentar? Díme el nombre del cliente o la mesa.';
      } else if (/(cancela|cancelar|anula|anular)/i.test(command)) {
        conversationRef.current = { kind: 'await_reference', nextAction: 'cancel_reservation' };
        message = '¿Qué reserva quieres cancelar? Díme el nombre del cliente o la mesa.';
      } else if (/(modifica|modificar|cambia|cambiar|mueve|mover|actualiza|actualizar)/i.test(command)) {
        conversationRef.current = { kind: 'await_modify_ref' };
        message = '¿Qué reserva quieres modificar? Díme el nombre del cliente o la mesa.';
      } else if (/(busca|buscar|encuentra|encontrar|localiza|localizar|consultar?)\s+(la\s+)?reserva/i.test(command)) {
        const found = findReservation(command, [...reservations, ...todayReservations], tables);
        if (found && !('ambiguous' in found)) {
          const r = found.reservation;
          const tblLabel = r.table?.label ? `, mesa ${r.table.label}` : '';
          message = `Aquí está: ${r.guest_name}, ${r.party_size} personas el ${r.date} a las ${r.time.slice(0, 5)}${tblLabel}.`;
        } else {
          conversationRef.current = { kind: 'search_reservation_query' };
          message = '¿Qué reserva quieres buscar? Dime el nombre del cliente o la mesa.';
        }
      } else if (/(env[ií]a|solicita|cobra|pago|bizum|pasarela)/i.test(command) && /(bizum|pasarela|tarjeta|anticipo|pago)/i.test(command)) {
        const isBizum = /bizum/i.test(command);
        const amtMatch = command.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)?/);
        const amt = amtMatch ? Number(amtMatch[1].replace(',', '.')) : undefined;
        const found = findReservation(command, [...reservations, ...todayReservations], tables);
        if (found && !('ambiguous' in found)) {
          const r = found.reservation;
          if (!r.guest_email) {
            message = `La reserva de ${r.guest_name} no tiene correo electrónico registrado para enviarle la solicitud.`;
          } else {
            const amountToCharge = amt ?? r.prepayment_amount ?? 15;
            const methodLabel = isBizum ? 'Bizum' : 'pasarela de pago';
            const summary = `Enviar a ${r.guest_name} (${r.guest_email}) una solicitud de ${amountToCharge.toFixed(2)}€ por ${methodLabel} para su reserva el ${r.date} a las ${r.time.slice(0, 5)}.`;
            const next: PendingProposal = {
              summary,
              operation: { action: 'require_prepayment', reservation_id: r.id, amount: amountToCharge },
              paymentRequest: isBizum ? 'bizum' : 'online',
            };
            setProposal(next);
            message = `${summary} ¿Lo confirmas?`;
          }
        } else {
          message = '¿A qué cliente o reserva quieres enviar la solicitud de pago por Bizum o pasarela?';
        }
      } else if (/(reserva|reservar|quiero|haz|ponme|dame|necesito)/i.test(command)) {
        conversationRef.current = { kind: 'reservation', draft: {} };
        message = '¿A nombre de quién pongo la reserva?';
      } else {
        message = 'Puedo decirte las reservas de hoy, qué mesas están libres, gestionar cobros por Bizum o pasarela, y reservar, modificar o cancelar. ¿Qué necesitas?';
      }
    } else {
      setWorking(true);
      try { const next = await buildProposal(intent); setProposal(next); message = next.summary + ' ' + confirmQ(styleRef.current); }
      catch (error) { message = error instanceof Error ? error.message : 'No pude preparar la operación.'; }
      finally { setWorking(false); }
    }
    reply(message);
  }, [assistantName, buildProposal, buildStoreSnapshot, ensureAISession, reply, reservations, rooms, selectedDate, selectedTime, tables, todayReservations, transcript]);
  useEffect(() => { answerRef.current = answer; }, [answer]);

  // ── Wake-word listener (native only) ──────────────────────────────────────
  useEffect(() => {
    if (!assistantName || isAuthPage || !Capacitor.isNativePlatform()) return;
    let listener: PluginListenerHandle | undefined;
    let cancelled = false;
    WakeWord.addListener('wakeCommand', ({ command }) => {
      conversationRef.current = null;
      if (aiSessionRef.current) {
        clearSession(aiSessionRef.current, '');
      }
      if (command === '__WAKE__') { setOpen(true); reply('Dime, ¿en qué te ayudo?'); return; }
      if (command) {
        setTranscript(command);
        setOpen(true);
        void answerRef.current(command);
      }
    }).then((h) => { if (cancelled) void h.remove(); else listener = h; });
    WakeWord.start({ name: assistantName }).then(() => setHandsFree(true)).catch((e) => {
      setHandsFree(false);
      setResponse(e instanceof Error ? e.message : `Activa el permiso de micrófono para usar "Ey ${assistantName}".`);
    });
    return () => { cancelled = true; void listener?.remove(); };
  }, [assistantName, isAuthPage, reply]);

  // ── confirm ───────────────────────────────────────────────────────────────
  /** Execute the pending proposal. Uses proposalRef to avoid stale closures. */
  const confirm = useCallback(async () => {
    const p = proposalRef.current;
    if (!p) return;
    setWorking(true);
    try {
      const result = await executeAssistantOperation(p.operation);
      await fetchReservations();
      let message = `Listo, operación completada para ${result.reservation_number}.`;
      if (p.paymentRequest) {
        const sent = await sendAssistantPaymentRequest(result.id, p.paymentRequest, Number(p.operation.amount), window.location.origin);
        if (!sent?.success) { setProposal(null); reply(`El pago quedó pendiente, pero no se envió el correo: ${sent?.error || 'error desconocido'}.`); return; }
        message = `Correo de pago enviado correctamente para ${result.reservation_number}.`;
      } else if (p.prepayment) {
        const payment = await createPrepaymentSession(result.id, window.location.origin);
        if (!payment.success || !payment.url) { setProposal(null); reply(`El anticipo quedó configurado, pero Stripe no generó el enlace. Reinténtalo desde la reserva.`); return; }
        await navigator.clipboard?.writeText(payment.url);
        message += ' El enlace de Stripe se ha copiado al portapapeles.';
      }
      setProposal(null); reply(message);
    } catch (error) {
      reply(error instanceof Error ? `No se realizó la operación: ${error.message}` : 'No se realizó la operación.');
    } finally { setWorking(false); }
  }, [fetchReservations, reply]);
  useEffect(() => { confirmRef.current = confirm; }, [confirm]);

  // ── startListening ────────────────────────────────────────────────────────
  /** Start the Web Speech API recognizer. On result, auto-calls answer().
   * Guards against starting while TTS is speaking to prevent self-listening.
   */
  const startListening = useCallback(() => {
    // Do NOT start if TTS is currently speaking (prevents self-listening loop)
    if (isSpeakingRef.current) {
      console.info('[VA] Skipping startListening: TTS still speaking');
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { setOpen(true); reply('El reconocimiento de voz no está disponible. Escribe la orden.'); return; }
    // Reuse existing recognition instance if already running
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    const recognition = new Ctor();
    recognition.lang = 'es-ES'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      // Ignore if TTS is speaking (safety guard)
      if (isSpeakingRef.current) {
        console.info('[VA] Ignoring recognition result: TTS speaking');
        return;
      }
      setTranscript(text); setOpen(true); setAwaitingReply(false);
      // Auto-process: no button press needed
      void answerRef.current(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false); setAwaitingReply(false);
      // Only report error if not caused by our own TTS stop
      if (!isSpeakingRef.current) {
        reply('No he podido escuchar. Puedes escribir la orden o intentarlo de nuevo.');
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true); setOpen(true);
  }, [reply]);
  useEffect(() => { startListenRef.current = startListening; }, [startListening]);

  // ── Session inactivity timeout ───────────────────────────────────────────────
  // If the AI session is open but there's been no activity for SESSION_TIMEOUT_MS,
  // auto-close it. The legacy conversationRef timeout is separate.
  useEffect(() => {
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    sessionTimeoutRef.current = setTimeout(() => {
      if (aiSessionRef.current && isSessionTimedOut(aiSessionRef.current)) {
        console.info('[VA] AI session timed out — clearing');
        clearSession(aiSessionRef.current, '');
        conversationRef.current = null;
      }
    }, 62_000); // slightly longer than SESSION_TIMEOUT_MS in conversation.ts
    return () => { if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current); };
  });

  // ── Local AI model manager subscription ─────────────────────────────────────
  useEffect(() => {
    if (isAuthPage) return;
    const unsub = modelManager.subscribe((info) => setLocalAIInfo(info));
    // Kick off status check on mount (async, non-blocking)
    void modelManager.checkStatus();
    return unsub;
  }, [isAuthPage]);

  // ── misc actions ──────────────────────────────────────────────────────────
  const saveName = async () => {
    const clean = draftName.trim().slice(0, 24);
    if (!clean || !tenantId || !canConfigure) return;
    setWorking(true);
    try { await saveAssistantConfiguration(tenantId, clean); setAssistantName(clean); }
    catch { setResponse('Solo propietario o encargado puede cambiar este nombre.'); }
    finally { setWorking(false); }
  };
  const toggleHandsFree = async () => {
    try {
      if (handsFree) { await WakeWord.stop(); setHandsFree(false); }
      else { await WakeWord.start({ name: assistantName }); setHandsFree(true); }
    } catch { reply('No se pudo cambiar la escucha continua. Revisa el permiso de micrófono.'); }
  };

  // ── Status label ─────────────────────────────────────────────────────────
  const statusLabel = Capacitor.isNativePlatform()
    ? (handsFree ? (awaitingReply ? 'Te escucho…' : `Di "Ey ${assistantName}"`) : 'Escucha continua apagada')
    : (listening ? 'Escuchando…' : awaitingReply ? 'Preparando micrófono…' : speechSupported ? 'Micrófono disponible' : 'Modo texto');

  // ── Render ────────────────────────────────────────────────────────────────
  return <>{children}

    {/* ── Setup modal (first launch) ── */}
    {ready && !isAuthPage && !assistantName && (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-3xl border border-violet-400/20 bg-slate-900 p-6 shadow-2xl">
          <Sparkles className="mb-4 h-8 w-8 text-violet-400"/>
          <h2 className="text-xl font-semibold text-white">Configura el asistente del restaurante</h2>
          <p className="mt-2 text-sm text-slate-300">Este nombre será compartido por todo el equipo.</p>
          <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} disabled={!canConfigure} placeholder={canConfigure ? 'Ej. Mara' : 'Pide al encargado que lo configure'} className="mt-5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"/>
          <button onClick={saveName} disabled={!canConfigure || working} className="mt-4 w-full rounded-xl bg-violet-500 px-4 py-3 font-semibold text-white disabled:opacity-40">Guardar y activar</button>
          {response && <p className="mt-3 text-sm text-amber-300">{response}</p>}
        </div>
      </div>
    )}

    {/* ── Floating widget ── */}
    {ready && !isAuthPage && assistantName && (
      <div className="fixed bottom-5 right-5 z-[90] flex flex-col items-end gap-3">

        {open && (
          <div className="w-[min(92vw,400px)] rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-violet-400"/>{assistantName}
              </div>
              <button aria-label="Cerrar" onClick={() => setOpen(false)}><X className="h-4 w-4"/></button>
            </div>

            {/* Text input (fallback / manual) */}
            <div className="mt-3 flex gap-2">
              <input value={transcript} onChange={(e) => setTranscript(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && transcript.trim() && void answer()} placeholder="Da una orden…" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <button aria-label="Enviar" disabled={!transcript.trim() || working} onClick={() => void answer()} className="rounded-xl bg-violet-500 p-2 disabled:opacity-40"><Send className="h-4 w-4"/></button>
            </div>

            {/* Response bubble */}
            {response && (
              <p className="mt-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-200">
                <Volume2 className="mr-2 inline h-4 w-4"/>{response}
              </p>
            )}

            {/* Listening / awaiting-reply indicator */}
            {(listening || awaitingReply) && (
              <p className="mt-2 flex items-center gap-2 text-xs text-violet-400">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400"/>
                {listening ? 'Escuchando…' : 'Preparando micrófono…'}
              </p>
            )}

            {/* Proposal confirmation */}
            {proposal && (
              <div className="mt-3 flex gap-2">
                <button disabled={working} onClick={() => void confirm()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">
                  <Check className="h-4 w-4"/>Confirmar
                </button>
                <button disabled={working} onClick={() => { setProposal(null); reply('Operación descartada.'); }} className="rounded-xl border border-slate-600 px-3 py-2 text-sm">
                  Descartar
                </button>
              </div>
            )}

            {/* Footer status */}
            <div className="mt-3 flex justify-between gap-3 text-xs text-slate-400">
              <span>
                {statusLabel}
              </span>
              <div className="flex gap-3">
                {Capacitor.isNativePlatform() && (
                  <button onClick={toggleHandsFree}>{handsFree ? 'Desactivar escucha' : 'Activar escucha'}</button>
                )}
                {canConfigure && (
                  <button onClick={() => { setDraftName(assistantName); setAssistantName(''); }} className="flex items-center gap-1">
                    <Pencil className="h-3 w-3"/>Cambiar nombre
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FAB mic button */}
        <button
          aria-label="Hablar"
          onClick={() => listening ? recognitionRef.current?.stop() : startListening()}
          className={`grid h-14 w-14 place-items-center rounded-full text-white shadow-xl transition-colors ${
            listening ? 'animate-pulse bg-red-500' : awaitingReply ? 'animate-pulse bg-violet-600' : 'bg-violet-500'
          }`}
        >
          {listening ? <MicOff/> : <Mic/>}
        </button>
      </div>
    )}
  </>;
}
