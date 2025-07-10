// src/app/page.tsx
'use client';

import { useTennisCoach } from '@/hooks/useTennisCoach';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Play, Square, Target } from 'lucide-react';
import { useCallback, useRef, useEffect } from 'react';

// A self-contained CameraFeed component
const CameraFeed = ({ onFrame, isDetecting }: { onFrame: (video: HTMLVideoElement) => void, isDetecting: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number>(0);

  const detectionLoop = useCallback(() => {
    if (videoRef.current) {
      onFrame(videoRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(detectionLoop);
  }, [onFrame]);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          animationFrameRef.current = requestAnimationFrame(detectionLoop);
        }
      } catch (err) {
        alert("Camera Error: Could not access camera. Please use a secure (HTTPS) connection and grant permissions.");
      }
    };

    const stopCamera = () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };

    if (isDetecting) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isDetecting, detectionLoop]);

  return <video ref={videoRef} playsInline muted className="w-full h-full object-cover transform -scale-x-100" />;
}

export default function Home() {
  const {
    status, isDetecting, isAnalyzing, isInitialized, swingCount,
    analysisResult, startDetection, stopDetection, handleFrame
  } = useTennisCoach();

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 p-4 font-sans">
      <Card className="w-full max-w-2xl shadow-2xl border-slate-200/50 dark:border-slate-700/50">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            AI Tennis Coach
          </CardTitle>
          <p className="text-base text-slate-500 dark:text-slate-400 h-6 transition-all">
            {status}
          </p>
        </CardHeader>
        <CardContent>
          <div className="relative w-full aspect-video bg-slate-900 rounded-xl overflow-hidden mb-6 shadow-inner">
            <CameraFeed onFrame={handleFrame} isDetecting={isDetecting} />
            {isDetecting && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold">
                <Target className="w-4 h-4" />
                <span>REC</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
              <Button
                onClick={isDetecting ? stopDetection : startDetection}
                disabled={!isInitialized || isAnalyzing}
                size="lg"
                className={`w-full text-xl font-bold py-8 rounded-xl transition-all duration-300 shadow-lg col-span-2 ${isDetecting ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
              >
                {isAnalyzing ? <Loader2 className="h-8 w-8 animate-spin" /> : 
                isDetecting ? <Square className="h-8 w-8 mr-2" /> : 
                <Play className="h-8 w-8 mr-2" />}
                {isAnalyzing ? 'Analyzing...' : isDetecting ? 'Stop Session' : 'Start Coaching'}
              </Button>
          </div>

          {(analysisResult || swingCount > 0) && (
            <div className="mt-6 space-y-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl text-center">
                    <p className="text-lg font-semibold text-slate-500 dark:text-slate-400">Swings Detected</p>
                    <p className="text-6xl font-bold text-slate-900 dark:text-slate-100">{swingCount}</p>
                </div>

                {analysisResult && (
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 animate-in fade-in-50 duration-500">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center">
                        <Mic className="w-5 h-5 mr-2 text-blue-500"/>
                        Coach's Feedback
                    </h3>
                    <p className="text-slate-700 dark:text-slate-300 text-xl">
                        {analysisResult.feedback}
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