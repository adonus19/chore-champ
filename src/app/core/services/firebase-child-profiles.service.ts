import { Injectable, inject } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, ChildProfile, ChildProfileDraft, HouseholdSwitchPolicy } from '../models/family.models';
import { buildChildInternalEmailAlias, normalizeChildUsername } from '../utils/child-login';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const MEMBERS_SUBCOLLECTION = 'members';
const CHILD_STATE_SUBCOLLECTION = 'childState';

interface ChildProfileDocument {
  childPersonId?: string;
  profile?: {
    displayName?: string;
    ageYears?: number | null;
    avatarLabel?: string | null;
    themeColor?: string | null;
  };
  login?: {
    enabled?: boolean;
    authUid?: string | null;
    usernameNormalized?: string | null;
    usernameDisplay?: string | null;
  };
}

interface ChildStateDocument {
  childPersonId?: string;
  points?: number;
  streakDays?: number;
  activeModeId?: string | null;
  currentBook?: string | null;
  currentLifeSkill?: string | null;
  sportsGoal?: string | null;
  yearGoal?: string | null;
}

interface ChildMembershipDocument {
  role?: string;
  status?: string;
  permissions?: {
    canManageChildren?: boolean;
    canManageChildCredentials?: boolean;
  };
  childPolicies?: {
    householdSwitchPolicy?: HouseholdSwitchPolicy;
  };
}

interface UsernameIndexDocument {
  normalizedUsername?: string;
  usernameDisplay?: string;
  childPersonId?: string;
  authUid?: string | null;
  internalEmailAlias?: string | null;
  status?: 'reserved' | 'active' | 'disabled';
}

interface HouseholdChildMutationResult {
  child?: ChildProfile;
  message?: string;
  ok: boolean;
}

