import { Injectable, effect, inject } from '@angular/core';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

type WarmAudience = 'signedIn' | 'parent' | 'child';

@Injectable({
  providedIn: 'root',
})
export class RouteWarmupService {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly warmedAudiences = new Set<WarmAudience>();

  constructor() {
    effect(() => {
      if (!this.firebaseAuth.authReady() || !this.firebaseAuth.isAuthenticated()) {
        this.warmedAudiences.clear();
        return;
      }

      this.scheduleWarmup('signedIn');

      const profile = this.firebaseUserProfile.currentProfile();

      if (profile?.source !== 'authAccount') {
        return;
      }

      if (profile.role === 'parent') {
        this.scheduleWarmup('parent');
        return;
      }

      if (profile.role === 'child') {
        this.scheduleWarmup('child');
      }
    });
  }

  private scheduleWarmup(audience: WarmAudience) {
    if (this.warmedAudiences.has(audience)) {
      return;
    }

    this.warmedAudiences.add(audience);
    queueWarmup(() => void this.warmAudience(audience));
  }

  private async warmAudience(audience: WarmAudience) {
    switch (audience) {
      case 'signedIn':
        await import('../../features/account/family-access-page/family-access-page');
        return;
      case 'parent':
        await Promise.all([
          import('../../features/dashboard/dashboard-page/dashboard-page'),
          import('../../features/parent-admin/parent-admin-page/parent-admin-page'),
          import('../../features/child-profile/parent-child-profiles-page/parent-child-profiles-page'),
          import('../../features/goals/parent-goals-page/parent-goals-page'),
          import('../../features/parent-self/my-board-page/my-board-page'),
          import('../../features/privileges/privileges-page/privileges-page'),
          import('../../features/seasonal-modes/seasonal-modes-page/seasonal-modes-page'),
        ]);
        return;
      case 'child':
        await Promise.all([
          import('../../features/child-today/child-today-page/child-today-page'),
          import('../../features/child-profile/child-profile-page/child-profile-page'),
          import('../../features/rewards/rewards-page/rewards-page'),
          import('../../features/goals/goals-page/goals-page'),
          import('../../features/journal/journal-page/journal-page'),
        ]);
        return;
    }
  }
}

function queueWarmup(task: () => void) {
  if (typeof window === 'undefined') {
    queueMicrotask(task);
    return;
  }

  const requestIdleCallback = window.requestIdleCallback?.bind(window);

  if (requestIdleCallback) {
    requestIdleCallback(task, {
      timeout: 1200,
    });
    return;
  }

  window.setTimeout(task, 150);
}
