'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function login(state: any, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'El correo y la contraseña son requeridos.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function registerTenant(state: any, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const restaurantName = formData.get('restaurantName') as string;
  const restaurantSlug = formData.get('restaurantSlug') as string;
  const ownerName = formData.get('ownerName') as string;

  if (!email || !password || !restaurantName || !restaurantSlug || !ownerName) {
    return { error: 'Todos los campos son obligatorios.' };
  }

  try {
    const supabase = await createClient();

    // 1. Sign up the user in Supabase auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      return { error: authError?.message || 'Error al registrar el usuario en Supabase.' };
    }

    const userId = authData.user.id;

    // 2. Create the tenant and user profile using admin client to bypass initial RLS constraint
    const adminSupabase = createAdminClient();

    // Create the Tenant
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
      // Clean up user if tenant creation fails
      await adminSupabase.auth.admin.deleteUser(userId);
      return { error: `Error al crear el restaurante: ${tenantError?.message}` };
    }

    // Create the user profile associated with the new tenant as 'owner'
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
      // Clean up tenant and user if profile creation fails
      await adminSupabase.from('tenants').delete().eq('id', tenantData.id);
      await adminSupabase.auth.admin.deleteUser(userId);
      return { error: `Error al crear el perfil de usuario: ${profileError.message}` };
    }

    // 3. Auto-provision default salon, table types, tables, and shifts
    const { data: roomData, error: roomError } = await adminSupabase
      .from('rooms')
      .insert({
        tenant_id: tenantData.id,
        name: 'Salón Principal',
        canvas_width: 1200,
        canvas_height: 800,
        background_color: '#0f172a',
        is_active: true,
        sort_order: 1,
      })
      .select()
      .single();

    if (!roomError && roomData) {
      // Create default table types
      const { data: tableTypes, error: typesError } = await adminSupabase
        .from('table_types')
        .insert([
          { tenant_id: tenantData.id, name: 'Redonda 2', shape: 'circle', capacity: 2, width: 70, height: 70, color: '#6366f1' },
          { tenant_id: tenantData.id, name: 'Cuadrada 4', shape: 'square', capacity: 4, width: 85, height: 85, color: '#3b82f6' },
          { tenant_id: tenantData.id, name: 'Rectangular 6', shape: 'rectangle', capacity: 6, width: 130, height: 80, color: '#10b981' },
          { tenant_id: tenantData.id, name: 'Redonda 4', shape: 'circle', capacity: 4, width: 90, height: 90, color: '#f59e0b' },
          { tenant_id: tenantData.id, name: 'Gran Mesa 8', shape: 'rectangle', capacity: 8, width: 160, height: 85, color: '#ef4444' },
        ])
        .select();

      if (!typesError && tableTypes) {
        const typeRedonda2 = tableTypes.find((t) => t.name === 'Redonda 2')?.id;
        const typeCuadrada4 = tableTypes.find((t) => t.name === 'Cuadrada 4')?.id;
        const typeRectangular6 = tableTypes.find((t) => t.name === 'Rectangular 6')?.id;
        const typeRedonda4 = tableTypes.find((t) => t.name === 'Redonda 4')?.id;
        const typeGranMesa8 = tableTypes.find((t) => t.name === 'Gran Mesa 8')?.id;

        // Create default tables
        await adminSupabase.from('tables').insert([
          { room_id: roomData.id, table_type_id: typeCuadrada4, label: 'M1', position_x: 80, position_y: 80, status: 'available' },
          { room_id: roomData.id, table_type_id: typeCuadrada4, label: 'M2', position_x: 230, position_y: 80, status: 'available' },
          { room_id: roomData.id, table_type_id: typeRectangular6, label: 'M3', position_x: 400, position_y: 80, status: 'available' },
          { room_id: roomData.id, table_type_id: typeRedonda2, label: 'M4', position_x: 80, position_y: 240, status: 'available' },
          { room_id: roomData.id, table_type_id: typeRedonda2, label: 'M5', position_x: 230, position_y: 240, status: 'available' },
          { room_id: roomData.id, table_type_id: typeRedonda4, label: 'M6', position_x: 400, position_y: 240, status: 'available' },
          { room_id: roomData.id, table_type_id: typeCuadrada4, label: 'M7', position_x: 580, position_y: 80, status: 'available' },
          { room_id: roomData.id, table_type_id: typeGranMesa8, label: 'M8', position_x: 580, position_y: 240, status: 'available' },
        ]);
      }
    }

    // Create default shifts
    await adminSupabase.from('shifts').insert([
      { tenant_id: tenantData.id, name: 'Mediodía', start_time: '13:00:00', end_time: '16:30:00', days_of_week: [1,2,3,4,5,6,7], color: '#f59e0b', is_active: true, sort_order: 1 },
      { tenant_id: tenantData.id, name: 'Noche', start_time: '20:00:00', end_time: '00:00:00', days_of_week: [1,2,3,4,5,6,7], color: '#6366f1', is_active: true, sort_order: 2 },
    ]);

    // Automatically sign in the user by calling signInWithPassword to ensure session cookies are set correctly
    await supabase.auth.signInWithPassword({ email, password });

  } catch (err: any) {
    console.error("CRITICAL ERROR IN REGISTRATION FLOW:", err);
    return { error: err.message || 'Ocurrió un error inesperado durante el registro.' };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function getCurrentUserSession() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    // Fetch user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile) return { user, profile: null, tenant: null };

    // Fetch tenant details
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', profile.tenant_id)
      .single();

    return {
      user,
      profile,
      tenant,
    };
  } catch {
    return null;
  }
}
