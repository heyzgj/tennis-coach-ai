'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { TennisMetricsCalculator } from '@/lib/tennis-metrics';
import type { Pose, Metrics } from '@/lib/types';

type Result = { feedback: string; metrics: Metrics } | null;

export const useTennisCoach = () => {
  const [status, setStatus] = useState('Initializing...');
  const [detecting, setDetecting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const [swingCount, setSwingCount] = useState(0);
  const [result, setResult] = useState<Result>(null);

  // refs
  const poseLM = useRef<PoseLandmarker | null>(null);
  const lastTS = useRef(0);
  const seq = useRef<Pose[]>([]);
  const triggered = useRef(false);

  // Audio playback with 1-line cache to avoid duplicate requests
  const audioQ = useRef<Blob[]>([]);
  const playing = useRef(false);
  const cache = useRef<Map<string, Blob>>(new Map());

  const playNext = useCallback(() => {
    if (playing.current || !audioQ.current.length) return;
    const blob = audioQ.current.shift()!;
    playing.current = true;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      playing.current = false;
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.onerror = () => {
      playing.current = false;
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.play().catch(() => {
      playing.current = false;
      URL.revokeObjectURL(url);
      playNext();
    });
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (cache.current.has(text)) {
        audioQ.current.push(cache.current.get(text)!);
        playNext();
        return;
      }
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) return;
      const blob = await r.blob();
      cache.current.set(text, blob);
      audioQ.current.push(blob);
      playNext();
    },
    [playNext]
  );

  // ▼ Initialize
  useEffect(() => {
    const init = async () => {
      setStatus('Loading models…');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      poseLM.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      setInitialized(true);
      setStatus('Ready');
    };
    init().catch(() => setStatus('Init failed'));
  }, []);

  // ▼ Call analysis
  const analyze = useCallback(
    async (poses: Pose[]) => {
      setAnalyzing(true);
      setStatus('Analyzing…');

      const metrics = TennisMetricsCalculator.calculateMetrics(poses);
      const fd = new FormData();
      fd.append('metrics', JSON.stringify(metrics));

      try {
        const r = await fetch('/api/analyze', { method: 'POST', body: fd });
        const json = await r.json();
        if (json.feedback) await speak(json.feedback);
        setResult({ feedback: json.feedback, metrics });
      } catch (e) {
        await speak('抱歉，分析失败，请再试一次。');
      } finally {
        setAnalyzing(false);
        setStatus('Ready');
      }
    },
    [speak]
  );

  // ▼ Video frame loop
  const onFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!detecting || analyzing || !initialized || !poseLM.current) return;

      const now = performance.now();
      if (now - lastTS.current < 67) return;
      lastTS.current = now;

      const res = poseLM.current.detectForVideo(video, now);
      if (!res?.landmarks[0]) return;

      const pose: Pose = { ts: now, points: res.landmarks[0] };

      if (triggered.current) {
        seq.current.push(pose);
        if (seq.current.length > 10) {
          analyze(seq.current.slice());
          triggered.current = false;
        }
        return;
      }

      const recent = [...seq.current.slice(-2), pose];
      seq.current = recent;
      if (recent.length < 3) return;

      const cur = recent[2],
        prev = recent[1];
      const wrist = cur.points[16],
        wristPrev = prev.points[16];
      const lS = cur.points[11],
        rS = cur.points[12],
        lSPrev = prev.points[11],
        rSPrev = prev.points[12];
      const dt = (cur.ts - prev.ts) / 1000;
      if (dt <= 0) return;

      const v =
        Math.hypot(wrist.x - wristPrev.x, wrist.y - wristPrev.y) / dt;
      let ang =
        Math.atan2(rS.y - lS.y, rS.x - lS.x) -
        Math.atan2(rSPrev.y - lSPrev.y, rSPrev.x - lSPrev.x);
      if (ang > Math.PI) ang -= 2 * Math.PI;
      if (ang < -Math.PI) ang += 2 * Math.PI;
      const av = Math.abs(ang / dt);

      if (v > 1.5 && av > 2.5) {
        triggered.current = true;
        seq.current = [cur];
        setSwingCount((n) => n + 1); // 即刻计数
      }
    },
    [detecting, analyzing, initialized, analyze]
  );

  // ▼ Control functions
  const start = () => {
    if (!initialized) return;
    setDetecting(true);
    setSwingCount(0);
    setResult(null);
    setStatus('Watching…');
  };

  const stop = () => {
    setDetecting(false);
    setStatus('Stopped');
    audioQ.current = [];
    playing.current = false;
  };

  return {
    status,
    isDetecting: detecting,
    isAnalyzing: analyzing,
    isInitialized: initialized,
    swingCount,
    analysisResult: result,
    startDetection: start,
    stopDetection: stop,
    handleFrame: onFrame,
  };
};
