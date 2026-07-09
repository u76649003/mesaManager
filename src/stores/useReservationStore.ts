'use client';

import { create } from 'zustand';
import type { Reservation, Shift } from '@/types';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';

interface ReservationState {
  reservations: Reservation[];
  todayReservations: Reservation[];
  shifts: Shift[];
  
  // Filtros activos
  selectedDate: string; // "2024-12-25"
  selectedShiftId: string | null;
  selectedRoomId: string | null;
  selectedTime: string | null; // "14:00"
  viewMode: 'day' | 'week' | 'month';
  
  // Modal
  isModalOpen: boolean;
  editingReservation: Reservation | null;
  prefillTableIds: string[];
  
  // Acciones Supabase
  fetchReservations: () => Promise<void>;
  fetchShifts: () => Promise<void>;
  
  setReservations: (reservations: Reservation[]) => void;
  addReservation: (reservation: Omit<Reservation, 'id' | 'created_at' | 'updated_at' | 'reservation_number' | 'tenant_id'>) => Promise<void>;
  updateReservation: (id: string, updates: Partial<Reservation>) => Promise<void>;
  removeReservation: (id: string) => Promise<void>;
  
  setShifts: (shifts: Shift[]) => void;
  
  setSelectedDate: (date: string) => void;
  setSelectedShift: (shiftId: string | null) => void;
  setSelectedRoom: (roomId: string | null) => void;
  setSelectedTime: (time: string | null) => void;
  setViewMode: (mode: 'day' | 'week' | 'month') => void;
  
  openModal: (reservation?: Reservation, tableIds?: string | string[]) => void;
  closeModal: () => void;
  
  selectedStatusFilter: 'all' | 'seated' | 'confirmed' | 'pending';
  setSelectedStatusFilter: (status: 'all' | 'seated' | 'confirmed' | 'pending') => void;

  // Computed
  getTodayReservations: () => Reservation[];
  getReservationsByDate: (date: string) => Reservation[];
  getActiveShift: () => Shift | null;
}

