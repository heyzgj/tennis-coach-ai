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
export function evaluateMetrics(m: Metrics): FeedbackResult {
  // 粗略评分：肩转占 40%，速度 30%，距离 20%，节奏 10%
  const shoulder = Math.min(m.maxShoulderTurn, 120) / 120;      // 0-1
  const speed    = m.peakArmSpeed / 100;
  const dist     = Math.min(m.contactMetrics.distanceFromCore, 120) / 120;
  const rhythm   = m.swingRhythm / 100;

  const score = Math.round(
    shoulder * 40 + speed * 30 + dist * 20 + rhythm * 10
  );

  // 模板选择
  let feedback = "动作不错，继续保持！";
  if (score > 85) feedback = "挥拍出色！维持节奏，再接再厉！";
  else if (score > 70) feedback = "很好！多转肩，力量更集中！";
  else if (m.maxShoulderTurn < 50) feedback = "转肩不足，试着大幅带动肩膀！";
  else if (m.contactMetrics.distanceFromCore < 40) feedback = "伸直手臂，扩大击球距离！";
  else if (speed < 0.4) feedback = "加快最后挥拍速度，提升击球质量！";
  else feedback = "节奏略乱，放松肩膀，连贯挥拍！";

  return { score, feedback };
}
