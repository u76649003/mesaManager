'use client';

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFloorStore } from '@/stores/useFloorStore';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useReservationStore } from '@/stores/useReservationStore';
import { FloorCanvas } from '@/components/floor/FloorCanvas';
import { TableDetailModal } from '@/components/floor/TableDetailModal';
import { RoomModal } from '@/components/floor/RoomModal';
import { ReservationList } from '@/components/reservations/ReservationList';
import { ReservationModal } from '@/components/reservations/ReservationModal';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import type { Table, Room } from '@/types';

export default function DashboardPage() {
  const {
    rooms,
    tables,
    fetchRooms,
    fetchTables,
    fetchTableGroups,
    fetchTableTypes,
    selectedTableId,
    selectTable,
    mode,
    setMode,
    tableGroups,
  } = useFloorStore();

  const {
    reservations,
    fetchReservations,
    fetchShifts,
    selectedTime,
    setSelectedTime,
    shifts,
    setSelectedRoom,
    selectedShiftId,
    setSelectedShift,
    selectedDate,
  } = useReservationStore();

  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const isMobile = useIsMobile();

  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<'map' | 'list'>('map');
  const [showMobileTimeline, setShowMobileTimeline] = useState(false);

  // --- Overdue Reservation Alert state ---
  // Map of reservationId -> how many minutes of extra grace have been granted
  const [snoozedMinutes, setSnoozedMinutes] = useState<Record<string, number>>({});
  // Queue of overdue reservation IDs waiting to show their popup
  const [overdueQueue, setOverdueQueue] = useState<string[]>([]);
  // Which reservation is currently showing its popup
  const [currentAlert, setCurrentAlert] = useState<string | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [nowTime, setNowTime] = useState(new Date());

  // 1. Initial load: fetch rooms and set the first one active, fetch shifts and reservations
  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true);
      try {
        const loadedRooms = await fetchRooms();
        if (loadedRooms && loadedRooms.length > 0) {
          const defaultRoom = loadedRooms[0];
          setActiveRoom(defaultRoom);
          
          // Concurrent fetches for the default room and general store data
          await Promise.all([
            fetchTables(defaultRoom.id),
            fetchTableGroups(defaultRoom.id),
            fetchTableTypes(),
            fetchReservations(),
            fetchShifts(),
          ]);
        }
      } catch (err) {
        console.error('Failed to load initial workspace data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();
  }, [fetchRooms, fetchTables, fetchTableGroups, fetchTableTypes, fetchReservations, fetchShifts]);

  // 2. Fetch tables and groups when active room changes
  useEffect(() => {
    if (activeRoom) {
      fetchTables(activeRoom.id);
      fetchTableGroups(activeRoom.id);
      setSelectedRoom(activeRoom.id);
    }
  }, [activeRoom, fetchTables, fetchTableGroups, setSelectedRoom]);

  // Dynamic table mapper to keep reservations and status correct in details drawer
  const getDynamicTable = useCallback((rawTable: Table | null): Table | null => {
    if (!rawTable) return null;
    if (mode === 'edit') return rawTable;

    const activeTime = selectedTime || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

    const isReservationActive = (res: any) => {
      if (res.date !== selectedDate) return false;
      if (res.status === 'cancelled' || res.status === 'no_show') return false;
      if (res.is_prepayment && res.payment_status === 'pending') return false;
      
      const [resH, resM] = res.time.split(':').map(Number);
      const [selH, selM] = activeTime.split(':').map(Number);
      
      const resStart = resH * 60 + resM;
      const sel = selH * 60 + selM;
      const resEnd = resStart + (res.duration_minutes || 90);
      
      return sel >= resStart && sel < resEnd;
    };

    // Buscar si hay alguna reserva activa para esta mesa a esta hora
    const activeRes = reservations.find((r) => {
      if (!isReservationActive(r)) return false;
      
      if (r.table_id === rawTable.id) return true;
      if (r.group_id) {
        const group = tableGroups.find((g) => g.id === r.group_id);
        return group?.member_table_ids.includes(rawTable.id);
      }
      return false;
    });

    if (activeRes) {
      return {
        ...rawTable,
        status: activeRes.status === 'seated' ? 'occupied' as const : 'reserved' as const,
        current_reservation_id: activeRes.id,
        current_reservation: activeRes,
      };
    }

    const fallbackStatus = selectedTime === null
      ? (rawTable.status ?? 'available')
      : (rawTable.status === 'blocked' ? 'blocked' : 'available');

    return {
      ...rawTable,
      status: fallbackStatus as any,
      current_reservation_id: undefined,
      current_reservation: undefined,
    };
  }, [mode, selectedTime, selectedDate, reservations, tableGroups]);

  // 3. Keep selectedTable synchronized with tables list updates
  useEffect(() => {
    if (selectedTableId) {
      const t = tables.find((t) => t.id === selectedTableId);
      setSelectedTable(getDynamicTable(t ?? null));
    } else {
      setSelectedTable(null);
    }
  }, [selectedTableId, tables, getDynamicTable]);

  // --- Auto-transition tables from cleaning to available after 2 minutes ---
  useEffect(() => {
    const checkCleaningTables = async () => {
      const now = new Date().getTime();
      const cleaningTables = tables.filter((t) => t.status === 'cleaning');
      
      for (const table of cleaningTables) {
        if (!table.updated_at) continue;
        const updatedAtTime = new Date(table.updated_at).getTime();
        const elapsedMs = now - updatedAtTime;
        
        if (elapsedMs >= 2 * 60 * 1000) { // 2 minutes
          await useFloorStore.getState().setTableStatus(table.id, 'available');
        }
      }
    };

    checkCleaningTables();
    const interval = setInterval(checkCleaningTables, 10000);
    return () => clearInterval(interval);
  }, [tables]);



  // --- Overdue detection: runs every 30 seconds ---
  useEffect(() => {
    const check = () => {
      const now = new Date();
      setNowTime(now);
      const todayStr = now.toISOString().slice(0, 10);
      const curMin = now.getHours() * 60 + now.getMinutes();

      const overdue = reservations.filter((r) => {
        if (r.date !== todayStr) return false;
        if (!['pending', 'confirmed'].includes(r.status)) return false;
        const [rh, rm] = r.time.slice(0, 5).split(':').map(Number);
        const reservMin = rh * 60 + rm;
        const grace = 20 + (snoozedMinutes[r.id] || 0);
        return curMin >= reservMin + grace;
      });

      const newQueue: string[] = [];
      overdue.forEach((r) => {
        if (!dismissedAlerts.has(r.id) && r.id !== currentAlert) {
          newQueue.push(r.id);
        }
      });

      if (newQueue.length > 0 && !currentAlert) {
        setCurrentAlert(newQueue[0]);
        setOverdueQueue(newQueue.slice(1));
      } else if (newQueue.length > 0) {
        setOverdueQueue((prev) => {
          const combined = [...new Set([...prev, ...newQueue])];
          return combined.filter((id) => !dismissedAlerts.has(id) && id !== currentAlert);
        });
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [reservations, snoozedMinutes, dismissedAlerts, currentAlert]);

  const handleSnoozeAlert = useCallback((reservationId: string) => {
    setSnoozedMinutes((prev) => ({ ...prev, [reservationId]: (prev[reservationId] || 0) + 5 }));
    setDismissedAlerts((prev) => { const s = new Set(prev); s.delete(reservationId); return s; });
    setCurrentAlert(null);
    // Show next in queue after a brief moment
    setTimeout(() => {
      setOverdueQueue((prev) => {
        if (prev.length > 0) {
          setCurrentAlert(prev[0]);
          return prev.slice(1);
        }
        return prev;
      });
    }, 300);
  }, []);

  const handleCancelFromAlert = useCallback(async (reservationId: string) => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', reservationId);
      // Refresh reservations in store
      await (useReservationStore.getState() as any).fetchReservations();
    } catch (e) {
      console.error('Error cancelling overdue reservation:', e);
    }
    setDismissedAlerts((prev) => new Set([...prev, reservationId]));
    setCurrentAlert(null);
    setTimeout(() => {
      setOverdueQueue((prev) => {
        if (prev.length > 0) {
          setCurrentAlert(prev[0]);
          return prev.slice(1);
        }
        return prev;
      });
    }, 300);
  }, []);

  const handleDismissAlert = useCallback((reservationId: string) => {
    setDismissedAlerts((prev) => new Set([...prev, reservationId]));
    setCurrentAlert(null);
    setTimeout(() => {
      setOverdueQueue((prev) => {
        if (prev.length > 0) {
          setCurrentAlert(prev[0]);
          return prev.slice(1);
        }
        return prev;
      });
    }, 300);
  }, []);

  // Encontrar turnos según mediodía / noche
  const getShiftIdByPeriod = (period: 'lunch' | 'dinner') => {
    const activeShifts = shifts.length > 0 ? shifts : [
      { id: 'd1', name: 'Comida', start_time: '13:00', end_time: '17:00', color: '#f59e0b', days_of_week: [1,2,3,4,5,6,7], is_active: true, sort_order: 1, tenant_id: '' },
      { id: 'd2', name: 'Cena', start_time: '20:00', end_time: '23:30', color: '#6366f1', days_of_week: [1,2,3,4,5,6,7], is_active: true, sort_order: 2, tenant_id: '' }
    ];
    
    if (period === 'lunch') {
      const found = activeShifts.find((s) => 
        s.name.toLowerCase().includes('comida') || 
        s.name.toLowerCase().includes('almuerzo') || 
        s.name.toLowerCase().includes('medio') || 
        parseInt(s.start_time.split(':')[0]) < 18
      );
      return found?.id || activeShifts[0]?.id || null;
    } else {
      const found = activeShifts.find((s) => 
        s.name.toLowerCase().includes('cena') || 
        s.name.toLowerCase().includes('noche') || 
        parseInt(s.start_time.split(':')[0]) >= 18
      );
      return found?.id || activeShifts[1]?.id || null;
    }
  };

  // Genera horas cada 30 mins para todos los turnos disponibles
  const getTimeSlots = () => {
    const slots: { time: string; shiftName: string; color: string }[] = [];
    
    // Si no hay turnos guardados, creamos unos por defecto
    const activeShifts = shifts.length > 0 ? shifts : [
      { id: 'd1', name: 'Comida', start_time: '13:00', end_time: '17:00', color: '#f59e0b', days_of_week: [1,2,3,4,5,6,7], is_active: true, sort_order: 1, tenant_id: '' },
      { id: 'd2', name: 'Cena', start_time: '20:00', end_time: '23:30', color: '#6366f1', days_of_week: [1,2,3,4,5,6,7], is_active: true, sort_order: 2, tenant_id: '' }
    ];

    const filteredShifts = selectedShiftId
      ? activeShifts.filter((s) => s.id === selectedShiftId)
      : activeShifts;

    filteredShifts.forEach((s) => {
      let [h, m] = s.start_time.split(':').map(Number);
      const [endH, endM] = s.end_time.split(':').map(Number);
      let currentMin = h * 60 + m;
      let endMin = endH * 60 + endM;

      if (endMin <= currentMin) {
        endMin += 24 * 60;
      }
      
      while (currentMin <= endMin) {
        const slotH = Math.floor(currentMin / 60) % 24;
        const slotM = currentMin % 60;
        const timeStr = `${String(slotH).padStart(2, '0')}:${String(slotM).padStart(2, '0')}`;
        // Evitar duplicados
        if (!slots.some((sl) => sl.time === timeStr)) {
          slots.push({
            time: timeStr,
            shiftName: s.name,
            color: s.color
          });
        }
        currentMin += 30;
      }
    });

    return slots.sort((a, b) => a.time.localeCompare(b.time));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-650 text-sm font-bold">Cargando gestión de sala...</p>
        </div>
      </div>
    );
  }

  if (!activeRoom) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-2xl font-black">No se encontraron salones</h2>
          <p className="text-slate-600 font-bold">
            No tienes salones configurados para este restaurante. Ponte en contacto con el administrador o añade un salón.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Sidebar de navegación */}
      <Sidebar activeRoom={activeRoom} rooms={rooms} onRoomChange={setActiveRoom} />

      {/* Contenido principal */}
      <div className="main-content">
        {/* Top bar con info del turno y controles */}
        <TopBar
          room={activeRoom}
          rooms={rooms}
          onRoomChange={setActiveRoom}
          mode={mode}
          onModeChange={setMode}
          totalTables={tables.filter((t) => t.room_id === activeRoom.id).length}
          occupiedTables={tables.filter((t) => t.room_id === activeRoom.id && t.status === 'occupied').length}
          reservationsToday={reservations.filter((r) => r.date === new Date().toISOString().slice(0, 10)).length}
        />

        {/* Mobile View Toggle */}
        <div className={cn("p-3 bg-white border-b border-slate-200", isMobile ? "flex" : "hidden")}>

          <div className="flex w-full rounded-2xl bg-slate-100 p-1 border border-slate-200 shadow-inner">
            <button
              onClick={() => setActiveView('map')}
              className={cn(
                "flex-1 py-2 text-sm font-black rounded-xl transition-all cursor-pointer text-center",
                activeView === 'map'
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-650 hover:text-slate-900"
              )}
            >
              🗺️ Plano de Sala
            </button>
            <button
              onClick={() => setActiveView('list')}
              className={cn(
                "flex-1 py-2 text-sm font-black rounded-xl transition-all cursor-pointer text-center",
                activeView === 'list'
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-650 hover:text-slate-900"
              )}
            >
              📅 Lista de Reservas
            </button>
          </div>
        </div>

        {/* Vista dividida: Lista izquierda + Canvas derecho */}
        <div className="dashboard-split flex-1 overflow-hidden">
          {/* Columna 1: Lista de Reservas (Izquierda en PC, pestaña en Móvil) */}
          <div className={cn("h-full flex-col overflow-hidden", isMobile ? (activeView === 'list' ? "flex" : "hidden") : "flex")}>

            <ReservationList
              onReservationClick={(res) => {
                if (res.table_id) {
                  const t = tables.find((t) => t.id === res.table_id);
                  if (t) {
                    setSelectedTable(t);
                    selectTable(t.id);
                    setActiveView('map');
                  }
                }
              }}
            />
          </div>

          {/* Columna 2: Plano de Sala y Mandos (Derecha en PC, pestaña en Móvil) */}
          <div className={cn("flex-col p-1.5 md:p-3 gap-2 md:gap-3 overflow-hidden flex-1", isMobile ? (activeView === 'map' ? "flex" : "hidden") : "flex")}>

            {/* Cabecera del plano con Leyenda y Selector de Horas (Timeline) */}
            <div className="flex flex-col gap-1.5 md:gap-3 bg-white border-2 border-slate-200 p-2 md:p-3.5 rounded-3xl shadow-sm">
              {/* Botón para colapsar/desplegar controles de horas en móvil */}
              <div className={cn("items-center justify-between w-full px-1 py-0.5", isMobile ? "flex" : "hidden")}>

                <span className="text-[11px] font-black text-slate-800">
                  {selectedTime === null ? '⏰ Tiempo Real' : `⏰ Reservas: ${selectedTime}`}
                </span>
                <button
                  onClick={() => setShowMobileTimeline(!showMobileTimeline)}
                  className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-600 rounded-xl text-[10px] font-black cursor-pointer hover:bg-blue-100 transition-colors"
                >
                  {showMobileTimeline ? '🙈 Ocultar Horas' : '⏰ Filtrar Horas'}
                </button>
              </div>

              {/* Controles de turnos y horas (visibles siempre en desktop, y en móvil solo si está desplegado) */}
              <div className={cn("flex flex-col gap-2 md:gap-3", isMobile ? (showMobileTimeline ? "flex" : "hidden") : "flex")}>
                <div className={cn("flex justify-between gap-1.5 md:gap-3 border-b border-slate-200 pb-1.5 md:pb-2", isMobile ? "flex-col" : "flex-row items-center")}>
                  <div className={isMobile ? "hidden" : "block"}>

                    <StatusLegend />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 md:gap-3 justify-between md:justify-start">
                    {/* Filtro de Turno (Todo el día / Medio día / Noche) */}
                    <div className="flex rounded-xl bg-slate-100 p-0.5 md:p-1 gap-1 border border-slate-200 shadow-inner">
                      <button
                        onClick={() => {
                          setSelectedShift(null);
                          setSelectedTime(null);
                        }}
                        className={cn(
                          "px-2 md:px-3 py-1 md:py-1.5 text-[10px] md:text-xs font-black rounded-lg transition-all cursor-pointer",
                          selectedShiftId === null
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-650 hover:text-slate-950"
                        )}
                      >
                        Todo el día
                      </button>
                      <button
                        onClick={() => {
                          const id = getShiftIdByPeriod('lunch');
                          setSelectedShift(id);
                          setSelectedTime(null);
                        }}
                        className={cn(
                          "px-2 md:px-3 py-1 md:py-1.5 text-[10px] md:text-xs font-black rounded-lg transition-all cursor-pointer",
                          selectedShiftId === getShiftIdByPeriod('lunch')
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-650 hover:text-slate-950"
                        )}
                      >
                        Medio día
                      </button>
                      <button
                        onClick={() => {
                          const id = getShiftIdByPeriod('dinner');
                          setSelectedShift(id);
                          setSelectedTime(null);
                        }}
                        className={cn(
                          "px-2 md:px-3 py-1 md:py-1.5 text-[10px] md:text-xs font-black rounded-lg transition-all cursor-pointer",
                          selectedShiftId === getShiftIdByPeriod('dinner')
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-650 hover:text-slate-950"
                        )}
                      >
                        Noche
                      </button>
                    </div>

                    {!isMobile && <div className="hidden lg:block h-6 w-px bg-slate-250" />}


                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-wider hidden sm:inline">Visualizar hora:</span>
                      <button
                        onClick={() => setSelectedTime(null)}
                        className={cn(
                          "px-2.5 md:px-3.5 py-1 md:py-1.5 rounded-xl text-[10px] md:text-xs font-black border-2 transition-all cursor-pointer",
                          selectedTime === null
                            ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                            : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200 hover:text-slate-950"
                        )}
                      >
                        ⏰ {selectedTime === null ? 'Tiempo Real' : 'Restablecer'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Selector de Horas del Turno (Timeline Scrollable) */}
                <div className="flex flex-col gap-1.5">
                  {(() => {
                    const slots = getTimeSlots();
                    const groups: Record<string, typeof slots> = {};
                    slots.forEach((s) => {
                      if (!groups[s.shiftName]) groups[s.shiftName] = [];
                      groups[s.shiftName].push(s);
                    });

                    return Object.entries(groups).map(([shiftName, shiftSlots]) => (
                      <div key={shiftName} className="flex flex-col gap-0.5">
                        {selectedShiftId === null && (
                          <span className={cn("text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1.5", isMobile ? "hidden" : "block")}>

                            Turno {shiftName}
                          </span>
                        )}
                        <div className="flex items-center gap-1 md:gap-1.5 overflow-x-auto pb-0.5 md:pb-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                          {shiftSlots.map((slot) => {
                            const isActive = selectedTime === slot.time;
                            return (
                              <button
                                key={slot.time}
                                onClick={() => setSelectedTime(slot.time)}
                                className={cn(
                                  "px-2.5 md:px-3.5 py-1 md:py-1.5 rounded-xl border text-[10px] md:text-xs font-bold transition-all shrink-0 flex items-center gap-1 md:gap-1.5",
                                  isActive
                                    ? "bg-blue-600 border-blue-650 text-white shadow-md cursor-pointer border-2"
                                    : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-950 cursor-pointer border-2"
                                )}
                              >
                                <div
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: slot.color }}
                                />
                                <span>{slot.time}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* Canvas del plano */}
            <FloorCanvas
              room={activeRoom}
              onRoomChange={setActiveRoom}
              onTableClick={(table) => setSelectedTable(table)}
            />
          </div>
        </div>
      </div>

      {/* Modales */}
      <TableDetailModal
        table={selectedTable}
        onClose={() => {
          setSelectedTable(null);
          selectTable(null);
        }}
      />
      <ReservationModal />
      <RoomModal onRoomChange={setActiveRoom} />

      {/* Overdue Reservation Alert Popup */}
      <AnimatePresence>
        {currentAlert && (() => {
          const res = reservations.find((r) => r.id === currentAlert);
          if (!res) return null;
          const grace = snoozedMinutes[res.id] || 0;
          const [rh, rm] = res.time.slice(0, 5).split(':').map(Number);
          const resMin = rh * 60 + rm;
          const nowMin = nowTime.getHours() * 60 + nowTime.getMinutes();
          const minutesLate = nowMin - resMin;
          const remaining = overdueQueue.length;

          return (
            <motion.div
              key={currentAlert}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[999] flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
            >
              <motion.div
                initial={{ scale: 0.88, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.88, opacity: 0, y: 24 }}
                transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                className="bg-white rounded-3xl shadow-2xl border-2 border-orange-200 w-full max-w-md mx-4 overflow-hidden"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-5 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white/20 rounded-2xl flex items-center justify-center">
                      <AlertTriangle size={22} className="text-white" />
                    </div>
                    <div>
                      <p className="text-white font-black text-sm uppercase tracking-wider">⚠️ Reserva Sin Sentar</p>
                      <p className="text-orange-100 text-xs font-bold mt-0.5">Lleva {minutesLate} min de retraso</p>
                    </div>
                  </div>
                  {remaining > 0 && (
                    <div className="bg-white/20 text-white text-[10px] font-black px-2.5 py-1 rounded-xl uppercase tracking-wider">
                      +{remaining} más
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="px-6 py-5">
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center shrink-0">
                      <span className="text-2xl font-black text-orange-600">
                        {res.guest_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-900 text-lg leading-tight truncate">{res.guest_name}</p>
                      <p className="text-slate-500 text-sm font-bold">{res.reservation_number}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                      <Clock size={14} className="text-slate-400 mx-auto mb-1" />
                      <p className="font-black text-slate-900 text-sm">{res.time.slice(0, 5)}</p>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wide">Hora</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                      <span className="text-sm block mb-1">👥</span>
                      <p className="font-black text-slate-900 text-sm">{res.party_size}</p>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wide">Personas</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                      <span className="text-sm block mb-1">🪑</span>
                      <p className="font-black text-slate-900 text-sm truncate">{res.table?.label || res.room?.name || '—'}</p>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wide">Mesa</p>
                    </div>
                  </div>

                  {grace > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 mb-4 text-center">
                      <p className="text-amber-700 text-xs font-black">⏱ Tiempo extra concedido: +{grace} min</p>
                    </div>
                  )}

                  {res.notes && (
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5 mb-4">
                      <p className="text-blue-700 text-xs font-bold">📝 {res.notes}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-2.5">
                    <button
                      onClick={() => handleSnoozeAlert(res.id)}
                      className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-2xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                    >
                      <Clock size={16} />
                      Posponer cancelación +5 min
                    </button>
                    <button
                      onClick={() => handleCancelFromAlert(res.id)}
                      className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                    >
                      <X size={16} />
                      Cancelar reserva
                    </button>
                    <button
                      onClick={() => handleDismissAlert(res.id)}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-2xl transition-colors text-xs cursor-pointer"
                    >
                      Ignorar esta vez
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function StatusLegend() {
  const statuses = [
    { label: 'Disponible', color: '#22c55e' },
    { label: 'Ocupada',    color: '#ef4444' },
    { label: 'Reservada',  color: '#f59e0b' },
    { label: 'Limpieza',   color: '#8b5cf6' },
    { label: 'Bloqueada',  color: '#6b7280' },
  ];

  return (
    <div className="flex items-center gap-4 px-1">
      {statuses.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="text-slate-700 text-xs font-black">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
