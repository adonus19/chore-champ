import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, UserRole } from '../models/family.models';
import { FirebaseAuthService } from './firebase-auth.service';

interface AuthBootstrapLookupResult {
  message?: string;
  profile: AuthBootstrapProfile | null;
}

interface AuthAccountDocument {
  personId?: string;
  accountType?: UserRole;
  status?: string;
  defaultHouseholdId?: string | null;
  lastActiveHouseholdId?: string | null;
  prototypeChildId?: string;
  childId?: string;
  login?: {
    email?: string;
    username?: string;
    internalEmailAlias?: string;
  };
}

interface PersonDocument {
  type?: UserRole;
  displayName?: string;
  avatarUrl?: string | null;
  themeColor?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseUserProfileService {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  readonly firestoreEnabled = Boolean(this.firestore);
  private readonly _profileReady = signal(!this.firestoreEnabled);
  readonly profileReady = this._profileReady.asReadonly();
  private readonly _currentProfile = signal<AuthBootstrapProfile | null>(null);
  readonly currentProfile = this._currentProfile.asReadonly();
  private readonly _lastProfileError = signal('');
  readonly lastProfileError = this._lastProfileError.asReadonly();
  readonly hasResolvedProfile = computed(() => Boolean(this.currentProfile()));
  readonly currentChildId = computed(() => this.currentProfile()?.childId ?? null);
  private readonly profileWaiters = new Set<() => void>();
  private currentLoadToken = 0;
  private authAccountSubscription: Unsubscribe | null = null;
  private currentSubscribedUid = '';

  constructor() {
    effect(() => {
      const authReady = this.firebaseAuth.authReady();
      const currentUserUid = this.firebaseAuth.currentUser()?.uid ?? null;

      void this.syncProfileFromAuth(authReady, currentUserUid);
    });
  }

  async waitForProfileReady() {
    if (this.profileReady()) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.profileWaiters.add(resolve);
    });
  }

  async refreshCurrentProfile() {
    await this.syncProfileFromAuth(this.firebaseAuth.authReady(), this.firebaseAuth.currentUser()?.uid ?? null);
  }

  private async syncProfileFromAuth(authReady: boolean, currentUserUid: string | null) {
    const firestore = this.firestore;

    if (!firestore) {
      this.stopProfileSync();
      this._currentProfile.set(null);
      this._lastProfileError.set('');
      this.markProfileReady();
      return;
    }

    if (!authReady) {
      this._profileReady.set(false);
      return;
    }

    if (!currentUserUid) {
      this.stopProfileSync();
      this._currentProfile.set(null);
      this._lastProfileError.set('');
      this.markProfileReady();
      return;
    }

    if (this.currentSubscribedUid === currentUserUid && this.authAccountSubscription) {
      return;
    }

    this.stopProfileSync();
    this._profileReady.set(false);
    this.currentSubscribedUid = currentUserUid;

    this.authAccountSubscription = onSnapshot(
      doc(firestore, environment.firebase.authAccountCollection, currentUserUid),
      (snapshot) => {
        void this.hydrateProfileFromSnapshot(currentUserUid, snapshot.exists() ? (snapshot.data() as AuthAccountDocument) : null);
      },
      (error) => {
        this._currentProfile.set(null);
        this._lastProfileError.set(describeProfileLookupError(error));
        this.markProfileReady();
      },
    );
  }

  private async hydrateProfileFromSnapshot(uid: string, authAccountData: AuthAccountDocument | null) {
    const firestore = this.firestore;

    if (!firestore) {
      return;
    }

    const loadToken = ++this.currentLoadToken;
    const lookup = authAccountData
      ? await readAuthAccountBootstrapProfile(firestore, uid, authAccountData)
      : await readLegacyUserProfile(firestore, uid);

    if (loadToken !== this.currentLoadToken) {
      return;
    }

    this._currentProfile.set(lookup.profile);
    this._lastProfileError.set(lookup.message ?? '');
    this.markProfileReady();
  }

  private stopProfileSync() {
    this.authAccountSubscription?.();
    this.authAccountSubscription = null;
    this.currentSubscribedUid = '';
    this.currentLoadToken++;
  }

  private markProfileReady() {
    if (!this._profileReady()) {
      this._profileReady.set(true);
    }

    if (this.profileWaiters.size === 0) {
      return;
    }

    for (const resolve of this.profileWaiters) {
      resolve();
    }

    this.profileWaiters.clear();
  }
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

