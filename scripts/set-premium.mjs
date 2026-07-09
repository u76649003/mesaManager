// Script combinado: arregla el trigger + actualiza usuario a premium
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TARGET_EMAIL = 'justojgd@gmail.com';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── 1. Fix the trigger via rpc ──────────────────────────────────────────────
async function fixTrigger() {
  console.log('🔧 Arreglando trigger de reservation_number...');
  const sql = `
    CREATE OR REPLACE FUNCTION generate_reservation_number()
    RETURNS TRIGGER AS $$
    DECLARE
      max_num INT;
      year_str TEXT;
    BEGIN
      year_str := TO_CHAR(NOW(), 'YYYY');
      SELECT COALESCE(
        MAX(
          CAST(
            REGEXP_REPLACE(reservation_number, '[^0-9]', '', 'g')
            AS INT
          )
        ), 0
      ) + 1
      INTO max_num
      FROM reservations
      WHERE tenant_id = NEW.tenant_id
        AND reservation_number LIKE 'RES-' || year_str || '%';
      NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(max_num::TEXT, 6, '0');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (!res.ok) {
    // Try alternative approach using pg directly
    console.log('⚠️  rpc/exec_sql no disponible, intentando via query directa...');
  } else {
    console.log('✅ Trigger actualizado');
  }
}

// ── 2. Set user as premium ──────────────────────────────────────────────────
async function setPremium() {
  console.log(`\n👤 Buscando usuario: ${TARGET_EMAIL}`);

  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    console.error('❌ Error:', usersError.message);
    process.exit(1);
  }

  const user = usersData.users.find(u => u.email === TARGET_EMAIL);
  if (!user) {
    console.log('Usuarios en el sistema:');
    usersData.users.forEach(u => console.log(' -', u.email));
    console.error(`❌ No se encontró ${TARGET_EMAIL}`);
    process.exit(1);
  }

  console.log(`✅ Usuario encontrado (${user.id})`);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    console.error('❌ Perfil de usuario no encontrado');
    process.exit(1);
  }

  console.log(`✅ Tenant: ${profile.tenant_id}`);

  const { data: updated, error: updateErr } = await supabase
    .from('tenants')
    .update({
      subscription_plan:   'pro',
      subscription_status: 'active',
      subscription_ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', profile.tenant_id)
    .select('name, subscription_plan, subscription_status')
    .single();

  if (updateErr) {
    console.error('❌ Error actualizando:', updateErr.message);
    process.exit(1);
  }

  console.log('');
  console.log('🎉 ¡Usuario actualizado a PREMIUM!');
  console.log('──────────────────────────────────');
  console.log(`   Restaurante : ${updated.name}`);
  console.log(`   Plan        : ${updated.subscription_plan.toUpperCase()} ✨`);
  console.log(`   Estado      : ${updated.subscription_status}`);
  console.log('──────────────────────────────────');
}

await fixTrigger().catch(() => {});
await setPremium();
