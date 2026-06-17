import { Injectable } from '@angular/core';

import {
  AuthBootstrapProfile,
  BonusMoment,
  ChildProfile,
  Goal,
  JournalEntry,
  PrivilegeRule,
  Quest,
  QuestCompletion,
  RewardRedemption,
} from '../models/family.models';

const CACHE_PREFIX = 'chore-champ.household-data';
const CACHE_VERSION = 1;

export interface HouseholdDataCache {
  activeModeId?: string;
  bonusMoments?: BonusMoment[];
  children?: ChildProfile[];
  completions?: QuestCompletion[];
  goals?: Goal[];
  journalEntries?: JournalEntry[];
  privilegeRules?: PrivilegeRule[];
  quests?: Quest[];
  rewardRedemptions?: RewardRedemption[];
  updatedAt: string;
}

export type HouseholdDataCachePatch = Partial<Omit<HouseholdDataCache, 'updatedAt'>>;

interface StoredHouseholdDataCache extends HouseholdDataCache {
  householdId: string;
  personId: string;
  role: AuthBootstrapProfile['role'];
  uid: string;
  version: number;
}

@Injectable({
  providedIn: 'root',
})
export class HouseholdDataCacheService {
  read(profile: AuthBootstrapProfile): HouseholdDataCache | null {
    if (!canCacheProfile(profile) || !supportsLocalStorage()) {
      return null;
    }

    try {
      const rawValue = localStorage.getItem(cacheKey(profile));

      if (!rawValue) {
        return null;
      }

      const parsed = JSON.parse(rawValue) as unknown;

      if (!isStoredHouseholdDataCache(parsed, profile)) {
        return null;
      }

      const { householdId, personId, role, uid, version, ...cache } = parsed;
      void householdId;
      void personId;
      void role;
      void uid;
      void version;

      return cache;
    } catch {
      return null;
    }
  }

  patch(profile: AuthBootstrapProfile, patch: HouseholdDataCachePatch) {
    if (!canCacheProfile(profile) || !supportsLocalStorage()) {
      return;
    }

    try {
      const existing = this.read(profile) ?? { updatedAt: new Date(0).toISOString() };
      const nextCache: StoredHouseholdDataCache = {
        ...existing,
        ...patch,
        householdId: profile.householdId,
        personId: profile.personId,
        role: profile.role,
        uid: profile.uid,
        updatedAt: new Date().toISOString(),
        version: CACHE_VERSION,
      };

      localStorage.setItem(cacheKey(profile), JSON.stringify(nextCache));
    } catch {
      // Storage can be unavailable or full; the live app state still works without persistence.
    }
  }
}

function canCacheProfile(profile: AuthBootstrapProfile): profile is AuthBootstrapProfile & { householdId: string } {
  return profile.source === 'authAccount' && Boolean(profile.uid && profile.personId && profile.householdId);
}

function cacheKey(profile: AuthBootstrapProfile & { householdId: string }) {
  return `${CACHE_PREFIX}.v${CACHE_VERSION}.${profile.uid}.${profile.role}.${profile.personId}.${profile.householdId}`;
}

function supportsLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function isStoredHouseholdDataCache(value: unknown, profile: AuthBootstrapProfile & { householdId: string }): value is StoredHouseholdDataCache {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value['version'] === CACHE_VERSION
    && value['uid'] === profile.uid
    && value['personId'] === profile.personId
    && value['role'] === profile.role
    && value['householdId'] === profile.householdId
    && typeof value['updatedAt'] === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
