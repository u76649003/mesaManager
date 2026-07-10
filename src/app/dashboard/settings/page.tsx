'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { useReservationStore } from '@/stores/useReservationStore';
import { Sidebar } from '@/components/layout/Sidebar';
import {
  Settings,
  Plus,
  Trash2,
  Edit,
  Save,
  X,
  Layers,
  Layout,
  Clock,
  Check,
  ChevronRight,
  Building2,
} from 'lucide-react';
import type { Room, TableType, Shift } from '@/types';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  // Stores
  const {
    rooms,
    tableTypes,
  } = useFloorStore();

  const { shifts } = useReservationStore();

  // Stub functions to fix TypeScript compilation for settings actions
  // Stub functions to fix TypeScript compilation for settings actions
  const addRoom = async (room: any) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile) return;
    
    const newRoom = { ...room, tenant_id: profile.tenant_id };
    await supabase.from('rooms').insert(newRoom);
    useFloorStore.setState((s) => ({ rooms: [...s.rooms, newRoom] }));
  };
  const updateRoom = async (id: string, updates: any) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('rooms').update(updates).eq('id', id);
    useFloorStore.setState((s) => ({
      rooms: s.rooms.map((r) => r.id === id ? { ...r, ...updates } : r)
    }));
  };
  const removeRoom = async (id: string) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('rooms').delete().eq('id', id);
    useFloorStore.setState((s) => ({
      rooms: s.rooms.filter((r) => r.id !== id)
    }));
  };
  const addTableType = async (type: any) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile) return;

    const newType = { ...type, tenant_id: profile.tenant_id };
    await supabase.from('table_types').insert(newType);
    useFloorStore.setState((s) => ({ tableTypes: [...s.tableTypes, newType] }));
  };
  const updateTableType = async (id: string, updates: any) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('table_types').update(updates).eq('id', id);
    useFloorStore.setState((s) => ({
      tableTypes: s.tableTypes.map((t) => t.id === id ? { ...t, ...updates } : t)
    }));
  };
  const removeTableType = async (id: string) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('table_types').delete().eq('id', id);
    useFloorStore.setState((s) => ({
      tableTypes: s.tableTypes.filter((t) => t.id !== id)
    }));
  };
  const addShift = async (shift: any) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile) return;

    const newShift = { ...shift, tenant_id: profile.tenant_id };
    await supabase.from('shifts').insert(newShift);
    useReservationStore.setState((s) => ({ shifts: [...s.shifts, newShift] }));
  };
  const updateShift = async (id: string, updates: any) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('shifts').update(updates).eq('id', id);
    useReservationStore.setState((s) => ({
      shifts: s.shifts.map((s) => s.id === id ? { ...s, ...updates } : s)
    }));
  };
  const removeShift = async (id: string) => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('shifts').delete().eq('id', id);
    useReservationStore.setState((s) => ({
      shifts: s.shifts.filter((s) => s.id !== id)
    }));
  };

  // Local Page State
  const [activeTab, setActiveTab] = useState<'general' | 'rooms' | 'tableTypes' | 'shifts'>('rooms');
  const [activeRoom, setActiveRoom] = useState<Room>({ id: 'temp' } as any);
  const [roomImageFile, setRoomImageFile] = useState<File | null>(null);
  const [roomImagePreview, setRoomImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [gracePeriod, setGracePeriod] = useState<number>(10);
  const [tenantId, setTenantId] = useState<string>('');

  useEffect(() => {
    if (rooms && rooms.length > 0 && (!activeRoom || activeRoom.id === 'temp')) {
      setActiveRoom(rooms[0]);
    }
  }, [rooms, activeRoom]);

  useEffect(() => {
    async function loadTenant() {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single();
      if (profile) {
        setTenantId(profile.tenant_id);
        const { data: tenant } = await supabase.from('tenants').select('grace_period_minutes').eq('id', profile.tenant_id).single();
        if (tenant) {
          setGracePeriod(tenant.grace_period_minutes || 10);
        }
      }
    }
    loadTenant();
  }, []);

  const saveGeneralSettings = async () => {
    if (!tenantId) return;
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.from('tenants').update({ grace_period_minutes: gracePeriod }).eq('id', tenantId);
    toast.success('Ajustes guardados correctamente');
  };

  const handleRoomImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRoomImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setRoomImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadRoomImage = async (file: File): Promise<string | null> => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const filename = `rooms/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('room-backgrounds')
      .upload(filename, file, { upsert: true });
    if (error) {
      console.error('Error uploading image:', error);
      return null;
    }
    const { data: urlData } = supabase.storage.from('room-backgrounds').getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  // Modales y formularios de edición
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editingType, setEditingType] = useState<TableType | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  // Estados de creación nuevos
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [isAddingType, setIsAddingType] = useState(false);
  const [isAddingShift, setIsAddingShift] = useState(false);

  // Form states
  const [roomForm, setRoomForm] = useState<Partial<Room>>({
    name: '',
    description: '',
    canvas_width: 1000,
    canvas_height: 800,
    background_color: '#0f172a',
    is_active: true,
  });

  const [typeForm, setTypeForm] = useState<Partial<TableType>>({
    name: '',
    shape: 'square',
    capacity: 4,
    width: 80,
    height: 80,
    color: '#3b82f6',
  });

  const [shiftForm, setShiftForm] = useState<Partial<Shift>>({
    name: '',
    start_time: '13:00',
    end_time: '16:30',
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    color: '#f59e0b',
    is_active: true,
  });

  // Handlers Room
  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomForm.name) return;
    setIsUploadingImage(true);

    let imageUrl: string | null | undefined = roomForm.background_image_url;
    if (roomImageFile) {
      const uploaded = await uploadRoomImage(roomImageFile);
      if (uploaded) imageUrl = uploaded;
    }

    if (editingRoom) {
      await updateRoom(editingRoom.id, { ...roomForm, background_image_url: imageUrl });
      setEditingRoom(null);
      setIsAddingRoom(false);
    } else {
      await addRoom({
        id: crypto.randomUUID(),
        tenant_id: '',
        name: roomForm.name,
        description: roomForm.description,
        canvas_width: Number(roomForm.canvas_width) || 1000,
        canvas_height: Number(roomForm.canvas_height) || 800,
        background_color: roomForm.background_color || '#0f172a',
        background_image_url: imageUrl,
        is_active: roomForm.is_active !== false,
        sort_order: rooms.length + 1,
        created_at: new Date().toISOString(),
      });
      setIsAddingRoom(false);
    }
    setIsUploadingImage(false);
    setRoomImageFile(null);
    setRoomImagePreview(null);
    setRoomForm({
      name: '',
      description: '',
      canvas_width: 1000,
      canvas_height: 800,
      background_color: '#0f172a',
      is_active: true,
    });
  };

  const handleStartEditRoom = (room: Room) => {
    setEditingRoom(room);
    setRoomForm(room);
    setIsAddingRoom(true);
  };

  // Handlers TableType
  const handleSaveType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeForm.name) return;

    if (editingType) {
      updateTableType(editingType.id, typeForm);
      setEditingType(null);
      setIsAddingType(false);
    } else {
      addTableType({
        id: crypto.randomUUID(),
        tenant_id: '',
        name: typeForm.name,
        shape: typeForm.shape || 'square',
        capacity: Number(typeForm.capacity) || 4,
        width: Number(typeForm.width) || 80,
        height: Number(typeForm.height) || 80,
        color: typeForm.color || '#3b82f6',
      });
      setIsAddingType(false);
    }
    setTypeForm({
      name: '',
      shape: 'square',
      capacity: 4,
      width: 80,
      height: 80,
      color: '#3b82f6',
    });
  };

  const handleStartEditType = (type: TableType) => {
    setEditingType(type);
    setTypeForm(type);
    setIsAddingType(true);
  };

  // Handlers Shift
  const handleSaveShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftForm.name) return;

    if (editingShift) {
      updateShift(editingShift.id, shiftForm);
      setEditingShift(null);
      setIsAddingShift(false);
    } else {
      addShift({
        id: crypto.randomUUID(),
        tenant_id: '',
        name: shiftForm.name,
        start_time: shiftForm.start_time || '13:00',
        end_time: shiftForm.end_time || '16:30',
        days_of_week: shiftForm.days_of_week || [1, 2, 3, 4, 5, 6, 7],
        color: shiftForm.color || '#f59e0b',
        is_active: shiftForm.is_active !== false,
        sort_order: shifts.length + 1,
      });
      setIsAddingShift(false);
    }
    setShiftForm({
      name: '',
      start_time: '13:00',
      end_time: '16:30',
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      color: '#f59e0b',
      is_active: true,
    });
  };

  const handleStartEditShift = (shift: Shift) => {
    setEditingShift(shift);
    setShiftForm(shift);
    setIsAddingShift(true);
  };

  const toggleDayOfWeek = (day: number) => {
    const current = shiftForm.days_of_week || [];
    const updated = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort();
    setShiftForm({ ...shiftForm, days_of_week: updated });
  };

  const weekdays = [
    { label: 'L', val: 1 },
    { label: 'M', val: 2 },
    { label: 'X', val: 3 },
    { label: 'J', val: 4 },
    { label: 'V', val: 5 },
    { label: 'S', val: 6 },
    { label: 'D', val: 7 },
  ];

  return (
    <div className="app-shell">
      {/* Sidebar navigation */}
      <Sidebar activeRoom={activeRoom} rooms={rooms} onRoomChange={setActiveRoom} />

      {/* Main Settings Content */}
      <div className="main-content flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900">
        {/* Header Bar */}
        <div className="flex items-center gap-3 p-5 border-b-2 border-slate-200 bg-white">
          <div className="w-11 h-11 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
            <Settings size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 leading-tight">Configuración del Sistema</h1>
            <p className="text-slate-500 text-sm mt-0.5 font-bold">
              Administra salas, tipos de mesa y turnos del restaurante
            </p>
          </div>
        </div>

        {/* Tab Selector & Content Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-64 border-r-2 border-slate-200 p-4 space-y-2 bg-white shrink-0">
            {[
              { id: 'general', label: 'General', icon: Building2 },
              { id: 'rooms', label: 'Salas y Espacios', icon: Layout },
              { id: 'tableTypes', label: 'Tipos de Mesa', icon: Layers },
              { id: 'shifts', label: 'Turnos y Horarios', icon: Clock },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    setIsAddingRoom(false);
                    setIsAddingType(false);
                    setIsAddingShift(false);
                    setEditingRoom(null);
                    setEditingType(null);
                    setEditingShift(null);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-3.5 py-3.5 rounded-2xl text-sm font-black transition-all cursor-pointer',
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-2 border-transparent'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </div>
                  <ChevronRight size={14} className={activeTab === tab.id ? 'opacity-100' : 'opacity-0'} />
                </button>
              );
            })}
          </div>

          {/* Configuration Workspace */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <AnimatePresence mode="wait">
              {activeTab === 'general' && (
                <motion.div
                  key="general"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Ajustes Generales</h2>
                      <p className="text-slate-500 text-sm mt-0.5 font-bold">
                        Configuración global del restaurante
                      </p>
                    </div>
                  </div>

                  <div className="p-6 bg-white border-2 border-slate-200 rounded-3xl space-y-4 max-w-xl shadow-md">
                    <div>
                      <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                        Tiempo de cortesía para reservas (minutos)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={gracePeriod}
                        onChange={(e) => setGracePeriod(parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none font-bold text-slate-900"
                      />
                      <p className="text-xs text-slate-500 mt-2">
                        Tiempo de espera máximo antes de que una mesa reservada se libere.
                      </p>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-slate-100">
                      <button
                        onClick={saveGeneralSettings}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-sm"
                      >
                        Guardar Ajustes
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'rooms' && (
                <motion.div
                  key="rooms"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Salas (Zonas del Restaurante)</h2>
                      <p className="text-slate-500 text-sm mt-0.5 font-bold">
                        Agrega o edita las zonas del restaurante (Terraza, Salón, Barra...)
                      </p>
                    </div>
                    {!isAddingRoom && (
                      <button
                        onClick={() => {
                          setEditingRoom(null);
                          setRoomForm({
                            name: '',
                            description: '',
                            canvas_width: 1200,
                            canvas_height: 800,
                            background_color: '#0f172a',
                            is_active: true,
                          });
                          setIsAddingRoom(true);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Plus size={16} />
                        <span>Nueva Sala</span>
                      </button>
                    )}
                  </div>

                  {isAddingRoom ? (
                    <form onSubmit={handleSaveRoom} className="p-6 bg-white border-2 border-slate-200 rounded-3xl space-y-4 max-w-xl shadow-md">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-slate-900 font-black text-base">
                          {editingRoom ? 'Editar Sala' : 'Crear Nueva Sala'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setIsAddingRoom(false)}
                          className="text-slate-400 hover:text-slate-650 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Nombre de la sala</label>
                        <input
                          type="text"
                          required
                          value={roomForm.name || ''}
                          onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                          placeholder="Ej. Terraza Exterior"
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Descripción (Opcional)</label>
                        <input
                          type="text"
                          value={roomForm.description || ''}
                          onChange={(e) => setRoomForm({ ...roomForm, description: e.target.value })}
                          placeholder="Ej. Zona con vista al jardín y calefactores"
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Ancho Plano (px)</label>
                          <input
                            type="number"
                            required
                            min={400}
                            max={2000}
                            value={roomForm.canvas_width || 1200}
                            onChange={(e) => setRoomForm({ ...roomForm, canvas_width: Number(e.target.value) })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Alto Plano (px)</label>
                          <input
                            type="number"
                            required
                            min={400}
                            max={2000}
                            value={roomForm.canvas_height || 800}
                            onChange={(e) => setRoomForm({ ...roomForm, canvas_height: Number(e.target.value) })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Color de Fondo del Canvas</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={roomForm.background_color || '#0f172a'}
                            onChange={(e) => setRoomForm({ ...roomForm, background_color: e.target.value })}
                            className="w-12 h-10 p-1 bg-white border-2 border-slate-250 rounded-xl cursor-pointer"
                          />
                          <span className="font-mono text-xs text-slate-600 font-bold">{roomForm.background_color}</span>
                        </div>
                      </div>

                      {/* Imagen de fondo del plano */}
                      <div className="space-y-2">
                        <label className="text-slate-700 text-xs font-bold">Imagen de Fondo del Plano (Opcional)</label>
                        <label className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-300 hover:border-blue-550 rounded-xl cursor-pointer transition-colors bg-slate-50">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleRoomImageChange}
                          />
                          {roomImagePreview || roomForm.background_image_url ? (
                            <div className="relative w-full">
                              <img
                                src={roomImagePreview || roomForm.background_image_url || ''}
                                alt="Preview"
                                className="w-full h-28 object-cover rounded-lg opacity-85 border border-slate-200"
                              />
                              <span className="absolute bottom-2 right-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full">Click para cambiar</span>
                            </div>
                          ) : (
                            <>
                              <div className="w-10 h-10 rounded-xl bg-slate-250 flex items-center justify-center text-slate-500 border border-slate-350">🖼️</div>
                              <span className="text-xs text-slate-500 font-bold">Click para subir imagen de planta del local</span>
                            </>
                          )}
                        </label>
                      </div>

                      <div className="flex gap-3 pt-3">
                        <button
                          type="button"
                          onClick={() => { setIsAddingRoom(false); setRoomImageFile(null); setRoomImagePreview(null); }}
                          className="flex-1 py-2.5 border-2 border-slate-250 rounded-xl text-sm hover:bg-slate-50 font-black text-slate-700 transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={isUploadingImage}
                          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-750 text-white rounded-xl text-sm font-black flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
                        >
                          <Save size={16} />
                          <span>{isUploadingImage ? 'Subiendo...' : editingRoom ? 'Actualizar' : 'Guardar Sala'}</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {rooms.map((room) => (
                        <div
                          key={room.id}
                          className="p-5 bg-white border-2 border-slate-200 rounded-2xl flex flex-col justify-between shadow-sm hover:border-slate-350 transition-all"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <h3 className="text-slate-900 font-black text-base">{room.name}</h3>
                              <span className="px-2.5 py-0.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] uppercase font-black tracking-wider">
                                {room.canvas_width}x{room.canvas_height} px
                              </span>
                            </div>
                            <p className="text-slate-500 font-bold text-xs mt-1.5 min-h-[32px]">
                              {room.description || 'Sin descripción disponible.'}
                            </p>
                            {room.background_image_url && (
                              <img
                                src={room.background_image_url}
                                alt={room.name}
                                className="w-full h-20 object-cover rounded-xl mt-2 border border-slate-200"
                              />
                            )}
                            <div className="mt-3 flex items-center gap-2">
                              <span className="text-xs text-slate-500 font-bold">Color de fondo:</span>
                              <div
                                className="w-4 h-4 rounded border border-slate-300"
                                style={{ backgroundColor: room.background_color }}
                              />
                            </div>
                          </div>

                          <div className="flex gap-2 mt-5 pt-3 border-t border-slate-100">
                            <button
                              onClick={() => handleStartEditRoom(room)}
                              className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-950 text-xs font-black flex items-center justify-center gap-1 transition-all border border-slate-200 cursor-pointer"
                            >
                              <Edit size={12} />
                              <span>Editar</span>
                            </button>
                            <button
                              onClick={() => removeRoom(room.id)}
                              disabled={rooms.length <= 1}
                              className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-650 hover:text-red-750 border border-red-200 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'tableTypes' && (
                <motion.div
                  key="tableTypes"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-white">Tipos de Mesa (Modelos)</h2>
                      <p className="text-slate-400 text-xs mt-0.5">
                        Define las dimensiones, formas y capacidades de las mesas del local
                      </p>
                    </div>
                    {!isAddingType && (
                      <button
                        onClick={() => {
                          setEditingType(null);
                          setTypeForm({
                            name: '',
                            shape: 'square',
                            capacity: 4,
                            width: 80,
                            height: 80,
                            color: '#3b82f6',
                          });
                          setIsAddingType(true);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Plus size={16} />
                        <span>Nuevo Tipo</span>
                      </button>
                    )}
                  </div>

                  {isAddingType ? (
                    <form onSubmit={handleSaveType} className="p-6 bg-white border-2 border-slate-200 rounded-3xl space-y-4 max-w-xl shadow-md">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-slate-900 font-black text-base">
                          {editingType ? 'Editar Tipo de Mesa' : 'Crear Tipo de Mesa'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setIsAddingType(false)}
                          className="text-slate-400 hover:text-slate-655 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Nombre de la plantilla</label>
                        <input
                          type="text"
                          required
                          value={typeForm.name || ''}
                          onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                          placeholder="Ej. Redonda Mediana"
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Forma visual</label>
                          <select
                            value={typeForm.shape || 'square'}
                            onChange={(e) => setTypeForm({ ...typeForm, shape: e.target.value as any })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          >
                            <option value="square">Cuadrada</option>
                            <option value="rectangle">Rectangular</option>
                            <option value="circle">Redonda</option>
                            <option value="oval">Ovalada</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Capacidad (comensales)</label>
                          <input
                            type="number"
                            required
                            min={1}
                            max={30}
                            value={typeForm.capacity || 4}
                            onChange={(e) => setTypeForm({ ...typeForm, capacity: Number(e.target.value) })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-255 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Ancho (px)</label>
                          <input
                            type="number"
                            required
                            min={40}
                            max={300}
                            value={typeForm.width || 80}
                            onChange={(e) => setTypeForm({ ...typeForm, width: Number(e.target.value) })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-255 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Alto (px)</label>
                          <input
                            type="number"
                            required
                            min={40}
                            max={300}
                            value={typeForm.height || 80}
                            onChange={(e) => setTypeForm({ ...typeForm, height: Number(e.target.value) })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-255 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Color Temático</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={typeForm.color || '#3b82f6'}
                            onChange={(e) => setTypeForm({ ...typeForm, color: e.target.value })}
                            className="w-12 h-10 p-1 bg-white border-2 border-slate-250 rounded-xl cursor-pointer"
                          />
                          <span className="font-mono text-xs text-slate-600 font-bold">{typeForm.color}</span>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-3">
                        <button
                          type="button"
                          onClick={() => setIsAddingType(false)}
                          className="flex-1 py-2.5 border-2 border-slate-250 rounded-xl text-sm hover:bg-slate-50 font-black text-slate-700 transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-750 text-white rounded-xl text-sm font-black flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Save size={16} />
                          <span>{editingType ? 'Actualizar' : 'Guardar Tipo'}</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {tableTypes.map((type: TableType) => (
                        <div
                          key={type.id}
                          className="p-4 bg-white border-2 border-slate-200 rounded-2xl flex flex-col justify-between shadow-sm hover:border-slate-350 transition-all"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <h3 className="text-slate-900 font-black text-sm truncate w-2/3">{type.name}</h3>
                              <span
                                className="w-5 h-5 rounded-full border border-slate-300"
                                style={{ backgroundColor: type.color }}
                              />
                            </div>
                            <div className="flex gap-3 mt-3 text-xs text-slate-550 font-bold">
                              <span>Forma: <strong className="capitalize text-slate-750 font-black">{type.shape === 'circle' ? 'Redonda' : type.shape === 'oval' ? 'Ovalada' : type.shape === 'rectangle' ? 'Rectangular' : 'Cuadrada'}</strong></span>
                              <span>Capacidad: <strong className="text-slate-750 font-black">{type.capacity}p</strong></span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-bold mt-1">
                              Dimensiones: {type.width}x{type.height} px
                            </div>
                          </div>

                          <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                            <button
                              onClick={() => handleStartEditType(type)}
                              className="flex-1 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-955 text-[11px] font-black flex items-center justify-center gap-1 transition-all border border-slate-200 cursor-pointer"
                            >
                              <Edit size={10} />
                              <span>Editar</span>
                            </button>
                            <button
                              onClick={() => removeTableType(type.id)}
                              disabled={tableTypes.length <= 1}
                              className="px-2.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-650 hover:text-red-750 border border-red-200 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'shifts' && (
                <motion.div
                  key="shifts"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-white">Turnos de Servicio (Mañana/Noche)</h2>
                      <p className="text-slate-400 text-xs mt-0.5">
                        Define los horarios hábiles para comidas, cenas y días activos
                      </p>
                    </div>
                    {!isAddingShift && (
                      <button
                        onClick={() => {
                          setEditingShift(null);
                          setShiftForm({
                            name: '',
                            start_time: '13:00',
                            end_time: '16:30',
                            days_of_week: [1, 2, 3, 4, 5, 6, 7],
                            color: '#f59e0b',
                            is_active: true,
                          });
                          setIsAddingShift(true);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Plus size={16} />
                        <span>Nuevo Turno</span>
                      </button>
                    )}
                  </div>

                  {isAddingShift ? (
                    <form onSubmit={handleSaveShift} className="p-6 bg-white border-2 border-slate-200 rounded-3xl space-y-4 max-w-xl shadow-md">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-slate-900 font-black text-base">
                          {editingShift ? 'Editar Turno' : 'Crear Nuevo Turno'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setIsAddingShift(false)}
                          className="text-slate-400 hover:text-slate-655 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Nombre del turno</label>
                        <input
                          type="text"
                          required
                          value={shiftForm.name || ''}
                          onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                          placeholder="Ej. Almuerzo Mediodía"
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Hora Inicio</label>
                          <input
                            type="time"
                            required
                            value={shiftForm.start_time || '13:00'}
                            onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-700 text-xs font-bold">Hora Fin</label>
                          <input
                            type="time"
                            required
                            value={shiftForm.end_time || '16:30'}
                            onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                            className="w-full px-4 py-2.5 bg-white border-2 border-slate-250 rounded-xl text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-650 text-sm font-semibold transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-slate-700 text-xs font-bold block">Días de la semana</label>
                        <div className="flex items-center gap-1.5">
                          {weekdays.map((day) => {
                            const active = (shiftForm.days_of_week || []).includes(day.val);
                            return (
                              <button
                                type="button"
                                key={day.val}
                                onClick={() => toggleDayOfWeek(day.val)}
                                className={cn(
                                  'w-8 h-8 rounded-lg text-xs font-black transition-all border flex items-center justify-center cursor-pointer',
                                  active
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                    : 'bg-slate-50 text-slate-400 border-slate-250 hover:bg-slate-100 hover:text-slate-905'
                                )}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-700 text-xs font-bold">Color Temático</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={shiftForm.color || '#f59e0b'}
                            onChange={(e) => setShiftForm({ ...shiftForm, color: e.target.value })}
                            className="w-12 h-10 p-1 bg-white border-2 border-slate-250 rounded-xl cursor-pointer"
                          />
                          <span className="font-mono text-xs text-slate-600 font-bold">{shiftForm.color}</span>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-3">
                        <button
                          type="button"
                          onClick={() => setIsAddingShift(false)}
                          className="flex-1 py-2.5 border-2 border-slate-250 rounded-xl text-sm hover:bg-slate-50 font-black text-slate-700 transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-755 text-white rounded-xl text-sm font-black flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Save size={16} />
                          <span>{editingShift ? 'Actualizar' : 'Guardar Turno'}</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {shifts.map((shift) => (
                        <div
                          key={shift.id}
                          className="p-5 bg-white border-2 border-slate-200 rounded-2xl flex flex-col justify-between shadow-sm hover:border-slate-350 transition-all"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                                <span
                                  className="w-3.5 h-3.5 rounded-full border border-white shadow-sm"
                                  style={{ backgroundColor: shift.color }}
                                />
                                {shift.name}
                              </h3>
                              <span
                                className={cn(
                                  'px-2.5 py-0.5 rounded-lg text-[10px] uppercase font-black tracking-wider border',
                                  shift.is_active
                                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                    : 'bg-slate-105 border-slate-200 text-slate-500'
                                )}
                              >
                                {shift.is_active ? 'Activo' : 'Inactivo'}
                              </span>
                            </div>
                            <div className="mt-3 flex items-center gap-1.5 text-slate-700 font-mono text-sm font-bold">
                              <Clock size={14} className="text-slate-400" />
                              <span>
                                {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                              </span>
                            </div>

                            <div className="mt-3 flex items-center gap-1">
                              {weekdays.map((w) => {
                                const active = shift.days_of_week.includes(w.val);
                                return (
                                  <span
                                    key={w.val}
                                    className={cn(
                                      'w-6 h-6 text-[10px] font-black rounded flex items-center justify-center border',
                                      active
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                        : 'bg-slate-50 text-slate-400 border-slate-200'
                                    )}
                                  >
                                    {w.label}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex gap-2 mt-5 pt-3 border-t border-slate-100">
                            <button
                              onClick={() => handleStartEditShift(shift)}
                              className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-950 text-xs font-black flex items-center justify-center gap-1 transition-all border border-slate-200 cursor-pointer"
                            >
                              <Edit size={12} />
                              <span>Editar</span>
                            </button>
                            <button
                              onClick={() => removeShift(shift.id)}
                              className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-650 hover:text-red-750 border border-red-200 transition-all cursor-pointer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
