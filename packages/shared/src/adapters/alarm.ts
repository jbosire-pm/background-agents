/**
 * Portable alarm/scheduler interface.
 *
 * Replaces Durable Object ctx.storage.setAlarm/getAlarm.
 * Implementations: DO alarms (Cloudflare), setTimeout + persistence (Node.js).
 */

export interface AlarmScheduler {
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