interface ChildLoginDraft {
  password: string;
  username: string;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseChildProfilesService {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;

  async loadAccessibleChildren(profile: AuthBootstrapProfile, fallbackModeId: string): Promise<ChildProfile[]> {
    if (profile.role === 'child') {
      return this.loadChildSelfProfile(profile, fallbackModeId);
    }

    return this.loadChildrenForHousehold(profile.householdId ?? '', fallbackModeId);
  }

  async loadChildrenForHousehold(householdId: string, fallbackModeId: string): Promise<ChildProfile[]> {
    const firestore = this.firestore;

    if (!firestore || !householdId) {
      return [];
    }

    try {
      const membersSnapshot = await getDocs(
        query(
          collection(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION),
          where('role', '==', 'child'),
          where('status', '==', 'active'),
        ),
      );

      const children = await Promise.all(
        membersSnapshot.docs.map((member) =>
          this.readChildComposite(
            firestore,
            householdId,
            member.id,
            fallbackModeId,
            member.data() as ChildMembershipDocument,
          ),
        ),
      );

      return children
        .filter((child): child is ChildProfile => child !== null)
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return [];
    }
  }

  async loadChildForHousehold(householdId: string, childId: string, fallbackModeId: string): Promise<ChildProfile | null> {
    const firestore = this.firestore;

    if (!firestore || !householdId || !childId) {
      return null;
    }

    try {
      const membershipSnapshot = await getDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, childId));

      if (!membershipSnapshot.exists()) {
        return null;
      }

      return await this.readChildComposite(
        firestore,
        householdId,
        childId,
        fallbackModeId,
        membershipSnapshot.data() as ChildMembershipDocument,
      );
    } catch {
      return null;
    }
  }

  async createChildProfile(draft: ChildProfileDraft, activeModeId: string): Promise<HouseholdChildMutationResult> {
    const firestore = this.firestore;
    const viewerProfile = this.firebaseUserProfile.currentProfile();
    const normalizedDraft = normalizeChildDraft(draft);

    if (!firestore) {
      return {
        ok: false,
        message: 'Child profile saving is not ready for this build yet.',
      };
    }

    if (!viewerProfile || viewerProfile.role !== 'parent' || !viewerProfile.householdId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh the session and try again.',
      };
    }

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'Add the child profile details before saving.',
      };
    }

    const householdId = viewerProfile.householdId;
    const childId = createChildId();
    const peopleRef = doc(firestore, environment.firebase.peopleCollection, childId);
    const childProfileRef = doc(firestore, environment.firebase.childProfileCollection, childId);
    const membershipRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, childId);
    const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId);

    try {
      await runTransaction(firestore, async (transaction) => {
        transaction.set(peopleRef, {
          personId: childId,
          type: 'child',
          displayName: normalizedDraft.name,
          avatarUrl: null,
          themeColor: normalizedDraft.themeColor,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(childProfileRef, {
          childPersonId: childId,
          profile: {
            displayName: normalizedDraft.name,
            ageYears: normalizedDraft.age,
            avatarLabel: normalizedDraft.avatar,
            themeColor: normalizedDraft.themeColor,
          },
          login: {
            enabled: false,
            authUid: null,
            usernameNormalized: null,
            usernameDisplay: null,
          },
          status: 'active',
          createdByPersonId: viewerProfile.personId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(membershipRef, {
          personId: childId,
          role: 'child',
          status: 'active',
          childPolicies: {
            householdSwitchPolicy: 'parentOnly',
          },
          joinedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(childStateRef, {
          childPersonId: childId,
          points: normalizedDraft.points,
          streakDays: normalizedDraft.streakDays,
          activeModeId,
          currentBook: normalizedDraft.currentBook || null,
          currentLifeSkill: normalizedDraft.currentLifeSkill || null,
          sportsGoal: normalizedDraft.sportsGoal || null,
          yearGoal: normalizedDraft.yearGoal || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      const child = await this.readChildComposite(
        firestore,
        householdId,
        childId,
        activeModeId,
        {
          role: 'child',
          status: 'active',
          childPolicies: {
            householdSwitchPolicy: 'parentOnly',
          },
        },
      );

      return {
        ok: true,
        child: child ?? buildFallbackChild(childId, normalizedDraft, activeModeId),
      };
    } catch (error) {
      return {
        ok: false,
        message: describeChildProfileError(error, 'create'),
      };
    }
  }

  async updateChildProfile(
    childId: string,
    draft: ChildProfileDraft,
    activeModeId: string,
  ): Promise<HouseholdChildMutationResult> {
    const firestore = this.firestore;
    const viewerProfile = this.firebaseUserProfile.currentProfile();
    const normalizedDraft = normalizeChildDraft(draft);

    if (!firestore) {
      return {
        ok: false,
        message: 'Child profile saving is not ready for this build yet.',
      };
    }

    if (!viewerProfile || viewerProfile.role !== 'parent' || !viewerProfile.householdId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh the session and try again.',
      };
    }

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'Add the child profile details before saving.',
      };
    }

    const householdId = viewerProfile.householdId;
    const peopleRef = doc(firestore, environment.firebase.peopleCollection, childId);
    const childProfileRef = doc(firestore, environment.firebase.childProfileCollection, childId);
    const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId);

    try {
      await runTransaction(firestore, async (transaction) => {
        transaction.update(peopleRef, {
          displayName: normalizedDraft.name,
          themeColor: normalizedDraft.themeColor,
          updatedAt: serverTimestamp(),
        });

        transaction.update(childProfileRef, {
          'profile.displayName': normalizedDraft.name,
          'profile.ageYears': normalizedDraft.age,
          'profile.avatarLabel': normalizedDraft.avatar,
          'profile.themeColor': normalizedDraft.themeColor,
          updatedAt: serverTimestamp(),
        });

        transaction.update(childStateRef, {
          points: normalizedDraft.points,
          streakDays: normalizedDraft.streakDays,
          activeModeId,
          currentBook: normalizedDraft.currentBook || null,
          currentLifeSkill: normalizedDraft.currentLifeSkill || null,
          sportsGoal: normalizedDraft.sportsGoal || null,
          yearGoal: normalizedDraft.yearGoal || null,
          updatedAt: serverTimestamp(),
        });
      });

      const membershipSnapshot = await getDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, childId));
      const child = await this.readChildComposite(
        firestore,
        householdId,
        childId,
        activeModeId,
        membershipSnapshot.exists() ? (membershipSnapshot.data() as ChildMembershipDocument) : null,
      );

      return {
        ok: true,
        child: child ?? buildFallbackChild(childId, normalizedDraft, activeModeId),
      };
    } catch (error) {
      return {
        ok: false,
        message: describeChildProfileError(error, 'update'),
      };
    }
  }

  async enableChildLogin(childId: string, draft: ChildLoginDraft): Promise<HouseholdChildMutationResult> {
    const firestore = this.firestore;
    const viewerProfile = this.firebaseUserProfile.currentProfile();
    const normalizedUsername = normalizeChildUsername(draft.username);
    const password = draft.password.trim();

    if (!firestore) {
      return {
        ok: false,
        message: 'Child login setup is not ready for this build yet.',
      };
    }

    if (!viewerProfile || viewerProfile.role !== 'parent' || !viewerProfile.householdId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh the session and try again.',
      };
    }

    if (!normalizedUsername) {
      return {
        ok: false,
        message: 'Choose a child username with 3 to 20 letters, numbers, dots, dashes, or underscores.',
      };
    }

    if (password.length < 6) {
      return {
        ok: false,
        message: 'Choose a starter password with at least 6 characters.',
      };
    }

    const householdId = viewerProfile.householdId;
    const childProfileRef = doc(firestore, environment.firebase.childProfileCollection, childId);
    const usernameIndexRef = doc(firestore, environment.firebase.usernameIndexCollection, normalizedUsername);
    const parentMembershipRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, viewerProfile.personId);
    const [childProfileSnapshot, usernameSnapshot, parentMembershipSnapshot] = await Promise.all([
      getDoc(childProfileRef),
      getDoc(usernameIndexRef),
      getDoc(parentMembershipRef),
    ]);

    if (!childProfileSnapshot.exists()) {
      return {
        ok: false,
        message: 'That child profile could not be found. Refresh the roster and try again.',
      };
    }

    if (!parentMembershipSnapshot.exists()) {
      return {
        ok: false,
        message: "We couldn't verify this parent's household access yet. Refresh and try again.",
      };
    }

    const parentMembership = parentMembershipSnapshot.data() as ChildMembershipDocument;
    const parentCanManageCredentials =
      parentMembership.permissions?.canManageChildCredentials === true
      || parentMembership.permissions?.canManageChildren === true;

    if (!parentCanManageCredentials) {
      return {
        ok: false,
        message: 'This parent account does not currently have permission to manage child sign-ins.',
      };
    }

    const childProfile = childProfileSnapshot.data() as ChildProfileDocument;

    if (childProfile.login?.enabled) {
      return {
        ok: false,
        message: 'This child already has sign-in enabled. Password reset and username changes come in a later pass.',
      };
    }

    if (usernameSnapshot.exists()) {
      return {
        ok: false,
        message: 'That username is already taken by another child account. Try another one.',
      };
    }

    const usernameDisplay = draft.username.trim();
    const internalEmailAlias = buildChildInternalEmailAlias(childId);
    const authCreateResult = await this.firebaseAuth.createSecondaryUserWithEmailPassword(internalEmailAlias, password);

    if (!authCreateResult.ok || !authCreateResult.uid) {
      return {
        ok: false,
        message: authCreateResult.message ?? 'The child sign-in account could not be created right now.',
      };
    }

    const authAccountRef = doc(firestore, environment.firebase.authAccountCollection, authCreateResult.uid);

    try {
      await runTransaction(firestore, async (transaction) => {
        const currentChildProfile = (await transaction.get(childProfileRef)).data() as ChildProfileDocument | undefined;
        const currentUsernameIndex = await transaction.get(usernameIndexRef);

        if (!currentChildProfile) {
          throw new Error('child-profile-missing');
        }

        if (currentChildProfile.login?.enabled) {
          throw new Error('login-already-enabled');
        }

        if (currentUsernameIndex.exists()) {
          throw new Error('username-taken');
        }

        transaction.set(authAccountRef, {
          uid: authCreateResult.uid,
          personId: childId,
          accountType: 'child',
          status: 'active',
          defaultHouseholdId: householdId,
          lastActiveHouseholdId: householdId,
          childId,
          login: {
            provider: 'password',
            username: normalizedUsername,
            internalEmailAlias,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(usernameIndexRef, {
          normalizedUsername,
          usernameDisplay,
          childPersonId: childId,
          authUid: authCreateResult.uid,
          internalEmailAlias,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.update(childProfileRef, {
          'login.enabled': true,
          'login.authUid': authCreateResult.uid,
          'login.usernameNormalized': normalizedUsername,
          'login.usernameDisplay': usernameDisplay,
          updatedAt: serverTimestamp(),
        });
      });

      const membershipSnapshot = await getDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, childId));
      const child = await this.readChildComposite(
        firestore,
        householdId,
        childId,
        'school-year',
        membershipSnapshot.exists() ? (membershipSnapshot.data() as ChildMembershipDocument) : null,
      );

      await authCreateResult.cleanup?.();

      return {
        ok: true,
        child: child ?? undefined,
      };
    } catch (error) {
      await authCreateResult.rollback?.();
      return {
        ok: false,
        message: describeChildLoginEnableError(error),
      };
    }
  }

  private async loadChildSelfProfile(profile: AuthBootstrapProfile, fallbackModeId: string): Promise<ChildProfile[]> {
    const firestore = this.firestore;
    const householdId = profile.householdId;
    const childId = profile.childId ?? profile.personId;

    if (!firestore || !householdId || !childId) {
      return [];
    }

    try {
      const membershipSnapshot = await getDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, childId));

      if (!membershipSnapshot.exists()) {
        return [];
      }

      const child = await this.readChildComposite(
        firestore,
        householdId,
        childId,
        fallbackModeId,
        membershipSnapshot.data() as ChildMembershipDocument,
      );

      return child ? [child] : [];
    } catch {
      return [];
    }
  }

  private async readChildComposite(
    firestore: Firestore,
    householdId: string,
    childId: string,
    fallbackModeId: string,
    membershipData?: ChildMembershipDocument | null,
  ): Promise<ChildProfile | null> {
    const [peopleSnapshot, profileSnapshot, stateSnapshot] = await Promise.all([
      getDoc(doc(firestore, environment.firebase.peopleCollection, childId)),
      getDoc(doc(firestore, environment.firebase.childProfileCollection, childId)),
      getDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId)),
    ]);

    if (!peopleSnapshot.exists() || !profileSnapshot.exists()) {
      return null;
    }

    const peopleData = peopleSnapshot.data() as { displayName?: string; themeColor?: string | null };
    const profileData = profileSnapshot.data() as ChildProfileDocument;
    const stateData = stateSnapshot.exists() ? (stateSnapshot.data() as ChildStateDocument) : null;
    const profile = profileData.profile ?? {};
    const login = profileData.login;
    const resolvedActiveModeId = fallbackModeId.trim() || stateData?.activeModeId?.trim() || 'school-year';

    return {
      id: childId,
      name: profile.displayName?.trim() || peopleData.displayName?.trim() || childId,
      age: Math.max(1, Math.round(profile.ageYears ?? 8)),
      avatar: (profile.avatarLabel?.trim().toUpperCase() || initialsForName(profile.displayName || peopleData.displayName || childId)).slice(
        0,
        3,
      ),
      themeColor: profile.themeColor?.trim() || peopleData.themeColor?.trim() || '#ff7b59',
      level: 1,
      points: Math.max(0, Math.round(stateData?.points ?? 0)),
      streakDays: Math.max(0, Math.round(stateData?.streakDays ?? 0)),
      activeModeId: resolvedActiveModeId,
      currentBook: stateData?.currentBook?.trim() || '',
      currentLifeSkill: stateData?.currentLifeSkill?.trim() || '',
      sportsGoal: stateData?.sportsGoal?.trim() || '',
      yearGoal: stateData?.yearGoal?.trim() || '',
      login: {
        enabled: Boolean(login?.enabled),
        authUid: login?.authUid?.trim() || undefined,
        usernameNormalized: login?.usernameNormalized?.trim() || undefined,
        usernameDisplay: login?.usernameDisplay?.trim() || undefined,
        householdSwitchPolicy: membershipData?.childPolicies?.householdSwitchPolicy ?? 'parentOnly',
      },
    };
  }
}

