const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Custom simple parser for dotenv as .env.local might contain comments and variables
const envLocalPath = path.join(__dirname, '..', '.env.local');
const envConfig = {};
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        envConfig[key] = value;
      }
    }
  }
}

async function run() {
  const url = envConfig['NEXT_PUBLIC_SUPABASE_URL'] || 'http://localhost:54321';
  const anonKey = envConfig['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = envConfig['SUPABASE_SERVICE_ROLE_KEY'];

  console.log('URL:', url);
  console.log('Anon Key length:', anonKey?.length);
  console.log('Service Role Key length:', serviceRoleKey?.length);

  const supabase = createClient(url, anonKey);
  const adminSupabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const email = `test-${Date.now()}@example.com`;
  const password = 'password123';
  const restaurantName = 'Test Restaurant';
  const restaurantSlug = `test-restaurant-${Date.now()}`;
  const ownerName = 'Test Owner';

  console.log('Signing up user:', email);
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError || !authData.user) {
    console.error('Sign up error:', authError);
    return;
  }

  const userId = authData.user.id;
  console.log('User created with ID:', userId);

  console.log('Creating tenant...');
  const { data: tenantData, error: tenantError } = await adminSupabase
    .from('tenants')
    .insert({
      name: restaurantName,
      slug: restaurantSlug,
      timezone: 'Europe/Madrid',
      subscription_plan: 'trial',
      subscription_status: 'active',
    })
    .select()
    .single();

  if (tenantError || !tenantData) {
    console.error('Tenant creation error:', tenantError);
    await adminSupabase.auth.admin.deleteUser(userId);
    return;
  }

  console.log('Tenant created with ID:', tenantData.id);

  console.log('Creating user profile...');
  const { error: profileError } = await adminSupabase
    .from('user_profiles')
    .insert({
      id: userId,
      tenant_id: tenantData.id,
      role: 'owner',
      full_name: ownerName,
      is_active: true,
    });

  if (profileError) {
    console.error('Profile creation error:', profileError);
    await adminSupabase.from('tenants').delete().eq('id', tenantData.id);
    await adminSupabase.auth.admin.deleteUser(userId);
    return;
  }

  console.log('User profile created successfully!');

  // Clean up test data
  console.log('Cleaning up test data...');
  await adminSupabase.from('user_profiles').delete().eq('id', userId);
  await adminSupabase.from('tenants').delete().eq('id', tenantData.id);
  await adminSupabase.auth.admin.deleteUser(userId);
  console.log('Clean up complete! Everything works!');
}

run().catch(console.error);
