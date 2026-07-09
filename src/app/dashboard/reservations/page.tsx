'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReservationStore } from '@/stores/useReservationStore';
import { useFloorStore } from '@/stores/useFloorStore';
import { Sidebar } from '@/components/layout/Sidebar';
import { ReservationModal } from '@/components/reservations/ReservationModal';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  Users,
  Search,
  CheckCircle,
  XCircle,
  HelpCircle,
  Eye,
  Sliders,
} from 'lucide-react';
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isSameMonth,
  parseISO,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { cn, getStatusColor, getStatusLabel } from '@/lib/utils';
import type { Reservation, Room, Shift, Table, TableGroup } from '@/types';

export default function ReservationsCalendarPage() {
  const {
    reservations,
    shifts,
    openModal,
    selectedDate,
    setSelectedDate,
    viewMode,
    setViewMode,
    fetchReservations,
    fetchShifts,
  } = useReservationStore();

  const { rooms: storeRooms, fetchRooms } = useFloorStore();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);

  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('all');
  const [selectedTimeFilter, setSelectedTimeFilter] = useState<string>('all');
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [allGroups, setAllGroups] = useState<TableGroup[]>([]);

  // Load rooms and reservations data on mount
  useEffect(() => {
    async function loadData() {
      const loadedRooms = await fetchRooms();
      if (loadedRooms && loadedRooms.length > 0) {
        setActiveRoom(loadedRooms[0]);
      }
      await Promise.all([fetchReservations(), fetchShifts()]);
      
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        
        const { data: tbls } = await supabase
          .from('tables')
          .select('*, table_type:table_types(*)')
          .eq('is_active', true);
        
        const { data: grps } = await supabase
          .from('table_groups')
          .select('*, table_group_members(table_id)');
          
        setAllTables(tbls || []);
        setAllGroups(
          (grps || []).map((g: any) => ({
            ...g,
            member_table_ids: g.table_group_members?.map((m: any) => m.table_id) || [],
          }))
        );
      } catch (err) {
        console.error('Error loading tables for calendar:', err);
      }
    }
    loadData();
  }, [fetchRooms, fetchReservations, fetchShifts]);

  // Sync rooms list
  const rooms = storeRooms;

  // Sync state between currentDate and selectedDate
  useEffect(() => {
    setSelectedDate(format(currentDate, 'yyyy-MM-dd'));
  }, [currentDate, setSelectedDate]);

  const isDateClosed = (dateStr: string) => {
    if (!shifts || shifts.length === 0) return false;
    const date = parseISO(dateStr);
    const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    const dayOfWeek = day === 0 ? 7 : day;
    
    const activeShifts = shifts.filter((s) => s.is_active);
    if (activeShifts.length === 0) return false;
    
    return !activeShifts.some((s) => s.days_of_week.includes(dayOfWeek));
  };

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === 'day') setCurrentDate((d) => subDays(d, 1));
    if (viewMode === 'week') setCurrentDate((d) => subWeeks(d, 1));
    if (viewMode === 'month') setCurrentDate((d) => subMonths(d, 1));
  };

  const handleNext = () => {
    if (viewMode === 'day') setCurrentDate((d) => addDays(d, 1));
    if (viewMode === 'week') setCurrentDate((d) => addWeeks(d, 1));
    if (viewMode === 'month') setCurrentDate((d) => addMonths(d, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const getFilteredReservations = (dateStr: string) => {
    return reservations.filter((r) => {
      const matchDate = r.date === dateStr;
      if (r.is_prepayment && r.payment_status === 'pending') return false;
      const matchSearch =
        searchQuery === '' ||
        r.guest_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.guest_phone && r.guest_phone.includes(searchQuery)) ||
        (r.guest_email && r.guest_email.toLowerCase().includes(searchQuery.toLowerCase()));
      
      let matchRoom = true;
      if (selectedRoomFilter !== 'all') {
        matchRoom = r.room_id === selectedRoomFilter;
      }

      // Time filter: show reservation if its time window OVERLAPS the selected slot
      // e.g. selecting 20:30 shows a 20:00 reservation with 90 min duration
      let matchTime = true;
      if (selectedTimeFilter !== 'all') {
        const getMin = (t: string) => {
          const [h, m] = t.slice(0, 5).split(':').map(Number);
          return h * 60 + m;
        };
        const resStartMin = getMin(r.time);
        const resDuration = r.duration_minutes || 90;
        const resEndMin = resStartMin + resDuration;
        const filterMin = getMin(selectedTimeFilter);
        // Slot overlaps if filter slot falls within [resStart, resEnd)
        matchTime = filterMin >= resStartMin && filterMin < resEndMin;
      }
      return matchDate && matchSearch && matchRoom && matchTime;
    });
  };

  // Render title string
  const getHeaderTitle = () => {
    if (viewMode === 'day') {
      return format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
    }
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      if (start.getMonth() === end.getMonth()) {
        return `${format(start, 'd')} - ${format(end, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
      }
      return `${format(start, "d 'de' MMMM", { locale: es })} - ${format(end, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
    }
    return format(currentDate, "MMMM 'de' yyyy", { locale: es });
  };

  return (
    <div className="app-shell">
      {/* Sidebar navigation */}
      {(activeRoom ?? rooms[0]) && (
        <Sidebar activeRoom={activeRoom ?? rooms[0]} rooms={rooms} onRoomChange={setActiveRoom} />
      )}

      {/* Main calendar content */}
      <div className="main-content flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900">
        {/* Sub Header / Control Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-4 border-b-2 border-slate-200 bg-white gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
              <CalendarIcon size={20} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 leading-tight">Agenda de Reservas</h1>
              <p className="text-slate-500 text-xs mt-0.5 capitalize font-bold">{getHeaderTitle()}</p>
            </div>
          </div>

          {/* Navigation & Search */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Buscar por cliente, telf..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white border-2 border-slate-300 text-sm text-slate-900 font-bold placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-600"
              />
            </div>

            {/* View selectors */}
            <div className="flex bg-slate-100 border-2 border-slate-200 p-1 rounded-xl">
              {(['day', 'week', 'month'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'px-3.5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer',
                    viewMode === mode
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {mode === 'day' ? 'Día' : mode === 'week' ? 'Semana' : 'Mes'}
                </button>
              ))}
            </div>

            {/* Date Nav */}
            <div className="flex items-center bg-white rounded-xl border-2 border-slate-300 overflow-hidden">
              <button
                onClick={handlePrev}
                className="p-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors border-r-2 border-slate-200 cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={handleToday}
                className="px-3.5 py-2.5 text-xs font-extrabold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Hoy
              </button>
              <button
                onClick={handleNext}
                className="p-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors border-l-2 border-slate-200 cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Add reservation button */}
            <button
              onClick={() => {
                if (isDateClosed(selectedDate)) {
                  toast.error("Hoy no se puede reservar, es día libre.");
                  return;
                }
                openModal();
              }}
              className="flex items-center gap-1.5 px-4.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-black rounded-xl transition-colors shadow-md cursor-pointer border-2 border-blue-600"
            >
              <Plus size={16} />
              <span>+ Reserva</span>
            </button>
          </div>
        </div>        {/* Filtro de Salones */}
        <div className="px-6 py-3 bg-white border-b-2 border-slate-200 flex flex-wrap items-center gap-3">
          <span className="text-slate-500 text-xs font-black uppercase tracking-wider">Filtrar por Salón:</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelectedRoomFilter('all')}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border-2",
                selectedRoomFilter === 'all'
                  ? "bg-slate-800 border-slate-800 text-white shadow-sm"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
              )}
            >
              Todos los salones
            </button>
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRoomFilter(r.id)}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border-2",
                  selectedRoomFilter === r.id
                    ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                )}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>

        {/* Hora pills row - derived from shifts */}
        {(() => {
          const activeShifts = shifts.filter((s) => s.is_active);
          const allSlots: { time: string; shiftName: string; color: string }[] = [];
          activeShifts.forEach((s) => {
            let [h, m] = s.start_time.split(':').map(Number);
            const [endH, endM] = s.end_time.split(':').map(Number);
            let cur = h * 60 + m;
            let end = endH * 60 + endM;
            if (end <= cur) end += 24 * 60;
            while (cur <= end) {
              const sh = Math.floor(cur / 60) % 24;
              const sm = cur % 60;
              const t = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
              if (!allSlots.some((sl) => sl.time === t)) {
                allSlots.push({ time: t, shiftName: s.name, color: s.color });
              }
              cur += 30;
            }
          });
          const groups: Record<string, typeof allSlots> = {};
          allSlots.sort((a, b) => a.time.localeCompare(b.time)).forEach((sl) => {
            if (!groups[sl.shiftName]) groups[sl.shiftName] = [];
            groups[sl.shiftName].push(sl);
          });

          if (allSlots.length === 0) return null;

          return (
            <div className="px-6 py-3 bg-slate-50 border-b-2 border-slate-200 flex flex-col gap-2">
              {Object.entries(groups).map(([shiftName, slots]) => (
                <div key={shiftName} className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-20 shrink-0">
                    {shiftName}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {slots.map((slot) => (
                      <button
                        key={slot.time}
                        onClick={() =>
                          setSelectedTimeFilter(
                            selectedTimeFilter === slot.time ? 'all' : slot.time
                          )
                        }
                        className={cn(
                          'px-3 py-1 rounded-xl border-2 text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shrink-0',
                          selectedTimeFilter === slot.time
                            ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                        )}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full inline-block"
                          style={{ backgroundColor: slot.color }}
                        />
                        {slot.time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}


        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={viewMode + currentDate.toISOString()}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {viewMode === 'day' && (
                <DayCalendarView
                  date={currentDate}
                  reservations={getFilteredReservations(format(currentDate, 'yyyy-MM-dd'))}
                  onEdit={(res) => openModal(res)}
                  shifts={shifts}
                  isDateClosed={isDateClosed}
                  rooms={rooms}
                  tables={allTables}
                  tableGroups={allGroups}
                  selectedRoomFilter={selectedRoomFilter}
                />
              )}

              {viewMode === 'week' && (
                <WeekCalendarView
                  date={currentDate}
                  getFilteredReservations={getFilteredReservations}
                  onEdit={(res) => openModal(res)}
                  isDateClosed={isDateClosed}
                  onDateClick={(d) => {
                    const dStr = format(d, 'yyyy-MM-dd');
                    if (isDateClosed(dStr)) {
                      toast.error("Este día el restaurante está cerrado, es día libre.");
                      return;
                    }
                    setCurrentDate(d);
                    setViewMode('day');
                  }}
                />
              )}

              {viewMode === 'month' && (
                <MonthCalendarView
                  date={currentDate}
                  getFilteredReservations={getFilteredReservations}
                  onDateClick={(d) => {
                    const dStr = format(d, 'yyyy-MM-dd');
                    if (isDateClosed(dStr)) {
                      toast.error("Este día no se puede reservar, es día libre.");
                      return;
                    }
                    setCurrentDate(d);
                    setViewMode('day');
                  }}
                  onEdit={(res) => openModal(res)}
                  isDateClosed={isDateClosed}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <ReservationModal />
    </div>
  );
}

// ==========================================
// 1. DAY // ==========================================
// 1. DAY VIEW
// ==========================================
function DayCalendarView({
  date,
  reservations,
  onEdit,
  shifts,
  isDateClosed,
  rooms,
  tables,
  tableGroups,
  selectedRoomFilter,
}: {
  date: Date;
  reservations: Reservation[];
  onEdit: (r: Reservation) => void;
  shifts: Shift[];
  isDateClosed: (dateStr: string) => boolean;
  rooms: Room[];
  tables: Table[];
  tableGroups: TableGroup[];
  selectedRoomFilter: string;
}) {
  const dateStr = format(date, 'yyyy-MM-dd');
  const closed = isDateClosed(dateStr);

  if (closed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-red-200 rounded-3xl bg-red-50/50">
        <div className="text-red-550 mb-3 text-5xl">🔴</div>
        <h3 className="text-red-700 font-extrabold text-lg">El restaurante está cerrado (Día Libre)</h3>
        <p className="text-red-550 text-sm mt-1 font-bold">Hoy no se pueden realizar ni gestionar reservas.</p>
      </div>
    );
  }

  const sortedReservations = [...reservations].sort((a, b) => a.time.localeCompare(b.time));

  const getMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const isTimeOverlap = (timeA: string, durationMin: number, timeC: string) => {
    const minA = getMinutes(timeA);
    const minC = getMinutes(timeC);
    return minC >= minA && minC < minA + durationMin;
  };

  const getRoomAvailabilityForDate = (room: Room) => {
    const roomTables = tables.filter((t) => t.room_id === room.id && t.is_active);
    const totalTablesCount = roomTables.length;
    if (totalTablesCount === 0) return { totalTablesCount: 0, availableSlots: [] };

    // Find all time slots for active shifts, tracking shiftName per slot
    const slots: { time: string; shiftName: string; color: string }[] = [];
    shifts.forEach((shift) => {
      if (!shift.is_active) return;
      
      const day = date.getDay();
      const dayOfWeek = day === 0 ? 7 : day;
      if (!shift.days_of_week.includes(dayOfWeek)) return;

      const [sh, sm] = shift.start_time.split(':').map(Number);
      const [eh, em] = shift.end_time.split(':').map(Number);
      
      let startMin = sh * 60 + sm;
      let endMin = eh * 60 + em;
      
      if (endMin <= startMin) {
        endMin += 1440;
      }
      
      for (let timeMin = startMin; timeMin <= endMin; timeMin += 30) {
        const h = Math.floor((timeMin % 1440) / 60);
        const m = timeMin % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (!slots.some((s) => s.time === timeStr)) {
          slots.push({ time: timeStr, shiftName: shift.name, color: shift.color });
        }
      }
    });

    slots.sort((a, b) => a.time.localeCompare(b.time));

    const availableSlots = slots.map((slot) => {
      const occupiedTableIds = new Set<string>();

      reservations.forEach((r) => {
        if (r.date !== dateStr) return;
        if (!['confirmed', 'pending', 'seated'].includes(r.status)) return;

        const duration = r.duration_minutes || 90;
        if (isTimeOverlap(r.time, duration, slot.time)) {
          if (r.table_id) {
            const t = roomTables.find((table) => table.id === r.table_id);
            if (t) occupiedTableIds.add(r.table_id);
          } else if (r.group_id) {
            const group = tableGroups.find((g) => g.id === r.group_id);
            if (group) {
              group.member_table_ids.forEach((id) => {
                const t = roomTables.find((table) => table.id === id);
                if (t) occupiedTableIds.add(id);
              });
            }
          }
        }
      });

      const freeTablesCount = roomTables.length - occupiedTableIds.size;
      return {
        time: slot.time,
        freeTables: freeTablesCount,
        isAvailable: freeTablesCount > 0,
        color: slot.color,
        shiftName: slot.shiftName,
      };
    }).filter((s) => s.isAvailable);

    return {
      totalTablesCount,
      availableSlots,
    };
  };

  const renderReservationCard = (res: Reservation) => {
    const statusCol = getStatusColor(res.status);
    return (
      <motion.div
        key={res.id}
        onClick={() => onEdit(res)}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
        className="p-4 rounded-2xl bg-white border-2 border-slate-200 hover:border-slate-350 transition-all flex flex-col justify-between cursor-pointer group shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {/* Time badge */}
            <div
              className="px-3 py-1.5 rounded-xl font-mono font-black text-sm flex items-center gap-1.5 border"
              style={{ backgroundColor: `${statusCol}15`, color: statusCol, borderColor: `${statusCol}30` }}
            >
              <Clock size={14} />
              <span>{res.time}</span>
            </div>

            <div>
              <h4 className="text-slate-900 font-extrabold text-base">
                {res.guest_name}
              </h4>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-slate-600 text-xs font-bold">
                <span className="flex items-center gap-1">
                  <Users size={12} />
                  <span>{res.party_size} {res.party_size === 1 ? 'persona' : 'personas'}</span>
                </span>
                {res.guest_phone && <span>Tlf: {res.guest_phone}</span>}
                {res.duration_minutes && (
                  <span className="text-slate-550">{res.duration_minutes} min de duración</span>
                )}
                {res.waiter && (
                  <span className="flex items-center gap-1 text-blue-700 font-black bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: res.waiter.color }} />
                    <span>Camarero: {res.waiter.name}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-3">
            <span
              className="px-2.5 py-1 rounded-full text-xs font-black border flex items-center gap-1.5"
              style={{
                backgroundColor: `${statusCol}12`,
                borderColor: `${statusCol}30`,
                color: statusCol,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusCol }} />
              {getStatusLabel(res.status)}
            </span>
            <button className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-950 transition-colors cursor-pointer border border-slate-200">
              <Eye size={14} />
            </button>
          </div>
        </div>

        {/* Observations section if notes exist */}
        {res.notes && (
          <div className="mt-3 p-3 bg-blue-50/40 border border-blue-100 rounded-xl text-xs flex gap-1.5 items-start">
            <span className="text-blue-700 font-black shrink-0">Obs:</span>
            <span className="text-slate-700 font-semibold font-serif italic break-words">{res.notes}</span>
          </div>
        )}

        {res.is_prepayment && res.prepayment_amount > 0 && (
          <div className="mt-3 p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl text-xs flex flex-wrap gap-1.5 items-center justify-between text-emerald-800 font-bold">
            <span className="flex items-center gap-1.5">
              <span>💵</span>
              <span>Anticipo Cobrado: {res.prepayment_amount} €</span>
            </span>
            <span className="text-slate-500 font-extrabold text-[10px]">
              ⚠️ Descontar <strong className="text-slate-950">-{res.prepayment_amount} €</strong> en el ticket final
            </span>
          </div>
        )}
      </motion.div>
    );
  };

  const { reservations: allReservationsStore, updateReservation } = useReservationStore();
  const pendingPaymentRes = allReservationsStore.filter(
    (r) => r.date === dateStr && r.is_prepayment && r.payment_status === 'pending'
  );

  const displayedRooms = selectedRoomFilter === 'all'
    ? rooms
    : rooms.filter((r) => r.id === selectedRoomFilter);

  if (sortedReservations.length === 0 && pendingPaymentRes.length === 0 && displayedRooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-white">
        <Clock className="text-slate-300 mb-3" size={40} />
        <h3 className="text-slate-700 font-extrabold">No hay reservas para hoy</h3>
        <p className="text-slate-550 text-sm mt-1 font-bold">Crea una nueva reserva pulsando el botón superior.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pendingPaymentRes.length > 0 && (
        <div className="p-5 bg-amber-50/50 border-2 border-amber-250 rounded-3xl space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-amber-200 pb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="text-amber-900 font-black text-lg tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
              ⚠️ Reservas Pendientes de Pago ({pendingPaymentRes.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingPaymentRes.map((res) => {
              return (
                <div
                  key={res.id}
                  className="p-4 rounded-2xl bg-white border-2 border-amber-200 hover:border-amber-300 transition-all flex flex-col justify-between shadow-sm relative"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      {/* Time badge */}
                      <div
                        className="px-3 py-1.5 rounded-xl font-mono font-black text-sm flex items-center gap-1.5 border bg-amber-50 border-amber-200 text-amber-700"
                      >
                        <Clock size={14} />
                        <span>{res.time}</span>
                      </div>
                      <div>
                        <h4 className="text-slate-900 font-extrabold text-base">
                          {res.guest_name}
                        </h4>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-slate-600 text-xs font-bold">
                          <span>👤 {res.party_size} pers.</span>
                          {res.guest_phone && <span>📞 {res.guest_phone}</span>}
                          {res.guest_email && <span className="text-slate-500">{res.guest_email}</span>}
                        </div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-black border bg-amber-50 border-amber-200 text-amber-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Pendiente Pago
                    </span>
                  </div>

                  <div className="mt-3 p-3 bg-amber-50/30 border border-amber-100 rounded-xl text-xs space-y-1 text-slate-750">
                    <p className="font-black text-amber-900 flex items-center gap-1">
                      ⏳ Importe: {res.prepayment_amount} € ({res.payment_method === 'bizum' ? 'Bizum' : 'Tarjeta'})
                    </p>
                    {res.prepayment_reason && (
                      <p className="italic text-slate-550">Motivo: {res.prepayment_reason}</p>
                    )}
                    {res.payment_method === 'bizum' && res.bizum_phone && (
                      <p className="text-[10px] text-slate-500 font-mono">
                        Bizum enviado a: {res.bizum_phone} ({res.bizum_name})
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2.5">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.confirm(`¿Confirmar que has recibido el pago de ${res.prepayment_amount} € y confirmar esta reserva?`)) {
                          await updateReservation(res.id, {
                            payment_status: 'paid',
                            status: 'confirmed'
                          });
                          toast.success("Pago confirmado y reserva activada.");
                        }
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-colors cursor-pointer text-center border border-emerald-600 shadow-sm"
                    >
                      ✓ Confirmar Pago Recibido
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.confirm("¿Seguro que quieres cancelar esta reserva?")) {
                          await updateReservation(res.id, { status: 'cancelled' });
                          toast.success("Reserva cancelada.");
                        }
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-750 text-xs font-black transition-colors cursor-pointer text-center border border-slate-200 hover:border-red-200"
                    >
                      ✕ Cancelar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {displayedRooms.map((room) => {
        const roomReservations = sortedReservations.filter((r) => r.room_id === room.id);
        const { totalTablesCount, availableSlots } = getRoomAvailabilityForDate(room);

        return (
          <div key={room.id} className="p-5 bg-slate-100 border-2 border-slate-200 rounded-3xl space-y-4">
            {/* Cabecera del Salón */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                <h3 className="text-slate-900 font-black text-lg tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                  📍 {room.name}
                </h3>
              </div>
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-slate-650 text-xs font-black">
                {roomReservations.length} {roomReservations.length === 1 ? 'reserva' : 'reservas'} · {totalTablesCount} mesas totales
              </span>
            </div>

            {/* Disponibilidad de Horas - grouped by shift */}
            {availableSlots.length > 0 ? (() => {
              // Group slots by shift name
              const slotGroups: Record<string, typeof availableSlots> = {};
              availableSlots.forEach((s) => {
                if (!slotGroups[s.shiftName]) slotGroups[s.shiftName] = [];
                slotGroups[s.shiftName].push(s);
              });
              return (
                <div className="space-y-3 bg-white border border-slate-200 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block">
                    Horas disponibles hoy (bloques {roomReservations[0]?.duration_minutes || 90} min):
                  </span>
                  {Object.entries(slotGroups).map(([shiftName, slotsInGroup]) => (
                    <div key={shiftName} className="flex items-start gap-3 flex-wrap">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-16 shrink-0 pt-2">
                        {shiftName}
                      </span>
                      <div className="flex flex-wrap gap-2 flex-1">
                        {slotsInGroup.map((slot) => (
                          <div
                            key={slot.time}
                            className="flex flex-col items-center px-3 py-2 bg-white border-2 border-slate-200 hover:border-slate-350 text-slate-800 text-xs font-black rounded-xl transition-colors shadow-sm min-w-[68px]"
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: slot.color }}
                              />
                              <span className="font-mono">{slot.time}</span>
                            </div>
                            <span className="text-[9px] text-emerald-600 font-extrabold mt-0.5 leading-none">
                              {slot.freeTables} {slot.freeTables === 1 ? 'libre' : 'libres'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })() : (
              <div className="bg-red-50 border border-red-200 p-3 rounded-2xl text-[10px] text-red-650 font-black uppercase tracking-wider">
                🚫 Completo (No quedan mesas disponibles en ningún horario hoy)
              </div>
            )}

            {/* Lista de Reservas por turno dentro de este salón */}
            <div className="pt-1">
              {roomReservations.length === 0 ? (
                <div className="p-4 text-center border-2 border-dashed border-slate-250 bg-white/50 rounded-2xl text-slate-550 text-xs font-bold">
                  Sin reservas para hoy en este salón.
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    const grouped = shifts
                      .map((shift) => {
                        const shiftRes = roomReservations.filter((r) => r.shift_id === shift.id);
                        return { shift, reservations: shiftRes };
                      })
                      .filter((g) => g.reservations.length > 0);

                    const unmatched = roomReservations.filter(
                      (r) => !shifts.some((s) => s.id === r.shift_id)
                    );

                    return (
                      <>
                        {grouped.map(({ shift, reservations: shiftRes }) => (
                          <div key={shift.id} className="space-y-2">
                            <div className="flex items-center gap-1.5 pl-1">
                              <span
                                className="w-2.5 h-2.5 rounded-full border border-white"
                                style={{ backgroundColor: shift.color }}
                              />
                              <span className="text-slate-700 text-xs font-black uppercase tracking-wider">
                                {shift.name} ({shiftRes.length})
                              </span>
                            </div>
                            <div className="grid grid-cols-1 gap-2.5">
                              {shiftRes.map((res) => renderReservationCard(res))}
                            </div>
                          </div>
                        ))}

                        {unmatched.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 pl-1">
                              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                              <span className="text-slate-700 text-xs font-black uppercase tracking-wider">
                                Otros (Sin turno) ({unmatched.length})
                              </span>
                            </div>
                            <div className="grid grid-cols-1 gap-2.5">
                              {unmatched.map((res) => renderReservationCard(res))}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// 2. WEEK VIEW
// ==========================================
function WeekCalendarView({
  date,
  getFilteredReservations,
  onEdit,
  isDateClosed,
  onDateClick,
}: {
  date: Date;
  getFilteredReservations: (dateStr: string) => Reservation[];
  onEdit: (r: Reservation) => void;
  isDateClosed: (dateStr: string) => boolean;
  onDateClick: (d: Date) => void;
}) {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start, end });

  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-3 min-h-[500px]">
      {weekDays.map((day) => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const dayReservations = getFilteredReservations(dayStr).sort((a, b) =>
          a.time.localeCompare(b.time)
        );
        const isToday = isSameDay(day, new Date());
        const closed = isDateClosed(dayStr);

        return (
          <div
            key={dayStr}
            onClick={() => onDateClick(day)}
            className={cn(
              'rounded-2xl border-2 flex flex-col min-h-[250px] transition-all cursor-pointer hover:shadow-md hover:border-slate-350',
              closed
                ? 'bg-red-50/50 border-red-200 border-dashed'
                : isToday ? 'border-blue-400 bg-white shadow-lg shadow-blue-50' : 'border-slate-200 bg-white'
            )}
          >
            {/* Week day header */}
            <div
              className={cn(
                'p-3 border-b-2 text-center rounded-t-2xl',
                closed
                  ? 'bg-red-50/70 border-red-100'
                  : isToday ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'
              )}
            >
              <span className={cn(
                "block text-xs font-black uppercase tracking-wider",
                closed ? "text-red-550" : "text-slate-550"
              )}>
                {closed ? '🔴 Cerrado' : format(day, 'EEEE', { locale: es })}
              </span>
              <span
                className={cn(
                  'inline-block text-lg font-black mt-0.5 rounded-full w-8 h-8 flex items-center justify-center mx-auto',
                  closed
                    ? 'text-red-650 font-black'
                    : isToday ? 'bg-blue-600 text-white' : 'text-slate-800'
                )}
              >
                {format(day, 'd')}
              </span>
            </div>

            {/* Week day reservations */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[400px]">
              {closed ? (
                <div className="text-red-550 text-xs text-center py-8 font-black uppercase tracking-wide">
                  🔴 Día libre
                </div>
              ) : dayReservations.length === 0 ? (
                <div className="text-slate-400 text-xs text-center py-8 font-bold">Sin reservas</div>
              ) : (
                dayReservations.map((res) => {
                  const statusCol = getStatusColor(res.status);
                  return (
                    <div
                      key={res.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(res);
                      }}
                      className="p-2.5 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-350 cursor-pointer transition-all group shadow-sm flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono font-black">
                        <span style={{ color: statusCol }}>{res.time.slice(0, 5)}</span>
                        <span className="text-slate-550 flex items-center gap-0.5">
                          <Users size={9} />
                          {res.party_size}
                        </span>
                      </div>
                      <div className="text-slate-900 text-xs font-extrabold truncate">
                        {res.guest_name}
                      </div>
                      {res.room && (
                        <div className="text-[9px] text-blue-600 bg-blue-50 px-1 py-0.5 rounded font-black uppercase tracking-wider self-start flex items-center gap-0.5">
                          <span>📍</span>
                          <span className="truncate max-w-[65px]">{res.room.name}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// 3. MONTH VIEW
// ==========================================
function MonthCalendarView({
  date,
  getFilteredReservations,
  onDateClick,
  onEdit,
  isDateClosed,
}: {
  date: Date;
  getFilteredReservations: (dateStr: string) => Reservation[];
  onDateClick: (d: Date) => void;
  onEdit: (r: Reservation) => void;
  isDateClosed: (dateStr: string) => boolean;
}) {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start, end });

  const weekLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <div className="flex flex-col h-full min-w-[600px] border-2 border-slate-200 rounded-3xl bg-white overflow-hidden">
      {/* Month Days Header */}
      <div className="grid grid-cols-7 border-b-2 border-slate-200 bg-slate-50 text-center font-black text-xs text-slate-700 py-3">
        {weekLabels.map((lbl) => (
          <div key={lbl}>{lbl}</div>
        ))}
      </div>

      {/* Grid cells */}
      <div className="grid grid-cols-7 grid-rows-5 flex-1 divide-x divide-y divide-slate-200 border-t border-slate-200">
        {monthDays.map((day, idx) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const dayReservations = getFilteredReservations(dayStr);
          const isToday = isSameDay(day, new Date());
          const isCurrentMonth = isSameMonth(day, date);
          const closed = isDateClosed(dayStr);

          return (
            <div
              key={dayStr}
              onClick={() => onDateClick(day)}
              className={cn(
                'min-h-[100px] p-2 flex flex-col transition-colors cursor-pointer hover:bg-slate-50/60',
                closed
                  ? 'bg-red-50/50 text-red-750'
                  : isCurrentMonth ? 'bg-white' : 'bg-slate-50/70 opacity-50',
                isToday && !closed && 'bg-blue-50'
              )}
            >
              {/* Day header */}
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className={cn(
                    'text-xs font-black w-6 h-6 rounded-full flex items-center justify-center transition-colors',
                    closed
                      ? 'bg-red-100 text-red-750 border border-red-200'
                      : isToday ? 'bg-blue-600 text-white' : 'text-slate-700'
                  )}
                >
                  {format(day, 'd')}
                </div>

                {closed ? (
                  <span className="text-[9px] text-red-600 font-black bg-red-100 px-1.5 py-0.5 rounded border border-red-200 uppercase tracking-wider scale-90">
                    Cerrado
                  </span>
                ) : dayReservations.length > 0 ? (
                  <span className="text-[10px] text-slate-600 font-extrabold bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">
                    {dayReservations.length} res
                  </span>
                ) : null}
              </div>

              {/* Day reservation list */}
              <div className="flex-1 space-y-1 overflow-hidden">
                {closed ? (
                  <div className="text-[10px] text-red-400 font-extrabold text-center mt-3 uppercase tracking-wide">
                    Día Libre
                  </div>
                ) : (
                  <>
                    {dayReservations.slice(0, 3).map((res) => {
                      const statusCol = getStatusColor(res.status);
                      return (
                        <div
                          key={res.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(res);
                          }}
                          className="px-1.5 py-0.5 rounded text-[10px] truncate bg-white border-2 border-slate-200 text-slate-800 cursor-pointer hover:border-slate-400 transition-colors flex flex-col gap-0.5 font-bold"
                        >
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusCol }} />
                            <span className="font-mono text-slate-400">{res.time.slice(0, 5)}</span>
                            <span className="truncate">{res.guest_name}</span>
                          </div>
                          {res.room && (
                            <span className="text-[8px] text-blue-500 font-extrabold truncate pl-3 flex items-center gap-0.5">
                              <span>📍</span>
                              <span className="truncate max-w-[50px]">{res.room.name}</span>
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {dayReservations.length > 3 && (
                      <button
                        onClick={() => onDateClick(day)}
                        className="text-[9px] text-blue-600 font-black block text-left hover:underline pl-1 cursor-pointer"
                      >
                        + {dayReservations.length - 3} más
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