function buildFallbackChild(childId: string, draft: ChildProfileDraft, activeModeId: string): ChildProfile {
  return {
    id: childId,
    name: draft.name,
    age: draft.age,
    avatar: draft.avatar,
    themeColor: draft.themeColor,
    level: draft.level,
    points: draft.points,
    streakDays: draft.streakDays,
    activeModeId,
    currentBook: draft.currentBook,
    currentLifeSkill: draft.currentLifeSkill,
    sportsGoal: draft.sportsGoal,
    yearGoal: draft.yearGoal,
    login: {
      enabled: false,
      householdSwitchPolicy: 'parentOnly',
    },
  };
}

function createFirebaseApp(): FirebaseApp | null {
  if (!hasFirebaseConfig()) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
}

let firestoreEmulatorConnected = false;

function createFirestore(app: FirebaseApp) {
  const firestore = getFirestore(app);

  if (environment.firebase.useFirestoreEmulator && !firestoreEmulatorConnected) {
    connectFirestoreEmulator(
      firestore,
      environment.firebase.firestoreEmulatorHost,
      environment.firebase.firestoreEmulatorPort,
    );
    firestoreEmulatorConnected = true;
  }

  return firestore;
}

function hasFirebaseConfig() {
  const { apiKey, authDomain, projectId, appId } = environment.firebase;

  return Boolean(apiKey && authDomain && projectId && appId);
}

