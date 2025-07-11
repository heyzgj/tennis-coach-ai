// src/lib/feedback.ts
import type { Metrics } from "./types";

export interface FeedbackResult {
  score: number;          // 0-100
  feedback: string;       // ≤20 中文
}

/**
 * 把指标映射成 0-100 综合分，再给一句短评。
 * 如需更精细，可把规则或模板拆成 json 配置。
 */
export function evaluateMetrics(m: Metrics){
  const shoulder = Math.min(m.maxShoulderTurn,80)/80;  // ≥40° 即 0.5+
  const speed    = m.peakArmSpeed/100;
  const dist     = Math.min(m.contactMetrics.distanceFromCore,120)/120;
  const rhythm   = m.swingRhythm/100;

  const score = Math.round(
    shoulder*40 + speed*30 + dist*20 + rhythm*10
  );

  let fb = '动作不错，继续保持！';
  if(score>85)           fb='击球强劲！保持节奏！';
  else if(score>70)      fb='很好！再多转肩发力！';
  else if(shoulder<0.5)  fb='转肩不足，试着带动肩膀！';
  else if(speed<0.4)     fb='挥速偏慢，加快收拍！';
  else                   fb='节奏略乱，放松连续挥拍！';

  return {score,feedback:fb};
}
