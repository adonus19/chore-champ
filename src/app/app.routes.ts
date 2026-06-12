import { Routes } from '@angular/router';

import { childViewerGuard, parentOnlyGuard, signedInGuard, signedOutOnlyGuard } from './core/guards/viewer-access.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [signedOutOnlyGuard],
    loadComponent: () => import('./features/auth/login-page/login-page').then((module) => module.LoginPage),
    title: 'Chore Champ | Login',
  },
  {
    path: 'signup/parent',
    canActivate: [signedOutOnlyGuard],
    loadComponent: () =>
      import('./features/auth/parent-signup-page/parent-signup-page').then((module) => module.ParentSignupPage),
    title: 'Chore Champ | Parent Signup',
  },
  {
    path: 'family-access',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./features/account/family-access-page/family-access-page').then((module) => module.FamilyAccessPage),
    title: 'Chore Champ | Family Access',
  },
  {
    path: '',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard-page/dashboard-page').then((module) => module.DashboardPage),
    title: 'Chore Champ | Family Dashboard',
    pathMatch: 'full',
  },
  {
    path: 'children/:childId/today',
    canActivate: [childViewerGuard],
    loadComponent: () =>
      import('./features/child-today/child-today-page/child-today-page').then((module) => module.ChildTodayPage),
    title: 'Chore Champ | Child Today',
  },
  {
    path: 'children/:childId/profile',
    canActivate: [childViewerGuard],
    loadComponent: () =>
      import('./features/child-profile/child-profile-page/child-profile-page').then((module) => module.ChildProfilePage),
    title: 'Chore Champ | Child Profile',
  },
  {
    path: 'children/:childId/rewards',
    canActivate: [childViewerGuard],
    loadComponent: () =>
      import('./features/rewards/rewards-page/rewards-page').then((module) => module.RewardsPage),
    title: 'Chore Champ | Rewards',
  },
  {
    path: 'children/:childId/goals',
    canActivate: [childViewerGuard],
    loadComponent: () =>
      import('./features/goals/goals-page/goals-page').then((module) => module.GoalsPage),
    title: 'Chore Champ | Goals',
  },
  {
    path: 'children/:childId/journal',
    canActivate: [childViewerGuard],
    loadComponent: () =>
      import('./features/journal/journal-page/journal-page').then((module) => module.JournalPage),
    title: 'Chore Champ | Journal',
  },
  {
    path: 'parent/quests',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/parent-admin/parent-admin-page/parent-admin-page').then((module) => module.ParentAdminPage),
    title: 'Chore Champ | Parent Quest Manager',
  },
  {
    path: 'parent/children',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/child-profile/parent-child-profiles-page/parent-child-profiles-page').then(
        (module) => module.ParentChildProfilesPage,
      ),
    title: 'Chore Champ | Parent Child Profiles',
  },
  {
    path: 'parent/goals',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/goals/parent-goals-page/parent-goals-page').then((module) => module.ParentGoalsPage),
    title: 'Chore Champ | Parent Goals Manager',
  },
  {
    path: 'parent/me',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/parent-self/my-board-page/my-board-page').then((module) => module.MyBoardPage),
    title: 'Chore Champ | My Goals & Quests',
  },
  {
    path: 'parent/privileges',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/privileges/privileges-page/privileges-page').then((module) => module.PrivilegesPage),
    title: 'Chore Champ | Privilege Settings',
  },
  {
    path: 'parent/modes',
    canActivate: [parentOnlyGuard],
    loadComponent: () =>
      import('./features/seasonal-modes/seasonal-modes-page/seasonal-modes-page').then(
        (module) => module.SeasonalModesPage,
      ),
    title: 'Chore Champ | Seasonal Modes',
  },
  {
    path: '**',
    redirectTo: '',
  },
];
