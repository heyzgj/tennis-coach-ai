'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import * as mpDraw from '@mediapipe/drawing_utils';
import { TennisMetricsCalculator } from '@/lib/tennis-metrics';
import { evaluateMetrics } from '@/lib/feedback';
import type { Pose, Metrics } from '@/lib/types';

/* ----- 绘制设置 ----- */
const { drawConnectors, drawLandmarks } = mpDraw;
const LINKS: [number, number][] = [
  [11, 13], [13, 15], [12, 14], [14, 16], [11, 12],
];

/* ----- 触发参数（专家基准）----- */
const PEAK_V_THRESHOLD      = 0.75;             // m/frame
const MIN_RISE_MS           = 60;               // 峰值前最小上升
const MAX_RISE_MS           = 250;              // 峰值上升窗口
const SHOULDER_ROT_TOTAL    = 40 * Math.PI/180; // 40°
const LOCK_MS_AFTER_FEED    = 2000;
const MIN_VIS               = 0.25;

/* -------------------------------- */
type Result = { feedback:string; score:number; metrics:Metrics } | null;

export const useTennisCoach = () => {
  /* UI state */
  const [status, setStatus]           = useState('Initializing…');
  const [detecting, setDetecting]     = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [swingCount, setSwingCount]   = useState(0);
  const [result, setResult]           = useState<Result>(null);

  /* refs */
  const poseLM      = useRef<PoseLandmarker|null>(null);
  const frames      = useRef<Pose[]>([]);
  const handedLeft  = useRef<boolean|null>(null);
  const lastUs      = useRef(0);
  const lockUntil   = useRef(0);

  /* debug canvas ref */
  const dbgCanvasRef = useRef<HTMLCanvasElement|null>(null);
  const setDbgCanvas = useCallback((el:HTMLCanvasElement|null)=>{ dbgCanvasRef.current = el;},[]);

  /* speech (cache + barge-in) */
  const speak = (()=>{
    const cache = new Map<string,SpeechSynthesisUtterance>();
    return (txt:string)=>{
      speechSynthesis.cancel();
      if(!txt) return;
      let u = cache.get(txt);
      if(!u){ u = new SpeechSynthesisUtterance(txt); u.lang='zh-CN'; cache.set(txt,u);}
      speechSynthesis.speak(u);
    };
  })();

  /* load model */
  useEffect(()=>{
    (async()=>{
      setStatus('Loading model…');
      const vis = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      poseLM.current = await PoseLandmarker.createFromOptions(vis,{
        baseOptions:{
          modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate:'GPU',
        },
        runningMode:'VIDEO', numPoses:1,
      });
      setInitialized(true); setStatus('Ready');
    })();
  },[]);

  /* analyze swing */
  const analyzeSwing = useCallback((seq:Pose[])=>{
    const metrics = TennisMetricsCalculator.calculateMetrics(seq);
    const {feedback,score} = evaluateMetrics(metrics);
    speak(feedback);
    setResult({feedback,score,metrics});
    setSwingCount(n=>n+1);
    lockUntil.current = performance.now()+LOCK_MS_AFTER_FEED;
  },[]);

  /* onFrame */
  const handleFrame = useCallback((video:HTMLVideoElement)=>{
    if(!detecting||!initialized||!poseLM.current) return;
    if(performance.now()<lockUntil.current) return;
    if(!video.videoWidth) return;

    /* timestamp μs */
    let ts = Math.floor(video.currentTime*1_000_000);
    if(ts<=lastUs.current) ts = lastUs.current+1;
    lastUs.current = ts;

    const det = poseLM.current.detectForVideo(video,ts);
    const lm  = det.landmarks?.[0];
    if(!lm){ frames.current=[]; return; }

    /* draw */
    if(dbgCanvasRef.current){
      const c = dbgCanvasRef.current, ctx=c.getContext('2d')!;
      c.width = video.videoWidth; c.height=video.videoHeight;
      ctx.clearRect(0,0,c.width,c.height);
      drawConnectors(ctx,lm,LINKS,{color:'#0f0',lineWidth:2});
      drawLandmarks(ctx,lm,{color:'#ff0',lineWidth:1});
    }

    /* handedness */
    if(handedLeft.current===null)
      handedLeft.current = (lm[15]?.visibility??0) > (lm[16]?.visibility??0);
    const WRIST = handedLeft.current?15:16;
    const L_S   = handedLeft.current?12:11;
    const R_S   = handedLeft.current?11:12;

    frames.current.push({ts,points:lm});
    /* 滑窗 400 ms */
    while(frames.current.length && ts-frames.current[0].ts>400_000)
      frames.current.shift();
    if(frames.current.length<4) return;

    /* -------- 1️⃣ 峰值腕速 & 上升区间 -------- */
    const vArr = frames.current.slice(1).map((f,i)=>{
      const prev = frames.current[i];
      const dt = (f.ts-prev.ts)/1_000_000;
      const w = f.points[WRIST], wP=prev.points[WRIST];
      return Math.hypot(w.x-wP.x,w.y-wP.y)/dt;
    });
    const peakV   = Math.max(...vArr);
    const pIdx    = vArr.indexOf(peakV)+1;
    const tPeakUs = frames.current[pIdx].ts;
    const riseMs  = (tPeakUs-frames.current[0].ts)/1000;
    if(peakV<PEAK_V_THRESHOLD) return;
    if(riseMs<MIN_RISE_MS||riseMs>MAX_RISE_MS) return;

    /* -------- 2️⃣ 肩线总旋转 -------- */
    const first = frames.current[0].points;
    const last  = frames.current[pIdx].points;
    const ang0 = Math.atan2(first[R_S].y-first[L_S].y, first[R_S].x-first[L_S].x);
    const ang1 = Math.atan2(last [R_S].y-last [L_S].y, last [R_S].x-last [L_S].x);
    let delta = Math.abs(ang1-ang0); if(delta>Math.PI) delta=2*Math.PI-delta;
    if(delta < SHOULDER_ROT_TOTAL) return;

    /* ---- confirmed swing ---- */
    analyzeSwing(frames.current.slice(Math.max(0,pIdx-4), pIdx+4));
    frames.current = [];
  },[detecting,initialized,analyzeSwing]);

  /* control */
  const startDetection = () => {
    if(!initialized) return;
    setDetecting(true); setStatus('Watching…');
    frames.current=[]; lockUntil.current=0;
    setResult(null); setSwingCount(0); speechSynthesis.cancel();
  };
  const stopDetection = () => {
    setDetecting(false); setStatus('Stopped');
    frames.current=[]; speechSynthesis.cancel();
  };

  return {
    status, isDetecting:detecting, isInitialized:initialized,
    swingCount, analysisResult:result,
    startDetection, stopDetection, handleFrame,
    setDbgCanvas,
  };
};
