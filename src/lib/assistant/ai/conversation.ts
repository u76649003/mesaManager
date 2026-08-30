// ============================================================
// MesaManager — Conversation Session Manager
// ============================================================
// Manages the AI message history and structured context for
// the ongoing voice session.

import type { AIMessage, ConversationContext, ConversationSession, PendingAIOperation } from './types';

const MAX_HISTORY_TURNS = 20; // keep last 20 user+assistant pairs
const SESSION_TIMEOUT_MS = 60_000; // 60 s of inactivity → auto-close

// ── Factory ──────────────────────────────────────────────────
export function createSession(systemPrompt: string): ConversationSession {
  return {
    messages: [{ role: 'system', content: systemPrompt }],
    context: {},
    sessionActive: true,
    lastActivityAt: Date.now(),
  };
}

// ── Message management ───────────────────────────────────────
export function addUserMessage(session: ConversationSession, text: string): void {
  session.messages.push({ role: 'user', content: text });
  session.lastActivityAt = Date.now();
  trimHistory(session);
}

export function addAssistantMessage(session: ConversationSession, text: string): void {
  session.messages.push({ role: 'assistant', content: text });
  session.lastActivityAt = Date.now();
}

export function addToolResult(session: ConversationSession, toolCallId: string, result: string): void {
  session.messages.push({ role: 'tool', content: result, tool_call_id: toolCallId });
}

/**
 * Keep the system message + last MAX_HISTORY_TURNS * 2 messages.
 */
function trimHistory(session: ConversationSession): void {
  const [system, ...rest] = session.messages;
  if (rest.length > MAX_HISTORY_TURNS * 2) {
    session.messages = [system!, ...rest.slice(rest.length - MAX_HISTORY_TURNS * 2)];
  }
}

// ── Structured context ───────────────────────────────────────
export function updateContext(session: ConversationSession, updates: Partial<ConversationContext>): void {
  session.context = { ...session.context, ...updates };
}

export function setPendingOperation(session: ConversationSession, op: PendingAIOperation | undefined): void {
  session.context.pendingOperation = op;
}

export function clearPendingOperation(session: ConversationSession): void {
  delete session.context.pendingOperation;
}

// ── Session lifecycle ────────────────────────────────────────
export function touchSession(session: ConversationSession): void {
  session.lastActivityAt = Date.now();
}

export function isSessionTimedOut(session: ConversationSession): boolean {
  return Date.now() - session.lastActivityAt > SESSION_TIMEOUT_MS;
}

export function closeSession(session: ConversationSession): void {
  session.sessionActive = false;
}

export function clearSession(session: ConversationSession, systemPrompt: string): void {
  session.messages = [{ role: 'system', content: systemPrompt }];
  session.context = {};
  session.sessionActive = true;
  session.lastActivityAt = Date.now();
}

// ── End-of-conversation detection ───────────────────────────
const END_PHRASES = [
  'gracias', 'de acuerdo gracias', 'perfecto gracias', 'muchas gracias',
  'eso es todo', 'ya está', 'ya está todo', 'terminamos', 'fin',
  'adiós', 'hasta luego', 'hasta pronto', 'chao', 'bye',
  'para', 'para ya', 'stop',
];

export function isEndOfSession(text: string): boolean {
  const norm = text.toLocaleLowerCase('es-ES').trim();
  return END_PHRASES.some((phrase) => norm === phrase || norm.startsWith(phrase + ' ') || norm.endsWith(' ' + phrase));
}
