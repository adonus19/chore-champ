import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';

import { MockFamilyData } from './mock-family-data';

type PreloadAudience = 'always' | 'signedIn' | 'parent';

@Injectable({
  providedIn: 'root',
})
export class RoleAwarePreloadingStrategy implements PreloadingStrategy {
  private readonly familyData = inject(MockFamilyData);

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    const audience = route.data?.['preload'] as PreloadAudience | undefined;

    if (!audience || !this.shouldPreload(audience)) {
      return of(null);
    }

    return load();
  }

  private shouldPreload(audience: PreloadAudience) {
    switch (audience) {
      case 'always':
        return true;
      case 'signedIn':
        return this.familyData.isSignedIn();
      case 'parent':
        return this.familyData.canAccessParentViews();
      default:
        return false;
    }
  }
}
