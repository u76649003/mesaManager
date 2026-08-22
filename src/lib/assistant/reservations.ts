import { createClient } from '@/lib/supabase/client';
import type { AssistantMutationIntent } from './intents';

export type AssistantOperation = Record<string, unknown> & { action: AssistantMutationIntent['action'] };

export async function resolveReservation(reference: string) {
  const supabase = createClient();
  const normalized = reference.toUpperCase();
  const { data, error } = await supabase
    .from('reservations')
    .select('id, tenant_id, reservation_number, guest_name, guest_email, date, time, party_size, status, prepayment_amount, payment_status, payment_method, bizum_phone, bizum_name')
    .eq('reservation_number', normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No encuentro la reserva ${normalized}.`);
  return data;
}

export async function executeAssistantOperation(operation: AssistantOperation) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('assistant_execute_reservation', { p_operation: operation });
  if (error) throw new Error(error.message);
  return data as { id: string; reservation_number: string; status: string; table_id?: string; group_id?: string };
}

export async function loadAssistantConfiguration() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles').select('tenant_id, role').eq('id', user.id).single();
  if (profileError) throw profileError;
  const { data: tenant, error } = await supabase
    .from('tenants').select('assistant_name, assistant_enabled').eq('id', profile.tenant_id).single();
  if (error) throw error;
  return { ...tenant, tenantId: profile.tenant_id, canConfigure: ['owner', 'manager'].includes(profile.role) };
}

export async function saveAssistantConfiguration(tenantId: string, name: string) {
  const supabase = createClient();
  const { error } = await supabase.from('tenants').update({ assistant_name: name, assistant_enabled: true }).eq('id', tenantId);
  if (error) throw error;
}
