// src/app/api/analyze/route.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
const MODEL_NAME = 'gemini-2.5-flash';

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const metricsString = formData.get('metrics') as string | null;

    if (!metricsString) {
      return NextResponse.json({ error: 'Metrics data is required' }, { status: 400 });
    }
    const metrics = JSON.parse(metricsString);

    console.log('metrics', JSON.stringify(metrics));
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const prompt = `
      You are an elite tennis coach analyzing performance data.
      Metrics from a player's forehand:
      - Shoulder Turn: ${metrics.shoulder}°
      - Contact Distance: ${metrics.dist}cm
      - Swing Speed Score: ${metrics.speed}/100

      Based ONLY on these numbers, provide one concise, encouraging, and actionable piece of feedback in Chinese.
      The feedback must be under 20 words.

      Example for low shoulder turn: "很棒的准备！下次尝试转动肩膀更多，把力量都释放出来。"
      Example for low speed: "你的形态很好！试着在击球瞬间更快地挥动球拍，增加球速。"
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return NextResponse.json({ feedback: text.trim() });

  } catch (error: any) {
    console.error('❌ Gemini API Error:', error);
    return NextResponse.json({ error: 'Failed to analyze swing' }, { status: 500 });
  }
}