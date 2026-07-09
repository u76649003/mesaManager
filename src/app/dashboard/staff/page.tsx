'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { Sidebar } from '@/components/layout/Sidebar';
import {
  Users,
  Plus,
  Trash2,
  Edit,
  Save,
  X,
  Phone,
  Mail,
  Check,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Room } from '@/types';
import { toast } from 'sonner';

interface Waiter {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  color: string;
  is_active: boolean;
}

const PRESET_COLORS = [
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#10b981', // Green
  '#fbbf24', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
];

export default function StaffPage() {
  const { rooms } = useFloorStore();
  const [activeRoom, setActiveRoom] = useState<Room>({ id: 'temp' } as any);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form states
  const [isAdding, setIsAdding] = useState(false);
  const [editingWaiter, setEditingWaiter] = useState<Waiter | null>(null);
  const [form, setForm] = useState<Partial<Waiter>>({
    name: '',
    phone: '',
    email: '',
    color: '#6366f1',
    is_active: true,
  });

  useEffect(() => {
    if (rooms && rooms.length > 0 && (!activeRoom || activeRoom.id === 'temp')) {
      setActiveRoom(rooms[0]);
    }
  }, [rooms, activeRoom]);

  // Fetch waiters from Supabase
  const fetchWaiters = async () => {
    setIsLoading(true);
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data, error } = await supabase
        .from('waiters')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setWaiters(data || []);
    } catch (err: any) {
      console.error('Error fetching waiters:', err);
      toast.error('Error al cargar la lista de camareros.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWaiters();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;

    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      if (editingWaiter) {
        const { error } = await supabase
          .from('waiters')
          .update({
            name: form.name,
            phone: form.phone || null,
            email: form.email || null,
            color: form.color,
            is_active: form.is_active !== false,
          })
          .eq('id', editingWaiter.id);

        if (error) throw error;
        toast.success('Camarero actualizado correctamente.');
      } else {
        // Get tenant_id
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuario no autenticado');
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();
        if (!profile) throw new Error('No se encontró el perfil de inquilino');

        const { error } = await supabase.from('waiters').insert({
          tenant_id: profile.tenant_id,
          name: form.name,
          phone: form.phone || null,
          email: form.email || null,
          color: form.color || '#6366f1',
          is_active: form.is_active !== false,
        });

        if (error) throw error;
        toast.success('Camarero creado correctamente.');
      }

      setForm({ name: '', phone: '', email: '', color: '#6366f1', is_active: true });
      setEditingWaiter(null);
      setIsAdding(false);
      fetchWaiters();
    } catch (err: any) {
      console.error('Error saving waiter:', err);
      toast.error(err.message || 'Error al guardar los datos del camarero.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar a ${name}?`)) return;

    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { error } = await supabase.from('waiters').delete().eq('id', id);

      if (error) throw error;
      toast.success('Camarero eliminado correctamente.');
      fetchWaiters();
    } catch (err: any) {
      console.error('Error deleting waiter:', err);
      toast.error('Error al eliminar el camarero.');
    }
  };

  const handleStartEdit = (waiter: Waiter) => {
    setEditingWaiter(waiter);
    setForm(waiter);
    setIsAdding(true);
  };

  return (
    <div className="app-shell">
      {/* Sidebar navigation */}
      <Sidebar activeRoom={activeRoom} rooms={rooms} onRoomChange={setActiveRoom} />

      {/* Main Settings Content */}
      <div className="main-content flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900">
        {/* Header Bar */}
        <div className="flex items-center justify-between p-5 border-b-2 border-slate-200 bg-white flex-shrink-0 z-30">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
              <Users size={20} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 leading-tight tracking-tight">
                Equipo y Personal
              </h1>
              <p className="text-slate-500 text-sm mt-0.5 font-bold">
                Gestiona los camareros del restaurante y asígnalos a los servicios de mesa
              </p>
            </div>
          </div>
          {!isAdding && (
            <button
              onClick={() => {
                setEditingWaiter(null);
                setForm({ name: '', phone: '', email: '', color: '#6366f1', is_active: true });
                setIsAdding(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-black rounded-xl transition-all shadow-md cursor-pointer border-2 border-blue-600"
            >
              <Plus size={15} />
              <span>+ Nuevo Camarero</span>
            </button>
          )}
        </div>

        {/* Content Panel */}
        <div className="flex-1 flex overflow-hidden gap-4">
          <div className="flex-1 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-36 bg-slate-200 animate-pulse rounded-2xl" />
                ))}
              </div>
            ) : waiters.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-200 rounded-3xl p-8 bg-white">
                <Users size={36} className="text-slate-300 mb-3" />
                <p className="text-sm font-extrabold text-slate-700">No hay camareros registrados</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs text-center font-bold">
                  Crea tu primer camarero para poder asignarlo a los turnos y mesas de servicio en tiempo real.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {waiters.map((waiter) => (
                  <motion.div
                    key={waiter.id}
                    layoutId={waiter.id}
                    className="p-5 bg-white border-2 border-slate-200 rounded-2xl flex flex-col justify-between hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden"
                    style={{
                      boxShadow: `0 2px 12px rgba(0,0,0,0.06), 0 0 0 0 transparent`,
                    }}
                  >
                    {/* Glowing Accent Border */}
                    <div 
                      className="absolute top-0 left-0 w-full h-[3px]"
                      style={{ backgroundColor: waiter.color }}
                    />
                    
                    <div>
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div 
                          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shadow-inner"
                          style={{ 
                            background: `linear-gradient(135deg, ${waiter.color}25 0%, ${waiter.color}55 100%)`,
                            border: `1.5px solid ${waiter.color}80` 
                          }}
                        >
                          {waiter.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-slate-900 font-black text-sm tracking-tight">{waiter.name}</h3>
                          <span 
                            className={cn(
                              "text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border mt-1 inline-block",
                              waiter.is_active 
                                ? "bg-green-50 border-green-200 text-green-700" 
                                : "bg-slate-100 border-slate-200 text-slate-500"
                            )}
                          >
                            {waiter.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                      </div>

                      {/* Info lines */}
                      <div className="mt-4 space-y-2 text-xs text-slate-600 font-bold">
                        {waiter.phone && (
                          <div className="flex items-center gap-2">
                            <Phone size={12} className="text-slate-400 shrink-0" />
                            <span>{waiter.phone}</span>
                          </div>
                        )}
                        {waiter.email && (
                          <div className="flex items-center gap-2">
                            <Mail size={12} className="text-slate-400 shrink-0" />
                            <span className="truncate">{waiter.email}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-5 pt-3 border-t-2 border-slate-100">
                      <button
                        onClick={() => handleStartEdit(waiter)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-xs font-black flex items-center justify-center gap-1.5 transition-colors border-2 border-slate-200 cursor-pointer"
                      >
                        <Edit size={12} />
                        <span>Editar</span>
                      </button>
                      <button
                        onClick={() => handleDelete(waiter.id, waiter.name)}
                        className="px-3 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border-2 border-red-200 transition-colors cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Form Panel (Side Over) */}
          <AnimatePresence>
            {isAdding && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-96 border-2 border-slate-200 rounded-3xl p-5 bg-white space-y-4 shrink-0 shadow-lg overflow-y-auto"
              >
                <div className="flex items-center justify-between border-b-2 border-slate-100 pb-3">
                  <h3 className="text-slate-900 font-black text-sm tracking-tight">
                    {editingWaiter ? 'Editar Camarero' : 'Nuevo Camarero'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdding(false);
                      setEditingWaiter(null);
                    }}
                    className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 border-2 border-slate-200 transition-colors hover:bg-slate-200 cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>

                <form onSubmit={handleSave} className="space-y-4">
                  {/* Name */}
                  <div className="space-y-1">
                    <label className="text-slate-700 text-xs font-black uppercase tracking-wide">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={form.name || ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Ej. Carlos Mendoza"
                      className="w-full px-4 py-3 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-sm font-bold placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-600 transition-all"
                    />
                  </div>

                  {/* Phone */}
                  <div className="space-y-1">
                    <label className="text-slate-700 text-xs font-black uppercase tracking-wide">Teléfono</label>
                    <input
                      type="text"
                      value={form.phone || ''}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+34 600 000 000"
                      className="w-full px-4 py-3 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-sm font-bold placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-600 transition-all"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1">
                    <label className="text-slate-700 text-xs font-black uppercase tracking-wide">Email (Opcional)</label>
                    <input
                      type="email"
                      value={form.email || ''}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="carlos@mirestaurante.com"
                      className="w-full px-4 py-3 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-sm font-bold placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-600 transition-all"
                    />
                  </div>

                  {/* Color Selector */}
                  <div className="space-y-1">
                    <label className="text-slate-700 text-xs font-black uppercase tracking-wide">Color del Perfil</label>
                    <div className="grid grid-cols-8 gap-2 pt-1.5">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setForm({ ...form, color: c })}
                          className="w-7 h-7 rounded-full border border-slate-950 shadow-md relative flex items-center justify-center transition-all hover:scale-110"
                          style={{ backgroundColor: c }}
                        >
                          {form.color === c && (
                            <Check size={12} className="text-white drop-shadow-md font-bold" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Active Toggle */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border-2 border-slate-200 mt-2">
                    <div>
                      <span className="text-slate-900 text-sm font-black block">Camarero Activo</span>
                      <span className="text-[10px] text-slate-500 font-bold">Disponible para asignar a las mesas</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.is_active !== false}
                        onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-white/5 border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-400 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                    </label>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-3 border-t-2 border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAdding(false);
                        setEditingWaiter(null);
                      }}
                      className="flex-1 py-3 border-2 border-slate-200 rounded-2xl text-sm font-black text-slate-700 bg-slate-50 hover:bg-slate-100 transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-black rounded-2xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Save size={14} />
                      <span>{editingWaiter ? 'Actualizar' : 'Guardar'}</span>
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
