import { type NextRequest, NextResponse } from 'next/server';

function cleanTextForSpeech(input: string): string {
  return input
    // Remove markdown symbols
    .replace(/[*#_~`>[\]()]/g, ' ')
    // Replace currency and common symbols with Spanish words
    .replace(/€/g, ' euros ')
    .replace(/&/g, ' y ')
    .replace(/%/g, ' por ciento ')
    // Remove emojis
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    // Normalize extra spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoSpeechChunks(text: string, maxChunkLen = 140): string[] {
  if (text.length <= maxChunkLen) return [text];

  const sentences = text.match(/[^.!?;\n]+[.!?;\n]*/g) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 1 <= maxChunkLen) {
      current = current ? `${current} ${trimmed}` : trimmed;
    } else {
      if (current) chunks.push(current);
      if (trimmed.length <= maxChunkLen) {
        current = trimmed;
      } else {
        // Further split by comma or words if a single sentence is very long
        const parts = trimmed.split(/([,:]\s*)/);
        let sub = '';
        for (const part of parts) {
          if (sub.length + part.length <= maxChunkLen) {
            sub += part;
          } else {
            if (sub.trim()) chunks.push(sub.trim());
            sub = part;
          }
        }
        current = sub.trim();
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length ? chunks : [text.slice(0, maxChunkLen)];
}

async function fetchEdgeNeuralAudio(chunk: string): Promise<Buffer | null> {
  try {
    const escaped = chunk.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='es-ES'>
      <voice name='es-ES-ElviraNeural'>
        <prosody rate='-2%' pitch='+1%'>${escaped}</prosody>
      </voice>
    </speak>`;

    const response = await fetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/single-execution/content?trustedclienttoken=6A5AA1D4EA594E74A77F3D0794F08C45',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ssml+xml',
          'X-RequestId': Math.random().toString(36).substring(2, 15),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        },
        body: ssml,
        next: { revalidate: 86400 },
      }
    );

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 100) {
        return Buffer.from(arrayBuffer);
      }
    }
  } catch (err) {
    console.warn('[TTS] Edge Neural Speech fetch failed, falling back to Google:', err);
  }
  return null;
}

async function fetchAudioChunk(chunk: string): Promise<Buffer> {
  const neuralBuffer = await fetchEdgeNeuralAudio(chunk);
  if (neuralBuffer) return neuralBuffer;

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=es&client=tw-ob`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://translate.google.com/',
    },
    // Cache repeated phrases for instant response
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    throw new Error(`TTS upstream returned status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const textParam = req.nextUrl.searchParams.get('text');
  if (!textParam || !textParam.trim()) {
    return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
  }

  const cleaned = cleanTextForSpeech(textParam);
  if (!cleaned) {
    return NextResponse.json({ error: 'No readable speech text' }, { status: 400 });
  }

  try {
    const chunks = splitIntoSpeechChunks(cleaned);
    const audioBuffers = await Promise.all(chunks.map(fetchAudioChunk));
    const combined = Buffer.concat(audioBuffers);

    return new NextResponse(combined, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(combined.length),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('[TTS-API] Error generating speech audio:', error);
    return NextResponse.json(
      { error: 'Failed to synthesize speech audio' },
      { status: 500 }
    );
  }
}
