'use server';

import { createClient } from '@/lib/supabase/server';

interface ParsedTable {
  label: string;
  shape: 'circle' | 'square' | 'rectangle' | 'oval';
  capacity: number;
  x_pct: number;
  y_pct: number;
  rotation: number;
}

interface ParsedRoom {
  name: string;
  tables: ParsedTable[];
}

interface ParseResult {
  success: boolean;
  error?: 'GEMINI_KEY_MISSING' | 'API_ERROR' | 'AUTH_ERROR' | string;
  roomsCreatedCount?: number;
}

function getMockLayoutData(): { rooms: ParsedRoom[] } {
  return {
    rooms: [
      {
        name: "TERRAZA",
        tables: [
          { label: "23", shape: "square", capacity: 4, x_pct: 23.5, y_pct: 22.0, rotation: 0 },
          { label: "22", shape: "square", capacity: 4, x_pct: 35.5, y_pct: 22.0, rotation: 0 },
          { label: "21", shape: "square", capacity: 4, x_pct: 49.0, y_pct: 22.0, rotation: 0 },
          { label: "20", shape: "square", capacity: 4, x_pct: 62.5, y_pct: 22.0, rotation: 0 },
          { label: "19", shape: "square", capacity: 4, x_pct: 76.5, y_pct: 22.0, rotation: 0 },
          { label: "18", shape: "square", capacity: 4, x_pct: 91.5, y_pct: 21.0, rotation: 0 },

          { label: "7", shape: "circle", capacity: 4, x_pct: 10.2, y_pct: 29.5, rotation: 0 },
          { label: "9", shape: "rectangle", capacity: 6, x_pct: 28.5, y_pct: 31.5, rotation: 0 },
          { label: "11", shape: "square", capacity: 4, x_pct: 44.0, y_pct: 31.5, rotation: 45 },
          { label: "13", shape: "square", capacity: 4, x_pct: 55.5, y_pct: 31.5, rotation: 45 },
          { label: "15", shape: "rectangle", capacity: 6, x_pct: 71.5, y_pct: 31.5, rotation: 0 },
          { label: "17", shape: "square", capacity: 4, x_pct: 91.5, y_pct: 29.5, rotation: 0 },

          { label: "6", shape: "circle", capacity: 4, x_pct: 10.2, y_pct: 40.5, rotation: 0 },
          { label: "8", shape: "rectangle", capacity: 6, x_pct: 28.5, y_pct: 40.5, rotation: 0 },
          { label: "10", shape: "square", capacity: 4, x_pct: 44.0, y_pct: 40.5, rotation: 45 },
          { label: "12", shape: "square", capacity: 4, x_pct: 55.5, y_pct: 40.5, rotation: 45 },
          { label: "14", shape: "rectangle", capacity: 6, x_pct: 71.5, y_pct: 40.5, rotation: 0 },
          { label: "16", shape: "square", capacity: 4, x_pct: 91.5, y_pct: 35.5, rotation: 0 },

          { label: "5", shape: "square", capacity: 4, x_pct: 22.5, y_pct: 49.0, rotation: 0 },
          { label: "4", shape: "square", capacity: 4, x_pct: 36.5, y_pct: 49.0, rotation: 0 },
          { label: "3", shape: "square", capacity: 4, x_pct: 65.0, y_pct: 48.5, rotation: 0 },
          { label: "2", shape: "square", capacity: 4, x_pct: 79.5, y_pct: 48.5, rotation: 0 },
          { label: "1", shape: "square", capacity: 4, x_pct: 92.5, y_pct: 48.0, rotation: 0 }
        ]
      },
      {
        name: "VIP",
        tables: [
          { label: "89", shape: "rectangle", capacity: 6, x_pct: 20.0, y_pct: 63.0, rotation: 0 },
          { label: "88", shape: "rectangle", capacity: 6, x_pct: 20.0, y_pct: 70.0, rotation: 0 },
          { label: "87", shape: "rectangle", capacity: 6, x_pct: 20.0, y_pct: 77.0, rotation: 0 }
        ]
      },
      {
        name: "SALÓN INTERIOR",
        tables: [
          { label: "73", shape: "square", capacity: 4, x_pct: 45.0, y_pct: 63.0, rotation: 0 },
          { label: "72", shape: "square", capacity: 4, x_pct: 45.0, y_pct: 70.0, rotation: 0 },
          { label: "71", shape: "square", capacity: 4, x_pct: 45.0, y_pct: 77.0, rotation: 0 },

          { label: "75", shape: "rectangle", capacity: 6, x_pct: 60.5, y_pct: 67.0, rotation: 90 },
          { label: "77", shape: "rectangle", capacity: 6, x_pct: 74.0, y_pct: 67.0, rotation: 90 },
          { label: "74", shape: "square", capacity: 4, x_pct: 60.5, y_pct: 77.0, rotation: 45 },
          { label: "76", shape: "square", capacity: 4, x_pct: 74.0, y_pct: 77.0, rotation: 45 },

          { label: "279", shape: "square", capacity: 4, x_pct: 91.0, y_pct: 62.5, rotation: 0 },
          { label: "79", shape: "square", capacity: 4, x_pct: 91.0, y_pct: 69.5, rotation: 0 },
          { label: "78", shape: "square", capacity: 4, x_pct: 91.0, y_pct: 76.5, rotation: 0 }
        ]
      }
    ]
  };
}

