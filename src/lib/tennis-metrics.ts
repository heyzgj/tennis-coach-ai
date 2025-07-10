// src/lib/tennis-metrics.ts

import { Pose, Metrics, PoseLandmarkIndex } from './types';

/**
 * A world-class system for calculating advanced tennis-specific metrics from a sequence of pose data.
 * This class provides a deep biomechanical analysis of a tennis swing.
 */
export class TennisMetricsCalculator {
  private static readonly MIN_VISIBILITY = 0.4; // Slightly lower threshold to accept more real-world data

  /**
   * The main public method. Calculates a comprehensive set of metrics from a pose sequence.
   * @param poses - An array of Pose objects representing the swing.
   * @returns A Metrics object with detailed analysis.
   */
  public static calculateMetrics(poses: Pose[]): Metrics {
    if (poses.length < 5) {
      // Not enough data for a meaningful analysis
      return this._getEmptyMetrics();
    }

    const peakArmSpeedData = this._calculatePeakArmSpeed(poses);
    const contactFrameIndex = peakArmSpeedData.peakFrameIndex;
    const contactFrame = poses[contactFrameIndex];

    return {
      maxShoulderTurn: this._calculateMaxShoulderTurn(poses),
      peakArmSpeed: peakArmSpeedData.speed,
      contactMetrics: this._calculateContactMetrics(contactFrame),
      swingRhythm: this._calculateSwingRhythm(poses),
    };
  }

  /**
   * Returns a default/empty metrics object.
   */
  private static _getEmptyMetrics(): Metrics {
    return {
      maxShoulderTurn: 0,
      peakArmSpeed: 0,
      contactMetrics: {
        distanceFromCore: 0,
        armAngle: 0,
        isFrontContact: false,
      },
      swingRhythm: 0,
    };
  }

  // --- PRIVATE CALCULATION METHODS ---

  /**
   * Calculates the true maximum shoulder turn by measuring the shoulder line's angle
   * relative to the hip line. This is superior as it's independent of camera tilt.
   * @returns The maximum rotation in degrees.
   */
  private static _calculateMaxShoulderTurn(poses: Pose[]): number {
    let maxTurn = 0;
    for (const pose of poses) {
      const leftShoulder = pose.points[PoseLandmarkIndex.LEFT_SHOULDER];
      const rightShoulder = pose.points[PoseLandmarkIndex.RIGHT_SHOULDER];
      const leftHip = pose.points[PoseLandmarkIndex.LEFT_HIP];
      const rightHip = pose.points[PoseLandmarkIndex.RIGHT_HIP];

      if (this._areLandmarksVisible([leftShoulder, rightShoulder, leftHip, rightHip])) {
        const shoulderVector = this._calculateVector(leftShoulder, rightShoulder);
        const hipVector = this._calculateVector(leftHip, rightHip);
        const angle = this._calculateAngleBetweenVectors(shoulderVector, hipVector);
        if (angle > maxTurn) {
          maxTurn = angle;
        }
      }
    }
    return Math.round(maxTurn);
  }

  /**
   * Calculates the peak speed of the swinging arm's wrist.
   * It also crucially returns the index of the frame where this peak speed occurred,
   * which we use as a proxy for the ball contact frame.
   * @returns An object containing the speed (0-100 score) and the index of the peak frame.
   */
  private static _calculatePeakArmSpeed(poses: Pose[]): { speed: number, peakFrameIndex: number } {
    let maxVelocity = 0;
    let peakFrameIndex = 0;

    for (let i = 1; i < poses.length; i++) {
      const prev = poses[i - 1];
      const curr = poses[i];
      const dt = (curr.ts - prev.ts) / 1000;
      if (dt <= 0) continue;

      const prevWrist = prev.points[PoseLandmarkIndex.RIGHT_WRIST];
      const currWrist = curr.points[PoseLandmarkIndex.RIGHT_WRIST];

      if (this._areLandmarksVisible([prevWrist, currWrist])) {
        const distance = this._calculateDistance(prevWrist, currWrist);
        const velocity = distance / dt;
        if (velocity > maxVelocity) {
          maxVelocity = velocity;
          peakFrameIndex = i;
        }
      }
    }
    // Convert a raw velocity (e.g., 0-5) to a more intuitive 0-100 score.
    const speedScore = Math.min(100, maxVelocity * 50);
    return { speed: Math.round(speedScore), peakFrameIndex };
  }