function normalizeChildDraft(draft: ChildProfileDraft) {
  const name = draft.name.trim();
  const avatar = draft.avatar.trim().toUpperCase();
  const themeColor = draft.themeColor.trim();

  if (!name || !avatar || !themeColor) {
    return null;
  }

  return {
    ...draft,
    name,
    age: Math.max(1, Math.round(draft.age)),
    avatar: avatar.slice(0, 3),
    themeColor,
    level: Math.max(1, Math.round(draft.level)),
    points: Math.max(0, Math.round(draft.points)),
    streakDays: Math.max(0, Math.round(draft.streakDays)),
    currentBook: draft.currentBook?.trim() ?? '',
    currentLifeSkill: draft.currentLifeSkill?.trim() ?? '',
    sportsGoal: draft.sportsGoal?.trim() ?? '',
    yearGoal: draft.yearGoal?.trim() ?? '',
  } satisfies ChildProfileDraft;
}

function createChildId() {
  return `child_${Math.random().toString(36).slice(2, 10)}`;
}

function initialsForName(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'CH';
}

function describeChildProfileError(error: unknown, action: 'create' | 'update') {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return `That child profile ${action} action is not allowed right now.`;
    case 'not-found':
    case 'firestore/not-found':
      return 'One of the child profile documents could not be found. Refresh the roster and try again.';
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while saving the child profile. Check the network and try again.";
    default:
      return `The child profile ${action} could not be completed right now.`;
  }
}

function describeChildLoginEnableError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';

  switch (message) {
    case 'child-profile-missing':
      return 'That child profile could not be found while enabling sign-in. Refresh the roster and try again.';
    case 'login-already-enabled':
      return 'This child already has sign-in enabled. Password reset and username edits come in a later pass.';
    case 'username-taken':
      return 'That username was taken by another child account just now. Try another one.';
    default:
      break;
  }

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'That child login setup is not allowed right now.';
    case 'auth/email-already-in-use':
      return 'The hidden child sign-in email alias is already in use. Refresh and try again.';
    default:
      return 'The child sign-in account could not be enabled right now.';
  }
}
