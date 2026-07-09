'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReservationStore } from '@/stores/useReservationStore';
import { getStatusColor, getStatusLabel, cn } from '@/lib/utils';
import type { Reservation } from '@/types';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Clock, Users, Hash, MapPin, Plus, Search, MessageSquare } from 'lucide-react';
import { useFloorStore } from '@/stores/useFloorStore';
import { useTableTimer } from '@/hooks/useTableTimer';

interface ReservationListProps {
  onReservationClick?: (reservation: Reservation) => void;
}

export function ReservationList({ onReservationClick }: ReservationListProps) {
  const {
    selectedDate,
    selectedShiftId,
    selectedRoomId,
    viewMode,
    getTodayReservations,
    setSelectedDate,
    setViewMode,
    openModal,
    shifts,
    selectedStatusFilter,
    setSelectedStatusFilter,
  } = useReservationStore();

  const { tableGroups, occupiedSince } = useFloorStore();
  const [nowTime, setNowTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const [searchTerm, setSearchTerm] = useState('');

  const isDateClosed = (dateStr: string) => {
    if (!shifts || shifts.length === 0) return false;
    const date = parseISO(dateStr);
    const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    const dayOfWeek = day === 0 ? 7 : day;
    
    const activeShifts = shifts.filter((s) => s.is_active);
    if (activeShifts.length === 0) return false;
    
    return !activeShifts.some((s) => s.days_of_week.includes(dayOfWeek));
  };

  const reservations = getTodayReservations();

  // Filtrar primero por el salón activo
  const roomFiltered = selectedRoomId
    ? reservations.filter((r) => r.room_id === selectedRoomId)
    : reservations;

  const filtered = selectedShiftId
    ? roomFiltered.filter((r) => r.shift_id === selectedShiftId)
    : roomFiltered;

  const sorted = [...filtered].sort((a, b) => a.time.localeCompare(b.time));

  const searched = sorted.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.guest_name.toLowerCase().includes(term) ||
      (r.reservation_number && r.reservation_number.toLowerCase().includes(term)) ||
      (r.notes && r.notes.toLowerCase().includes(term)) ||
      (r.table && r.table.label.toLowerCase().includes(term))
    );
  });

  const pendingPaymentReservations = searched
    .filter((r) => r.is_prepayment && r.payment_status === 'pending')
    .sort((a, b) => a.time.localeCompare(b.time));

  const unfilteredActive = searched.filter((r) => ['pending', 'confirmed', 'seated'].includes(r.status) && !(r.is_prepayment && r.payment_status === 'pending'));

  const activeReservations = searched
    .filter((r) => {
      const matchStatus = ['pending', 'confirmed', 'seated'].includes(r.status);
      const matchPrepayment = !(r.is_prepayment && r.payment_status === 'pending');
      const matchFilter = selectedStatusFilter === 'all' || r.status === selectedStatusFilter;
      return matchStatus && matchPrepayment && matchFilter;
    })
    .sort((a, b) => {
      const todayStr = format(nowTime, 'yyyy-MM-dd');
      const curMin = nowTime.getHours() * 60 + nowTime.getMinutes();

      const getMinutes = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };

      const isOverdueA = a.date === todayStr && ['pending', 'confirmed'].includes(a.status) && curMin > getMinutes(a.time);
      const isOverdueB = b.date === todayStr && ['pending', 'confirmed'].includes(b.status) && curMin > getMinutes(b.time);

      // 1. Atrasadas primero
      if (isOverdueA && !isOverdueB) return -1;
      if (!isOverdueA && isOverdueB) return 1;
      if (isOverdueA && isOverdueB) {
        return getMinutes(a.time) - getMinutes(b.time); // Más atrasado primero
      }

      // 2. Sentados después
      if (a.status === 'seated' && b.status !== 'seated') return -1;
      if (a.status !== 'seated' && b.status === 'seated') return 1;
      if (a.status === 'seated' && b.status === 'seated') {
        const aTableId = a.table_id || (a.group_id ? tableGroups.find((g) => g.id === a.group_id)?.member_table_ids[0] : null);
        const bTableId = b.table_id || (b.group_id ? tableGroups.find((g) => g.id === b.group_id)?.member_table_ids[0] : null);
        const aSince = aTableId ? occupiedSince[aTableId] : null;
        const bSince = bTableId ? occupiedSince[bTableId] : null;
        
        if (aSince && bSince) {
          return aSince.localeCompare(bSince); // Más antiguo primero
        }
        if (aSince) return -1;
        if (bSince) return 1;
      }

      // 3. Confirmadas/Pendientes por hora
      return a.time.localeCompare(b.time);
    });

  const finalizedReservations = searched.filter((r) => ['completed', 'cancelled', 'no_show'].includes(r.status));

  const statusGroups = {
    seated:    unfilteredActive.filter((r) => r.status === 'seated'),
    confirmed: unfilteredActive.filter((r) => r.status === 'confirmed'),
    pending:   unfilteredActive.filter((r) => r.status === 'pending'),
    other:     finalizedReservations,
  };

  return (
    <div className="flex flex-col h-full bg-white border-r-2 border-slate-200 overflow-hidden">
      {/* Header claro */}
      <div className="p-4 border-b-2 border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h2 className="text-slate-900 font-black text-lg tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
              Reservas
            </h2>
            <p className="text-slate-550 text-xs font-extrabold capitalize mt-0.5">
              {selectedDate === format(new Date(), 'yyyy-MM-dd')
                ? `Hoy: ${format(parseISO(selectedDate), "EEEE d 'de' MMMM", { locale: es })}`
                : format(parseISO(selectedDate), "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          {selectedDate >= format(new Date(), 'yyyy-MM-dd') && !isDateClosed(selectedDate) && (
            <button
              onClick={() => openModal()}
              className="flex items-center gap-1.5 px-4.5 py-2.5 bg-blue-600 hover:bg-blue-750 text-white text-xs font-black rounded-xl transition-colors shadow-md shadow-blue-500/10 cursor-pointer border-2 border-blue-600"
            >
              <Plus size={15} />
              <span>Nueva</span>
            </button>
          )}
        </div>

        {/* Buscador de reservas */}
        <div className="mt-3 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={14} className="text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar reserva..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border-2 border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:outline-none rounded-xl text-xs font-bold transition-all bg-white text-slate-900 placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Stats rápidas de alto contraste */}
      <div className="grid grid-cols-3 gap-2 p-3 border-b-2 border-slate-200 bg-white">
        {[
          { key: 'seated' as const, label: 'En mesa', count: statusGroups.seated.length, color: '#dc2626' },
          { key: 'confirmed' as const, label: 'Confirmadas', count: statusGroups.confirmed.length, color: '#2563eb' },
          { key: 'pending' as const, label: 'Pendientes', count: statusGroups.pending.length, color: '#d97706' },
        ].map((stat) => {
          const isActive = selectedStatusFilter === stat.key;
          return (
            <button
              key={stat.label}
              onClick={() => {
                setSelectedStatusFilter(isActive ? 'all' : stat.key);
              }}
              className={cn(
                "border rounded-2xl p-2.5 text-center shadow-sm transition-all cursor-pointer select-none w-full flex flex-col items-center justify-center",
                isActive 
                  ? "bg-slate-900 border-slate-900 text-white transform scale-[1.02] ring-2 ring-slate-900 ring-offset-1" 
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-350"
              )}
              style={{
                boxShadow: isActive ? `0 10px 15px -3px ${stat.color}25, 0 4px 6px -4px ${stat.color}25` : undefined,
                borderColor: isActive ? stat.color : undefined,
              }}
            >
              <div 
                className="text-xl font-black transition-colors" 
                style={{ color: isActive ? '#ffffff' : stat.color }}
              >
                {stat.count}
              </div>
              <div 
                className={cn(
                  "text-[9px] uppercase font-black tracking-wider mt-0.5 transition-colors leading-none",
                  isActive ? "text-slate-200 font-extrabold" : "text-slate-500"
                )}
              >
                {stat.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Lista de reservas */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 bg-slate-50">
        <AnimatePresence initial={false}>
          {activeReservations.length === 0 && finalizedReservations.length === 0 && pendingPaymentReservations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <div className="text-3xl mb-2">{isDateClosed(selectedDate) ? '🔴' : '📋'}</div>
              <p className="text-xs font-bold text-slate-500 text-center px-4">
                {isDateClosed(selectedDate)
                  ? 'El restaurante está cerrado este día (Día Libre).'
                  : searchTerm ? 'No se encontraron resultados' : 'Sin reservas para hoy'}
              </p>
            </div>
          ) : (
            <>
              {/* Sección Pendientes de Pago */}
              {pendingPaymentReservations.length > 0 && (
                <div className="mb-4 space-y-2">
                  <h3 className="text-xs font-black text-amber-600 uppercase tracking-wider mb-2 px-1 flex items-center gap-1.5 animate-pulse">
                    <span>⚠️ Pendientes de Pago ({pendingPaymentReservations.length})</span>
                  </h3>
                  {pendingPaymentReservations.map((reservation, index) => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      index={index}
                      nowTime={nowTime}
                      onClick={() => onReservationClick?.(reservation)}
                    />
                  ))}
                </div>
              )}

              {/* Sección Activas */}
              {activeReservations.length > 0 && (
                <div className="space-y-2">
                  {pendingPaymentReservations.length > 0 && (
                    <h3 className="text-xs font-black text-slate-550 uppercase tracking-wider mb-2 px-1">
                      Confirmadas / Activas ({activeReservations.length})
                    </h3>
                  )}
                  {activeReservations.map((reservation, index) => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      index={index}
                      nowTime={nowTime}
                      onClick={() => onReservationClick?.(reservation)}
                    />
                  ))}
                </div>
              )}

              {/* Sección Finalizadas / Canceladas */}
              {finalizedReservations.length > 0 && (
                <div className="mt-6 pt-4 border-t-2 border-slate-200">
                  <h3 className="text-xs font-black text-slate-550 uppercase tracking-wider mb-2.5 px-1">
                    Finalizadas / Canceladas ({finalizedReservations.length})
                  </h3>
                  <div className="space-y-3 opacity-60 hover:opacity-85 transition-opacity">
                    {finalizedReservations.map((reservation, index) => (
                      <ReservationCard
                        key={reservation.id}
                        reservation={reservation}
                        index={index + activeReservations.length}
                        nowTime={nowTime}
                        onClick={() => onReservationClick?.(reservation)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------

function ReservationCard({
  reservation,
  index,
  onClick,
  nowTime,
}: {
  reservation: Reservation;
  index: number;
  onClick: () => void;
  nowTime: Date;
}) {
  const statusColor = getStatusColor(reservation.status);
  const { reservations, updateReservation, openModal, selectedDate } = useReservationStore();
  const { seatTable, clearTable, tableGroups } = useFloorStore();
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);

  const todayStr = format(nowTime, 'yyyy-MM-dd');
  const isDashboardPast = selectedDate < todayStr;
  const isDashboardToday = selectedDate === todayStr;

  const curMin = nowTime.getHours() * 60 + nowTime.getMinutes();
  const getMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const isPendingPayment = reservation.is_prepayment && reservation.payment_status === 'pending';

  const isOverdue = reservation.date === todayStr && 
                    ['pending', 'confirmed'].includes(reservation.status) && 
                    curMin > getMinutes(reservation.time) &&
                    !isPendingPayment;

  const showActions = (reservation.status === 'confirmed' || reservation.status === 'pending') && !isDashboardPast && !isPendingPayment;
  const showSeatedActions = reservation.status === 'seated' && isDashboardToday;

  const getTimerTableId = () => {
    if (reservation.table_id) return reservation.table_id;
    if (reservation.group_id) {
      const group = tableGroups.find((g) => g.id === reservation.group_id);
      return group?.member_table_ids[0] || '';
    }
    return '';
  };

  const timer = useTableTimer(getTimerTableId());

  const handleSeatClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Auto-completar reservas anteriores 'seated' en la misma mesa
    const targetTableIds = reservation.table_id 
      ? [reservation.table_id] 
      : reservation.group_id 
        ? tableGroups.find((g) => g.id === reservation.group_id)?.member_table_ids || []
        : [];

    if (targetTableIds.length > 0) {
      const activeResOnTables = reservations.filter(
        (r) => r.id !== reservation.id && 
               r.status === 'seated' && 
               ((r.table_id && targetTableIds.includes(r.table_id)) || 
                (r.group_id && tableGroups.find((g) => g.id === r.group_id)?.member_table_ids.some(tid => targetTableIds.includes(tid))))
      );

      for (const oldRes of activeResOnTables) {
        await updateReservation(oldRes.id, { status: 'completed' });
      }
    }

    if (reservation.table_id) {
      await seatTable(reservation.table_id, reservation.id);
    } else if (reservation.group_id) {
      const group = tableGroups.find((g) => g.id === reservation.group_id);
      if (group) {
        for (const tableId of group.member_table_ids) {
          await seatTable(tableId, reservation.id);
        }
      }
    }
    await updateReservation(reservation.id, { status: 'seated' });
  };

  const handleCancelClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('¿Estás seguro de que quieres cancelar esta reserva?')) {
      await updateReservation(reservation.id, { status: 'cancelled' });
      if (reservation.table_id) {
        await clearTable(reservation.table_id);
      } else if (reservation.group_id) {
        const group = tableGroups.find((g) => g.id === reservation.group_id);
        if (group) {
          for (const tableId of group.member_table_ids) {
            await clearTable(tableId);
          }
        }
      }
    }
  };

  const handleCompleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await updateReservation(reservation.id, { status: 'completed' });
    if (reservation.table_id) {
      await clearTable(reservation.table_id);
    } else if (reservation.group_id) {
      const group = tableGroups.find((g) => g.id === reservation.group_id);
      if (group) {
        for (const tableId of group.member_table_ids) {
          await clearTable(tableId);
        }
      }
    }
  };


  const cardBorderColor = isPendingPayment 
    ? 'border-amber-300 bg-amber-50/10 border-l-4 border-l-amber-500' 
    : isOverdue 
      ? 'border-l-4 border-l-amber-500 bg-amber-50/20 border-amber-300 animate-pulse' 
      : reservation.status === 'seated' 
        ? 'border-l-4 border-l-red-600' 
        : '';

  return (
    <motion.div
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -15 }}
      transition={{ delay: index * 0.03, type: 'spring', stiffness: 400, damping: 35 }}
      onClick={!isDashboardPast ? onClick : undefined}
      className={cn(
        'relative p-3.5 rounded-2xl border-2 transition-colors space-y-2 bg-white shadow-sm',
        !isDashboardPast ? 'cursor-pointer hover:border-slate-400 hover:bg-slate-50' : 'cursor-default opacity-85',
        cardBorderColor
      )}
    >
      {/* Indicador de estado */}
      <div
        className="absolute top-4.5 right-4 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm"
        style={{ backgroundColor: isPendingPayment ? '#f59e0b' : statusColor }}
      />

      {/* Nombre y número */}
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black text-white flex-shrink-0"
          style={{ backgroundColor: statusColor }}
        >
          {reservation.guest_name[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0 pr-4">
          <p className="text-slate-900 font-extrabold text-sm truncate leading-tight">{reservation.guest_name}</p>
          <p className="text-slate-550 text-[10px] font-mono font-bold mt-0.5">{reservation.reservation_number}</p>
        </div>
      </div>

      {/* Detalles */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1 border-t border-slate-100 pt-2">
        <div className="flex items-center gap-1.5 text-slate-700 text-xs font-bold">
          <Clock size={13} className="text-slate-400 shrink-0" />
          <span>{reservation.time.slice(0, 5)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-700 text-xs font-bold">
          <Users size={13} className="text-slate-400 shrink-0" />
          <span>{reservation.party_size} pers.</span>
        </div>
        {reservation.table && (
          <div className="flex items-center gap-1.5 text-slate-700 text-xs font-bold">
            <MapPin size={13} className="text-slate-400 shrink-0" />
            <span>Mesa {reservation.table.label}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border"
            style={{
              backgroundColor: isPendingPayment ? '#f59e0b10' : isOverdue ? '#f59e0b10' : statusColor + '10',
              borderColor: isPendingPayment ? '#f59e0b20' : isOverdue ? '#f59e0b20' : statusColor + '20',
              color: isPendingPayment ? '#d97706' : isOverdue ? '#d97706' : statusColor,
            }}
          >
            {isPendingPayment 
              ? '⚠️ Pendiente de Pago' 
              : isOverdue 
                ? '⚠️ Atrasada / En Espera' 
                : getStatusLabel(reservation.status)}
          </span>
          {reservation.status === 'seated' && timer.isRunning && (
            <span className={cn(
              "px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-black tracking-wider border flex items-center gap-1 shadow-sm",
              timer.isOvertime 
                ? "bg-red-50 border-red-300 text-red-650 animate-pulse font-black" 
                : "bg-emerald-50 border-emerald-300 text-emerald-650 font-black"
            )}>
              ⏱️ {timer.elapsedFormatted}
            </span>
          )}
        </div>
        {reservation.waiter && (
          <div className="flex items-center gap-2 text-xs col-span-2 pt-2 border-t border-slate-100 mt-1">
            <span 
              className="w-2.5 h-2.5 rounded-full border border-white" 
              style={{ backgroundColor: reservation.waiter.color }}
            />
            <span className="text-slate-500 font-bold">Camarero:</span>
            <span className="text-slate-900 font-black">{reservation.waiter.name}</span>
          </div>
        )}
        {reservation.is_prepayment && (
          <div className="col-span-2 pt-2 border-t border-slate-100 mt-1 flex flex-col gap-0.5 text-[10px] rounded-xl border p-2 bg-slate-50 border-slate-200">
            {reservation.payment_status === 'paid' ? (
              <>
                <span className="text-emerald-800 font-extrabold flex items-center gap-1">💵 Anticipo Cobrado: {reservation.prepayment_amount} €</span>
                <span className="text-slate-550 font-extrabold">⚠️ Descontar -{reservation.prepayment_amount} € del ticket final</span>
              </>
            ) : (
              <>
                <span className="text-amber-800 font-extrabold flex items-center gap-1">⏳ Esperando Anticipo: {reservation.prepayment_amount} €</span>
                {reservation.prepayment_reason && (
                  <span className="text-slate-500 font-bold italic text-[9px] truncate">Motivo: {reservation.prepayment_reason}</span>
                )}
              </>
            )}
          </div>
        )}
        {reservation.notes && (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              setIsNotesExpanded(!isNotesExpanded);
            }}
            className="text-[11px] col-span-2 pt-2 border-t border-slate-100 mt-1 cursor-pointer hover:bg-slate-100 p-1.5 rounded-xl transition-all flex items-start gap-1.5"
          >
            <MessageSquare size={13} className="text-blue-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-slate-500 font-bold">Obs: </span>
              <span className={cn(
                "text-slate-700 font-semibold font-serif italic break-words",
                !isNotesExpanded && "line-clamp-2"
              )}>
                {reservation.notes}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Botones de acción rápida para iniciar/cancelar (Botones Grandes) */}
      {showActions && (() => {
        const isReservationToday = reservation.date === todayStr;
        const isTodayOrFuture = reservation.date >= todayStr;

        return (
          <div className="flex flex-col gap-2 pt-2 border-t border-slate-150 mt-1">
            <div className="flex gap-2.5">
              {isReservationToday && (
                <button
                  onClick={handleSeatClick}
                  className="flex-1 py-2 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black transition-all text-center cursor-pointer border border-emerald-600"
                >
                  ✓ Sentar Cliente
                </button>
              )}
              <button
                onClick={handleCancelClick}
                className="flex-1 py-2 px-2.5 rounded-xl bg-slate-100 hover:bg-red-50 border border-slate-300 hover:border-red-200 text-slate-700 hover:text-red-750 text-[10px] font-black transition-all text-center cursor-pointer"
              >
                ✕ Cancelar
              </button>
            </div>
            {isTodayOrFuture && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openModal(reservation);
                }}
                className="w-full py-2 px-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-black transition-all text-center cursor-pointer flex items-center justify-center gap-1"
              >
                📅 Cambiar Fecha
              </button>
            )}
          </div>
        );
      })()}

      {/* Botón de confirmación manual de pago Bizum/Efectivo */}
      {isPendingPayment && !isDashboardPast && (
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-150 mt-1">
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (window.confirm(`¿Confirmar que has recibido el Bizum/Pago de ${reservation.prepayment_amount} € de ${reservation.guest_name} y confirmar esta reserva?`)) {
                await updateReservation(reservation.id, {
                  payment_status: 'paid',
                  status: 'confirmed'
                });
                toast.success("Pago confirmado y reserva activada.");
              }
            }}
            className="w-full py-2 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black transition-all text-center cursor-pointer border border-emerald-650 flex items-center justify-center gap-1.5 shadow-sm"
          >
            <span>✓ Confirmar Pago Recibido (Bizum/Efectivo)</span>
          </button>
          <button
            onClick={handleCancelClick}
            className="w-full py-2 px-2.5 rounded-xl bg-slate-100 hover:bg-red-50 border border-slate-350 hover:border-red-200 text-slate-700 hover:text-red-750 text-[10px] font-black transition-all text-center cursor-pointer"
          >
            ✕ Cancelar Reserva
          </button>
        </div>
      )}

      {/* Botones de acción rápida para finalizar servicio */}
      {showSeatedActions && (
        <div className="flex gap-2.5 pt-2 border-t border-slate-150 mt-1">
          <button
            onClick={handleCompleteClick}
            className="flex-1 py-2 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-750 text-white text-[10px] font-black transition-all text-center cursor-pointer border border-blue-600 flex items-center justify-center gap-1"
          >
            ✓ Finalizar Servicio
          </button>
        </div>
      )}
    </motion.div>
  );
}
