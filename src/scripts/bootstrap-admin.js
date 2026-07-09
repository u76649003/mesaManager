const { createClient } = require('@supabase/supabase-js');

// Crear cliente de administración local usando el service role key
const supabase = createClient(
  'http://127.0.0.1:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    }
  }
);

async function run() {
  const email = 'juan@mirestaurante.com';
  const password = 'password123';
  const restaurantName = 'El Mirador';
  const restaurantSlug = 'el-mirador';
  const ownerName = 'Juan Pérez';

  console.log('Iniciando registro forzado del administrador local...');

  // 1. Crear el usuario en auth.users usando la API de administración para evitar envíos de correos de confirmación
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true // Confirmado automáticamente
  });

  if (authError || !authData.user) {
    console.error('Error creando usuario de autenticación:', authError);
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log(`Usuario de autenticación creado con ID: ${userId}`);

  // 2. Insertar el restaurante (Tenant)
  const { data: tenantData, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      name: restaurantName,
      slug: restaurantSlug,
      timezone: 'Europe/Madrid',
      subscription_plan: 'pro',
      subscription_status: 'active'
    })
    .select()
    .single();

  if (tenantError || !tenantData) {
    console.error('Error creando el restaurante:', tenantError);
    // Limpieza
    await supabase.auth.admin.deleteUser(userId);
    process.exit(1);
  }

  console.log(`Restaurante creado con ID: ${tenantData.id}`);

  // 3. Crear el perfil de usuario asociado como propietario (Owner)
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      id: userId,
      tenant_id: tenantData.id,
      role: 'owner',
      full_name: ownerName,
      is_active: true
    });

  if (profileError) {
    console.error('Error creando perfil de usuario:', profileError);
    // Limpieza
    await supabase.from('tenants').delete().eq('id', tenantData.id);
    await supabase.auth.admin.deleteUser(userId);
    process.exit(1);
  }

  console.log('Perfil de usuario propietario enlazado correctamente.');

  // 4. Aprovisionamiento por defecto
  const { data: roomData, error: roomError } = await supabase
    .from('rooms')
    .insert({
      tenant_id: tenantData.id,
      name: 'Salón Principal',
      canvas_width: 1200,
      canvas_height: 800,
      background_color: '#0f172a',
      is_active: true,
      sort_order: 1
    })
    .select()
    .single();

  if (roomError || !roomData) {
    console.error('Error al aprovisionar salón:', roomError);
    process.exit(1);
  }

  console.log('Salón principal aprovisionado.');

  // Aprovisionar tipos de mesa por defecto
  const { data: tableTypes, error: typesError } = await supabase
    .from('table_types')
    .insert([
      { tenant_id: tenantData.id, name: 'Redonda 2', shape: 'circle', capacity: 2, width: 70, height: 70, color: '#6366f1' },
      { tenant_id: tenantData.id, name: 'Cuadrada 4', shape: 'square', capacity: 4, width: 85, height: 85, color: '#3b82f6' },
      { tenant_id: tenantData.id, name: 'Rectangular 6', shape: 'rectangle', capacity: 6, width: 130, height: 80, color: '#10b981' },
      { tenant_id: tenantData.id, name: 'Redonda 4', shape: 'circle', capacity: 4, width: 90, height: 90, color: '#f59e0b' },
      { tenant_id: tenantData.id, name: 'Gran Mesa 8', shape: 'rectangle', capacity: 8, width: 160, height: 85, color: '#ef4444' }
    ])
    .select();

  if (typesError || !tableTypes) {
    console.error('Error al aprovisionar tipos de mesa:', typesError);
    process.exit(1);
  }

  console.log('Tipos de mesas creados.');

  const typeRedonda2 = tableTypes.find((t) => t.name === 'Redonda 2').id;
  const typeCuadrada4 = tableTypes.find((t) => t.name === 'Cuadrada 4').id;
  const typeRectangular6 = tableTypes.find((t) => t.name === 'Rectangular 6').id;
  const typeRedonda4 = tableTypes.find((t) => t.name === 'Redonda 4').id;
  const typeGranMesa8 = tableTypes.find((t) => t.name === 'Gran Mesa 8').id;

  // Aprovisionar mesas por defecto
  const { error: tablesError } = await supabase.from('tables').insert([
    { room_id: roomData.id, table_type_id: typeCuadrada4, label: 'M1', position_x: 80, position_y: 80, status: 'available' },
    { room_id: roomData.id, table_type_id: typeCuadrada4, label: 'M2', position_x: 230, position_y: 80, status: 'available' },
    { room_id: roomData.id, table_type_id: typeRectangular6, label: 'M3', position_x: 400, position_y: 80, status: 'available' },
    { room_id: roomData.id, table_type_id: typeRedonda2, label: 'M4', position_x: 80, position_y: 240, status: 'available' },
    { room_id: roomData.id, table_type_id: typeRedonda2, label: 'M5', position_x: 230, position_y: 240, status: 'available' },
    { room_id: roomData.id, table_type_id: typeRedonda4, label: 'M6', position_x: 400, position_y: 240, status: 'available' },
    { room_id: roomData.id, table_type_id: typeCuadrada4, label: 'M7', position_x: 580, position_y: 80, status: 'available' },
    { room_id: roomData.id, table_type_id: typeGranMesa8, label: 'M8', position_x: 580, position_y: 240, status: 'available' }
  ]);

  if (tablesError) {
    console.error('Error al insertar mesas:', tablesError);
    process.exit(1);
  }

  console.log('Mesas aprovisionadas en el plano.');

  // Aprovisionar turnos
  const { error: shiftsError } = await supabase.from('shifts').insert([
    { tenant_id: tenantData.id, name: 'Mediodía', start_time: '13:00:00', end_time: '16:30:00', days_of_week: [1,2,3,4,5,6,7], color: '#f59e0b', is_active: true, sort_order: 1 },
    { tenant_id: tenantData.id, name: 'Noche', start_time: '20:00:00', end_time: '00:00:00', days_of_week: [1,2,3,4,5,6,7], color: '#6366f1', is_active: true, sort_order: 2 }
  ]);

  if (shiftsError) {
    console.error('Error al insertar turnos:', shiftsError);
    process.exit(1);
  }

  console.log('Turnos de almuerzo y noche aprovisionados correctamente.');
  console.log('\n======================================================');
  console.log('¡REGISTRO MANUAL COMPLETADO CON ÉXITO!');
  console.log('Credenciales de acceso:');
  console.log(`Usuario / Email:  ${email}`);
  console.log(`Contraseña:       ${password}`);
  console.log('======================================================');
}

run();
