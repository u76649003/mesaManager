// ============================================================
// MesaManager — AI Layer Types
// ============================================================

// ── Message types (OpenAI-compatible) ──────────────────────
export type AIRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AIMessage {
  role: AIRole;
  content: string;
  tool_call_id?: string; // when role === 'tool'
  tool_calls?: AIToolCall[]; // when role === 'assistant' and model requested a tool
}

// ── Tool definitions ────────────────────────────────────────
export interface AIToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

export interface AIToolParameters {
  type: 'object';
  properties: Record<string, AIToolParameter>;
  required?: string[];
}

export interface AITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: AIToolParameters;
  };
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface AIToolResult {
  tool_call_id: string;
  content: string; // JSON string or plain text result
}

// ── Structured conversation context ─────────────────────────
// Keeps track of things mentioned during the conversation so the AI
// can resolve references like "la de antes", "esa mesa", "el de las diez".
export interface ConversationContext {
  activeTableId?: string;
  activeTableLabel?: string;
  activeReservationId?: string;
  activeReservationNumber?: string;
  activeGuestName?: string;
  activeRoomId?: string;
  lastSearchResults?: string[]; // table labels found in last search
  lastReservationResults?: Array<{ id: string; reservation_number: string; guest_name: string; time: string }>;
  partySize?: number;
  date?: string; // ISO date
  time?: string; // HH:MM
  pendingOperation?: PendingAIOperation;
}

export interface PendingAIOperation {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

// ── Session ──────────────────────────────────────────────────
export interface ConversationSession {
  messages: AIMessage[];
  context: ConversationContext;
  sessionActive: boolean;
  lastActivityAt: number; // Date.now()
}

// ── AI response ──────────────────────────────────────────────
export type AIResponseKind =
  | { kind: 'text'; text: string }
  | { kind: 'proposal'; summary: string; operation: Record<string, unknown>; paymentRequest?: 'online' | 'bizum'; prepayment?: boolean }
  | { kind: 'end_session'; text: string }
  | { kind: 'unavailable' }; // Ollama down — caller uses fallback

// ── Provider interface ──────────────────────────────────────
// Implement this interface to swap Ollama for OpenAI, Gemini, Claude, etc.
export interface AIProvider {
  chat(messages: AIMessage[], tools: AITool[], signal?: AbortSignal): Promise<AIProviderResponse>;
  readonly available: boolean;
}

export interface AIProviderResponse {
  content: string | null;
  tool_calls?: AIToolCall[];
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'error';
}

// ── Store context snapshot ───────────────────────────────────
// A reduced snapshot of store data, passed from the component to the AI provider.
export interface StoreSnapshot {
  tables: Array<{
    id: string;
    label: string;
    status: string;
    capacity: number;
    room_id: string;
    is_active: boolean;
  }>;
  rooms: Array<{ id: string; name: string }>;
  reservations: Array<{
    id: string;
    reservation_number: string;
    guest_name: string;
    date: string;
    time: string;
    party_size: number;
    status: string;
    table_id?: string | null;
  }>;
  todayReservations: Array<{
    id: string;
    reservation_number: string;
    guest_name: string;
    date: string;
    time: string;
    party_size: number;
    status: string;
    table_id?: string | null;
    table?: { label: string } | null;
  }>;
  selectedDate: string;
  selectedTime: string | null;
  now: string; // ISO timestamp
}
