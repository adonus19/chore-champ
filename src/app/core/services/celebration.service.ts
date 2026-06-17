import { Injectable, signal } from '@angular/core';

export type CelebrationIntensity = 'small' | 'big';

export interface CelebrationRequest {
  id: number;
  intensity: CelebrationIntensity;
}

/**
 * Lightweight, app-wide celebration trigger. Components call `celebrate()` at win moments (board
 * complete, reward redeemed, goal reached) and the globally mounted confetti overlay reacts. Kept
 * dependency-free and decoupled so any feature can fire a burst without importing the overlay.
 */
@Injectable({
  providedIn: 'root',
})
export class CelebrationService {
  private nextId = 0;
  private readonly _request = signal<CelebrationRequest | null>(null);
  readonly request = this._request.asReadonly();

  celebrate(intensity: CelebrationIntensity = 'big') {
    console.log('[celebration] celebrate() called with intensity:', intensity);
    this._request.set({ id: ++this.nextId, intensity });
  }
}
