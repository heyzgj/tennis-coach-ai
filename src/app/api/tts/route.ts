import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Official Gemini TTS API endpoint
const MODEL = 'gemini-2.5-flash-preview-tts';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const IS_DEV = process.env.NODE_ENV !== 'production';

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), { status: 500 });
  }

  const { text } = await req.json();
  const clean = (text ?? '').trim();
  if (!clean) {
    return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400 });
  }

  // Official Gemini TTS API format
  const body = {
    contents: [{ parts: [{ text: clean }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
      },
    },
  };

  IS_DEV && console.log('🔊 TTS request:', clean);

  const resp = await fetch(`${ENDPOINT}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const error = await resp.text();
    IS_DEV && console.error('TTS error:', error);
    return new Response(error, { status: resp.status });
  }

  const data = await resp.json();
  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) {
    IS_DEV && console.error('TTS: no audio data');
    return new Response(JSON.stringify({ error: 'No audio returned' }), { status: 500 });
  }

  const pcm = Buffer.from(b64, 'base64');

  // minimum wav header
  const wav = Buffer.alloc(44 + pcm.length);
  let o = 0;
  wav.write('RIFF', o); o += 4;
  wav.writeUInt32LE(36 + pcm.length, o); o += 4;
  wav.write('WAVEfmt ', o); o += 8;
  wav.writeUInt32LE(16, o); o += 4; // PCM chunk size
  wav.writeUInt16LE(1, o); o += 2;  // PCM format
  wav.writeUInt16LE(1, o); o += 2;  // mono
  wav.writeUInt32LE(24000, o); o += 4;
  wav.writeUInt32LE(24000 * 2, o); o += 4;
  wav.writeUInt16LE(2, o); o += 2;
  wav.writeUInt16LE(16, o); o += 2;
  wav.write('data', o); o += 4;
  wav.writeUInt32LE(pcm.length, o); o += 4;
  pcm.copy(wav, o);

  return new Response(wav, {
    headers: { 'Content-Type': 'audio/wav', 'Content-Length': wav.length.toString() },
  });
}
