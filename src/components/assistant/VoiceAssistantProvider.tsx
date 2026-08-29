'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check, Mic, MicOff, Pencil, Send, Sparkles, Volume2, X } from 'lucide-react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createClient } from '@/lib/supabase/client';
import { createPrepaymentSession } from '@/app/actions/payments';
import { sendAssistantPaymentRequest } from '@/app/actions/emails';
import { parseAssistantIntent, type AssistantMutationIntent } from '@/lib/assistant/intents';
import {
  executeAssistantOperation, loadAssistantConfiguration, resolveReservation,
  saveAssistantConfiguration, type AssistantOperation,
} from '@/lib/assistant/reservations';
import { useFloorStore } from '@/stores/useFloorStore';
import { useReservationStore } from '@/stores/useReservationStore';
import type { Reservation, Table } from '@/types';

type RecognitionEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: RecognitionEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
declare global { interface Window { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition } }

type PendingProposal = { summary: string; operation: AssistantOperation; prepayment?: boolean; paymentRequest?: 'online' | 'bizum' };
type ReservationDraft = { tableLabel?: string; guestName?: string; date?: string; time?: string; partySize?: number };
type Conversation = { kind: 'free_tables_room' } | { kind: 'reservation'; draft: ReservationDraft } | { kind: 'seat_reference' };
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

