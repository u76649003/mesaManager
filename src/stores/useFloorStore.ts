'use client';

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import type { Table, TableGroup, FloorMode, Room } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { useReservationStore } from './useReservationStore';

// ============================================================
// FLOOR STORE — Estado del plano de sala conectado a Supabase
// ============================================================

interface FloorState {
  // Datos
  rooms: Room[];
  tables: Table[];
  tableGroups: TableGroup[];
  tableTypes: any[];
  
  // Selección y modo
  selectedTableId: string | null;
  hoveredTableId: string | null;
  selectedTableIds: string[]; // Para selección múltiple (merge)
  mode: FloorMode;
  
  // ⭐ Timers: tableId → ISO string de occupied_since
  occupiedSince: Record<string, string>;
  
  // Configuración del canvas
  zoom: number;
  panX: number;
  panY: number;
  
  // Gestión de Salones (Modales)
  isRoomModalOpen: boolean;
  editingRoom: Room | null;
  openRoomModal: (room?: Room) => void;
  closeRoomModal: () => void;
  
  // Acciones Supabase
  fetchRooms: () => Promise<Room[]>;
  addRoom: (room: Omit<Room, 'id' | 'created_at' | 'tenant_id'>) => Promise<void>;
  updateRoom: (id: string, updates: Partial<Room>) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  fetchTables: (roomId: string) => Promise<void>;
  fetchTableGroups: (roomId: string) => Promise<void>;
  fetchTableTypes: () => Promise<void>;
  
  setTables: (tables: Table[]) => void;
  updateTable: (id: string, updates: Partial<Table>) => Promise<void>;
  moveTable: (id: string, x: number, y: number) => Promise<void>;
  addTable: (table: Omit<Table, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  deleteTable: (id: string) => Promise<void>;
  
  selectTable: (id: string | null) => void;
  hoverTable: (id: string | null) => void;
  toggleTableSelection: (id: string) => void;
  clearMultiSelection: () => void;
  
  setMode: (mode: FloorMode) => void;
  
  // Ocupación y timers
  seatTable: (tableId: string, reservationId?: string) => Promise<void>;
  clearTable: (tableId: string) => Promise<void>;
  setTableStatus: (tableId: string, status: Table['status']) => Promise<void>;
  
  // Merge / Split
  setTableGroups: (groups: TableGroup[]) => void;
  mergeTables: (tableIds: string[], label?: string) => Promise<void>;
  splitGroup: (groupId: string) => Promise<void>;
  
  // Canvas
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
}

export const useFloorStore = create<FloorState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        rooms: [],
        tables: [],
        tableGroups: [],
        tableTypes: [],
        selectedTableId: null,
        hoveredTableId: null,
        selectedTableIds: [],
        mode: 'service',
        occupiedSince: {},
        isRoomModalOpen: false,
        editingRoom: null,
        openRoomModal: (room) => set({ isRoomModalOpen: true, editingRoom: room ?? null }),
        closeRoomModal: () => set({ isRoomModalOpen: false, editingRoom: null }),

        zoom: 1,
        panX: 0,
        panY: 0,

        fetchTableTypes: async () => {
          const supabase = createClient();
          const { data: userData } = await supabase.auth.getUser();
          if (!userData.user) return;

          const { data: profile } = await supabase
            .from('user_profiles')
            .select('tenant_id')
            .eq('id', userData.user.id)
            .single();

          if (!profile) return;

          const { data, error } = await supabase
            .from('table_types')
            .select('*')
            .eq('tenant_id', profile.tenant_id);

          if (error) {
            console.error('Error fetching table types:', error);
            return;
          }
          set({ tableTypes: data || [] });
        },

        fetchRooms: async () => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from('rooms')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

          if (error) {
            console.error('Error fetching rooms:', error);
            return [];
          }

