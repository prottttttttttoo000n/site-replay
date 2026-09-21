import type { ReplayEvent } from "../types";

export class ReplayPlayer {
  private events: ReplayEvent[] = [];
  private currentIndex = 0;
  private startTime = 0;
  private isPlaying = false;
  private speed = 1;
  private animationFrame = 0;
  private onEvent: (event: ReplayEvent) => void;
  private onProgress: (progress: number) => void;
  private onEnd: () => void;

  constructor(
    events: ReplayEvent[],
    onEvent: (e: ReplayEvent) => void,
    onProgress: (p: number) => void,
    onEnd: () => void
  ) {
    this.events = events;
    this.onEvent = onEvent;
    this.onProgress = onProgress;
    this.onEnd = onEnd;
  }

  play() {
    this.isPlaying = true;
    this.startTime = performance.now() - (this.events[this.currentIndex]?.timestamp || 0) / this.speed;
    this.tick();
  }

  pause() {
    this.isPlaying = false;
    cancelAnimationFrame(this.animationFrame);
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(timestamp: number) {
    this.currentIndex = this.events.findIndex((e) => e.timestamp >= timestamp);
    if (this.currentIndex === -1) this.currentIndex = this.events.length - 1;
    this.startTime = performance.now() - timestamp / this.speed;
  }

  setSpeed(speed: number) {
    this.speed = speed;
    if (this.isPlaying) {
      this.startTime = performance.now() - this.currentTimestamp() / speed;
    }
  }

  getCurrentTime(): number {
    return this.currentTimestamp();
  }

  getDuration(): number {
    return this.events[this.events.length - 1]?.timestamp || 0;
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  private tick() {
    if (!this.isPlaying) return;

    const elapsed = (performance.now() - this.startTime) * this.speed;

    while (this.currentIndex < this.events.length && this.events[this.currentIndex].timestamp <= elapsed) {
      this.onEvent(this.events[this.currentIndex]);
      this.currentIndex++;
    }

    const duration = this.getDuration();
    this.onProgress(duration > 0 ? elapsed / duration : 0);

    if (this.currentIndex < this.events.length) {
      this.animationFrame = requestAnimationFrame(() => this.tick());
    } else {
      this.isPlaying = false;
      this.onEnd();
    }
  }

  private currentTimestamp(): number {
    return this.events[this.currentIndex]?.timestamp || 0;
  }
}