async function readAuthBootstrapProfile(firestore: Firestore, uid: string): Promise<AuthBootstrapLookupResult> {
  try {
    try {
      const authAccountSnapshot = await getDoc(doc(firestore, environment.firebase.authAccountCollection, uid));

      if (authAccountSnapshot.exists()) {
        return await readAuthAccountBootstrapProfile(firestore, uid, authAccountSnapshot.data() as AuthAccountDocument);
      }
    } catch (error) {
      if (!isFirestorePermissionDenied(error)) {
        throw error;
      }
    }

    return await readLegacyUserProfile(firestore, uid);
  } catch (error) {
    return {
      message: describeProfileLookupError(error),
      profile: null,
    };
  }
}

async function readAuthAccountBootstrapProfile(
  firestore: Firestore,
  uid: string,
  data: AuthAccountDocument,
): Promise<AuthBootstrapLookupResult> {
  if (!data.personId || !data.accountType) {
    return {
      message:
        'The Firestore auth account document is missing one of the required fields: personId or accountType.',
      profile: null,
    };
  }

  const householdId = data.defaultHouseholdId ?? data.lastActiveHouseholdId ?? null;

  if (!householdId) {
    return {
      message:
        'The Firestore auth account document is missing the household context needed for app bootstrap. Add defaultHouseholdId.',
      profile: null,
    };
  }

  const personSnapshot = await getDoc(doc(firestore, environment.firebase.peopleCollection, data.personId));

  if (!personSnapshot.exists()) {
    return {
      message: `No Firestore person document exists at ${environment.firebase.peopleCollection}/${data.personId}.`,
      profile: null,
    };
  }

  const personData = personSnapshot.data() as PersonDocument;

  if (personData.type && personData.type !== data.accountType) {
    return {
      message: `The Firestore person document at ${environment.firebase.peopleCollection}/${data.personId} does not match the auth account type.`,
      profile: null,
    };
  }

  return {
    profile: {
      uid,
      personId: data.personId,
      role: data.accountType,
      displayName: personData.displayName?.trim() || data.login?.email?.trim() || uid,
      householdId,
      defaultHouseholdId: data.defaultHouseholdId ?? householdId,
      lastActiveHouseholdId: data.lastActiveHouseholdId ?? data.defaultHouseholdId ?? householdId,
      childId: data.accountType === 'child' ? resolvePrototypeChildId(data) : undefined,
      avatarUrl: personData.avatarUrl ?? undefined,
      themeColor: personData.themeColor ?? undefined,
      source: 'authAccount',
    },
  };
}

async function readLegacyUserProfile(firestore: Firestore, uid: string): Promise<AuthBootstrapLookupResult> {
  const snapshot = await getDoc(doc(firestore, environment.firebase.legacyUserProfileCollection, uid));

  if (!snapshot.exists()) {
    return {
      message:
        `No Firestore bootstrap document exists at ${environment.firebase.authAccountCollection}/${uid}, ` +
        `and no legacy fallback exists at ${environment.firebase.legacyUserProfileCollection}/${uid}.`,
      profile: null,
    };
  }

  const data = snapshot.data() as {
    role?: UserRole;
    familyId?: string;
    displayName?: string;
    childId?: string;
    avatarUrl?: string;
    themeColor?: string;
  };

  if (!data.role || !data.familyId) {
    return {
      message:
        'The legacy Firestore user profile is missing one of the required fields: role or familyId.',
      profile: null,
    };
  }

  return {
    profile: {
      uid,
      personId: uid,
      role: data.role,
      displayName: data.displayName?.trim() || uid,
      householdId: data.familyId,
      defaultHouseholdId: data.familyId,
      lastActiveHouseholdId: data.familyId,
      childId: data.childId,
      avatarUrl: data.avatarUrl,
      themeColor: data.themeColor,
      source: 'legacyUserProfile',
    },
  };
}

function resolvePrototypeChildId(data: AuthAccountDocument) {
  const temporaryChildId = data.prototypeChildId?.trim() || data.childId?.trim() || data.personId?.trim() || '';

  return temporaryChildId || undefined;
}

function isFirestorePermissionDenied(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  return code === 'permission-denied' || code === 'firestore/permission-denied';
}

function describeProfileLookupError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firestore denied access to the account bootstrap documents. Check your Firestore security rules.';
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached. Check the network connection and Firebase project settings.';
    default:
      return 'Firestore could not read the account bootstrap documents for this signed-in account.';
  }
}
