import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { fromEvent } from 'rxjs';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

@Injectable({
  providedIn: 'root',
})
export class PwaInstallService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly window = this.document.defaultView;
  private readonly deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);
  private readonly standaloneMode = signal(this.detectStandaloneMode());
  readonly installGuideOpen = signal(false);

  readonly canPromptInstall = computed(() => this.deferredPrompt() !== null);
  readonly canShowIosGuide = computed(() => this.isIosDevice() && !this.standaloneMode());
  readonly showInstallAction = computed(
    () => !this.standaloneMode() && (this.canPromptInstall() || this.canShowIosGuide()),
  );
  readonly installActionLabel = computed(() => (this.canPromptInstall() ? 'Install app' : 'Add to home screen'));

  constructor() {
    if (!this.window) {
      return;
    }

    const beforeInstallPromptSubscription = fromEvent<Event>(this.window, 'beforeinstallprompt').subscribe((event) => {
      event.preventDefault();
      this.deferredPrompt.set(event as BeforeInstallPromptEvent);
    });

    const appInstalledSubscription = fromEvent(this.window, 'appinstalled').subscribe(() => {
      this.deferredPrompt.set(null);
      this.installGuideOpen.set(false);
      this.syncStandaloneMode();
    });

    const visibilitySubscription = fromEvent(this.document, 'visibilitychange').subscribe(() => {
      this.syncStandaloneMode();
    });

    this.destroyRef.onDestroy(() => {
      beforeInstallPromptSubscription.unsubscribe();
      appInstalledSubscription.unsubscribe();
      visibilitySubscription.unsubscribe();
    });
  }

  async requestInstall(): Promise<void> {
    const promptEvent = this.deferredPrompt();

    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;

      if (choice.outcome === 'accepted') {
        this.deferredPrompt.set(null);
      }

      return;
    }

    if (this.canShowIosGuide()) {
      this.installGuideOpen.set(true);
    }
  }

  closeInstallGuide(): void {
    this.installGuideOpen.set(false);
  }

  private syncStandaloneMode(): void {
    this.standaloneMode.set(this.detectStandaloneMode());
  }

  private detectStandaloneMode(): boolean {
    if (!this.window) {
      return false;
    }

    const standaloneNavigator = this.window.navigator as Navigator & {
      standalone?: boolean;
    };

    return this.window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
  }

  private isIosDevice(): boolean {
    if (!this.window) {
      return false;
    }

    return /iphone|ipad|ipod/i.test(this.window.navigator.userAgent);
  }
}
