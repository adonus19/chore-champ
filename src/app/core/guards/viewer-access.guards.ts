import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { FirebaseAuthService } from '../services/firebase-auth.service';
import { MockFamilyData } from '../services/mock-family-data';

const CHILD_ROUTE_SECTIONS = ['today', 'profile', 'rewards', 'goals', 'journal'] as const;
type ChildRouteSection = (typeof CHILD_ROUTE_SECTIONS)[number];

export const parentOnlyGuard: CanActivateFn = async () => {
  const firebaseAuth = inject(FirebaseAuthService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);

  await firebaseAuth.waitForAuthReady();

  return familyData.canAccessParentViews() ? true : router.parseUrl(familyData.parentAccessFallbackUrl());
};

export const signedOutOnlyGuard: CanActivateFn = async () => {
  const firebaseAuth = inject(FirebaseAuthService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);

  await firebaseAuth.waitForAuthReady();

  return familyData.isSignedIn() && familyData.viewerSession().kind !== 'shared'
    ? router.parseUrl(familyData.viewerHomeUrl())
    : true;
};

export const signedInGuard: CanActivateFn = async () => {
  const firebaseAuth = inject(FirebaseAuthService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);

  await firebaseAuth.waitForAuthReady();

  return familyData.isSignedIn() ? true : router.parseUrl('/login');
};

export const childViewerGuard: CanActivateFn = async (route, state) => {
  const firebaseAuth = inject(FirebaseAuthService);
  const familyData = inject(MockFamilyData);
  const router = inject(Router);
  const childId = route.paramMap.get('childId') ?? '';

  await firebaseAuth.waitForAuthReady();

  return familyData.canAccessChildView(childId)
    ? true
    : router.parseUrl(familyData.childAccessFallbackUrl(resolveChildSection(state.url)));
};

function resolveChildSection(url: string): ChildRouteSection {
  const cleanUrl = url.split('?')[0]?.split('#')[0] ?? '';
  const section = cleanUrl.split('/')[3];

  return isChildRouteSection(section) ? section : 'today';
}

function isChildRouteSection(section?: string): section is ChildRouteSection {
  return Boolean(section && CHILD_ROUTE_SECTIONS.includes(section as ChildRouteSection));
}
