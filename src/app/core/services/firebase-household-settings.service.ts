import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const SETTINGS_SUBCOLLECTION = 'settings';
const APP_SETTINGS_DOC = 'app';

interface HouseholdAppSettingsDocument {
  activeModeId?: string | null;
}

export interface HouseholdSettingsMutationResult {
  activeModeId?: string;
  message?: string;
  ok: boolean;
  source?: 'firebase' | 'local';
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseHouseholdSettingsService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _activeModeId = signal<string | null>(null);
  readonly activeModeId = this._activeModeId.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private settingsSubscription: Unsubscribe | null = null;
  private currentSyncKey = '';

  startSync(profile: AuthBootstrapProfile) {
    const firestore = this.firestore;
    const householdId = profile.householdId ?? '';

    if (!firestore || !householdId || profile.source !== 'authAccount') {
      this.stopSync();
      return;
    }

    const syncKey = `${profile.uid}:${profile.role}:${profile.personId}:${householdId}`;

    if (this.currentSyncKey === syncKey) {
      return;
    }

    this.stopSync();
    this.currentSyncKey = syncKey;
    this._activeModeId.set(null);
    this._lastSyncError.set('');

    this.settingsSubscription = onSnapshot(
      doc(firestore, HOUSEHOLDS_COLLECTION, householdId, SETTINGS_SUBCOLLECTION, APP_SETTINGS_DOC),
      (snapshot) => {
        const data = snapshot.exists() ? (snapshot.data() as HouseholdAppSettingsDocument) : null;
        this._activeModeId.set(data?.activeModeId?.trim() || null);
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set("We couldn't keep the household mode updated right now.");
      },
    );
  }

  stopSync() {
    this.settingsSubscription?.();
    this.settingsSubscription = null;
    this.currentSyncKey = '';
    this._activeModeId.set(null);
    this._lastSyncError.set('');
  }

  async setActiveMode(modeId: string): Promise<HouseholdSettingsMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();
    const activeModeId = modeId.trim();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The family mode setting is not ready yet. Refresh and try again.',
      };
    }

    if (!activeModeId) {
      return {
        ok: false,
        message: 'Choose a seasonal mode before making it live.',
      };
    }

    try {
      await setDoc(
        doc(firestore, HOUSEHOLDS_COLLECTION, householdId, SETTINGS_SUBCOLLECTION, APP_SETTINGS_DOC),
        {
          activeModeId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return {
        activeModeId,
        ok: true,
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describeHouseholdSettingsError(error),
      };
    }
  }

  private householdIdForWrites() {
    const profile = this.firebaseUserProfile.currentProfile();

    if (!this.firestore || !profile?.householdId || profile.source !== 'authAccount') {
      return null;
    }

    return profile.householdId;
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

function describeHouseholdSettingsError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'This mode change is not allowed right now.';
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while switching modes. Check the network and try again.";
    default:
      return 'The household mode could not be switched right now.';
  }
}
