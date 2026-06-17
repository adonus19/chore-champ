import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { FirebaseAuthService } from '../services/firebase-auth.service';
import { FirebaseUserProfileService } from '../services/firebase-user-profile.service';
import { MockFamilyData } from '../services/mock-family-data';
import { withTimeout } from '../utils/with-timeout';

const CHILD_ROUTE_SECTIONS = ['today', 'profile', 'rewards', 'goals', 'journal'] as const;
type ChildRouteSection = (typeof CHILD_ROUTE_SECTIONS)[number];
const ROUTE_DATA_TIMEOUT_MS = 12000;

export const parentOnlyGuard: CanActivateFn = async () => {
  const firebaseAuth = inject(FirebaseAuthService);
  const firebaseUserProfile = inject(FirebaseUserProfileService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);

  await firebaseAuth.waitForAuthReady();

  if (firebaseAuth.isAuthenticated()) {
    const profileReady = await waitForProfileReadyOrRecover(firebaseAuth, firebaseUserProfile, familyData);

    if (!profileReady) {
      return router.parseUrl('/login');
    }
  }

  return familyData.canAccessParentViews() ? true : router.parseUrl(familyData.parentAccessFallbackUrl());
};

export const signedOutOnlyGuard: CanActivateFn = async (_route, state) => {
  const firebaseAuth = inject(FirebaseAuthService);
  const firebaseUserProfile = inject(FirebaseUserProfileService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);

  await firebaseAuth.waitForAuthReady();

  if (!firebaseAuth.isAuthenticated()) {
    return true;
  }

  const profileReady = await waitForProfileReadyOrRecover(firebaseAuth, firebaseUserProfile, familyData);

  if (!profileReady) {
    return true;
  }

  const profile = firebaseUserProfile.currentProfile();

  if (!profile) {
    return cleanRoutePath(state.url) === '/signup/parent' ? true : router.parseUrl('/signup/parent');
  }

  if (profile?.role === 'child' && profile.childId) {
    return router.parseUrl(familyData.childRoutePath(profile.childId));
  }

  return router.parseUrl('/family-access');
};

export const signedInGuard: CanActivateFn = async () => {
  const firebaseAuth = inject(FirebaseAuthService);
  const router = inject(Router);

  await firebaseAuth.waitForAuthReady();

  return firebaseAuth.isAuthenticated() ? true : router.parseUrl('/login');
};

export const childViewerGuard: CanActivateFn = async (route, state) => {
  const firebaseAuth = inject(FirebaseAuthService);
  const firebaseUserProfile = inject(FirebaseUserProfileService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);
  const childId = route.paramMap.get('childId') ?? '';

  await firebaseAuth.waitForAuthReady();

  if (!firebaseAuth.isAuthenticated()) {
    return router.parseUrl('/login');
  }

  const profileReady = await waitForProfileReadyOrRecover(firebaseAuth, firebaseUserProfile, familyData);

  if (!profileReady) {
    return router.parseUrl('/login');
  }

  const profile = firebaseUserProfile.currentProfile();

  if (profile?.source === 'authAccount' && profile.role === 'parent') {
    return true;
  }

  const householdReady = await waitForHouseholdDataReadyOrRecover(firebaseAuth, familyData);

  if (!householdReady) {
    return router.parseUrl('/login');
  }

  return familyData.canAccessChildView(childId)
    ? true
    : router.parseUrl(familyData.childAccessFallbackUrl(resolveChildSection(state.url)));
};

function resolveChildSection(url: string): ChildRouteSection {
  const cleanUrl = cleanRoutePath(url);
  const section = cleanUrl.split('/')[3];

  return isChildRouteSection(section) ? section : 'today';
}

function isChildRouteSection(section?: string): section is ChildRouteSection {
  return Boolean(section && CHILD_ROUTE_SECTIONS.includes(section as ChildRouteSection));
}

function cleanRoutePath(url: string) {
  return url.split('?')[0]?.split('#')[0] ?? '';
}

async function waitForProfileReadyOrRecover(
  firebaseAuth: FirebaseAuthService,
  firebaseUserProfile: FirebaseUserProfileService,
  familyData: MockFamilyData,
) {
  try {
    await withTimeout(
      firebaseUserProfile.waitForProfileReady(),
      ROUTE_DATA_TIMEOUT_MS,
      'The signed-in account took too long to open.',
    );
    return true;
  } catch {
    await firebaseAuth.signOut();
    familyData.signOut();
    return false;
  }
}

async function waitForHouseholdDataReadyOrRecover(firebaseAuth: FirebaseAuthService, familyData: MockFamilyData) {
  try {
    await withTimeout(
      familyData.waitForHouseholdDataReady(),
      ROUTE_DATA_TIMEOUT_MS,
      'The family data took too long to open.',
    );
    return true;
  } catch {
    await firebaseAuth.signOut();
    familyData.signOut();
    return false;
  }
}
