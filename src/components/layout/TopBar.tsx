'use client';

import { motion } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { useReservationStore } from '@/stores/useReservationStore';
import { cn } from '@/lib/utils';
import type { Room, FloorMode } from '@/types';
import {
  Edit3,
  Eye,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  TableProperties,
  Layers,
  ChevronDown,
  Edit,
  PlusCircle,
  Upload,
} from 'lucide-react';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseAndCreateRoomsFromImage } from '@/app/actions/layoutParser';

interface TopBarProps {
  room: Room;
  rooms: Room[];
  onRoomChange: (room: Room) => void;
  mode: FloorMode;
  onModeChange: (mode: FloorMode) => void;
  totalTables: number;
  occupiedTables: number;
  reservationsToday: number;
}

export function TopBar({
  room,
  rooms,
  onRoomChange,
  mode,
  onModeChange,
  totalTables,
  occupiedTables,
  reservationsToday,
}: TopBarProps) {
  // Use direct stores to fetch actions
  const { resetView, openRoomModal, fetchRooms } = useFloorStore();
  const { selectedDate, setSelectedDate, getActiveShift, shifts } = useReservationStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const handleCreateRoomFromImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsCreatingRoom(true);
    setIsDropdownOpen(false);

    const toastId = toast.loading("Subiendo imagen de distribución...");

    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      let lastCreatedRoom: Room | null = null;

      // Helper to convert file to base64
      const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (error) => reject(error);
        });
      };

      for (const file of files) {
        const filename = `rooms/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;

        // 1. Subir al Storage
        const { data, error } = await supabase.storage
          .from('room-backgrounds')
          .upload(filename, file, { upsert: true });

        if (error) {
          console.error('Error uploading background:', error);
          toast.error(`Error al subir plano de fondo: ${file.name}`, { id: toastId });
          continue;
        }

        const { data: urlData } = supabase.storage.from('room-backgrounds').getPublicUrl(data.path);
        const publicUrl = urlData.publicUrl;

        // 2. Leer archivo como base64
        toast.loading(`Analizando plano con IA y detectando mesas: ${file.name}...`, { id: toastId });
        const base64Data = await fileToBase64(file);

        // 3. Invocar al Server Action de detección con Gemini Vision
        const parseResult = await parseAndCreateRoomsFromImage(base64Data, file.type, publicUrl);

        if (!parseResult.success) {
          if (parseResult.error === 'GEMINI_KEY_MISSING') {
            toast.error(
              "Falta la configuración de IA. Por favor, añade GEMINI_API_KEY a tu archivo .env.local y reinicia la aplicación.",
              { id: toastId, duration: 8000 }
            );
          } else {
            toast.error(
              `Error al procesar el plano: ${parseResult.error || 'error desconocido'}`,
              { id: toastId }
            );
          }
          continue;
        }

        // 4. Refrescar salones de la base de datos
        const updatedRooms = await fetchRooms();
        
        // Buscamos el salón creado con ese background
        const created = updatedRooms
          .slice()
          .reverse()
          .find((r) => r.background_image_url === publicUrl);

        if (created) {
          lastCreatedRoom = created;
        }
      }

      // Seleccionar el último salón creado e informar éxito
      if (lastCreatedRoom) {
        onRoomChange(lastCreatedRoom);
        toast.success("¡Planos de sala importados y mesas autodetectadas con éxito!", { id: toastId });
      } else {
        toast.dismiss(toastId);
      }
    } catch (err) {
      console.error('Error creating rooms from images:', err);
      toast.error("Ocurrió un error al procesar las imágenes.", { id: toastId });
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const activeShift = getActiveShift();
  const occupancyPct = totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0;

  const goToPrevDay = () => {
    let prevDate = subDays(parseISO(selectedDate), 1);
    for (let i = 0; i < 7; i++) {
      const prevDateStr = format(prevDate, 'yyyy-MM-dd');
      if (!isDateClosed(prevDateStr)) {
        setSelectedDate(prevDateStr);
        return;
      }
      prevDate = subDays(prevDate, 1);
    }
    setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'));
  };

  const goToNextDay = () => {
    let nextDate = addDays(parseISO(selectedDate), 1);
    for (let i = 0; i < 7; i++) {
      const nextDateStr = format(nextDate, 'yyyy-MM-dd');
      if (!isDateClosed(nextDateStr)) {
        setSelectedDate(nextDateStr);
        return;
      }
      nextDate = addDays(nextDate, 1);
    }
    setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'));
  };

  const goToToday = () =>
    setSelectedDate(format(new Date(), 'yyyy-MM-dd'));

  const isToday = selectedDate === format(new Date(), 'yyyy-MM-dd');

  const isDateClosed = (dateStr: string) => {
    if (!shifts || shifts.length === 0) return false;
    const date = parseISO(dateStr);
    const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    const dayOfWeek = day === 0 ? 7 : day;
    
    const activeShifts = shifts.filter((s) => s.is_active);
    if (activeShifts.length === 0) return false;
    
    return !activeShifts.some((s) => s.days_of_week.includes(dayOfWeek));
  };

  return (
    <header className="flex items-center justify-between px-5 py-4 border-2 border-slate-200 bg-white rounded-3xl shadow-sm flex-shrink-0 z-30 mb-4">
      {/* Izquierda: Nombre del salón + Turno */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <button
            onClick={() => !isCreatingRoom && setIsDropdownOpen(!isDropdownOpen)}
            disabled={isCreatingRoom}
            className="flex items-center gap-2.5 px-4.5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 text-left transition-all disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {isCreatingRoom ? (
              <div className="w-4 h-4 rounded-full border-2 border-blue-500/30 border-t-blue-600 animate-spin" />
            ) : (
              <Layers size={16} className="text-blue-600" />
            )}
            <span className="text-slate-900 font-extrabold text-sm">
              {isCreatingRoom ? 'Creando salón...' : room.name}
            </span>
            <ChevronDown size={15} className="text-slate-500 shrink-0" />
          </button>

          {/* Dropdown flotante claro */}
          {isDropdownOpen && (
            <>
              {/* Overlay invisible para cerrar clicando fuera */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute top-full left-0 mt-2 w-64 bg-white border-2 border-slate-350 rounded-2xl shadow-xl p-2.5 z-40 space-y-1">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider px-2.5 py-1.5 block border-b border-slate-100 mb-1">
                  Mis Salones
                </span>
                
                {/* Listado de salones */}
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        onRoomChange(r);
                        setIsDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between transition-colors border cursor-pointer",
                        r.id === room.id
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "text-slate-700 bg-white border-transparent hover:bg-slate-50 hover:text-slate-950"
                      )}
                    >
                      <span className="truncate">{r.name}</span>
                      <span className={cn("text-[9px] font-mono", r.id === room.id ? "text-blue-100" : "text-slate-450")}>
                        {r.canvas_width}x{r.canvas_height}px
                      </span>
                    </button>
                  ))}
                </div>

                <div className="h-[1.5px] bg-slate-100 my-1.5" />

                {/* Acciones de salones */}
                <label className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 text-blue-650 hover:text-blue-750 text-xs font-black flex items-center gap-2.5 transition-colors cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleCreateRoomFromImage}
                  />
                  <Upload size={15} />
                  <span>Importar Salón desde Imagen</span>
                </label>
                
                <button
                  onClick={() => {
                    openRoomModal();
                    setIsDropdownOpen(false);
                  }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 text-slate-700 hover:text-slate-950 text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer border border-transparent"
                >
                  <PlusCircle size={15} />
                  <span>Crear Salón Manual</span>
                </button>
                <button
                  onClick={() => {
                    openRoomModal(room);
                    setIsDropdownOpen(false);
                  }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 text-slate-700 hover:text-slate-950 text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer border border-transparent"
                >
                  <Edit size={15} />
                  <span>Editar Salón Actual</span>
                </button>
              </div>
            </>
          )}

          {activeShift && (
            <div className="flex items-center gap-2 mt-1 px-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: activeShift.color }}
              />
              <span className="text-xs font-semibold text-slate-600">
                Turno {activeShift.name} · {activeShift.start_time}–{activeShift.end_time}
              </span>
            </div>
          )}
        </div>

        {/* Separador */}
        <div className="w-[1.5px] h-8 bg-slate-200" />

        {/* Stats rápidas de alto contraste */}
        <div className="flex items-center gap-3">
          <Stat
            icon={<TableProperties size={15} />}
            value={`${occupiedTables}/${totalTables}`}
            label="Mesas en uso"
            color={occupancyPct > 80 ? '#b91c1c' : occupancyPct > 50 ? '#b45309' : '#16a34a'}
          />
          <Stat
            icon={<Calendar size={15} />}
            value={String(reservationsToday)}
            label="Reservas hoy"
            color="#2563eb"
          />
          <Stat
            icon={<Clock size={15} />}
            value={`${occupancyPct}%`}
            label="Ocupación"
            color={occupancyPct > 80 ? '#b91c1c' : '#475569'}
          />
        </div>
      </div>

      {/* Centro: Navegación de fecha táctil y grande */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center gap-2 bg-slate-100 border-2 border-slate-200 rounded-2xl p-1 shadow-inner transition-colors",
          isDateClosed(selectedDate) && "bg-red-50 border-red-200"
        )}>
          <button
            onClick={goToPrevDay}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <ChevronLeft size={18} />
          </button>

          <button
            onClick={goToToday}
            className={cn(
              'px-4 py-1.5 rounded-xl text-sm font-extrabold transition-colors cursor-pointer',
              isToday 
                ? 'text-blue-600 bg-white border border-slate-200 shadow-sm' 
                : 'text-slate-700 hover:text-slate-950 hover:bg-slate-200',
              isDateClosed(selectedDate) && 'text-red-650 font-black'
            )}
          >
            {isToday
              ? 'Hoy'
              : format(parseISO(selectedDate), "d 'de' MMM", { locale: es })}
          </button>

          <button
            onClick={goToNextDay}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        {isDateClosed(selectedDate) && (
          <span className="px-3 py-1.5 rounded-xl bg-red-100 border border-red-200 text-red-700 text-xs font-black uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-sm">
            🔴 DÍA LIBRE / CERRADO
          </span>
        )}
      </div>

      {/* Derecha: Toggle modo servicio/edición grande */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-100 border-2 border-slate-200 rounded-2xl p-1 gap-1">
          {(['service', 'edit'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={cn(
                'flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl text-sm font-extrabold transition-all border border-transparent cursor-pointer',
                mode === m
                  ? m === 'edit'
                    ? 'bg-amber-100 text-amber-800 border-2 border-amber-300 shadow-sm'
                    : 'bg-blue-600 text-white border-2 border-blue-600 shadow-sm'
                  : 'text-slate-650 hover:text-slate-950 hover:bg-slate-200'
              )}
            >
              {m === 'service' ? <Eye size={16} /> : <Edit3 size={16} />}
              {m === 'service' ? 'Ver Mesas' : 'Editar Plano'}
            </button>
          ))}
        </div>
        {mode === 'edit' && (
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-950 text-xs font-black transition-all shadow-sm cursor-pointer"
          >
            ⚙️ Ajustes
          </Link>
        )}

        <button
          onClick={resetView}
          title="Restablecer vista"
          className="w-9.5 h-9.5 flex items-center justify-center rounded-xl bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-950 hover:bg-slate-50 transition-colors text-sm font-bold cursor-pointer"
        >
          ⊡
        </button>
      </div>
    </header>
  );
}

function Stat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-50 border-2 border-slate-200 shadow-sm">
      <span style={{ color }} className="flex items-center shrink-0">
        {icon}
      </span>
      <div className="flex flex-col leading-none">
        <span className="text-slate-900 font-black text-sm leading-tight">{value}</span>
        <span className="text-slate-550 text-[10px] uppercase font-bold tracking-wider mt-0.5">{label}</span>
      </div>
    </div>
  );
}
