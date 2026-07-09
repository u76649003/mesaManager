'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { X, Save, Upload, Trash2, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { parseAndCreateRoomsFromImage } from '@/app/actions/layoutParser';
import type { Room } from '@/types';

interface RoomModalProps {
  onRoomChange?: (room: Room) => void;
}

export function RoomModal({ onRoomChange }: RoomModalProps) {
  const {
    isRoomModalOpen,
    editingRoom,
    closeRoomModal,
    addRoom,
    updateRoom,
    deleteRoom,
    rooms,
    fetchRooms,
  } = useFloorStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [canvasHeight, setCanvasHeight] = useState(800);
  const [backgroundColor, setBackgroundColor] = useState('#0f172a');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [useAI, setUseAI] = useState(true);

  // Sync modal inputs when editing room data changes
  useEffect(() => {
    if (editingRoom) {
      setName(editingRoom.name);
      setDescription(editingRoom.description || '');
      setCanvasWidth(editingRoom.canvas_width);
      setCanvasHeight(editingRoom.canvas_height);
      setBackgroundColor(editingRoom.background_color);
      setBackgroundImageUrl(editingRoom.background_image_url || '');
      setImagePreview(editingRoom.background_image_url || null);
      setUseAI(false);
    } else {
      setName('');
      setDescription('');
      setCanvasWidth(1200);
      setCanvasHeight(800);
      setBackgroundColor('#0f172a');
      setBackgroundImageUrl('');
      setImagePreview(null);
      setUseAI(true);
    }
    setImageFile(null);
  }, [editingRoom, isRoomModalOpen]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const filename = `rooms/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('room-backgrounds')
      .upload(filename, file, { upsert: true });

    if (error) {
      console.error('Error uploading image to storage:', error);
      return null;
    }

    const { data: urlData } = supabase.storage.from('room-backgrounds').getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name && !(useAI && imageFile)) return;

    setIsUploading(true);
    let finalImageUrl = backgroundImageUrl;

    const toastId = toast.loading(useAI && imageFile ? "Subiendo y analizando plano con IA..." : "Guardando salón...");

    try {
      if (imageFile) {
        const uploadedUrl = await uploadImage(imageFile);
        if (uploadedUrl) {
          finalImageUrl = uploadedUrl;
        } else {
          toast.error("Error al subir la imagen del plano.", { id: toastId });
          setIsUploading(false);
          return;
        }
      }

      if (useAI && imageFile) {
        // Run AI parsing
        const fileToBase64 = (file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
          });
        };
        const base64Data = await fileToBase64(imageFile);
        const parseResult = await parseAndCreateRoomsFromImage(base64Data, imageFile.type, finalImageUrl || '');

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

        // Refresh rooms
        const updatedRooms = await fetchRooms();
        const created = updatedRooms
          .slice()
          .reverse()
          .find((r) => r.background_image_url === finalImageUrl);

        if (created && onRoomChange) {
          onRoomChange(created);
        } else if (onRoomChange && updatedRooms.length > 0) {
          onRoomChange(updatedRooms[0]);
        }

        toast.success("¡Salones y mesas creados con éxito usando IA!", { id: toastId });
      } else {
        // Standard save
        const roomPayload = {
          name: name || 'Nuevo Salón',
          description,
          canvas_width: canvasWidth,
          canvas_height: canvasHeight,
          background_color: backgroundColor,
          background_image_url: finalImageUrl || null,
          is_active: true,
          sort_order: editingRoom ? editingRoom.sort_order : rooms.length + 1,
        };

        if (editingRoom) {
          await updateRoom(editingRoom.id, roomPayload);
        } else {
          await addRoom(roomPayload);
        }
        await fetchRooms();
        toast.success("Salón guardado con éxito.", { id: toastId });
      }

      closeRoomModal();
    } catch (err: any) {
      console.error('Error saving room:', err);
      toast.error(`Error al guardar salón: ${err.message || 'Error desconocido'}`, { id: toastId });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!editingRoom) return;
    if (confirm(`¿Estás seguro de que quieres eliminar el salón "${editingRoom.name}"? Se perderán todas sus mesas.`)) {
      await deleteRoom(editingRoom.id);
      closeRoomModal();
    }
  };

  return (
    <AnimatePresence>
      {isRoomModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeRoomModal}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]"
          />

          {/* Modal content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-800">
                <h3 className="text-white font-bold text-lg">
                  {editingRoom ? '✏️ Editar Salón' : '➕ Crear Nuevo Salón'}
                </h3>
                <button
                  onClick={closeRoomModal}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-450 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSave} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                <div className="space-y-1">
                  <label className="text-slate-400 text-xs font-semibold">Nombre de la Sala {useAI && imageFile ? '(Opcional, detectado por la IA)' : ''}</label>
                  <input
                    type="text"
                    required={!useAI || !imageFile}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={useAI && imageFile ? "Autodetectado por la IA..." : "Ej. Terraza Principal, Salón Privado..."}
                    className="w-full px-3.5 py-2.5 bg-slate-850 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-xs font-semibold">Descripción (Opcional)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ej. Vista al exterior, zona climatizada..."
                    className="w-full px-3.5 py-2.5 bg-slate-850 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Importar Imagen de Planta (del tirón) */}
                <div className="space-y-2">
                  <label className="text-slate-400 text-xs font-semibold">Imagen del Plano / Planta (Importar plano)</label>
                  <label className="flex flex-col items-center justify-center gap-2.5 p-5 border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl cursor-pointer transition-colors bg-slate-850/50">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                    {imagePreview ? (
                      <div className="relative w-full">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setImageFile(null);
                            setImagePreview(null);
                            setBackgroundImageUrl('');
                          }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-600 hover:bg-red-550 text-white transition-colors z-10 shadow-lg"
                          title="Eliminar plano de fondo"
                        >
                          <Trash2 size={14} />
                        </button>
                        <img
                          src={imagePreview}
                          alt="Previsualización plano"
                          className="w-full h-32 object-cover rounded-lg opacity-75 border border-slate-800"
                        />
                        <span className="absolute bottom-2 right-2 text-[10px] bg-black/70 text-white px-2 py-0.5 rounded-full font-semibold">Click para cambiar imagen</span>
                      </div>
                    ) : (
                      <>
                        <Upload size={22} className="text-slate-500" />
                        <div className="text-center">
                          <span className="text-xs text-slate-350 font-bold block">Sube el plano de distribución</span>
                          <span className="text-[10px] text-slate-500">Se usará como fondo del salón al instante</span>
                        </div>
                      </>
                    )}
                  </label>
                </div>

                {/* Checkbox de IA si hay previsualización o archivo */}
                {imagePreview && !editingRoom && (
                  <div className="flex items-center gap-2 bg-slate-850 p-3 rounded-xl border border-slate-800">
                    <input
                      type="checkbox"
                      id="room_modal_use_ai"
                      checked={useAI}
                      onChange={(e) => setUseAI(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor="room_modal_use_ai" className="text-xs text-slate-300 font-semibold cursor-pointer select-none flex items-center gap-1.5">
                      <Brain size={14} className="text-indigo-400 animate-pulse" />
                      <span>Autodetectar múltiples salones y mesas con Inteligencia Artificial (Gemini)</span>
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-slate-400 text-xs font-semibold">Ancho (px)</label>
                    <input
                      type="number"
                      required
                      min={600}
                      max={2000}
                      value={canvasWidth}
                      onChange={(e) => setCanvasWidth(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-slate-850 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 text-xs font-semibold">Alto (px)</label>
                    <input
                      type="number"
                      required
                      min={600}
                      max={2000}
                      value={canvasHeight}
                      onChange={(e) => setCanvasHeight(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-slate-850 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-xs font-semibold">Color de Fondo (si no hay imagen)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="w-12 h-10 p-1 bg-slate-850 border border-slate-700 rounded-xl cursor-pointer"
                    />
                    <span className="font-mono text-xs text-slate-400">{backgroundColor}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-3 border-t border-slate-800/80">
                  {editingRoom && rooms.length > 1 && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-4 bg-red-950/40 hover:bg-red-900 border border-red-500/20 text-red-400 hover:text-white rounded-xl flex items-center justify-center transition-colors"
                      title="Eliminar Salón"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeRoomModal}
                    className="flex-1 py-3 border border-slate-700 hover:bg-slate-800 rounded-xl text-slate-350 text-sm font-semibold transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isUploading}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Save size={16} />
                    <span>{isUploading ? 'Guardando...' : editingRoom ? 'Actualizar' : 'Crear Salón'}</span>
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
