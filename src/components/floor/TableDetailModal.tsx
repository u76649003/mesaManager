'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { useReservationStore } from '@/stores/useReservationStore';
import { useTableTimer } from '@/hooks/useTableTimer';
import { getStatusLabel, getStatusColor, cn } from '@/lib/utils';
import { X, Clock, Users, CheckCircle2, Trash2, CalendarPlus, RefreshCw } from 'lucide-react';
import type { Table } from '@/types';
import { format } from 'date-fns';

interface TableDetailModalProps {
  table: Table | null;
  onClose: () => void;
}

export function TableDetailModal({ table, onClose }: TableDetailModalProps) {
  const { seatTable, clearTable, setTableStatus, deleteTable, mode, updateTable, tableGroups } = useFloorStore();
  const { openModal, reservations, updateReservation, selectedDate } = useReservationStore();

  const { elapsedFormatted, hours, minutes, isOvertime, isRunning } = useTableTimer(
    table?.id ?? '',
    90
  );

  if (!table) return null;

  const isToday = selectedDate === format(new Date(), 'yyyy-MM-dd');
  const statusColor = getStatusColor(table.status);

  const handleSeat = async () => {
    const targetTableIds = [table.id];

    // Find and complete any other seated reservations on this table
    const activeResOnTables = reservations.filter(
      (r) => r.status === 'seated' && 
             ((r.table_id && targetTableIds.includes(r.table_id)) || 
              (r.group_id && tableGroups.find((g) => g.id === r.group_id)?.member_table_ids.some(tid => targetTableIds.includes(tid))))
    );

    for (const oldRes of activeResOnTables) {
      await updateReservation(oldRes.id, { status: 'completed' });
    }

    if (table.current_reservation) {
      await seatTable(table.id, table.current_reservation.id);
      await updateReservation(table.current_reservation.id, { status: 'seated' });
    } else {
      await seatTable(table.id);
    }
    onClose();
  };

  const handleClear = () => {
    clearTable(table.id);
    onClose();
  };

  const handleSetCleaning = () => {
    setTableStatus(table.id, 'cleaning');
    onClose();
  };

  const handleSetAvailable = () => {
    setTableStatus(table.id, 'available');
    onClose();
  };

  const handleDelete = async () => {
    if (window.confirm(`¿Estás seguro de que quieres eliminar la Mesa ${table.label}?`)) {
      await deleteTable(table.id);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {table && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 15 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white border-2 border-slate-350 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
              {/* Header con color de estado sólido */}
              <div
                className="relative p-5 pb-4 flex items-center gap-4"
                style={{
                  background: `${statusColor}08`,
                  borderBottom: `2px solid #e2e8f0`,
                }}
              >
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 hover:text-slate-900 border-2 border-slate-200 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>

                {/* Icono de la mesa */}
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm bg-white shrink-0 border-3"
                  style={{
                    borderColor: statusColor,
                    borderRadius: table.table_type?.shape === 'circle' ? '50%' : '16px',
                  }}
                >
                  <span className="text-slate-900 font-black text-2xl" style={{ fontFamily: 'var(--font-title)' }}>
                    {table.label}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  {mode === 'edit' ? (
                    <div className="space-y-1.5 pr-8">
                      <label className="text-[9px] font-black text-slate-550 uppercase tracking-wider block">Nombre</label>
                      <input
                        type="text"
                        value={table.label}
                        onChange={(e) => updateTable(table.id, { label: e.target.value })}
                        className="w-full px-3.5 py-2 bg-white border-2 border-slate-300 rounded-xl text-slate-900 font-bold text-sm focus:outline-none focus:border-blue-600 transition-all"
                      />
                      <label className="text-[9px] font-black text-slate-550 uppercase tracking-wider block mt-1">Capacidad</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={table.capacity ?? table.table_type?.capacity ?? 4}
                        onChange={(e) => updateTable(table.id, { capacity: Number(e.target.value) })}
                        className="w-full px-3.5 py-2 bg-white border-2 border-slate-300 rounded-xl text-slate-900 font-bold text-sm focus:outline-none focus:border-blue-600 transition-all"
                      />
                    </div>
                  ) : (
                    <>
                      <h2 className="text-slate-900 font-black text-xl tracking-tight leading-tight" style={{ fontFamily: 'var(--font-title)' }}>
                        Mesa {table.label}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <div
                          className="w-2.5 h-2.5 rounded-full shadow-sm"
                          style={{ backgroundColor: statusColor }}
                        />
                        <span className="text-xs font-black uppercase tracking-wider" style={{ color: statusColor }}>
                          {getStatusLabel(table.status)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-slate-600 text-sm font-bold">
                        <Users size={14} className="text-slate-400 shrink-0" />
                        <span>{table.capacity ?? table.table_type?.capacity ?? 4} personas</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Timer (solo cuando está ocupada) */}
              {isRunning && (
                <div
                  className={cn(
                    'mx-4 mt-4 p-4 rounded-2xl border-2 backdrop-blur-md shadow-sm',
                    isOvertime
                      ? 'bg-red-50 border-red-300 text-red-900'
                      : 'bg-slate-50 border-slate-200'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Clock size={16} className={isOvertime ? 'text-red-650' : 'text-slate-650'} />
                    <span className="text-xs font-bold text-slate-600">
                      {isOvertime ? '⚠️ Tiempo de Mesa Excedido' : 'Tiempo en servicio'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'text-4xl font-mono font-black tracking-tight',
                        isOvertime ? 'text-red-700' : 'text-slate-900'
                      )}
                    >
                      {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
                    </span>
                    <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">h:min</span>
                  </div>
                  <p className="text-slate-500 text-xs mt-1 font-semibold">
                    {isOvertime
                      ? 'Ha superado el límite recomendado de 90 minutos.'
                      : 'Límite estimado de atención: 90 minutos.'}
                  </p>
                </div>
              )}

              {/* Reserva actual y Camarero asignado */}
              {table.current_reservation && (
                <div className="mx-4 mt-3.5 p-4 bg-slate-50 rounded-2xl border-2 border-slate-200 shadow-sm">
                  <p className="text-slate-500 text-[10px] uppercase font-black tracking-wider mb-1.5">Reserva Activa</p>
                  <p className="text-slate-900 font-extrabold text-sm leading-tight">{table.current_reservation.guest_name}</p>
                  <p className="text-slate-600 text-xs font-bold mt-0.5">
                    Hora: {table.current_reservation.time.slice(0, 5)} · Comensales: {table.current_reservation.party_size}
                  </p>
                  
                  {table.current_reservation.waiter && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200 flex items-center gap-2">
                      <span 
                        className="w-2.5 h-2.5 rounded-full border border-white" 
                        style={{ backgroundColor: table.current_reservation.waiter.color }}
                      />
                      <span className="text-slate-500 text-xs font-bold">Atendido por:</span>
                      <span className="text-slate-900 text-xs font-black">{table.current_reservation.waiter.name}</span>
                    </div>
                  )}

                  {table.current_reservation.is_prepayment && (table.current_reservation.prepayment_amount ?? 0) > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1 text-[11px] text-emerald-800 font-bold bg-emerald-50/50 p-2.5 rounded-xl border border-emerald-200">
                      <p className="flex items-center gap-1 font-black">
                        💵 Anticipo Cobrado: {table.current_reservation.prepayment_amount} €
                      </p>
                      <p className="text-slate-500 font-extrabold text-[10px]">
                        ⚠️ Descontar <strong className="text-slate-950">-{table.current_reservation.prepayment_amount} €</strong> en el ticket final.
                      </p>
                      {table.current_reservation.prepayment_reason && (
                        <p className="text-slate-450 italic text-[9px] mt-0.5 leading-none">Motivo: {table.current_reservation.prepayment_reason}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Acciones principales - Botones Grandes */}
              <div className="p-4 space-y-2.5">
                {mode === 'edit' ? (
                  <>
                    <ActionButton
                      icon={<CheckCircle2 size={18} />}
                      label="Actualizar Mesa"
                      color="indigo"
                      onClick={onClose}
                    />
                    <ActionButton
                      icon={<Trash2 size={18} />}
                      label="Eliminar Mesa del Plano"
                      color="red"
                      onClick={handleDelete}
                    />
                  </>
                ) : (
                  <>
                    {table.status === 'available' && (
                      <>
                        {isToday && (
                          <ActionButton
                            icon={<CheckCircle2 size={18} />}
                            label="Sentar Clientes Ahora"
                            color="indigo"
                            onClick={handleSeat}
                          />
                        )}
                        <ActionButton
                          icon={<CalendarPlus size={18} />}
                          label="Crear Nueva Reserva"
                          color="slate"
                          onClick={() => { openModal(undefined, table.id); onClose(); }}
                        />
                      </>
                    )}

                    {table.status === 'occupied' && (
                      <>
                        <ActionButton
                          icon={<CheckCircle2 size={18} />}
                          label="Liberar y Limpiar Mesa"
                          color="emerald"
                          onClick={handleClear}
                        />
                        <ActionButton
                          icon={<RefreshCw size={18} />}
                          label="Cambiar a Limpieza"
                          color="violet"
                          onClick={handleSetCleaning}
                        />
                      </>
                    )}

                    {table.status === 'reserved' && (
                      isToday ? (
                        <ActionButton
                          icon={<CheckCircle2 size={18} />}
                          label="Sentar Clientes (Confirmar Llegada)"
                          color="indigo"
                          onClick={handleSeat}
                        />
                      ) : (
                        <div className="text-xs text-slate-500 font-bold text-center py-3 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                          Solo se pueden sentar clientes el día de hoy
                        </div>
                      )
                    )}

                    {table.status === 'cleaning' && (
                      <ActionButton
                        icon={<CheckCircle2 size={18} />}
                        label="Marcar como Disponible"
                        color="emerald"
                        onClick={handleSetAvailable}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function ActionButton({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: 'indigo' | 'emerald' | 'violet' | 'red' | 'slate';
  onClick: () => void;
}) {
  const colors = {
    indigo:  'bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600 shadow-md shadow-blue-600/10 py-3.5 rounded-2xl text-sm font-black',
    emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-emerald-600 shadow-md shadow-emerald-600/10 py-3.5 rounded-2xl text-sm font-black',
    violet:  'bg-violet-650 hover:bg-violet-750 text-white border-2 border-violet-650 shadow-md shadow-violet-600/10 py-3.5 rounded-2xl text-sm font-black',
    red:     'bg-red-600 hover:bg-red-700 text-white border-2 border-red-600 shadow-md shadow-red-600/10 py-3.5 rounded-2xl text-sm font-black',
    slate:   'bg-slate-100 hover:bg-slate-200 text-slate-800 border-2 border-slate-300 py-3.5 rounded-2xl text-sm font-black',
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-center gap-3 px-5 transition-all cursor-pointer',
        colors[color]
      )}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}
