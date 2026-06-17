import { Location } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { FirebaseAuthService } from './core/services/firebase-auth.service';
import { MockFamilyData } from './core/services/mock-family-data';
import { PwaInstallService } from './core/services/pwa-install.service';
import { ConfettiOverlay } from './shared/ui/confetti-overlay/confetti-overlay';

type ShellIcon = 'back' | 'dashboard' | 'family' | 'goals' | 'install' | 'kids' | 'login' | 'me' | 'profile' | 'signOut';

interface ShellNavLink {
  exact: boolean;
  icon: ShellIcon;
  label: string;
  path: string;
  strong?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ConfettiOverlay],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly familyData = inject(MockFamilyData);
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly location = inject(Location);
  private readonly pwaInstall = inject(PwaInstallService);
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly familyName = this.familyData.familyName;
  readonly activeViewerBadge = this.familyData.activeViewerBadge;
  readonly isSignedIn = this.familyData.isSignedIn;
  readonly usesParentSelfBoard = this.familyData.usesParentSelfBoard;
  readonly showInstallAction = this.pwaInstall.showInstallAction;
  readonly installActionLabel = this.pwaInstall.installActionLabel;
  readonly installGuideOpen = this.pwaInstall.installGuideOpen;
  readonly shellEyebrow = computed(() =>
    this.isSignedIn() ? this.familyData.currentHouseholdLabel() : 'Family Quest Board',
  );
  readonly brandLink = computed(() => this.familyData.viewerHomeUrl());
  readonly currentRoutePath = computed(() => {
    this.currentUrl();
    return this.activeLeafPath();
  });
  readonly currentPageTitle = computed(() =>
    resolvePageTitle(this.currentRoutePath(), this.activeLeafTitle()),
  );
  readonly primaryNavLinks = computed<ShellNavLink[]>(() => {
    const viewer = this.familyData.viewerSession();
    const activeChild = this.familyData.activeChildViewer();

    if (viewer.kind === 'child' && activeChild) {
      return [
        {
          exact: true,
          icon: 'me',
          label: 'Me',
          path: this.familyData.childRoutePath(activeChild.id, 'today'),
        },
        {
          exact: true,
          icon: 'profile',
          label: 'Profile',
          path: this.familyData.childRoutePath(activeChild.id, 'profile'),
        },
        {
          exact: true,
          icon: 'family',
          label: 'Family',
          path: '/family-access',
        },
        {
          exact: true,
          icon: 'goals',
          label: 'Goals',
          path: this.familyData.childRoutePath(activeChild.id, 'goals'),
        },
      ];
    }

    if (viewer.kind === 'parent') {
      const links: ShellNavLink[] = [];

      if (this.usesParentSelfBoard()) {
        links.push({
          exact: true,
          icon: 'me',
          label: 'Me',
          path: '/parent/me',
        });
      }

      links.push({
        exact: true,
        icon: 'dashboard',
        label: 'Dashboard',
        path: '/',
      });
      links.push({
        exact: true,
        icon: 'family',
        label: 'Family',
        path: '/family-access',
        strong: true,
      });
      links.push({
        exact: true,
        icon: 'kids',
        label: 'Kids',
        path: '/parent/children',
      });

      return links;
    }

    return [
      {
        exact: true,
        icon: 'login',
        label: 'Login',
        path: '/login',
        strong: true,
      },
    ];
  });
  readonly mobileNavLinks = computed(() => this.isSignedIn() ? this.primaryNavLinks() : []);
  readonly showMobileBottomNav = computed(() => this.mobileNavLinks().length > 0);
  readonly showMobileBackButton = computed(() => {
    const path = this.currentPathname();

    if (path === '/login') {
      return false;
    }

    return !this.mobileNavLinks().some((link) => link.path === path);
  });
  readonly mobileInstallLabel = computed(() => (this.showInstallAction() ? 'Install' : ''));

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

  goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      this.location.back();
      return;
    }

    void this.router.navigateByUrl(this.backFallbackPath());
  }

  iconPath(icon: ShellIcon) {
    return SHELL_ICON_PATHS[icon];
  }

  private activeLeafPath() {
    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) {
      route = route.firstChild;
    }

    return route.routeConfig?.path ?? '';
  }

  private activeLeafTitle() {
    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) {
      route = route.firstChild;
    }

    return route.title?.toString() ?? '';
  }

  private backFallbackPath() {
    const routePath = this.currentRoutePath();
    const activeChild = this.familyData.activeChildViewer();

    switch (routePath) {
      case 'signup/parent':
        return '/login';
      case 'parent/quests':
      case 'parent/goals':
      case 'parent/privileges':
      case 'parent/modes':
        return '/';
      case 'children/:childId/rewards':
      case 'children/:childId/goals':
      case 'children/:childId/journal':
        return activeChild ? this.familyData.childRoutePath(activeChild.id, 'today') : '/family-access';
      default:
        return this.mobileNavLinks()[0]?.path ?? this.familyData.viewerHomeUrl();
    }
  }

  private currentPathname() {
    return this.currentUrl().split('?')[0]?.split('#')[0] ?? this.currentUrl();
  }
}

