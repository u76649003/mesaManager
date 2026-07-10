'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { useReservationStore } from '@/stores/useReservationStore';
import { useFloorStore } from '@/stores/useFloorStore';
import { X, User, Phone, Mail, Users, Calendar, Clock, FileText, LayoutGrid, AlertTriangle, Map, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TableGroup, Waiter } from '@/types';
import { createClient } from '@/lib/supabase/client';

interface FormValues {
  guest_name:       string;
  guest_phone:      string;
  guest_email:      string;
  party_size:       number;
  date:             string;
  time:             string;
  duration_minutes: number;
  shift_id:         string;
  waiter_id:        string;
  notes:            string;
  send_email:       boolean;
  is_prepayment:    boolean;
  prepayment_amount:number;
  prepayment_reason:string;
  payment_method:   'online' | 'bizum';
  bizum_phone:      string;
  bizum_name:       string;
}

export function ReservationModal() {
  const {
    isModalOpen,
    editingReservation,
    prefillTableIds,
    selectedDate,
    selectedTime,
    shifts,
    reservations,
    closeModal,
    addReservation,
    updateReservation,
    removeReservation,
  } = useReservationStore();

  const { rooms, tables, tableGroups, mergeTables, splitGroup } = useFloorStore();

  // Local state for selecting multiple tables (joining)
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [createdPrepaymentRes, setCreatedPrepaymentRes] = useState<any>(null);

  useEffect(() => {
    const fetchWaiters = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data } = await supabase
          .from('waiters')
          .select('*')
          .eq('is_active', true)
          .order('name', { ascending: true });
        setWaiters(data || []);
      } catch (err) {
        console.error('Error fetching waiters for modal:', err);
      }
    };
    if (isModalOpen) {
      fetchWaiters();
    }
  }, [isModalOpen]);
  const [showMultiTableSelector, setShowMultiTableSelector] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      date:             selectedDate,
      duration_minutes: 90,
      party_size:       2,
      guest_name:       '',
      guest_phone:      '',
      guest_email:      '',
      time:             useReservationStore.getState().selectedTime || '',
      shift_id:         '',
      waiter_id:        '',
      notes:            '',
      send_email:       false,
      is_prepayment:    false,
      prepayment_amount: 20,
      prepayment_reason: '',
      payment_method:   'online',
      bizum_phone:      '600000000',
      bizum_name:       'La Terrazza Restaurant',
    },
  });

  const partySize = watch('party_size') || 2;
  const watchShiftId = watch('shift_id');
  const watchTime = watch('time');

  useEffect(() => {
    if (watchShiftId) {
      const shift = shifts.find((s) => s.id === watchShiftId);
      if (shift) {
        // Check if current time is within shift range
        const [sh, sm] = shift.start_time.split(':').map(Number);
        const [eh, em] = shift.end_time.split(':').map(Number);
        const startMin = sh * 60 + sm;
        let endMin = eh * 60 + em;
        if (endMin <= startMin) endMin += 1440;

        if (watchTime) {
          const [th, tm] = watchTime.split(':').map(Number);
          const timeMin = th * 60 + tm;
          const isWithin = timeMin >= startMin && timeMin <= endMin;
          if (!isWithin) {
            setValue('time', shift.start_time);
          }
        } else {
          setValue('time', shift.start_time);
        }
      }
    }
  }, [watchShiftId, setValue, shifts]);

  // Initialize form and local selected tables
  useEffect(() => {
    let initialTables: string[] = [];

    if (editingReservation) {
      reset({
        guest_name:       editingReservation.guest_name,
        guest_phone:      editingReservation.guest_phone ?? '',
        guest_email:      editingReservation.guest_email ?? '',
        party_size:       editingReservation.party_size,
        date:             editingReservation.date,
        time:             editingReservation.time,
        duration_minutes: editingReservation.duration_minutes,
        shift_id:         editingReservation.shift_id ?? '',
        waiter_id:        editingReservation.waiter_id ?? '',
        notes:            editingReservation.notes ?? '',
        send_email:       editingReservation.send_email ?? false,
        is_prepayment:    editingReservation.is_prepayment ?? false,
        prepayment_amount:editingReservation.prepayment_amount ?? 20,
        prepayment_reason:editingReservation.prepayment_reason ?? '',
        payment_method:   editingReservation.payment_method ?? 'online',
        bizum_phone:      editingReservation.bizum_phone ?? '600000000',
        bizum_name:       editingReservation.bizum_name ?? 'La Terrazza Restaurant',
      });

      // Load existing table IDs
      if (editingReservation.group_id) {
        const group = tableGroups.find((g) => g.id === editingReservation.group_id);
        initialTables = group ? group.member_table_ids : [];
        setSelectedTables(initialTables);
        setShowMultiTableSelector(true);
      } else if (editingReservation.table_id) {
        initialTables = [editingReservation.table_id];
        setSelectedTables(initialTables);
        setShowMultiTableSelector(false);
      } else {
        initialTables = [];
        setSelectedTables([]);
      }
    } else {
      reset({
        date:             selectedDate,
        duration_minutes: 90,
        party_size:       2,
        guest_name:       '',
        guest_phone:      '',
        guest_email:      '',
        time:             selectedTime || '',
        shift_id:         '',
        waiter_id:        '',
        notes:            '',
        send_email:       false,
        is_prepayment:    false,
        prepayment_amount: 20,
        prepayment_reason: '',
        payment_method:   'online',
        bizum_phone:      '600000000',
        bizum_name:       'La Terrazza Restaurant',
      });

      // Load prefilled tables from store
      if (prefillTableIds && prefillTableIds.length > 0) {
        initialTables = prefillTableIds;
        setSelectedTables(prefillTableIds);
        setShowMultiTableSelector(prefillTableIds.length > 1);
      } else {
        initialTables = [];
        setSelectedTables([]);
        setShowMultiTableSelector(false);
      }
    }

    // Auto set the active room ID based on selected tables
    let defaultRoomId = '';
    if (initialTables.length > 0) {
      const t = tables.find((tab) => tab.id === initialTables[0]);
      if (t) defaultRoomId = t.room_id;
    }

    if (!defaultRoomId) {
      defaultRoomId = 
        useReservationStore.getState().selectedRoomId || (rooms.length > 0 ? rooms[0].id : '');
    }
    setActiveRoomId(defaultRoomId);

  }, [editingReservation, prefillTableIds, isModalOpen, reset, selectedDate, tables, rooms, tableGroups]);

  // Set the correct shift when duration or time changes
  const watchDate = watch('date');
  const watchIsPrepayment = watch('is_prepayment');
  const watchPrefillEmail = watch('guest_email');
  const watchPaymentMethod = watch('payment_method');

  useEffect(() => {
    if (!watchTime || !shifts || shifts.length === 0) return;
    
    // Find matching shift
    const matchingShift = shifts.find((s) => {
      if (!s.is_active) return false;
      return watchTime >= s.start_time && watchTime <= s.end_time;
    });

    if (matchingShift) {
      setValue('shift_id', matchingShift.id);
    }
  }, [watchTime, shifts, setValue]);

  // Update party_size default value based on selected tables capacity sum
  useEffect(() => {
    if (!editingReservation && selectedTables.length > 0) {
      const sumCapacity = selectedTables.reduce((sum, id) => {
        const table = tables.find((t) => t.id === id);
        const cap = table ? (table.capacity ?? table.table_type?.capacity ?? 4) : 0;
        return sum + cap;
      }, 0);
      
      if (sumCapacity > 0) {
        setValue('party_size', sumCapacity);
      }
    }
  }, [selectedTables, tables, setValue, editingReservation]);

  // Handle room selector changes
  const handleRoomChange = (roomId: string) => {
    setActiveRoomId(roomId);
    
    // If the room changes, we must deselect tables from other rooms
    const filtered = selectedTables.filter((tid) => {
      const tab = tables.find((t) => t.id === tid);
      return tab && tab.room_id === roomId;
    });
    setSelectedTables(filtered);
  };

  // Select / Deselect table logic
  const toggleTableSelection = (tableId: string) => {
    const exists = selectedTables.includes(tableId);
    if (exists) {
      setSelectedTables(selectedTables.filter((id) => id !== tableId));
    } else {
      setSelectedTables([...selectedTables, tableId]);
    }
  };

  const handleSingleTableSelect = (tableId: string) => {
    setSelectedTables([tableId]);
  };

  const handleClose = () => {
    setCreatedPrepaymentRes(null);
    closeModal();
  };

  const onSubmit = async (data: FormValues) => {
    // Table selection is optional - reservation can exist without a table
    if (selectedTables.length === 0) {
      // Proceed without table assignment
    }

    let finalTableId: string | undefined = undefined;
    let finalGroupId: string | undefined = undefined;

    // Check if we need to merge tables
    if (selectedTables.length > 1) {
      const labels = tables
        .filter((t) => selectedTables.includes(t.id))
        .map((t) => t.label)
        .join('+');
      await mergeTables(selectedTables, labels);
      const updatedGroups = useFloorStore.getState().tableGroups;
      const newGroup = updatedGroups.find((g) =>
        g.member_table_ids.length === selectedTables.length &&
        selectedTables.every((id) => g.member_table_ids.includes(id))
      );
      finalGroupId = newGroup?.id;
    } else if (selectedTables.length === 1) {
      finalTableId = selectedTables[0];
    }

    const firstTable = tables.find((t) => selectedTables.includes(t.id));
    const targetRoomId = firstTable?.room_id || useReservationStore.getState().selectedRoomId || undefined;

    if (editingReservation) {
      if (editingReservation.group_id && editingReservation.group_id !== finalGroupId) {
        await splitGroup(editingReservation.group_id);
      }
      await updateReservation(editingReservation.id, {
        ...data,
        guest_phone: data.guest_phone || undefined,
        guest_email: data.guest_email || undefined,
        table_id:    finalTableId,
        group_id:    finalGroupId,
        room_id:     targetRoomId,
        waiter_id:   data.waiter_id || null,
        send_email:  data.send_email,
        is_prepayment: data.is_prepayment,
        prepayment_amount: data.prepayment_amount,
        prepayment_reason: data.prepayment_reason,
        payment_method:   data.payment_method,
        bizum_phone:      data.bizum_phone,
        bizum_name:       data.bizum_name,
      });
      handleClose();
    } else {
      const prepaymentRequired = data.is_prepayment;
      
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', userData.user.id)
        .single();
      if (!profile) return;

      const sanitized: any = {
        guest_name:       data.guest_name,
        guest_phone:      data.guest_phone || null,
        guest_email:      data.guest_email || null,
        party_size:       data.party_size,
        date:             data.date,
        time:             data.time,
        duration_minutes: data.duration_minutes ?? 90,
        notes:            data.notes || null,
        status:           prepaymentRequired ? 'pending' : 'confirmed',
        table_id:         finalTableId || null,
        group_id:         finalGroupId || null,
        shift_id:         data.shift_id || null,
        room_id:          targetRoomId || null,
        tenant_id:        profile.tenant_id,
        send_email:       data.send_email,
        is_prepayment:    data.is_prepayment,
        prepayment_amount: data.prepayment_amount || 0,
        prepayment_reason: data.prepayment_reason || null,
        payment_status:   prepaymentRequired ? 'pending' : 'no_payment_required',
      };

      if (data.is_prepayment) {
        sanitized.payment_method = data.payment_method;
        sanitized.bizum_phone = data.bizum_phone || null;
        sanitized.bizum_name = data.bizum_name || null;
      }

      if (data.waiter_id) {
        sanitized.waiter_id = data.waiter_id;
      }

      let insertedData: any = null;
      let error: any = null;

      const result = await supabase
        .from('reservations')
        .insert(sanitized)
        .select('*, room:rooms(*), shift:shifts(*), table:tables!reservations_table_id_fkey(*), waiter:waiters(*)')
        .single();
      
      insertedData = result.data;
      error = result.error;

      if (error && (
        error.message.includes('is_prepayment') ||
        error.message.includes('prepayment') ||
        error.message.includes('payment_status') ||
        error.message.includes('bizum') ||
        error.message.includes('schema cache') ||
        error.message.includes('column')
      )) {
        console.warn('Falling back insert without prepayment columns in modal...');
        const fallbackSanitized = { ...sanitized };
        delete fallbackSanitized.is_prepayment;
        delete fallbackSanitized.prepayment_amount;
        delete fallbackSanitized.prepayment_reason;
        delete fallbackSanitized.payment_status;
        delete fallbackSanitized.payment_method;
        delete fallbackSanitized.bizum_phone;
        delete fallbackSanitized.bizum_name;
        delete fallbackSanitized.send_email;

        const retryResult = await supabase
          .from('reservations')
          .insert(fallbackSanitized)
          .select('*, room:rooms(*), shift:shifts(*), table:tables!reservations_table_id_fkey(*), waiter:waiters(*)')
          .single();
        insertedData = retryResult.data;
        error = retryResult.error;
      }

      if (error) {
        toast.error('Error al guardar la reserva: ' + error.message);
        return;
      }

      // Add to store
      useReservationStore.setState((state) => ({
        reservations: [insertedData, ...state.reservations]
      }));

      // Trigger visual email simulation
      if (data.send_email && data.guest_email) {
        if (prepaymentRequired) {
          toast.success(`📧 Correo enviado a ${data.guest_email} solicitando pre-pago de ${data.prepayment_amount} €`);
        } else {
          toast.success(`📧 Correo enviado a ${data.guest_email} confirmando la reserva.`);
        }
      }

      if (prepaymentRequired) {
        setCreatedPrepaymentRes(insertedData);
      } else {
        handleClose();
      }
    }
  };

  const inputCls = (hasError: boolean) =>
    cn(
      'w-full px-4 py-3 rounded-2xl bg-white border-2 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none transition-all font-bold',
      hasError
        ? 'border-red-500 focus:ring-4 focus:ring-red-100 focus:border-red-650'
        : 'border-slate-300 focus:ring-4 focus:ring-blue-100 focus:border-blue-600 hover:border-slate-450'
    );

  const getTableDimensions = (cap: number) => {
    if (cap <= 2) return { width: 55, height: 55 };
    if (cap <= 4) return { width: 70, height: 70 };
    if (cap <= 6) return { width: 95, height: 65 };
    return { width: 110, height: 70 };
  };

  const getTimeSlotsForModal = () => {
    if (!shifts || shifts.length === 0) return [];
    
    const slots: string[] = [];
    // If a specific shift is selected, only generate slots for that shift!
    const activeShifts = watchShiftId
      ? shifts.filter((s) => s.id === watchShiftId && s.is_active)
      : shifts.filter((s) => s.is_active);

    activeShifts.forEach((shift) => {
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
        if (!slots.includes(timeStr)) {
          slots.push(timeStr);
        }
      }
    });
    
    return slots.sort();
  };

  const timeSlots = getTimeSlotsForModal();

  const isDateClosed = (dateStr: string) => {
    if (!shifts || shifts.length === 0) return false;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return false;
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    const date = new Date(y, m, d);
    const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    const dayOfWeek = day === 0 ? 7 : day;
    
    const activeShifts = shifts.filter((s) => s.is_active);
    if (activeShifts.length === 0) return false;
    
    return !activeShifts.some((s) => s.days_of_week.includes(dayOfWeek));
  };

  const isTimeSlotFullyBooked = (dateStr: string, timeB: string) => {
    if (!tables || tables.length === 0) return false;
    const totalActiveTables = tables.filter((t) => t.is_active).length;
    if (totalActiveTables === 0) return false;

    const getMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const isTimeOverlap = (timeA: string, durationMin: number, timeC: string) => {
      const minA = getMinutes(timeA);
      const minC = getMinutes(timeC);
      return minC >= minA && minC < minA + durationMin;
    };

    const occupiedIds = new Set<string>();
    
    reservations.forEach((r) => {
      if (r.date !== dateStr) return;
      if (!['confirmed', 'pending', 'seated'].includes(r.status)) return;
      if (editingReservation && r.id === editingReservation.id) return;

      const duration = r.duration_minutes || 90;
      if (isTimeOverlap(r.time, duration, timeB)) {
        if (r.table_id) {
          occupiedIds.add(r.table_id);
        } else if (r.group_id) {
          const group = tableGroups.find((g) => g.id === r.group_id);
          if (group) {
            group.member_table_ids.forEach((id) => occupiedIds.add(id));
          }
        }
      }
    });

    return occupiedIds.size >= totalActiveTables;
  };

  const isClosedDaySelected = watchDate ? isDateClosed(watchDate) : false;

  const renderSuccessContent = () => {
    if (!createdPrepaymentRes) return null;
    const isBizum = createdPrepaymentRes.payment_method === 'bizum';
    return (
      <div className="p-6 text-center space-y-5 bg-white max-h-[75vh] overflow-y-auto">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600 shadow-inner">
          <CheckCircle size={32} />
        </div>
        <div>
          <h3 className="text-slate-900 font-black text-xl">¡Reserva Registrada!</h3>
          <p className="text-slate-550 text-xs font-bold mt-1">
            La reserva está <span className="text-amber-600 font-extrabold uppercase">pendiente de pago</span> ({isBizum ? 'Bizum' : 'Tarjeta'})
          </p>
        </div>

        <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4.5 text-left space-y-3.5 shadow-sm text-xs font-bold text-slate-700">
          <div className="flex justify-between border-b border-slate-250 pb-2">
            <span className="text-slate-455">CLIENTE</span>
            <span className="text-slate-900 font-black">{createdPrepaymentRes.guest_name}</span>
          </div>
          <div className="flex justify-between border-b border-slate-250 pb-2">
            <span className="text-slate-455">FECHA Y HORA</span>
            <span className="text-slate-900 font-black">{createdPrepaymentRes.date} a las {createdPrepaymentRes.time.slice(0,5)} hs</span>
          </div>
          <div className="flex justify-between border-b border-slate-250 pb-2">
            <span className="text-slate-455">IMPORTE SOLICITADO</span>
            <span className="text-blue-600 font-black text-sm">{createdPrepaymentRes.prepayment_amount} €</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-455">MOTIVO</span>
            <span className="text-slate-900 font-black truncate max-w-[180px]">{createdPrepaymentRes.prepayment_reason || 'Pago por adelantado'}</span>
          </div>
        </div>

        {isBizum ? (
          <div className="p-4 bg-amber-50 border border-amber-250 rounded-2xl text-[11px] text-amber-900 text-left font-semibold space-y-2">
            <p className="font-black text-xs text-amber-800 flex items-center gap-1">📲 Instrucciones de Bizum:</p>
            <div className="bg-white p-3 rounded-xl border border-amber-200 font-bold space-y-1.5 text-slate-750 shadow-sm font-mono text-[10px]">
              <p>📱 Enviar a: <span className="text-slate-950 font-black">{createdPrepaymentRes.bizum_phone || '600 00 00 00'}</span></p>
              <p>👤 Beneficiario: <span className="text-slate-950 font-black">{createdPrepaymentRes.bizum_name || 'La Terrazza Restaurant'}</span></p>
              <p>📝 Concepto: <span className="text-slate-950 font-black">{createdPrepaymentRes.guest_name} ({createdPrepaymentRes.reservation_number})</span></p>
              <p>💰 Importe: <span className="text-emerald-700 font-black">{createdPrepaymentRes.prepayment_amount} €</span></p>
            </div>
            <p className="text-[10px] text-slate-500 pt-1 leading-normal font-bold">
              El cliente ha recibido estas instrucciones por correo electrónico. Cuando te envíe el Bizum, confirma el pago manualmente en la lista lateral para activar la reserva.
            </p>
          </div>
        ) : (
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-[11px] text-blue-750 text-left font-semibold space-y-1.5">
            <p className="font-black">📧 Enlace de pago enviado a:</p>
            <p className="font-mono bg-white px-2.5 py-1 rounded border border-blue-200 text-blue-800 break-all">{createdPrepaymentRes.guest_email}</p>
            <p className="text-[10px] text-slate-500 pt-1 leading-normal font-bold">
              El correo incluye el enlace de pago seguro. Una vez que el cliente realice el pago, la reserva se confirmará automáticamente y aparecerá en tu panel.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          {!isBizum && (
            <button
              type="button"
              onClick={() => window.open(`/payment/${createdPrepaymentRes.id}`, '_blank')}
              className="w-full py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-black rounded-xl transition-all text-xs cursor-pointer border border-blue-250 flex items-center justify-center gap-1 shadow-sm"
            >
              <span>🔗 Abrir Pasarela (Simular cliente)</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl transition-all text-sm shadow-md cursor-pointer border-2 border-blue-600"
          >
            Volver al panel principal
          </button>
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000]"
            onClick={closeModal}
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 15 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white border-2 border-slate-350 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b-2 border-slate-200 bg-slate-50">
                <div>
                  <h2 className="text-slate-900 font-black text-lg tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {editingReservation ? 'Editar reserva asignada' : 'Crear nueva reserva'}
                  </h2>
                  <p className="text-slate-500 text-xs font-bold mt-0.5">
                    Fecha actual: {format(new Date(), 'dd/MM/yyyy')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-9 h-9 rounded-xl bg-slate-100 border-2 border-slate-200 flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {createdPrepaymentRes ? renderSuccessContent() : (
                <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4.5 max-h-[75vh] overflow-y-auto bg-white">
                {/* Nombre */}
                <Field label="Nombre del cliente (Obligatorio)" icon={<User size={15} />} error={errors.guest_name?.message}>
                  <input
                    {...register('guest_name', { required: 'Obligatorio', minLength: { value: 2, message: 'Mínimo 2 letras' } })}
                    placeholder="Ej. María García"
                    className={inputCls(!!errors.guest_name)}
                  />
                </Field>

                {/* Teléfono y Email */}
                <div className="grid grid-cols-2 gap-3.5">
                  <Field label="Teléfono (Opcional)" icon={<Phone size={15} />}>
                    <input
                      {...register('guest_phone')}
                      placeholder="+34 600 000 000"
                      className={inputCls(false)}
                    />
                  </Field>
                  <Field label={watchIsPrepayment ? "Correo electrónico (OBLIGATORIO)" : "Correo electrónico (Opcional)"} icon={<Mail size={15} />} error={errors.guest_email?.message}>
                    <input
                      {...register('guest_email', {
                        required: watchIsPrepayment ? 'El correo es obligatorio si solicita pre-pago' : false,
                        pattern: { value: /^[^@]+@[^@]+\.[^@]+$/, message: 'Formato incorrecto (ejemplo@web.com)' },
                      })}
                      type="email"
                      placeholder="email@ejemplo.es"
                      className={inputCls(!!errors.guest_email)}
                    />
                  </Field>
                </div>

                {/* Personas, Fecha, Hora */}
                <div className="grid grid-cols-3 gap-3.5">
                  <Field label="Pax (Personas)" icon={<Users size={15} />}>
                    <input
                      {...register('party_size', { required: true, min: 1, max: 100, valueAsNumber: true })}
                      type="number"
                      min={1}
                      max={100}
                      className={inputCls(false)}
                    />
                  </Field>
                  <Field label="Fecha" icon={<Calendar size={15} />} error={errors.date?.message}>
                    <input
                      {...register('date', { required: 'Selecciona una fecha' })}
                      type="date"
                      className={inputCls(!!errors.date)}
                    />
                  </Field>
                  <Field label="Hora de llegada" icon={<Clock size={15} />} error={errors.time?.message}>
                    {timeSlots.length > 0 ? (
                      <select
                        {...register('time', { required: 'Selecciona una hora' })}
                        className={inputCls(!!errors.time)}
                      >
                        <option value="">Selecciona hora...</option>
                        {timeSlots.map((t) => {
                          const isFull = watchDate ? isTimeSlotFullyBooked(watchDate, t) : false;
                          return (
                            <option key={t} value={t} disabled={isFull}>
                              {t} {isFull ? ' (Completo - Sin mesas)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <input
                        {...register('time', { required: 'Selecciona una hora' })}
                        type="time"
                        className={inputCls(!!errors.time)}
                      />
                    )}
                  </Field>
                </div>

                {/* Turno y Duración */}
                <div className="grid grid-cols-2 gap-3.5">
                  <Field label="Tiempo en mesa (Duración)">
                    <select {...register('duration_minutes', { valueAsNumber: true })} className={inputCls(false)}>
                      {[60, 90, 120, 150, 180].map((m) => (
                        <option key={m} value={m}>{m} minutos</option>
                      ))}
                    </select>
                  </Field>
                  {shifts.length > 0 && (
                    <Field label="Servicio / Turno">
                      <select {...register('shift_id')} className={inputCls(false)}>
                        <option value="">Cualquier turno</option>
                        {shifts.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>

                {/* Camarero Asignado */}
                <div className="grid grid-cols-1 gap-3.5">
                  <Field label="Camarero de Servicio" icon={<User size={15} />}>
                    <select {...register('waiter_id')} className={inputCls(false)}>
                      <option value="">Sin camarero asignado</option>
                      {waiters.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* SECTOR DE SELECCIÓN DE MESAS (TACTIL & VISUAL) */}
                <div className="border-2 border-slate-200 rounded-3xl p-4.5 bg-slate-50 space-y-4.5 shadow-inner">
                  {/* Selector de Salón */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-slate-600">Paso 1: Selecciona el Salón</label>
                      {activeRoomId && (
                        <span className="text-[10px] text-blue-800 font-extrabold bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200 shadow-sm">
                          Zona: {rooms.find(r => r.id === activeRoomId)?.name || 'Salón'}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
                      {rooms.map((r) => {
                        const hasSelectedTablesInRoom = selectedTables.some(
                          (id) => tables.find((t) => t.id === id)?.room_id === r.id
                        );
                        const isSelected = activeRoomId === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => handleRoomChange(r.id)}
                            className={cn(
                              'px-4 py-2.5 rounded-xl border-2 text-xs font-black whitespace-nowrap transition-all cursor-pointer shrink-0',
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                : hasSelectedTablesInRoom
                                ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                            )}
                          >
                            {r.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selector de Mesas */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-slate-600">Paso 2: Pulsa para Elegir Mesa</label>
                      
                      {/* Modo de selección (Mapa o Lista) */}
                      <div className="flex rounded-lg bg-slate-200/80 p-0.5 gap-0.5 border border-slate-300">
                        {(['map', 'list'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setViewMode(m)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border',
                              viewMode === m
                                ? 'bg-white border-slate-350 text-slate-900 shadow-sm'
                                : 'bg-transparent border-transparent text-slate-600 hover:text-slate-900'
                            )}
                          >
                            {m === 'map' ? <Map size={11} className="inline mr-1" /> : <LayoutGrid size={11} className="inline mr-1" />}
                            {m === 'map' ? 'Mapa' : 'Lista'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Switch Unir Varias Mesas */}
                    <div className="flex items-center justify-between p-3.5 bg-white rounded-2xl border-2 border-slate-200">
                      <div>
                        <span className="text-slate-900 text-sm font-black block">Unir varias mesas para esta reserva</span>
                        <span className="text-[10px] text-slate-500 font-bold block mt-0.5">Permite pulsar y combinar múltiples mesas</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showMultiTableSelector}
                          onChange={(e) => {
                            setShowMultiTableSelector(e.target.checked);
                            if (!e.target.checked && selectedTables.length > 1) {
                              setSelectedTables([selectedTables[0]]);
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-6 bg-slate-200 border border-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-500 after:border-slate-500 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                      </label>
                    </div>

                    {/* Contenedor del mapa de sala / lista */}
                    <div className="h-[380px] relative border-2 border-slate-350 rounded-3xl overflow-hidden bg-slate-205/50 shadow-inner">
                      {viewMode === 'map' ? (
                        /* VISTA PLANO DE LA SALA */
                        (() => {
                          const activeRoom = rooms.find((r) => r.id === activeRoomId);
                          const roomTables = tables.filter((t) => t.is_active && t.room_id === activeRoomId);

                          if (!activeRoom) {
                            return (
                              <div className="h-full flex items-center justify-center text-slate-500 text-xs font-extrabold bg-white/40">
                                Selecciona un salón en el menú de arriba
                              </div>
                            );
                          }

                          return (
                            <div 
                              className="relative w-full h-full bg-slate-100 overflow-hidden shadow-inner select-none"
                              style={{
                                backgroundColor: activeRoom.background_color,
                                backgroundImage: activeRoom.background_image_url ? `url(${activeRoom.background_image_url})` : 'none',
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                              }}
                            >
                              {/* Overlay de plano */}
                              <div className="absolute inset-0 bg-white/10 backdrop-blur-[0.5px]" />

                              {/* Mesas del salón */}
                              {roomTables.map((table) => {
                                const isSelected = selectedTables.includes(table.id);
                                const cap = table.capacity ?? table.table_type?.capacity ?? 4;
                                const shape = table.table_type?.shape ?? 'square';
                                const { width: tW, height: tH } = getTableDimensions(cap);

                                // Convert coordinates to percentage positions
                                const leftPct = (table.position_x / 1200) * 100;
                                const topPct = (table.position_y / 800) * 100;
                                const widthPct = (tW / 1200) * 100;
                                const heightPct = (tH / 800) * 100;

                                const borderRadius = shape === 'circle' ? '50%' : shape === 'oval' ? '50%' : '8px';

                                return (
                                  <button
                                    key={table.id}
                                    type="button"
                                    onClick={() => {
                                      if (showMultiTableSelector) {
                                        toggleTableSelection(table.id);
                                      } else {
                                        handleSingleTableSelect(table.id);
                                      }
                                    }}
                                    style={{
                                      position: 'absolute',
                                      left: `${leftPct}%`,
                                      top: `${topPct}%`,
                                      width: `${widthPct}%`,
                                      height: `${heightPct}%`,
                                      transform: `rotate(${table.rotation || 0}deg)`,
                                      borderRadius,
                                    }}
                                    className={cn(
                                      "transition-all flex flex-col items-center justify-center border-2 text-[9px] font-black shadow-sm cursor-pointer",
                                      isSelected
                                        ? "bg-blue-600 border-blue-600 text-white font-black scale-105 z-25 shadow-md"
                                        : "bg-white border-slate-350 text-slate-800 hover:border-slate-400 hover:scale-105 hover:z-10"
                                    )}
                                    title={`Mesa ${table.label} (${cap}p)`}
                                  >
                                    <span className="leading-none font-black text-xs">{table.label}</span>
                                    <span className="leading-none text-[9.5px] opacity-80 mt-0.5">{cap}p</span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()
                      ) : (
                        /* VISTA LISTA DE BOTONES DE MESA */
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 p-3.5 max-h-full overflow-y-auto">
                          {tables
                            .filter((t) => t.is_active && t.room_id === activeRoomId)
                            .map((table) => {
                              const isSelected = selectedTables.includes(table.id);
                              const cap = table.capacity ?? table.table_type?.capacity ?? 2;
                              return (
                                <button
                                  type="button"
                                  key={table.id}
                                  onClick={() => {
                                    if (showMultiTableSelector) {
                                      toggleTableSelection(table.id);
                                    } else {
                                      handleSingleTableSelect(table.id);
                                    }
                                  }}
                                  className={cn(
                                    'p-3.5 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer text-xs font-bold',
                                    isSelected
                                      ? 'bg-blue-600 border-blue-600 text-white font-black shadow-md'
                                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                  )}
                                >
                                  <span className="font-extrabold">{table.label}</span>
                                  <span className="text-[9px] opacity-75 font-semibold">{cap} pers.</span>
                                </button>
                              );
                            })}
                          {tables.filter((t) => t.is_active && t.room_id === activeRoomId).length === 0 && (
                            <div className="col-span-full py-8 text-center text-slate-500 text-xs font-semibold">
                              No hay mesas creadas en este salón
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Resumen de mesas seleccionadas */}
                  {selectedTables.length > 0 && (
                    <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-blue-800 text-xs font-black">
                          {selectedTables.length} {selectedTables.length === 1 ? 'mesa seleccionada' : 'mesas seleccionadas'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTables([])}
                        className="text-xs text-blue-700 hover:text-blue-900 font-extrabold hover:underline cursor-pointer"
                      >
                        Limpiar selección
                      </button>
                    </div>
                  )}
                </div>

                {/* Notas */}
                <Field label="Notas o aclaraciones de la reserva" icon={<FileText size={15} />}>
                  <textarea
                    {...register('notes')}
                    placeholder="Ej. Alergias, trona para bebé, mesa cerca de la ventana..."
                    rows={2}
                    className={cn(inputCls(false), 'resize-none')}
                  />
                </Field>

                {/* Enviar Correo & Pre-pago Section */}
                <div className="bg-slate-50 border-2 border-slate-200 p-4.5 rounded-2xl space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        {...register('send_email')}
                        className="w-4 h-4 rounded text-blue-600 border-slate-350 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>📧 Enviar correo de confirmación</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        {...register('is_prepayment')}
                        className="w-4 h-4 rounded text-blue-600 border-slate-350 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>💳 Solicitar pago por adelantado (Pre-pago)</span>
                    </label>
                  </div>

                  {watchIsPrepayment && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="border-t-2 border-slate-200 pt-3.5 space-y-3.5"
                    >
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[10px] text-amber-800 font-black flex items-start gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600 animate-pulse" />
                        <span>
                          Al solicitar pre-pago, el correo electrónico se vuelve obligatorio. 
                          La reserva se guardará como pendiente y no aparecerá hasta que se complete el pago.
                        </span>
                      </div>

                      {/* Método de pago */}
                      <div className="space-y-1">
                        <label className="text-slate-700 font-extrabold text-xs">Método de cobro</label>
                        <select
                          {...register('payment_method')}
                          className="w-full px-4 py-3 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-600 transition-all cursor-pointer"
                        >
                          <option value="online">💳 Pasarela de Pago Online (Stripe)</option>
                          <option value="bizum">📲 Transferencia por Bizum</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3.5">
                        <Field label="Importe a solicitar (€)" icon={<span className="text-xs font-black">€</span>} error={errors.prepayment_amount?.message}>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="Ej. 20.00"
                            {...register('prepayment_amount', {
                              required: watchIsPrepayment ? 'Ingrese el importe' : false,
                              min: { value: 0.01, message: 'Mínimo 0.01 €' },
                              valueAsNumber: true,
                            })}
                            className={inputCls(!!errors.prepayment_amount)}
                          />
                        </Field>

                        <Field label="Motivo de la solicitud" icon={<FileText size={14} />} error={errors.prepayment_reason?.message}>
                          <input
                            type="text"
                            placeholder="Ej. Encargo de Arroz / Mesa Grande"
                            {...register('prepayment_reason', {
                              required: watchIsPrepayment ? 'Obligatorio' : false,
                            })}
                            className={inputCls(!!errors.prepayment_reason)}
                          />
                        </Field>
                      </div>

                      {watchPaymentMethod === 'bizum' && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="grid grid-cols-2 gap-3.5 border-t border-dashed border-slate-200 pt-3"
                        >
                          <Field label="Teléfono de Bizum" icon={<Phone size={13} />} error={errors.bizum_phone?.message}>
                            <input
                              type="text"
                              placeholder="Ej. 600000000"
                              {...register('bizum_phone', {
                                required: watchPaymentMethod === 'bizum' ? 'Número Bizum obligatorio' : false,
                              })}
                              className={inputCls(!!errors.bizum_phone)}
                            />
                          </Field>
                          <Field label="Nombre del Beneficiario" icon={<User size={13} />} error={errors.bizum_name?.message}>
                            <input
                              type="text"
                              placeholder="Ej. Juan Gómez"
                              {...register('bizum_name', {
                                required: watchPaymentMethod === 'bizum' ? 'Beneficiario obligatorio' : false,
                              })}
                              className={inputCls(!!errors.bizum_name)}
                            />
                          </Field>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </div>

                {isClosedDaySelected && (
                  <div className="p-3.5 bg-red-50 border-2 border-red-200 text-red-700 text-[11px] font-black rounded-2xl flex items-center gap-2 mt-1">
                    <span>🔴 El restaurante está cerrado (Día Libre) en esta fecha. Elija otro día.</span>
                  </div>
                )}

                {/* Botones */}
                <div className="space-y-2 pt-2">
                  <div className="flex gap-3.5">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 py-3.5 rounded-2xl border-2 border-slate-300 text-slate-700 bg-slate-100 hover:bg-slate-200 font-black text-sm transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <motion.button
                      type="submit"
                      disabled={isSubmitting || isClosedDaySelected}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex-1 py-3.5 rounded-2xl bg-blue-600 border-2 border-blue-600 text-white font-black text-sm shadow-md hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isSubmitting ? 'Guardando...' : editingReservation ? 'Actualizar Reserva' : 'Guardar y Confirmar'}
                    </motion.button>
                  </div>

                  {editingReservation && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm('¿Estás seguro de que deseas eliminar esta reserva por completo?')) {
                          await removeReservation(editingReservation.id);
                          handleClose();
                        }
                      }}
                      className="w-full py-3 bg-red-50 hover:bg-red-100 border-2 border-red-200 hover:border-red-300 text-red-650 rounded-2xl text-xs font-black transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      🗑️ Eliminar Reserva por Completo
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);
}

function Field({
  label,
  icon,
  error,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-slate-700 font-extrabold text-xs flex items-center gap-1.5 px-0.5">
        {icon}
        <span>{label}</span>
      </label>
      {children}
      {error && <p className="text-red-650 font-black text-xs mt-0.5 pl-0.5">{error}</p>}
    </div>
  );
}