/** True when the assistant message is a question or we are mid-conversation. */
function needsReply(message: string, inConversation: boolean) {
  return inConversation || message.trim().endsWith('?');
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

  // ── Refs (stable across renders, no subscription cost) ──────────────────────
  const recognitionRef   = useRef<Recognition | null>(null);
  const answerRef        = useRef<(spokenText?: string) => Promise<void>>(async () => {});
  const confirmRef       = useRef<() => Promise<void>>(async () => {});
  const startListenRef   = useRef<() => void>(() => {});
  const conversationRef  = useRef<Conversation | null>(null);
  const proposalRef      = useRef<PendingProposal | null>(null);
  const autoStartedRef   = useRef(false);  // ensures auto-start fires only once

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
      }
    }).catch(() => setResponse('No se pudo cargar la configuración del asistente.')).finally(() => setReady(true));
  }, [isAuthPage]);

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
   */
  const speak = useCallback((text: string, expectReply = false) => {
    if (Capacitor.isNativePlatform()) {
      void WakeWord.speak({ text, expectReply });
      return;
    }
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES'; u.rate = 0.95; u.pitch = 1.02;
    if (expectReply) {
      u.onend = () => {
        setAwaitingReply(false);
        setTimeout(() => startListenRef.current(), 400);
      };
    }
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

  // ── buildProposal ─────────────────────────────────────────────────────────────
  const buildProposal = useCallback(async (intent: AssistantMutationIntent): Promise<PendingProposal> => {
    if (intent.action === 'create_reservation') {
      return { summary: `Crear reserva para ${intent.guestName}, ${intent.partySize} personas, el ${intent.date} a las ${intent.time}. La mesa se asignará de forma segura al confirmar.`, operation: { action: intent.action, guest_name: intent.guestName, party_size: intent.partySize, date: intent.date, time: intent.time, duration_minutes: intent.durationMinutes } };
    }
    const reservation = await resolveReservation(intent.reference);
    if (intent.action === 'send_payment_request') {
      if (!reservation.guest_email) throw new Error(`${reservation.reservation_number} no tiene correo del cliente.`);
      return { summary: `Enviar a ${reservation.guest_email} una solicitud de ${intent.amount.toFixed(2)} € por ${intent.method === 'bizum' ? 'Bizum' : 'pasarela de pago'} para ${reservation.reservation_number}.`, operation: { action: 'require_prepayment', reservation_id: reservation.id, amount: intent.amount }, paymentRequest: intent.method };
    }
    if (intent.action === 'seat_reservation') return { summary: `Sentar la reserva ${reservation.reservation_number}, de ${reservation.guest_name}. La mesa quedará marcada como ocupada.`, operation: { action: intent.action, reservation_id: reservation.id } };
    if (intent.action === 'cancel_reservation') return { summary: `Cancelar ${reservation.reservation_number}, de ${reservation.guest_name}, el ${reservation.date} a las ${reservation.time.slice(0, 5)}.`, operation: { action: intent.action, reservation_id: reservation.id } };
    if (intent.action === 'require_prepayment') return { summary: `Solicitar un anticipo de ${intent.amount.toFixed(2)} € para ${reservation.reservation_number}. Stripe generará un enlace de pago; no se capturarán tarjetas aquí.`, operation: { action: intent.action, reservation_id: reservation.id, amount: intent.amount }, prepayment: true };
    return { summary: `Modificar ${reservation.reservation_number}: ${intent.date ? `fecha ${intent.date}; ` : ''}${intent.time ? `hora ${intent.time}; ` : ''}${intent.partySize ? `${intent.partySize} personas; ` : ''}la asignación se recalculará al confirmar.`, operation: { action: intent.action, reservation_id: reservation.id, date: intent.date, time: intent.time, party_size: intent.partySize } };
  }, []);

  // ── answer ────────────────────────────────────────────────────────────────────
  const answer = useCallback(async (spokenText?: string) => {
    const command = spokenText?.trim() || transcript.trim();
    if (!command) return;
    setTranscript(command); setOpen(true); setAwaitingReply(false);

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

    // ── Active conversation turns ────────────────────────────────────────────
    if (conversationRef.current?.kind === 'free_tables_room') {
      const normalized = command.toLocaleLowerCase('es-ES');
      const room = rooms.find((r) => normalized.includes(r.name.toLocaleLowerCase('es-ES')));
      if (!room) { reply(`No reconozco ese salón. Puedes decir ${rooms.map((r) => r.name).join(' o ')}.`); return; }
      const { data, error } = await createClient().from('tables').select('*, table_type:table_types(*)').eq('room_id', room.id).eq('is_active', true);
      if (error) { reply('No he podido consultar las mesas de ese salón.'); return; }
      conversationRef.current = null;
      const roomTables = (data ?? []) as Table[];
      const free = roomTables.filter((t) => !overlaps(t, reservations, selectedDate, selectedTime));
      reply(free.length ? `En ${room.name} tienes ${free.length} mesas libres: ${free.map((t) => t.label).join(', ')}.` : `No tienes mesas libres en ${room.name}.`);
      return;
    }

    if (conversationRef.current?.kind === 'seat_reference') {
      const reference = command.match(/\b(res-\d{4}-\d{6})\b/i)?.[1];
      if (!reference) { reply('Dime el número completo de reserva, por ejemplo RES-2026-000123.'); return; }
      conversationRef.current = null; setWorking(true);
      try {
        const next = await buildProposal({ action: 'seat_reservation', reference: reference.toUpperCase() });
        setProposal(next); reply(next.summary + ' ¿Lo confirmas?');
      } catch (error) { reply(error instanceof Error ? error.message : 'No pude localizar esa reserva.'); }
      finally { setWorking(false); }
      return;
    }

    if (conversationRef.current?.kind === 'reservation') {
      const draft = conversationRef.current.draft;
      const parsed = parseAssistantIntent(command);
      if (parsed.action === 'draft_reservation') Object.assign(draft, Object.fromEntries(Object.entries(parsed).filter(([k, v]) => k !== 'action' && v !== undefined)));
      else if (!draft.tableLabel) draft.tableLabel = command.replace(/^mesa\s+/i, '').trim();
      else if (!draft.partySize) { const f = parseAssistantIntent(`reserva mesa ${draft.tableLabel} para ${command}`); if (f.action === 'draft_reservation') draft.partySize = f.partySize; }
      else if (!draft.date)     { const f = parseAssistantIntent(`reserva mesa ${draft.tableLabel} para ${draft.partySize} ${command}`); if (f.action === 'draft_reservation') draft.date = f.date; }
      else if (!draft.time)     { const f = parseAssistantIntent(`reserva mesa ${draft.tableLabel} para ${draft.partySize} ${draft.date} a las ${command}`); if (f.action === 'draft_reservation') draft.time = f.time; }
      else if (!draft.guestName) draft.guestName = command.replace(/^(a nombre de|nombre)\s+/i, '').trim();
      const missing = !draft.tableLabel ? '¿Qué mesa quieres reservar?' : !draft.partySize ? '¿Para cuántas personas?' : !draft.date ? '¿Para qué día?' : !draft.time ? '¿A qué hora?' : !draft.guestName ? '¿A nombre de quién?' : null;
      if (missing) { reply(missing); return; }
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
        const next = { summary: `Reservar la mesa ${table.label} para ${draft.guestName}, ${draft.partySize} personas, el ${draft.date} a las ${draft.time}.`, operation: { action: 'create_reservation' as const, guest_name: draft.guestName, party_size: draft.partySize, date: draft.date, time: draft.time, duration_minutes: 90, table_id: table.id } };
        conversationRef.current = null; setProposal(next); reply(next.summary + ' ¿Lo confirmas?');
      } catch { reply('No he podido comprobar la disponibilidad ahora mismo.'); }
      finally { setWorking(false); }
      return;
    }

    // ── Single-shot intents ──────────────────────────────────────────────────
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
      message = active.length ? `Hoy tienes ${active.length} reservas. ${active.slice(0, 8).map((r) => `${r.guest_name}, ${r.party_size} personas a las ${r.time.slice(0, 5)}${r.table?.label ? `, mesa ${r.table.label}` : ''}`).join('. ')}${active.length > 8 ? `. Y ${active.length - 8} más.` : '.'}` : 'Hoy no tienes reservas activas.';
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
      if (rooms.length > 1) { conversationRef.current = { kind: 'free_tables_room' }; message = `¿En qué salón? Puedes decir ${rooms.map((r) => r.name).join(', ')}.`; }
      else { const free = tables.filter((t) => t.is_active && !overlaps(t, reservations, selectedDate, selectedTime)); message = free.length ? `Tienes ${free.length} mesas libres: ${free.slice(0, 10).map((t) => t.label).join(', ')}${free.length > 10 ? ` y ${free.length - 10} más` : ''}.` : 'No veo mesas libres en este momento.'; }
    } else if (intent.action === 'draft_reservation') {
      conversationRef.current = { kind: 'reservation', draft: { tableLabel: intent.tableLabel, guestName: intent.guestName, date: intent.date, time: intent.time, partySize: intent.partySize } };
      const draft = conversationRef.current.draft;
      // If all fields are already present, process immediately
      if (draft.tableLabel && draft.partySize && draft.date && draft.time && draft.guestName) { void answerRef.current(command); return; }
      message = !draft.tableLabel ? '¿Qué mesa quieres reservar?' : !draft.partySize ? '¿Para cuántas personas?' : !draft.date ? '¿Para qué día?' : !draft.time ? '¿A qué hora?' : '¿A nombre de quién?';
    } else if (intent.action === 'help' && /(sienta|sentar|acomoda)/i.test(command)) {
      conversationRef.current = { kind: 'seat_reference' }; message = 'Claro. Dime el número completo de la reserva que quieres sentar.';
    } else if (intent.action === 'help') {
      message = 'Puedo decirte las reservas de hoy, qué mesas están libres, recomendar una mesa, y también reservar, modificar o cancelar reservas. ¿Qué necesitas?';
    } else {
      setWorking(true);
      try { const next = await buildProposal(intent); setProposal(next); message = next.summary + ' ¿Lo confirmas?'; }
      catch (error) { message = error instanceof Error ? error.message : 'No pude preparar la operación.'; }
      finally { setWorking(false); }
    }
    reply(message);
  }, [buildProposal, reply, reservations, rooms, selectedDate, selectedTime, tables, todayReservations, transcript]);
  useEffect(() => { answerRef.current = answer; }, [answer]);

  // ── Wake-word listener (native only) ──────────────────────────────────────
  useEffect(() => {
    if (!assistantName || isAuthPage || !Capacitor.isNativePlatform()) return;
    let listener: PluginListenerHandle | undefined;
    let cancelled = false;
    WakeWord.addListener('wakeCommand', ({ command }) => {
      if (command === '__WAKE__') { setOpen(true); reply('Dime, ¿qué deseas?'); return; }
      if (command) void answerRef.current(command);
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
  /** Start the Web Speech API recognizer. On result, auto-calls answer(). */
  const startListening = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { setOpen(true); reply('El reconocimiento de voz no está disponible. Escribe la orden.'); return; }
    const recognition = new Ctor();
    recognition.lang = 'es-ES'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setTranscript(text); setOpen(true); setAwaitingReply(false);
      // Auto-process: no button press needed
      void answerRef.current(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false); setAwaitingReply(false);
      reply('No he podido escuchar. Puedes escribir la orden o intentarlo de nuevo.');
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true); setOpen(true);
  }, [reply]);
  useEffect(() => { startListenRef.current = startListening; }, [startListening]);

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
              <span>{statusLabel}</span>
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
