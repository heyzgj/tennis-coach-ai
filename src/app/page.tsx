// src/app/page.tsx
'use client';

import { useTennisCoach } from '@/hooks/useTennisCoach';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Square, Target } from 'lucide-react';
import { useCallback, useRef, useEffect } from 'react';

/* ---------- CameraFeed ---------- */
const CameraFeed = ({
  onFrame,
  isDetecting,
}: {
  onFrame: (video: HTMLVideoElement) => void;
  isDetecting: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);

  // 每帧回调
  const loop = useCallback(() => {
    if (videoRef.current) onFrame(videoRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [onFrame]);

  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          rafRef.current = requestAnimationFrame(loop);
        }
      } catch {
        alert(
          'Camera error. 请使用 HTTPS 打开并授权摄像头。'
        );
      }
    };

    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop());
      }
    };

    isDetecting ? start() : stop();
    return () => stop();
  }, [isDetecting, loop]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      className="w-full h-full object-cover transform -scale-x-100"
    />
  );
};

/* ---------- Page ---------- */
export default function Home() {
  const {
    status,
    isDetecting,
    isInitialized,
    swingCount,
    analysisResult,
    startDetection,
    stopDetection,
    handleFrame,
  } = useTennisCoach();

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 p-4 font-sans">
      <Card className="w-full max-w-2xl shadow-2xl border-slate-200/50 dark:border-slate-700/50">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            AI Tennis Coach
          </CardTitle>
          <p className="h-6 text-base text-slate-500 dark:text-slate-400">
            {status}
          </p>
        </CardHeader>

        <CardContent>
          {/* Camera preview */}
          <div className="relative w-full aspect-video bg-slate-900 rounded-xl overflow-hidden mb-6 shadow-inner">
            <CameraFeed onFrame={handleFrame} isDetecting={isDetecting} />
            {isDetecting && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold">
                <Target className="w-4 h-4" />
                <span>REC</span>
              </div>
            )}
          </div>

          {/* Start / Stop button */}
          <Button
            onClick={isDetecting ? stopDetection : startDetection}
            disabled={!isInitialized}
            size="lg"
            className={`w-full text-xl font-bold py-8 rounded-xl transition-all duration-300 shadow-lg ${
              isDetecting
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white`}
          >
            {isDetecting ? (
              <>
                <Square className="h-8 w-8 mr-2" />
                Stop Session
              </>
            ) : (
              <>
                <Play className="h-8 w-8 mr-2" />
                Start Coaching
              </>
            )}
          </Button>

          {/* Swing count & feedback */}
          {(analysisResult || swingCount > 0) && (
            <div className="mt-6 space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                <p className="text-lg font-semibold text-slate-500 dark:text-slate-400">
                  Swings Detected
                </p>
                <p className="text-6xl font-bold text-slate-900 dark:text-slate-100">
                  {swingCount}
                </p>
              </div>

              {analysisResult && (
                <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 animate-in fade-in-50 duration-500">
                  <h3 className="text-lg font-semibold mb-2">反馈</h3>
                  <p className="text-xl">{analysisResult.feedback}</p>
                  <p className="text-sm text-slate-500 mt-1">
                    综合分：{analysisResult.score}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <footer className="mt-6 text-center text-sm text-gray-500">
        <p>For best results, use a secure (HTTPS) connection.</p>
      </footer>
    </main>
  );
}