export const useReservationStore = create<ReservationState>()((set, get) => ({
  reservations: [],
  todayReservations: [],
  shifts: [],
  selectedDate: format(new Date(), 'yyyy-MM-dd'),
  selectedShiftId: null,
  selectedRoomId: null,
  selectedTime: null,
  viewMode: 'day',
  selectedStatusFilter: 'all',
  setSelectedStatusFilter: (statusFilter) => set({ selectedStatusFilter: statusFilter }),
  editingReservation: null,
  prefillTableIds: [],

  fetchReservations: async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    // Fetch user profile to get tenant_id
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', userData.user.id)
      .single();

    if (!profile) return;

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const selectedDate = get().selectedDate;
    const viewMode = get().viewMode;

    let startDateStr = selectedDate;
    let endDateStr = selectedDate;

    try {
      const { startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } = await import('date-fns');
      const selDate = parseISO(selectedDate);

      if (viewMode === 'week') {
        startDateStr = format(startOfWeek(selDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
        endDateStr = format(endOfWeek(selDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      } else if (viewMode === 'month') {
        startDateStr = format(startOfWeek(startOfMonth(selDate), { weekStartsOn: 1 }), 'yyyy-MM-dd');
        endDateStr = format(endOfWeek(endOfMonth(selDate), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      } else {
        const dates = [selectedDate, todayStr].sort();
        startDateStr = dates[0];
        endDateStr = dates[1];
      }
    } catch (e) {
      console.error('Error importing date-fns inside store:', e);
    }

    const { data, error } = await supabase
      .from('reservations')
      .select('*, room:rooms(*), shift:shifts(*), table:tables!reservations_table_id_fkey(*), waiter:waiters(*)')
      .eq('tenant_id', profile.tenant_id)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('time', { ascending: true });

    if (error) {
      console.error('Error fetching reservations:', error);
      return;
    }

    const allData = data || [];
    const todayRes = allData.filter((r) => r.date === todayStr);

    set({ 
      reservations: allData, 
      todayReservations: todayRes 
    });
  },

  fetchShifts: async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    // Fetch user profile to get tenant_id
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', userData.user.id)
      .single();

    if (!profile) return;

    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching shifts:', error);
      return;
    }

    set({ shifts: data || [] });
  },

  setReservations: (reservations) => set({ reservations }),

  addReservation: async (reservation) => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', userData.user.id)
      .single();

    if (!profile) return;

    // Sanitize: convert empty strings and undefined FK values to null
    // Do NOT include reservation_number - the DB trigger generates it automatically
    const sanitized: Record<string, unknown> = {
      guest_name:       reservation.guest_name,
      guest_phone:      reservation.guest_phone    || null,
      guest_email:      reservation.guest_email    || null,
      party_size:       reservation.party_size,
      date:             reservation.date,
      time:             reservation.time,
      duration_minutes: reservation.duration_minutes ?? 90,
      notes:            reservation.notes           || null,
      status:           reservation.status          || 'confirmed',
      table_id:         reservation.table_id        || null,
      group_id:         reservation.group_id        || null,
      shift_id:         reservation.shift_id        || null,
      room_id:          reservation.room_id         || null,
      tenant_id:        profile.tenant_id,
      send_email:       reservation.send_email       || false,
      is_prepayment:    reservation.is_prepayment    || false,
      prepayment_amount:reservation.prepayment_amount|| 0,
      prepayment_reason:reservation.prepayment_reason|| null,
      payment_status:   reservation.payment_status   || 'no_payment_required',
      payment_method:   (reservation as any).payment_method   || 'online',
      bizum_phone:      (reservation as any).bizum_phone      || null,
      bizum_name:       (reservation as any).bizum_name       || null,
    };

    // Only include waiter_id if it exists in the schema
    if ('waiter_id' in reservation) {
      sanitized.waiter_id = (reservation as any).waiter_id || null;
    }

    // Insert to database - trigger sets reservation_number automatically
    const { data, error } = await supabase
      .from('reservations')
      .insert(sanitized)
      .select('*, room:rooms(*), shift:shifts(*), table:tables!reservations_table_id_fkey(*), waiter:waiters(*)')
      .single();

    if (error) {
      console.error('Error adding reservation:', error.message, error.details, error.hint);
      const { toast } = await import('sonner');
      toast.error('Error al guardar la reserva: ' + (error.message || 'Error desconocido'));
      return;
    }

    set((state) => ({ reservations: [data, ...state.reservations] }));
  },

  updateReservation: async (id, updates) => {
    // Optimistic update
    set((state) => ({
      reservations: state.reservations.map((r) =>
        r.id === id ? { ...r, ...updates, updated_at: new Date().toISOString() } : r
      ),
    }));

    // Sanitize updates - remove joined fields and convert empty strings to null for FK columns
    const dbUpdates = { ...updates } as any;
    delete dbUpdates.room;
    delete dbUpdates.shift;
    delete dbUpdates.table;
    delete dbUpdates.waiter;

    // Convert empty string FK fields to null
    for (const fk of ['table_id', 'group_id', 'shift_id', 'waiter_id', 'room_id']) {
      if (fk in dbUpdates && (dbUpdates[fk] === '' || dbUpdates[fk] === undefined)) {
        dbUpdates[fk] = null;
      }
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('reservations')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      console.error('Error updating reservation in Supabase:', error.message, error.details);
      const { toast } = await import('sonner');
      toast.error('Error al actualizar la reserva: ' + (error.message || 'Error desconocido'));
    }
  },


  removeReservation: async (id) => {
    set((state) => ({
      reservations: state.reservations.filter((r) => r.id !== id),
    }));

    const supabase = createClient();
    const { error } = await supabase
      .from('reservations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error removing reservation in Supabase:', error);
    }
  },

  setShifts: (shifts) => set({ shifts }),

  setSelectedDate: (date) => {
    set({ selectedDate: date });
    get().fetchReservations();
  },
  setSelectedShift: (shiftId) => set({ selectedShiftId: shiftId }),
  setSelectedRoom: (roomId) => set({ selectedRoomId: roomId }),
  setSelectedTime: (time) => set({ selectedTime: time }),
  setViewMode: (viewMode) => {
    set({ viewMode });
    get().fetchReservations();
  },

  openModal: (reservation, tableIds) =>
    set({
      isModalOpen: true,
      editingReservation: reservation ?? null,
      prefillTableIds: Array.isArray(tableIds)
        ? tableIds
        : tableIds
        ? [tableIds]
        : [],
    }),
  closeModal: () =>
    set({ isModalOpen: false, editingReservation: null, prefillTableIds: [] }),

  getTodayReservations: () => {
    return get().reservations.filter((r) => r.date === get().selectedDate);
  },

  getReservationsByDate: (date) => {
    return get().reservations.filter((r) => r.date === date);
  },

  getActiveShift: () => {
    const { shifts } = get();
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return (
      shifts.find((s) => {
        if (!s.is_active) return false;
        const dow = now.getDay() === 0 ? 7 : now.getDay();
        return (
          s.days_of_week.includes(dow) &&
          currentTime >= s.start_time &&
          currentTime <= s.end_time
        );
      }) ?? null
    );
  },
}));