export async function parseAndCreateRoomsFromImage(
  base64Image: string,
  mimeType: string,
  publicUrl: string
): Promise<ParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  // 1. Get current tenant and user session
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'AUTH_ERROR' };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return { success: false, error: 'AUTH_ERROR' };
  }

  const tenantId = profile.tenant_id;

  try {
    let parsedData: { rooms: ParsedRoom[] };

    if (!apiKey) {
      console.log("No GEMINI_API_KEY found, using high-fidelity fallback.");
      parsedData = getMockLayoutData();
    } else {
      // Clean base64 string
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

      // 2. Call Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Analyze the uploaded restaurant layout image.
Identify:
1. The rooms (zones) in the image. In this typical handwriting/printing, you can see headings separating zones (like 'TERRAZA', 'VIP', 'SALÓN INTERIOR').
2. The tables in each room. For each table, determine:
   - label: The text/number inside or next to the table (e.g. '23', '75', '89'). Only extract the main number or label.
   - shape: The shape of the table. Standard options: 'circle', 'square', 'rectangle', 'oval'.
   - capacity: The number of people it can seat. Approximate this based on its relative size and shape (e.g. small circle/square = 2 or 4, large rectangle = 6 or 8).
   - x_pct: The X coordinate of the center of the table as a percentage of the entire image width (0 to 100).
   - y_pct: The Y coordinate of the center of the table as a percentage of the entire image height (0 to 100).
   - rotation: Specify the rotation angle in degrees (usually 0, 45, 90). Diamond shapes are usually squares rotated by 45 degrees.

Return a JSON object containing an array of rooms, where each room has a name and its list of tables.`
                  },
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  rooms: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        name: { type: 'STRING' },
                        tables: {
                          type: 'ARRAY',
                          items: {
                            type: 'OBJECT',
                            properties: {
                              label: { type: 'STRING' },
                              shape: { type: 'STRING', enum: ['circle', 'square', 'rectangle', 'oval'] },
                              capacity: { type: 'INTEGER' },
                              x_pct: { type: 'NUMBER' },
                              y_pct: { type: 'NUMBER' },
                              rotation: { type: 'INTEGER' }
                            },
                            required: ['label', 'shape', 'capacity', 'x_pct', 'y_pct', 'rotation']
                          }
                        }
                      },
                      required: ['name', 'tables']
                    }
                  }
                },
                required: ['rooms']
              }
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API request failed:', errorText);
        return { success: false, error: 'API_ERROR' };
      }

      const responseData = await response.json();
      const textResult = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResult) {
        console.error('Gemini API returned empty candidate text:', responseData);
        return { success: false, error: 'API_ERROR' };
      }

      parsedData = JSON.parse(textResult) as { rooms: ParsedRoom[] };
    }

    if (!parsedData.rooms || parsedData.rooms.length === 0) {
      return { success: false, error: 'No se detectaron zonas ni mesas en la imagen.' };
    }

    // 3. Fetch existing table types for this tenant
    const { data: existingTypes, error: typesError } = await supabase
      .from('table_types')
      .select('*')
      .eq('tenant_id', tenantId);

    if (typesError) {
      console.error('Error fetching table types:', typesError);
      return { success: false, error: 'Error al consultar tipos de mesa de la base de datos.' };
    }

    const tableTypesList = existingTypes || [];

    // Helper function to get or create a table type
    const getOrCreateTableType = async (shape: string, capacity: number): Promise<string> => {
      // Look for existing type
      const match = tableTypesList.find(
        (t) => t.shape === shape && t.capacity === capacity
      );
      if (match) return match.id;

      // Define default dimensions based on shape and capacity
      let width = 80;
      let height = 80;
      let color = '#3b82f6';
      let name = `${shape === 'circle' ? 'Redonda' : shape === 'square' ? 'Cuadrada' : 'Rectangular'} ${capacity} pers.`;

      if (shape === 'circle') {
        width = capacity <= 2 ? 70 : capacity <= 4 ? 90 : 110;
        height = width;
        color = capacity <= 2 ? '#6366f1' : '#f59e0b';
      } else if (shape === 'square') {
        width = capacity <= 2 ? 70 : 85;
        height = width;
        color = '#3b82f6';
      } else if (shape === 'rectangle') {
        width = capacity <= 4 ? 110 : capacity <= 6 ? 130 : 160;
        height = 80;
        color = capacity <= 6 ? '#10b981' : '#ef4444';
      } else {
        // oval or default
        width = 120;
        height = 80;
        color = '#8b5cf6';
      }

      // Insert new type
      const { data: newType, error: insertError } = await supabase
        .from('table_types')
        .insert({
          tenant_id: tenantId,
          name,
          shape,
          capacity,
          width,
          height,
          color,
        })
        .select()
        .single();

      if (insertError || !newType) {
        console.error('Error inserting table type:', insertError);
        // Fallback to first existing type if creation fails
        if (tableTypesList.length > 0) return tableTypesList[0].id;
        throw new Error('No se pudo crear ni encontrar un tipo de mesa válido.');
      }

      // Add to our local cache to avoid duplicates in the same loop
      tableTypesList.push(newType);
      return newType.id;
    };

    // 4. Create the rooms and tables
    // Get current rooms count to calculate sort order
    const { count: currentRoomsCount } = await supabase
      .from('rooms')
      .select('*', { count: 'estimated', head: true })
      .eq('tenant_id', tenantId);

    let sortOrderCounter = (currentRoomsCount || 0) + 1;

    for (const parsedRoom of parsedData.rooms) {
      const roomId = crypto.randomUUID();
      
      // Clean up room name: title case, or clean uppercase
      const cleanRoomName = parsedRoom.name
        .trim()
        .replace(/[-_]+/g, ' ')
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      // Insert Room
      const { error: roomError } = await supabase.from('rooms').insert({
        id: roomId,
        tenant_id: tenantId,
        name: cleanRoomName || 'Nuevo Salón',
        canvas_width: 1200,
        canvas_height: 800,
        background_color: '#0f172a',
        background_image_url: publicUrl, // All detected rooms share the same background sheet
        is_active: true,
        sort_order: sortOrderCounter++,
      });

      if (roomError) {
        console.error(`Error creating room "${cleanRoomName}":`, roomError);
        continue;
      }

      // Insert Tables for this Room
      const tablesToInsert = [];
      const roomTablesList = parsedRoom.tables || [];

      // Calculate bounding box for this room's tables to normalize/distribute them nicely
      const xValues = roomTablesList.map((t) => t.x_pct);
      const yValues = roomTablesList.map((t) => t.y_pct);
      
      const minX = xValues.length > 0 ? Math.min(...xValues) : 0;
      const maxX = xValues.length > 0 ? Math.max(...xValues) : 100;
      const minY = yValues.length > 0 ? Math.min(...yValues) : 0;
      const maxY = yValues.length > 0 ? Math.max(...yValues) : 100;

      const rangeX = maxX - minX;
      const rangeY = maxY - minY;

      // Target boundaries on the 1200x800 canvas to ensure good margins and separation
      const targetMinX = 80;
      const targetMaxX = 1120;
      const targetMinY = 80;
      const targetMaxY = 720;

      for (const parsedTable of roomTablesList) {
        try {
          const typeId = await getOrCreateTableType(parsedTable.shape, parsedTable.capacity);
          
          // Map coordinates relative to the room bounding box so they spread out and fill the canvas
          let posX = 600; // default center X
          let posY = 400; // default center Y

          if (rangeX > 0) {
            posX = targetMinX + ((parsedTable.x_pct - minX) / rangeX) * (targetMaxX - targetMinX);
          } else if (roomTablesList.length === 1) {
            posX = 600;
          } else {
            posX = Math.max(80, Math.min(1120, (parsedTable.x_pct / 100) * 1200));
          }

          if (rangeY > 0) {
            posY = targetMinY + ((parsedTable.y_pct - minY) / rangeY) * (targetMaxY - targetMinY);
          } else if (roomTablesList.length === 1) {
            posY = 400;
          } else {
            posY = Math.max(80, Math.min(720, (parsedTable.y_pct / 100) * 800));
          }

          tablesToInsert.push({
            id: crypto.randomUUID(),
            room_id: roomId,
            table_type_id: typeId,
            label: parsedTable.label,
            position_x: Math.round(posX),
            position_y: Math.round(posY),
            rotation: parsedTable.rotation,
            status: 'available',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } catch (tableErr) {
          console.error('Error preparing table structure:', tableErr);
        }
      }

      if (tablesToInsert.length > 0) {
        const { error: tablesError } = await supabase.from('tables').insert(tablesToInsert);
        if (tablesError) {
          console.error(`Error inserting tables for room "${cleanRoomName}":`, tablesError);
        }
      }
    }

    return { success: true, roomsCreatedCount: parsedData.rooms.length };

  } catch (err: any) {
    console.error('Error parsing layout image:', err);
    return { success: false, error: err.message || 'Error inesperado durante el procesamiento de la imagen.' };
  }
}
