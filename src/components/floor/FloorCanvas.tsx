'use client';

import { useCallback, useRef, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { useReservationStore } from '@/stores/useReservationStore';
import { TableItem } from './TableItem';
import { MergeOverlay } from './MergeOverlay';
import { cn } from '@/lib/utils';
import type { Table, Room, TableGroup, Reservation, TableType } from '@/types';
import { Plus, Grid, Layers, Circle, Square, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseAndCreateRoomsFromImage } from '@/app/actions/layoutParser';

interface FloorCanvasProps {
  room: Room;
  onTableClick?: (table: Table) => void;
  onRoomChange?: (room: Room) => void;
}

export function FloorCanvas({ room, onTableClick, onRoomChange }: FloorCanvasProps) {
  const {
    tables,
    tableGroups,
    tableTypes,
    selectedTableId,
    selectedTableIds,
    mode,
    zoom,
    panX,
    panY,
    moveTable,
    addTable,
    selectTable,
    toggleTableSelection,
    mergeTables,
    clearMultiSelection,
    setZoom,
    setPan,
    updateRoom,
    deleteRoom,
    fetchRooms,
  } = useFloorStore();

  const {
    reservations,
    selectedDate,
    selectedTime,
    openModal,
    selectedStatusFilter,
  } = useReservationStore();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showImportPrompt, setShowImportPrompt] = useState(true);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const handleUploadBackground = async (file: File) => {
    if (!file) return;
    setIsUploading(true);

    const toastId = toast.loading("Subiendo plano/imagen de distribución...");

    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const filename = `rooms/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;

      // 1. Upload to room-backgrounds storage bucket
      const { data, error } = await supabase.storage
        .from('room-backgrounds')
        .upload(filename, file, { upsert: true });

      if (error) {
        console.error('Error uploading background image:', error);
        toast.error(`Error al subir imagen: ${file.name}`, { id: toastId });
        setIsUploading(false);
        return;
      }

      // Get public URL
      const { data: urlData } = supabase.storage.from('room-backgrounds').getPublicUrl(data.path);
      const publicUrl = urlData.publicUrl;

      // Helper to convert file to base64
      const fileToBase64 = (f: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(f);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (error) => reject(error);
        });
      };

      toast.loading(`Analizando plano con IA y detectando mesas: ${file.name}...`, { id: toastId });
      const base64Data = await fileToBase64(file);

      // 2. Call the Server Action
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
        setIsUploading(false);
        return;
      }

      // 3. Refresh rooms from database
      const updatedRooms = await fetchRooms();

      // Find the last created room matching this background URL
      const created = updatedRooms
        .slice()
        .reverse()
        .find((r) => r.background_image_url === publicUrl);

      // Clean up placeholder room if it's empty
      const currentRoomTablesCount = tables.filter((t) => t.room_id === room.id).length;
      const isPlaceholderRoom =
        currentRoomTablesCount === 0 &&
        (room.name === "Salón Principal" || room.name === "Nuevo Salón" || room.name.toLowerCase().includes("principal"));

      if (isPlaceholderRoom && updatedRooms.length > 1) {
        await deleteRoom(room.id);
      }

      // 4. Switch active room
      if (created && onRoomChange) {
        onRoomChange(created);
        toast.success("¡Planos de sala importados y mesas autodetectadas con éxito!", { id: toastId });
      } else if (onRoomChange && updatedRooms.length > 0) {
        const firstNewRoom = updatedRooms.find(r => r.background_image_url === publicUrl) || updatedRooms[0];
        onRoomChange(firstNewRoom);
        toast.success("¡Planos de sala importados y mesas autodetectadas con éxito!", { id: toastId });
      } else {
        toast.success("¡Planos de sala importados con éxito!", { id: toastId });
      }
    } catch (err) {
      console.error('Error uploading background:', err);
      toast.error("Ocurrió un error al procesar el plano con IA.", { id: toastId });
    } finally {
      setIsUploading(false);
    }
  };

  // Sensores táctiles y de ratón con distancia mínima para diferenciar tap de drag
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: mode === 'edit' ? 8 : 1000 }, // En modo servicio, deshabilitar drag
    }),
    useSensor(TouchSensor, {
      activationConstraint: mode === 'edit' ? { delay: 100, tolerance: 8 } : { distance: 1000 },
    })
  );

  // Lógica de cálculo de tiempo activo
  const activeTime = selectedTime || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

  const isReservationActive = (res: Reservation) => {
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

  // Filtrado temporal dinámico de mesas según reservas
  const roomTables = tables
    .filter((t: Table) => t.room_id === room.id && t.is_active)
    .map((table: Table) => {
      if (mode === 'edit') return table;

      // Buscar si hay alguna reserva activa para esta mesa a esta hora
      const activeRes = reservations.find((r: Reservation) => {
        if (!isReservationActive(r)) return false;
        
        if (r.table_id === table.id) return true;
        if (r.group_id) {
          const group = tableGroups.find((g: TableGroup) => g.id === r.group_id);
          return group?.member_table_ids.includes(table.id);
        }
        return false;
      });

      if (activeRes) {
        return {
          ...table,
          status: activeRes.status === 'seated' ? 'occupied' as const : 'reserved' as const,
          current_reservation_id: activeRes.id,
          current_reservation: activeRes,
        };
      }

      // Si no hay reserva activa en este slot de tiempo:
      // Si estamos en Tiempo Real (selectedTime === null), respetamos el estado actual de la mesa (occupied, cleaning, blocked)
      // Si estamos en un slot de tiempo futuro, respetamos 'blocked', pero los estados transitorios (occupied, cleaning)
      // se consideran disponibles en el futuro a menos que haya una reserva.
      const fallbackStatus = selectedTime === null
        ? (table.status ?? 'available')
        : (table.status === 'blocked' ? 'blocked' : 'available');

      return {
        ...table,
        status: fallbackStatus as any,
        current_reservation_id: undefined,
        current_reservation: undefined,
      };
    });

  // Filtrado temporal dinámico de grupos de mesas
  const roomTableGroups = tableGroups.filter((group: TableGroup) => {
    if (mode === 'edit') return group.is_active && group.member_table_ids.length > 1;

    const hasActiveRes = reservations.some((r: Reservation) => r.group_id === group.id && isReservationActive(r));
    return hasActiveRes && group.is_active && group.member_table_ids.length > 1;
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, delta } = event;
      if (!delta || (delta.x === 0 && delta.y === 0)) return;

      const tableId = active.id as string;
      const table = tables.find((t) => t.id === tableId);
      if (!table) return;

      const newX = Math.max(0, Math.min(room.canvas_width - 100, table.position_x + delta.x / zoom));
      const newY = Math.max(0, Math.min(room.canvas_height - 100, table.position_y + delta.y / zoom));
      moveTable(tableId, newX, newY);
    },
    [tables, room, zoom, moveTable]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current) {
        selectTable(null);
        clearMultiSelection();
      }
    },
    [selectTable, clearMultiSelection]
  );

  // Zoom con rueda del ratón
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(zoom + delta);
    },
    [zoom, setZoom]
  );

  // Pan con clic del botón central o espacio+drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        setIsPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
      }
    },
    [panX, panY]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan(panStart.current.panX + dx, panStart.current.panY + dy);
    },
    [isPanning, setPan]
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const canMerge = selectedTableIds.length >= 2 && (mode === 'edit' || isMultiSelectMode);

  const handleMerge = useCallback(() => {
    if (!canMerge) return;
    if (mode === 'service') {
      openModal(undefined, selectedTableIds);
      clearMultiSelection();
      setIsMultiSelectMode(false);
    } else {
      mergeTables(selectedTableIds, `Mesa ${selectedTableIds.length}`);
    }
  }, [canMerge, selectedTableIds, mergeTables, mode, openModal, clearMultiSelection]);

  const draggingTable = tables.find((t) => t.id === draggingId);

  return (
    <div className="relative flex-1 overflow-hidden rounded-3xl bg-slate-100 border-2 border-slate-200 shadow-sm">
      {/* Toolbar del canvas */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {/* Toggle Selección Múltiple (Unir) en Modo Servicio */}
        {mode === 'service' && (
          <button
            onClick={() => {
              setIsMultiSelectMode(!isMultiSelectMode);
              clearMultiSelection();
            }}
            className={cn(
              "px-3.5 py-2.5 rounded-xl border-2 text-xs font-black flex items-center gap-1.5 transition-all shadow-md cursor-pointer",
              isMultiSelectMode
                ? "bg-blue-600 border-blue-600 text-white font-black"
                : "bg-white border-slate-300 text-slate-700 hover:text-slate-950 hover:bg-slate-50"
            )}
            title="Seleccionar varias mesas para unirlas en una reserva"
          >
            <Link2 size={14} />
            <span>{isMultiSelectMode ? "Cancelando unión..." : "Unir Mesas"}</span>
          </button>
        )}

        {/* Controles de zoom */}
        <div className="flex items-center gap-1 bg-white rounded-xl border-2 border-slate-300 p-1 shadow-sm">
          <button
            onClick={() => setZoom(zoom - 0.15)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-650 hover:text-slate-950 hover:bg-slate-100 transition-colors text-lg font-bold cursor-pointer"
          >
            −
          </button>
          <span className="text-slate-800 text-xs font-mono font-extrabold w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(zoom + 0.15)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-650 hover:text-slate-950 hover:bg-slate-100 transition-colors text-lg font-bold cursor-pointer"
          >
            +
          </button>
        </div>

        {/* Carga rápida de Plano en Modo Edición */}
        {mode === 'edit' && (
          <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-xl border-2 border-slate-300 shadow-md">
            <label className="px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadBackground(file);
                }}
                disabled={isUploading}
              />
              <span>{isUploading ? 'Subiendo...' : room.background_image_url ? '📷 Cambiar Plano' : '📷 Subir Plano'}</span>
            </label>
            {room.background_image_url && (
              <button
                onClick={async () => {
                  if (confirm('¿Estás seguro de que quieres eliminar el plano de fondo de esta sala?')) {
                    await updateRoom(room.id, { background_image_url: null });
                  }
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-650 transition-colors cursor-pointer"
                title="Eliminar plano de fondo"
              >
                🗑️
              </button>
            )}
          </div>
        )}

        {/* Botón merge */}
        <AnimatePresence>
          {canMerge && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={handleMerge}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-black rounded-xl border-2 border-blue-600 transition-colors shadow-lg cursor-pointer"
            >
              ⊞ {mode === 'service' ? "Crear Reserva Unidas" : `Unir ${selectedTableIds.length} mesas`}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Canvas principal */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={canvasRef}
          className={cn(
            'relative overflow-hidden w-full h-full',
            isPanning && 'cursor-grabbing',
            mode === 'edit' && 'cursor-crosshair'
          )}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ minHeight: '500px' }}
        >
          {/* Grid de fondo */}
          <svg
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            width="100%"
            height="100%"
          >
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#94a3b8" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Imagen de fondo del salón */}
          {room.background_image_url && mode === 'edit' ? (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `url(${room.background_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                opacity: 0.25,
              }}
            />
          ) : !room.background_image_url && roomTables.length === 0 && showImportPrompt ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 z-10 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative max-w-md w-full bg-white border-2 border-slate-300 p-8 rounded-3xl shadow-2xl text-center space-y-5 pointer-events-auto"
              >
                <button
                  onClick={() => setShowImportPrompt(false)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-650 hover:text-slate-950 hover:bg-slate-200 transition-colors cursor-pointer"
                  title="Cerrar prompt"
                >
                  ✕
                </button>
                <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center mx-auto text-blue-600">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-slate-900 font-extrabold text-base">Importar Plano de Sala</h3>
                  <p className="text-slate-600 text-xs font-semibold leading-relaxed">
                    Sube una imagen de distribución o planta de tu local. Se configurará como fondo de la sala al instante y creará mesas automáticas para que organices tu salón.
                  </p>
                </div>

                <div className="flex gap-3 justify-center">
                  <label className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-750 disabled:opacity-50 text-white rounded-xl text-xs font-black border-2 border-blue-600 transition-all shadow-md cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadBackground(file);
                      }}
                      disabled={isUploading}
                    />
                    {isUploading ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span>Componiendo salón...</span>
                      </>
                    ) : (
                      <span>📷 Seleccionar Plano / Imagen</span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowImportPrompt(false)}
                    className="px-5 py-2.5 border-2 border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Diseñar manualmente
                  </button>
                </div>
              </motion.div>
            </div>
          ) : null}

          {/* Contenedor transformable (zoom + pan) */}
          <div
            className="absolute origin-top-left"
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              width: room.canvas_width,
              height: room.canvas_height,
              transition: draggingId ? 'none' : 'transform 0.1s ease',
            }}
          >
            {/* Grupos de mesas (líneas de unión) */}
            {roomTableGroups
              .map((group: TableGroup) => {
                const memberTables = roomTables.filter((t: Table) =>
                  group.member_table_ids.includes(t.id)
                );
                if (memberTables.length < 2) return null;
                return <MergeOverlay key={group.id} group={group} tables={memberTables} />;
              })}

            {/* Mesas */}
            {roomTables.map((table: Table) => {
              const isSeated = table.status === 'occupied' || table.current_reservation?.status === 'seated';
              const matchesFilter = selectedStatusFilter === 'all' || 
                (selectedStatusFilter === 'seated' && isSeated) ||
                (table.current_reservation && table.current_reservation.status === selectedStatusFilter);
              const isDimmed = !matchesFilter;

              return (
                <TableItem
                  key={table.id}
                  table={table}
                  isSelected={
                    selectedTableId === table.id || selectedTableIds.includes(table.id)
                  }
                  isDragging={draggingId === table.id}
                  isEditMode={mode === 'edit' || isMultiSelectMode}
                  isDimmed={isDimmed}
                  onClick={(e) => {
                    const localToday = new Date();
                    const localTodayStr = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
                    const isPast = selectedDate < localTodayStr;
                    if (isPast) return;

                    const isMultiSelect = e?.ctrlKey || e?.shiftKey || isMultiSelectMode;
                    if (isMultiSelect) {
                      toggleTableSelection(table.id);
                    } else {
                      selectTable(table.id === selectedTableId ? null : table.id);
                      onTableClick?.(table);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Drag overlay con preview semitransparente */}
        <DragOverlay>
          {draggingTable ? (() => {
            const capacity = draggingTable.capacity ?? draggingTable.table_type?.capacity ?? 4;
            let width = 80;
            let height = 80;

            if (capacity <= 2) {
              width = 65;
              height = 65;
            } else if (capacity <= 4) {
              width = 85;
              height = 85;
            } else if (capacity <= 6) {
              width = 115;
              height = 80;
            } else if (capacity <= 8) {
              width = 140;
              height = 85;
            } else {
              width = 160;
              height = 90;
            }

            return (
              <div
                style={{
                  width,
                  height,
                  opacity: 0.6,
                  border: '2px dashed #6366f1',
                  borderRadius: draggingTable.table_type?.shape === 'circle' ? '50%' : '12px',
                  backgroundColor: (draggingTable.table_type?.color ?? '#6366f1') + '33',
                }}
              />
            );
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* Indicador de modo & Panel de herramientas de adición */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-3 max-w-[240px]">
        {mode === 'edit' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-slate-900/95 backdrop-blur-sm border border-slate-800 rounded-2xl shadow-xl flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Añadir Mesas</span>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto pr-1">
              {tableTypes.map((type: TableType) => (
                <button
                  key={type.id}
                  onClick={async () => {
                    // Contar el número de mesas de este tipo para el nuevo label
                    const count = tables.filter((t: Table) => t.table_type_id === type.id).length + 1;
                    const shapeLetter = type.shape === 'circle' ? 'CR' : 'M';
                    await addTable({
                      room_id: room.id,
                      table_type_id: type.id,
                      label: `${shapeLetter}${count}`,
                      position_x: room.canvas_width / 2 - (type.width / 2),
                      position_y: room.canvas_height / 2 - (type.height / 2),
                      rotation: 0,
                      status: 'available',
                      is_active: true,
                    });
                  }}
                  className="flex items-center justify-between p-2 rounded-xl bg-slate-950/50 hover:bg-slate-800 border border-slate-850 hover:border-slate-700 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded"
                      style={{
                        backgroundColor: type.color,
                        borderRadius: type.shape === 'circle' ? '50%' : '3px'
                      }}
                    />
                    <span className="text-xs text-white font-semibold truncate max-w-[120px]">{type.name}</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-bold bg-slate-900 px-1.5 py-0.5 rounded-md">{type.capacity}p</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <div className={cn(
          'w-fit px-3 py-1.5 rounded-full text-xs font-semibold border bg-slate-900/90 backdrop-blur-sm shadow-md',
          mode === 'edit'
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
            : 'bg-slate-850 text-slate-400 border-slate-700'
        )}>
          {mode === 'edit' ? '✏️ Modo edición' : '🍽️ Modo servicio'}
        </div>
      </div>
    </div>
  );
}