          set({ rooms: data || [] });
          return data || [];
        },

        addRoom: async (room) => {
          const supabase = createClient();
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();
          if (!profile) return;

          const roomId = crypto.randomUUID();
          const newRoom = {
            ...room,
            id: roomId,
            tenant_id: profile.tenant_id,
            created_at: new Date().toISOString(),
          };

          const { error } = await supabase.from('rooms').insert(newRoom);
          if (error) {
            console.error('Error adding room:', error);
            return;
          }

          // Si el salón viene con imagen de fondo, le auto-generamos mesas
          if (newRoom.background_image_url) {
            // Obtener tipos de mesa del tenant
            let { data: types } = await supabase
              .from('table_types')
              .select('*')
              .eq('tenant_id', profile.tenant_id);

            // Si no existen tipos de mesa, crear unos por defecto
            if (!types || types.length === 0) {
              const defaultTypes = [
                { id: crypto.randomUUID(), tenant_id: profile.tenant_id, name: 'Mesa 2 pers.', shape: 'square', capacity: 2, width: 60, height: 60, color: '#3b82f6' },
                { id: crypto.randomUUID(), tenant_id: profile.tenant_id, name: 'Mesa 4 pers.', shape: 'square', capacity: 4, width: 80, height: 80, color: '#10b981' },
                { id: crypto.randomUUID(), tenant_id: profile.tenant_id, name: 'Mesa 6 pers.', shape: 'rectangle', capacity: 6, width: 120, height: 80, color: '#f59e0b' },
                { id: crypto.randomUUID(), tenant_id: profile.tenant_id, name: 'Mesa Circular 4p', shape: 'circle', capacity: 4, width: 80, height: 80, color: '#8b5cf6' }
              ];
              await supabase.from('table_types').insert(defaultTypes);
              types = defaultTypes;
            }

            // Distribuir 6 mesas iniciales en la sala de forma armónica
            const type2p = types.find((t) => t.capacity === 2) || types[0];
            const type4p = types.find((t) => t.capacity === 4) || types[0];
            const type6p = types.find((t) => t.capacity === 6) || types[0];

            const defaultTables = [
              { id: crypto.randomUUID(), room_id: roomId, table_type_id: type4p.id, label: 'M1', position_x: 200, position_y: 200, rotation: 0, status: 'available', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              { id: crypto.randomUUID(), room_id: roomId, table_type_id: type4p.id, label: 'M2', position_x: 500, position_y: 200, rotation: 0, status: 'available', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              { id: crypto.randomUUID(), room_id: roomId, table_type_id: type6p.id, label: 'M3', position_x: 800, position_y: 200, rotation: 0, status: 'available', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              { id: crypto.randomUUID(), room_id: roomId, table_type_id: type2p.id, label: 'M4', position_x: 200, position_y: 500, rotation: 0, status: 'available', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              { id: crypto.randomUUID(), room_id: roomId, table_type_id: type2p.id, label: 'M5', position_x: 500, position_y: 500, rotation: 0, status: 'available', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              { id: crypto.randomUUID(), room_id: roomId, table_type_id: type4p.id, label: 'M6', position_x: 800, position_y: 500, rotation: 0, status: 'available', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];

            await supabase.from('tables').insert(defaultTables);
          }

          set((state) => ({ rooms: [...state.rooms, newRoom as Room] }));
        },

        updateRoom: async (id, updates) => {
          const supabase = createClient();
          const { error } = await supabase.from('rooms').update(updates).eq('id', id);
          if (error) {
            console.error('Error updating room:', error);
            return;
          }

          set((state) => ({
            rooms: state.rooms.map((r) => r.id === id ? { ...r, ...updates } : r),
          }));
        },

        deleteRoom: async (id) => {
          const supabase = createClient();
          const { error } = await supabase.from('rooms').delete().eq('id', id);
          if (error) {
            console.error('Error deleting room:', error);
            return;
          }

          set((state) => ({
            rooms: state.rooms.filter((r) => r.id !== id),
          }));
        },

        fetchTables: async (roomId: string) => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from('tables')
            .select('*, table_type:table_types(*)')
            .eq('room_id', roomId)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

          if (error) {
            console.error('Error fetching tables:', error);
            return;
          }

          get().setTables(data || []);
        },

        fetchTableGroups: async (roomId: string) => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from('table_groups')
            .select('*, table_group_members(table_id)')
            .eq('room_id', roomId)
            .eq('is_active', true);

          if (error) {
            console.error('Error fetching table groups:', error);
            return;
          }

          const groups: TableGroup[] = (data || []).map((g: any) => ({
            id: g.id,
            room_id: g.room_id,
            label: g.label || '',
            is_active: g.is_active,
            member_table_ids: (g.table_group_members || []).map((m: any) => m.table_id),
          }));

          set({ tableGroups: groups });
        },

        setTables: (tables) => {
          const newOccupied: Record<string, string> = { ...get().occupiedSince };
          tables.forEach((t) => {
            if (t.occupied_since && t.status === 'occupied') {
              newOccupied[t.id] = t.occupied_since;
            } else if (t.status !== 'occupied') {
              delete newOccupied[t.id];
            }
          });
          set({ tables, occupiedSince: newOccupied });
        },

        updateTable: async (id, updates) => {
          // Update locally
          set((state) => ({
            tables: state.tables.map((t) => (t.id === id ? { ...t, ...updates } : t)),
          }));

          // Sanitize relations
          const dbUpdates = { ...updates } as any;
          delete dbUpdates.table_type;
          delete dbUpdates.current_reservation;

          const supabase = createClient();
          const { error } = await supabase
            .from('tables')
            .update(dbUpdates)
            .eq('id', id);

          if (error) {
            console.error('Error updating table in Supabase:', error);
          }
        },

        moveTable: async (id, x, y) => {
          set((state) => ({
            tables: state.tables.map((t) =>
              t.id === id ? { ...t, position_x: x, position_y: y } : t
            ),
          }));

          const supabase = createClient();
          const { error } = await supabase
            .from('tables')
            .update({ position_x: x, position_y: y })
            .eq('id', id);

          if (error) {
            console.error('Error moving table in Supabase:', error);
          }
        },

        addTable: async (table) => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from('tables')
            .insert(table)
            .select('*, table_type:table_types(*)')
            .single();

          if (error) {
            console.error('Error adding table in Supabase:', error);
            return;
          }

          set((state) => ({
            tables: [...state.tables, data],
          }));
        },

        deleteTable: async (id) => {
          const supabase = createClient();
          const { error } = await supabase
            .from('tables')
            .delete()
            .eq('id', id);

          if (error) {
            console.error('Error deleting table in Supabase:', error);
            return;
          }

          set((state) => ({
            tables: state.tables.filter((t) => t.id !== id),
            selectedTableId: state.selectedTableId === id ? null : state.selectedTableId,
          }));
        },

        selectTable: (id) => set({ selectedTableId: id }),
        
        hoverTable: (id) => set({ hoveredTableId: id }),

        toggleTableSelection: (id) =>
          set((state) => {
            const exists = state.selectedTableIds.includes(id);
            return {
              selectedTableIds: exists
                ? state.selectedTableIds.filter((i) => i !== id)
                : [...state.selectedTableIds, id],
            };
          }),

        clearMultiSelection: () => set({ selectedTableIds: [] }),

        setMode: (mode) => set({ mode, selectedTableIds: [] }),

        seatTable: async (tableId, reservationId) => {
          const now = new Date().toISOString();
          set((state) => ({
            tables: state.tables.map((t) =>
              t.id === tableId
                ? {
                    ...t,
                    status: 'occupied',
                    occupied_since: now,
                    current_reservation_id: reservationId,
                  }
                : t
            ),
            occupiedSince: { ...state.occupiedSince, [tableId]: now },
          }));

          const supabase = createClient();
          const { error } = await supabase
            .from('tables')
            .update({
              status: 'occupied',
              occupied_since: now,
              current_reservation_id: reservationId || null,
            })
            .eq('id', tableId);

          if (error) {
            console.error('Error seating table:', error);
          }
        },

        clearTable: async (tableId) => {
          // Buscar si la mesa pertenece a algún grupo de mesas unidas
          const group = get().tableGroups.find((g) => g.member_table_ids.includes(tableId));
          if (group) {
            await get().splitGroup(group.id);
          }

          const table = get().tables.find((t) => t.id === tableId);
          const reservationId = table?.current_reservation_id;

          set((state) => {
            const newOccupied = { ...state.occupiedSince };
            delete newOccupied[tableId];
            return {
              tables: state.tables.map((t) =>
                t.id === tableId
                  ? {
                      ...t,
                      status: 'cleaning',
                      occupied_since: undefined,
                      current_reservation_id: undefined,
                    }
                  : t
              ),
              occupiedSince: newOccupied,
              selectedTableId: state.selectedTableId === tableId ? null : state.selectedTableId,
            };
          });

          const supabase = createClient();
          const { error } = await supabase
            .from('tables')
            .update({
              status: 'cleaning',
              occupied_since: null,
              current_reservation_id: null,
            })
            .eq('id', tableId);

          if (error) {
            console.error('Error clearing table:', error);
          }

          if (reservationId) {
            await useReservationStore.getState().updateReservation(reservationId, { status: 'completed' });
          }
        },

        setTableStatus: async (tableId, status) => {
          const nowISO = new Date().toISOString();
          set((state) => ({
            tables: state.tables.map((t) => (t.id === tableId ? { ...t, status, updated_at: nowISO } : t)),
          }));

          const supabase = createClient();
          const { error } = await supabase
            .from('tables')
            .update({ status })
            .eq('id', tableId);

          if (error) {
            console.error('Error setting table status:', error);
          }
        },

        setTableGroups: (groups) => set({ tableGroups: groups }),

        mergeTables: async (tableIds, label) => {
          const firstTable = get().tables.find((t) => t.id === tableIds[0]);
          const roomId = firstTable?.room_id;
          if (!roomId) return;

          const supabase = createClient();

          // 1. Insert the table group
          const { data: groupData, error: groupError } = await supabase
            .from('table_groups')
            .insert({
              room_id: roomId,
              label: label || '',
              is_active: true,
            })
            .select()
            .single();

          if (groupError || !groupData) {
            console.error('Error creating table group:', groupError);
            return;
          }

          // 2. Insert the members
          const members = tableIds.map((tid) => ({
            group_id: groupData.id,
            table_id: tid,
          }));

          const { error: membersError } = await supabase
            .from('table_group_members')
            .insert(members);

          if (membersError) {
            console.error('Error creating group members:', membersError);
            return;
          }

          // Update local state
          const newGroup: TableGroup = {
            id: groupData.id,
            room_id: roomId,
            label: label || '',
            member_table_ids: tableIds,
            is_active: true,
          };

          set((state) => ({
            tableGroups: [...state.tableGroups, newGroup],
            selectedTableIds: [],
          }));
        },

        splitGroup: async (groupId) => {
          set((state) => ({
            tableGroups: state.tableGroups.filter((g) => g.id !== groupId),
          }));

          const supabase = createClient();
          const { error } = await supabase
            .from('table_groups')
            .delete()
            .eq('id', groupId);

          if (error) {
            console.error('Error splitting group:', error);
          }
        },

        setZoom: (zoom) => set({ zoom: Math.max(0.3, Math.min(2, zoom)) }),
        setPan: (panX, panY) => set({ panX, panY }),
        resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),
      }),
      {
        name: 'floor-store',
        partialize: (state) => ({
          occupiedSince: state.occupiedSince,
          mode: state.mode,
          zoom: state.zoom,
        }),
      }
    )
  )
);
