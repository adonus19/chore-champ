import { ApplicationRef, DestroyRef, Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { concat, filter, fromEvent, interval, take } from 'rxjs';
import { DOCUMENT } from '@angular/common';

const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class PwaUpdateService {
  private readonly applicationRef = inject(ApplicationRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly swUpdate = inject(SwUpdate);

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return;
    }

    const appStable$ = this.applicationRef.isStable.pipe(
      filter((isStable) => isStable),
      take(1),
    );

    const updateCheckSubscription = concat(appStable$, interval(UPDATE_CHECK_INTERVAL_MS)).subscribe(() => {
      void this.checkForUpdate();
    });

    const visibilitySubscription = fromEvent(this.document, 'visibilitychange').subscribe(() => {
      if (this.document.visibilityState === 'visible') {
        void this.checkForUpdate();
      }
    });

    const versionSubscription = this.swUpdate.versionUpdates.subscribe((event) => {
      switch (event.type) {
        case 'VERSION_READY':
          void this.activateAndReload(event);
          break;
        case 'VERSION_INSTALLATION_FAILED':
          console.error('PWA update installation failed.', event.error);
          break;
      }
    });

    this.destroyRef.onDestroy(() => {
      updateCheckSubscription.unsubscribe();
      visibilitySubscription.unsubscribe();
      versionSubscription.unsubscribe();
    });
  }

  private async checkForUpdate(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      console.error('PWA update check failed.', error);
    }
  }

  private async activateAndReload(event: VersionReadyEvent): Promise<void> {
    try {
      await this.swUpdate.activateUpdate();
      this.document.location.reload();
    } catch (error) {
      console.error('PWA update activation failed.', {
        error,
        currentVersion: event.currentVersion,
        latestVersion: event.latestVersion,
      });
    }
  }
}
