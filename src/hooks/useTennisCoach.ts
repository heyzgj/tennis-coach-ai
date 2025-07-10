'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { TennisMetricsCalculator } from '@/lib/tennis-metrics';
import type { Pose, Metrics } from '@/lib/types';
import { evaluateMetrics } from '@/lib/feedback';

type Result = { feedback: string; score: number; metrics: Metrics } | null;

export const useTennisCoach = () => {
  // UI 状态
  const [status, setStatus] = useState('Initializing…');
  const [detecting, setDetecting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [swingCount, setSwingCount] = useState(0);
  const [result, setResult] = useState<Result>(null);

  // 推理依赖
  const poseLM = useRef<PoseLandmarker | null>(null);
  const seq = useRef<Pose[]>([]);
  const triggered = useRef(false);
  const lastTS = useRef(0);

  // SpeechSynthesis 播放队列
  const queue = useRef<string[]>([]);
  const speakBusy = useRef(false);

  // ---------- Speech helpers ----------
  function speak(text: string) {
    if (!('speechSynthesis' in window)) return;
    queue.current.push(text);
    playQueue();
  }

  function playQueue() {
    if (speakBusy.current || !queue.current.length) return;
    const utt = new SpeechSynthesisUtterance(queue.current.shift()!);
    utt.lang = 'zh-CN';
    // 选一个更自然的中文女声（iOS 通常叫 Ting / Xiao）
    const voice = speechSynthesis.getVoices()
      .find(v => v.lang.startsWith('zh') && /Ting|Xiao/i.test(v.name));
    if (voice) utt.voice = voice;
    speakBusy.current = true;
    utt.onend = () => { speakBusy.current = false; playQueue(); };
    speechSynthesis.cancel();          // 打断上条
    speechSynthesis.speak(utt);
  }

  // ---------- 初始化 ----------
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

  // ---------- Swing 解析 ----------
  const MIN_FRAMES = 15;      // 收集 ≥15 帧再分析
  const isValid = (m: Metrics) =>
    m.maxShoulderTurn > 10 &&
    m.peakArmSpeed > 20 &&
    m.contactMetrics.distanceFromCore > 10;

  const analyze = useCallback((poses: Pose[]) => {
    const metrics = TennisMetricsCalculator.calculateMetrics(poses);
    if (!isValid(metrics)) {
      setStatus('Need more data…');    // 不播语音
      return;
    }
    const { feedback, score } = evaluateMetrics(metrics);
    speak(feedback);
    setResult({ feedback, score, metrics });
    setStatus('Ready');
  }, []);

  // ---------- 视频帧循环 ----------
  const onFrame = useCallback((video: HTMLVideoElement) => {
    if (!detecting || !initialized || !poseLM.current) return;

    const now = performance.now();
    if (now - lastTS.current < 67) return;   // ~15 fps
    lastTS.current = now;

    const res = poseLM.current.detectForVideo(video, now);
    if (!res?.landmarks[0]) return;

    const pose: Pose = { ts: now, points: res.landmarks[0] };

    if (triggered.current) {
      seq.current.push(pose);
      if (seq.current.length >= MIN_FRAMES) {
        analyze(seq.current.slice());
        triggered.current = false;
      }
      return;
    }

    // 用腕速度 + 肩角速度触发
    if (seq.current.length) seq.current.shift();
    seq.current.push(pose);

    if (seq.current.length >= 3) {
      const cur = seq.current[2], prev = seq.current[1];
      const wrist = cur.points[16], wristPrev = prev.points[16];
      const lS = cur.points[11], rS = cur.points[12];
      const lSPrev = prev.points[11], rSPrev = prev.points[12];
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
        setSwingCount(c => c + 1);
      }
    }
  }, [detecting, initialized, analyze]);

  // ---------- 控制 ----------
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
    speechSynthesis.cancel();
    queue.current = [];
  };

  return {
    status,
    isDetecting: detecting,
    isInitialized: initialized,
    swingCount,
    analysisResult: result,
    startDetection: start,
    stopDetection: stop,
    handleFrame: onFrame,
  };
};