const SHELL_ICON_PATHS: Record<ShellIcon, string> = {
  back: 'M15.75 19.5 8.25 12l7.5-7.5',
  dashboard:
    'M4.5 10.5a2.25 2.25 0 0 1 2.25-2.25h1.5A2.25 2.25 0 0 1 10.5 10.5v7.5a2.25 2.25 0 0 1-2.25 2.25h-1.5A2.25 2.25 0 0 1 4.5 18v-7.5Zm9-4.5a2.25 2.25 0 0 1 2.25-2.25h1.5A2.25 2.25 0 0 1 19.5 6v12a2.25 2.25 0 0 1-2.25 2.25h-1.5A2.25 2.25 0 0 1 13.5 18V6Z',
  family:
    'M9 11.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 1.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM3.75 18a4.5 4.5 0 0 1 9 0v.75h-9V18Zm9.75.75v-.75c0-1.135-.321-2.196-.878-3.097A3.75 3.75 0 0 1 20.25 18v.75H13.5Z',
  goals:
    'M12 3.75c-4.556 0-8.25 3.694-8.25 8.25s3.694 8.25 8.25 8.25 8.25-3.694 8.25-8.25S16.556 3.75 12 3.75Zm0 2.25a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 2.25 1.61 3.264 3.64.53-2.625 2.558.62 3.623L12 16.53l-3.255 1.695.62-3.623-2.625-2.558 3.64-.53L12 8.25Z',
  install: 'M12 3.75v9m0 0 3-3m-3 3-3-3M4.5 15.75v1.5A2.25 2.25 0 0 0 6.75 19.5h10.5a2.25 2.25 0 0 0 2.25-2.25v-1.5',
  kids:
    'M7.5 7.5a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Zm4.313 6.808A4.488 4.488 0 0 0 9.75 13.5a4.488 4.488 0 0 0-2.063.808A3.74 3.74 0 0 0 5.25 18v.75h9V18a3.74 3.74 0 0 0-2.437-3.692ZM15.75 8.25a1.875 1.875 0 1 0 0 3.75 1.875 1.875 0 0 0 0-3.75Zm-1.125 10.5v-.75c0-.79-.19-1.535-.527-2.193.446-.2.94-.307 1.452-.307A3.75 3.75 0 0 1 19.5 18v.75h-4.875Z',
  login:
    'M15.75 3.75h-7.5A2.25 2.25 0 0 0 6 6v12a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 18V6a2.25 2.25 0 0 0-2.25-2.25Zm-3 10.5 2.25-2.25-2.25-2.25m2.25 2.25H9',
  me: 'M12 12a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Zm-6.75 7.5a6.75 6.75 0 1 1 13.5 0v.75H5.25v-.75Z',
  profile:
    'M6.75 4.5A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 17.25 4.5H6.75ZM12 8.25a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Zm0 5.625c1.922 0 3.58.993 4.5 2.486V17.25h-9v-.889c.92-1.493 2.578-2.486 4.5-2.486Z',
  signOut: 'M15.75 9V6A2.25 2.25 0 0 0 13.5 3.75h-6A2.25 2.25 0 0 0 5.25 6v12A2.25 2.25 0 0 0 7.5 20.25h6A2.25 2.25 0 0 0 15.75 18v-3m-6-3h10.5m0 0-3-3m3 3-3 3',
};

function resolvePageTitle(routePath: string, fallbackTitle: string) {
  switch (routePath) {
    case '':
      return 'Dashboard';
    case 'family-access':
      return 'Family Page';
    case 'children/:childId/today':
      return 'My Board';
    case 'children/:childId/profile':
      return 'My Profile';
    case 'children/:childId/rewards':
      return 'Rewards';
    case 'children/:childId/goals':
      return 'Goals';
    case 'children/:childId/journal':
      return 'Journal';
    case 'parent/quests':
      return 'Quest Desk';
    case 'parent/children':
      return 'Kids';
    case 'parent/goals':
      return 'Goals';
    case 'parent/me':
      return 'My Board';
    case 'parent/privileges':
      return 'Privileges';
    case 'parent/modes':
      return 'Seasonal Modes';
    case 'login':
      return 'Login';
    case 'signup/parent':
      return 'Parent Signup';
    default:
      return fallbackTitle.replace('Chore Champ | ', '') || 'Chore Champ';
  }
}