  /**
   * Analyzes key metrics at the moment of "contact" (approximated by peak arm speed).
   * This provides a snapshot of the most critical part of the swing.
   * @param contactFrame - The single Pose object at the point of contact.
   * @returns An object with detailed contact metrics.
   */
  private static _calculateContactMetrics(contactFrame: Pose): Metrics['contactMetrics'] {
    const shoulder = contactFrame.points[PoseLandmarkIndex.RIGHT_SHOULDER];
    const elbow = contactFrame.points[PoseLandmarkIndex.RIGHT_ELBOW];
    const wrist = contactFrame.points[PoseLandmarkIndex.RIGHT_WRIST];
    const hip = this._getHipCenter(contactFrame);

    if (!this._areLandmarksVisible([shoulder, elbow, wrist]) || !hip) {
      return { distanceFromCore: 0, armAngle: 0, isFrontContact: false };
    }

    // 1. Distance from body core to wrist (measures extension)
    const distanceFromCore = this._calculateDistance(hip, wrist) * 150; // Convert to rough cm scale

    // 2. Arm angle at the elbow (measures how straight the arm is)
    const upperArmVec = this._calculateVector(shoulder, elbow);
    const forearmVec = this._calculateVector(elbow, wrist);
    const armAngle = this._calculateAngleBetweenVectors(upperArmVec, forearmVec);
    
    // 3. Contact point position (in front or behind the body)
    // A lower z-value means closer to the camera. We want the wrist to be closer than the shoulder.
    const isFrontContact = wrist.z < shoulder.z;

    return {
      distanceFromCore: Math.round(distanceFromCore),
      armAngle: Math.round(armAngle),
      isFrontContact,
    };
  }

  /**
   * Calculates the rhythm and smoothness of the swing.
   * A low score indicates a jerky, inconsistent motion. A high score indicates a smooth, rhythmic swing.
   * It uses the Coefficient of Variation of frame intervals.
   * @returns A score from 0 to 100.
   */
  private static _calculateSwingRhythm(poses: Pose[]): number {
    if (poses.length < 3) return 0;

    const intervals = [];
    for (let i = 1; i < poses.length; i++) {
      intervals.push(poses[i].ts - poses[i - 1].ts);
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(intervals.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / intervals.length);

    // Coefficient of Variation (CV) - a measure of relative variability.
    const cv = mean > 0 ? stdDev / mean : 0;

    // Convert CV into a 0-100 score. Lower CV (less variation) is better.
    const rhythmScore = Math.max(0, 100 - (cv * 200));
    return Math.round(rhythmScore);
  }

  // --- PRIVATE HELPER UTILITIES ---

  private static _areLandmarksVisible(landmarks: (Pose['points'][0] | undefined)[]): boolean {
    return landmarks.every(lm => lm && (lm.visibility ?? 0) > this.MIN_VISIBILITY);
  }

  private static _getHipCenter(pose: Pose): Pose['points'][0] | null {
    const leftHip = pose.points[PoseLandmarkIndex.LEFT_HIP];
    const rightHip = pose.points[PoseLandmarkIndex.RIGHT_HIP];
    if (this._areLandmarksVisible([leftHip, rightHip])) {
      return {
        x: (leftHip.x + rightHip.x) / 2,
        y: (leftHip.y + rightHip.y) / 2,
        z: (leftHip.z + rightHip.z) / 2,
      };
    }
    return null;
  }
  
  private static _calculateDistance(p1: Pose['points'][0], p2: Pose['points'][0]): number {
      return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
  }

  private static _calculateVector(from: Pose['points'][0], to: Pose['points'][0]): { x: number; y: number } {
    return { x: to.x - from.x, y: to.y - from.y };
  }

  private static _calculateAngleBetweenVectors(v1: { x: number; y: number }, v2: { x: number; y: number }): number {
    const dotProduct = v1.x * v2.x + v1.y * v2.y;
    const magnitude1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const magnitude2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    const cosAngle = dotProduct / (magnitude1 * magnitude2);
    // Clamp the value to avoid floating point errors with acos
    const clampedCos = Math.max(-1, Math.min(1, cosAngle));
    return Math.acos(clampedCos) * (180 / Math.PI);
  }
}