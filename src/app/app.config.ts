import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { PwaUpdateService } from './core/services/pwa-update.service';
import { RoleAwarePreloadingStrategy } from './core/services/role-aware-preloading-strategy.service';
import { RouteWarmupService } from './core/services/route-warmup.service';
import { routes } from './app.routes';
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withPreloading(RoleAwarePreloadingStrategy),
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
    provideAppInitializer(() => {
      inject(RouteWarmupService);
    }),
    provideAppInitializer(() => {
      inject(PwaUpdateService);
    }),
  ],
};
