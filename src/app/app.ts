import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { FirebaseAuthService } from './core/services/firebase-auth.service';
import { MockFamilyData } from './core/services/mock-family-data';
import { PwaInstallService } from './core/services/pwa-install.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly familyData = inject(MockFamilyData);
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly pwaInstall = inject(PwaInstallService);
  private readonly router = inject(Router);

  readonly familyName = this.familyData.familyName;
  readonly activeViewerBadge = this.familyData.activeViewerBadge;
  readonly isSignedIn = this.familyData.isSignedIn;
  readonly usesParentSelfBoard = this.familyData.usesParentSelfBoard;
  readonly showInstallAction = this.pwaInstall.showInstallAction;
  readonly installActionLabel = this.pwaInstall.installActionLabel;
  readonly installGuideOpen = this.pwaInstall.installGuideOpen;
  readonly shellTitle = computed(() =>
    this.isSignedIn() ? `Household: ${this.familyData.currentHouseholdLabel()}` : 'Sign in to open your family lane',
  );
  readonly brandLink = computed(() => this.familyData.viewerHomeUrl());
  readonly navLinks = computed(() => {
    const viewer = this.familyData.viewerSession();
    const activeChild = this.familyData.activeChildViewer();

    if (viewer.kind === 'child' && activeChild) {
      return [
        {
          label: 'My board',
          path: this.familyData.childRoutePath(activeChild.id, 'today'),
          strong: false,
        },
        {
          label: 'My profile',
          path: this.familyData.childRoutePath(activeChild.id, 'profile'),
          strong: false,
        },
        {
          label: 'Family access',
          path: '/family-access',
          strong: true,
        },
      ];
    }

    if (viewer.kind === 'parent') {
      const links = [
        {
          label: 'Dashboard',
          path: '/',
          strong: false,
        },
      ];

      if (this.usesParentSelfBoard()) {
        links.push({
          label: 'My board',
          path: '/parent/me',
          strong: false,
        });
      }

      links.push({
        label: 'Family access',
        path: '/family-access',
        strong: true,
      });

      return links;
    }

    return [
      {
        label: 'Login',
        path: '/login',
        strong: true,
      },
    ];
  });

  async signOut() {
    await this.firebaseAuth.signOut();
    this.familyData.signOut();
    void this.router.navigateByUrl('/login');
  }

  async installApp() {
    await this.pwaInstall.requestInstall();
  }

  closeInstallGuide() {
    this.pwaInstall.closeInstallGuide();
  }
}
