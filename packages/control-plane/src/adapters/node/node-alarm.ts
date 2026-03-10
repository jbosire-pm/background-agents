/**
 * Node.js implementation of the AlarmScheduler interface.
 *
 * Uses setTimeout for scheduling with an optional callback
 * when the alarm fires.
 */

import type { AlarmScheduler } from "@open-inspect/shared";

export class NodeAlarmScheduler implements AlarmScheduler {
  private scheduledTime: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onAlarm: (() => Promise<void>) | undefined;

  constructor(onAlarm?: () => Promise<void>) {
    this.onAlarm = onAlarm;
  }

  async getAlarm(): Promise<number | null> {
    return this.scheduledTime;
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.clearTimer();
    this.scheduledTime = scheduledTime;

    const delay = Math.max(0, scheduledTime - Date.now());
    this.timer = setTimeout(async () => {
      this.scheduledTime = null;
      this.timer = null;
      if (this.onAlarm) {
        await this.onAlarm();
      }
    }, delay);
  }

  async deleteAlarm(): Promise<void> {
    this.clearTimer();
    this.scheduledTime = null;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.clearTimer();
  }
}
