# Firebase Setup

This project now supports Firebase Auth plus Firestore-based account bootstrap lookup.

Until the app is fully Firestore-backed, Firebase is used for:

- Email/password sign-in
- Auth session persistence
- Account and role lookup from Firestore
- Mapping child users to the correct child board

## What You Need To Do

1. Create a Firebase project.
2. Add a Web app inside that Firebase project.
3. Enable `Authentication -> Sign-in method -> Email/Password`.
4. Create a Firestore database.
5. Copy your Firebase web config into:
   - `src/environments/environment.development.ts`
   - `src/environments/environment.ts`
6. Create Firebase Auth users for the parent and child accounts you want to test.
7. Create matching Firestore bootstrap documents.

## Environment Fields

Fill these fields in both environment files:

```ts
firebase: {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  appId: '...',
  messagingSenderId: '...',
  storageBucket: '...',
  useAuthEmulator: false,
  authEmulatorUrl: 'http://127.0.0.1:9099',
  useFirestoreEmulator: false,
  firestoreEmulatorHost: '127.0.0.1',
  firestoreEmulatorPort: 8080,
  authAccountCollection: 'authAccounts',
  peopleCollection: 'people',
  legacyUserProfileCollection: 'userProfiles',
}
```

## Current Bootstrap Resolution Order

The app currently resolves a signed-in user like this:

1. Read `authAccounts/{firebaseAuthUid}`
2. Read `people/{personId}` from that auth account
3. If `authAccounts/{uid}` does not exist yet, fall back to `userProfiles/{uid}`

That means your current `userProfiles/{uid}` setup can keep working during migration, but the new preferred path is:

- `authAccounts/{uid}`
- `people/{personId}`

## Preferred Auth Account Schema

Document path:

`authAccounts/FIREBASE_UID`

Required fields:

```ts
{
  personId: string;
  accountType: 'parent' | 'child';
  defaultHouseholdId: string;
}
```

Optional fields currently used by the prototype:

```ts
{
  lastActiveHouseholdId?: string;
  prototypeChildId?: string;
  childId?: string;
  login?: {
    email?: string;
    username?: string;
    internalEmailAlias?: string;
  };
}
```

Important:

- For child accounts, `prototypeChildId` is a temporary bridge while the rest of the app still uses mock child boards.
- The service also accepts `childId` as a temporary alias for that same purpose.
- Use one of those fields only during this prototype migration stage.

## Preferred People Schema

Document path:

`people/PERSON_ID`

Document data:

```json
{
  "personId": "person_parent_123",
  "type": "parent",
  "displayName": "Mom",
  "avatarUrl": null,
  "themeColor": null,
  "status": "active"
}
```

## Example Parent Bootstrap Docs

`authAccounts/PARENT_FIREBASE_UID`

```json
{
  "personId": "person_parent_123",
  "accountType": "parent",
  "status": "active",
  "defaultHouseholdId": "household_sunrise_home",
  "lastActiveHouseholdId": "household_sunrise_home",
  "login": {
    "email": "parent@example.com"
  }
}
```

`people/person_parent_123`

```json
{
  "personId": "person_parent_123",
  "type": "parent",
  "displayName": "Mom",
  "avatarUrl": null,
  "themeColor": null,
  "status": "active"
}
```

## Example Child Bootstrap Docs

`authAccounts/CHILD_FIREBASE_UID`

```json
{
  "personId": "person_child_ava",
  "accountType": "child",
  "status": "active",
  "defaultHouseholdId": "household_sunrise_home",
  "lastActiveHouseholdId": "household_sunrise_home",
  "prototypeChildId": "ava",
  "login": {
    "email": "child1@example.com"
  }
}
```

`people/person_child_ava`

```json
{
  "personId": "person_child_ava",
  "type": "child",
  "displayName": "Ava",
  "avatarUrl": null,
  "themeColor": "#ff7f6e",
  "status": "active"
}
```

## Legacy Fallback Profile Schema

During migration, the app still supports:

`userProfiles/{firebaseAuthUid}`

Required fields:

```ts
{
  familyId: string;
  role: 'parent' | 'child';
  displayName: string;
}
```

Optional fields:

```ts
{
  childId?: string;
  avatarUrl?: string;
  themeColor?: string;
}
```

## Current Prototype Child IDs

Until the app data itself moves to Firestore, child bootstrap docs should use one of the existing mock child ids in either:

- `authAccounts/{uid}.prototypeChildId`
- `authAccounts/{uid}.childId`
- or legacy `userProfiles/{uid}.childId`

Valid values:

- `ava`
- `leo`

If you put some other value there, login will succeed in Firebase but the app will reject the lane mapping.

## Firestore Rules For Current Login Flow

Right now the app needs these login-time reads:

- the signed-in user reading `authAccounts/{uid}`
- the signed-in user reading their linked `people/{personId}`
- optional legacy fallback read of `userProfiles/{uid}`

This ruleset is a good current fit:

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /authAccounts/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false;
    }

    match /people/{personId} {
      allow read: if request.auth != null
        && exists(/databases/$(database)/documents/authAccounts/$(request.auth.uid))
        && get(/databases/$(database)/documents/authAccounts/$(request.auth.uid)).data.personId == personId;
      allow write: if false;
    }

    match /userProfiles/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

This allows:

- an authenticated user to read only `authAccounts/{theirFirebaseUid}`
- an authenticated user to read only their linked `people/{personId}`
- an authenticated user to read only the legacy fallback `userProfiles/{theirFirebaseUid}`

This does not allow:

- reading any other account or person document
- writing bootstrap documents from the client
- reading or writing any other collection

## Extra Rules For Temporary Parent Signup Bootstrap

The current prototype now has a public parent signup page that bootstraps the first household directly from the web app.

That means, for this phase, the client needs a tightly scoped one-time create path for:

- `authAccounts/{uid}`
- `people/{personId}`
- `households/{householdId}`
- `households/{householdId}/members/{personId}`

Replace the earlier login-only rules with this combined ruleset if you want to test parent signup right now:

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function authAccountPath(uid) {
      return /databases/$(database)/documents/authAccounts/$(uid);
    }

    match /authAccounts/{userId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow create: if signedIn()
        && request.auth.uid == userId
        && !exists(/databases/$(database)/documents/authAccounts/$(userId))
        && request.resource.data.accountType == 'parent'
        && request.resource.data.personId is string
        && request.resource.data.defaultHouseholdId is string;
      allow update, delete: if false;
    }

    match /people/{personId} {
      allow read: if signedIn()
        && exists(authAccountPath(request.auth.uid))
        && get(authAccountPath(request.auth.uid)).data.personId == personId;
      allow create: if signedIn()
        && !exists(/databases/$(database)/documents/people/$(personId))
        && getAfter(authAccountPath(request.auth.uid)).data.personId == personId
        && request.resource.data.type == 'parent'
        && request.resource.data.displayName is string;
      allow update, delete: if false;
    }

    match /households/{householdId} {
      allow create: if signedIn()
        && !exists(/databases/$(database)/documents/households/$(householdId))
        && getAfter(authAccountPath(request.auth.uid)).data.defaultHouseholdId == householdId
        && getAfter(authAccountPath(request.auth.uid)).data.personId == request.resource.data.createdByPersonId
        && request.resource.data.status == 'active';
      allow read, update, delete: if false;

      match /members/{personId} {
        allow create: if signedIn()
          && !exists(/databases/$(database)/documents/households/$(householdId)/members/$(personId))
          && getAfter(authAccountPath(request.auth.uid)).data.personId == personId
          && getAfter(authAccountPath(request.auth.uid)).data.defaultHouseholdId == householdId
          && request.resource.data.role == 'owner'
          && request.resource.data.status == 'active';
        allow read, update, delete: if false;
      }
    }

    match /userProfiles/{userId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

This is intentionally a prototype rule set, not the final production posture.

Later, the better long-term move is:

- client creates the Firebase Auth parent user
- client calls a secure backend or callable function
- backend performs the Firestore bootstrap writes

That will let us tighten the client write rules back down after the bootstrap path moves server-side.

## Extra Rules For Temporary Firestore Child Profiles And Child Login

The current prototype now lets a signed-in parent household create and edit child profiles directly in Firestore from the parent child manager page, and it can also enable child username sign-in from that same parent lane.

That means the client needs a tightly scoped path for:

- reading child roster membership docs
- reading child profile and child state docs
- creating child identity docs
- updating child profile and child state docs
- creating child auth account bootstrap docs
- creating a temporary username index for child sign-in
- letting a signed-in child read only their own membership, child profile, and child state docs

Replace the earlier signup-only rule set with this expanded rule set if you want to test real child creation plus child username login now:

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function authAccountPath(uid) {
      return /databases/$(database)/documents/authAccounts/$(uid);
    }

    function hasAuthAccount() {
      return signedIn() && exists(authAccountPath(request.auth.uid));
    }

    function currentPersonId() {
      return get(authAccountPath(request.auth.uid)).data.personId;
    }

    function currentHouseholdId() {
      return get(authAccountPath(request.auth.uid)).data.defaultHouseholdId;
    }

    function membershipPath(householdId, personId) {
      return /databases/$(database)/documents/households/$(householdId)/members/$(personId);
    }

    function childStatePath(householdId, childId) {
      return /databases/$(database)/documents/households/$(householdId)/childState/$(childId);
    }

    function personPath(personId) {
      return /databases/$(database)/documents/people/$(personId);
    }

    function childProfilePath(childId) {
      return /databases/$(database)/documents/childProfiles/$(childId);
    }

    function childLinkPath(linkId) {
      return /databases/$(database)/documents/childLinks/$(linkId);
    }

    function isActiveParentForHousehold(householdId) {
      return hasAuthAccount()
        && currentHouseholdId() == householdId
        && exists(membershipPath(householdId, currentPersonId()))
        && get(membershipPath(householdId, currentPersonId())).data.status == 'active'
        && (
          get(membershipPath(householdId, currentPersonId())).data.role == 'owner'
          || get(membershipPath(householdId, currentPersonId())).data.role == 'parent_admin'
          || get(membershipPath(householdId, currentPersonId())).data.role == 'parent_member'
        );
    }

    function canManageChildren(householdId) {
      return isActiveParentForHousehold(householdId)
        && get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true;
    }

    function canManageChildCredentials(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildCredentials == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canManageQuests(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canManageQuests == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canManageRewards(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canApproveRewards == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canManageGoals(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canManageGoals == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canManageHouseholdSettings(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canManageHouseholdSettings == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canManagePrivileges(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canManagePrivileges == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canManageJournalResponses(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          get(membershipPath(householdId, currentPersonId())).data.permissions.canManageJournalResponses == true
          || get(membershipPath(householdId, currentPersonId())).data.permissions.canManageChildren == true
        );
    }

    function canInviteParents(householdId) {
      return isActiveParentForHousehold(householdId)
        && (
          // The household owner can always invite, even if their membership predates this permission field.
          get(membershipPath(householdId, currentPersonId())).data.role == 'owner'
          // `.get(key, false)` avoids a missing-key error when a co-parent membership omits the flag.
          || get(membershipPath(householdId, currentPersonId())).data.permissions.get('canInviteParents', false) == true
        );
    }

    function isCurrentPersonActiveMemberOfHousehold(householdId) {
      return hasAuthAccount()
        && exists(membershipPath(householdId, currentPersonId()))
        && get(membershipPath(householdId, currentPersonId())).data.status == 'active';
    }

    function isSelfActiveMembership(householdId, personId) {
      return hasAuthAccount()
        && currentPersonId() == personId
        && exists(membershipPath(householdId, personId))
        && get(membershipPath(householdId, personId)).data.status == 'active';
    }

    function canChildSelfSwitchToHousehold(householdId) {
      return hasAuthAccount()
        && exists(membershipPath(householdId, currentPersonId()))
        && get(membershipPath(householdId, currentPersonId())).data.role == 'child'
        && get(membershipPath(householdId, currentPersonId())).data.status == 'active'
        && get(membershipPath(householdId, currentPersonId())).data.childPolicies.householdSwitchPolicy == 'childAllowed';
    }

    function isActiveChildInCurrentHousehold(childId) {
      return hasAuthAccount()
        && exists(membershipPath(currentHouseholdId(), childId))
        && get(membershipPath(currentHouseholdId(), childId)).data.role == 'child'
        && get(membershipPath(currentHouseholdId(), childId)).data.status == 'active';
    }

    function isCurrentChildMember(householdId, childId) {
      return hasAuthAccount()
        && currentHouseholdId() == householdId
        && currentPersonId() == childId
        && exists(membershipPath(householdId, childId))
        && get(membershipPath(householdId, childId)).data.role == 'child'
        && get(membershipPath(householdId, childId)).data.status == 'active';
    }

    function isCurrentChildCompletionId(completionId) {
      return hasAuthAccount()
        && completionId.matches('^completion_' + currentPersonId() + '_.*$');
    }

    function isChildMembershipBeingCreated(householdId, childId) {
      return getAfter(membershipPath(householdId, childId)).data.role == 'child'
        && getAfter(membershipPath(householdId, childId)).data.status == 'active';
    }

    function isSupportedHouseholdSwitchPolicy(policy) {
      return policy == 'parentOnly'
        || policy == 'childAllowed'
        || policy == 'childRequest';
    }

    function isNewCanonicalChildBeingCreated(childId) {
      return !exists(personPath(childId))
        && !exists(childProfilePath(childId))
        && getAfter(personPath(childId)).data.type == 'child'
        && getAfter(personPath(childId)).data.personId == childId
        && getAfter(childProfilePath(childId)).data.childPersonId == childId;
    }

    function isBootstrapParentPersonCreate(personId) {
      return signedIn()
        && request.auth.uid is string
        && !exists(personPath(personId))
        && getAfter(authAccountPath(request.auth.uid)).data.personId == personId
        && getAfter(authAccountPath(request.auth.uid)).data.accountType == 'parent'
        && request.resource.data.personId == personId
        && request.resource.data.type == 'parent';
    }

    function isCanonicalChildIdentity(childId) {
      return exists(personPath(childId))
        && exists(childProfilePath(childId))
        && get(personPath(childId)).data.type == 'child'
        && get(childProfilePath(childId)).data.childPersonId == childId;
    }

    function isAcceptedChildLinkForHousehold(linkId, householdId, childId) {
      return getAfter(childLinkPath(linkId)).data.childPersonId == childId
        && getAfter(childLinkPath(linkId)).data.status == 'accepted'
        && getAfter(childLinkPath(linkId)).data.targetHouseholdId == householdId
        && getAfter(childLinkPath(linkId)).data.acceptedByPersonId == currentPersonId();
    }

    function isAcceptedChildLinkMembershipCreate(householdId, childId) {
      return request.resource.data.linkedByChildLinkId is string
        && request.resource.data.personId == childId
        && isCanonicalChildIdentity(childId)
        && isAcceptedChildLinkForHousehold(request.resource.data.linkedByChildLinkId, householdId, childId);
    }

    function isAcceptedChildLinkStateCreate(householdId, childId) {
      return request.resource.data.linkedByChildLinkId is string
        && request.resource.data.childPersonId == childId
        && isChildMembershipBeingCreated(householdId, childId)
        && getAfter(membershipPath(householdId, childId)).data.linkedByChildLinkId == request.resource.data.linkedByChildLinkId
        && isAcceptedChildLinkForHousehold(request.resource.data.linkedByChildLinkId, householdId, childId);
    }

    match /authAccounts/{userId} {
      allow read: if (
          signedIn() && request.auth.uid == userId
        ) || (
          canManageChildCredentials(currentHouseholdId())
          && resource.data.accountType == 'child'
          && resource.data.personId is string
          && isActiveChildInCurrentHousehold(resource.data.personId)
        );
      allow create: if (
          signedIn()
          && request.auth.uid == userId
          && !exists(/databases/$(database)/documents/authAccounts/$(userId))
          && request.resource.data.accountType == 'parent'
          && request.resource.data.personId is string
          && request.resource.data.defaultHouseholdId is string
        ) || (
          canManageChildCredentials(currentHouseholdId())
          && !exists(/databases/$(database)/documents/authAccounts/$(userId))
          && request.resource.data.accountType == 'child'
          && request.resource.data.status == 'active'
          && request.resource.data.personId is string
          && request.resource.data.defaultHouseholdId == currentHouseholdId()
          && request.resource.data.childId == request.resource.data.personId
          && isActiveChildInCurrentHousehold(request.resource.data.personId)
        ) || (
          // An inviting parent provisions a second parent's account into their own household.
          canInviteParents(currentHouseholdId())
          && !exists(/databases/$(database)/documents/authAccounts/$(userId))
          && request.resource.data.accountType == 'parent'
          && request.resource.data.status == 'active'
          && request.resource.data.personId is string
          && request.resource.data.defaultHouseholdId == currentHouseholdId()
          && request.resource.data.lastActiveHouseholdId == currentHouseholdId()
        );
      allow update: if (
          signedIn()
          && request.auth.uid == userId
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['defaultHouseholdId', 'lastActiveHouseholdId', 'updatedAt'])
          && request.resource.data.defaultHouseholdId is string
          && request.resource.data.lastActiveHouseholdId is string
          && request.resource.data.defaultHouseholdId == request.resource.data.lastActiveHouseholdId
          && (
            (
              resource.data.accountType == 'parent'
              && isCurrentPersonActiveMemberOfHousehold(request.resource.data.defaultHouseholdId)
            ) || (
              resource.data.accountType == 'child'
              && resource.data.personId == currentPersonId()
              && canChildSelfSwitchToHousehold(request.resource.data.defaultHouseholdId)
            )
          )
        ) || (
          canManageChildCredentials(currentHouseholdId())
          && resource.data.accountType == 'child'
          && resource.data.personId is string
          && isActiveChildInCurrentHousehold(resource.data.personId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['defaultHouseholdId', 'lastActiveHouseholdId', 'updatedAt'])
          && request.resource.data.defaultHouseholdId == currentHouseholdId()
          && request.resource.data.lastActiveHouseholdId == currentHouseholdId()
        ) || (
          // A signed-in child clears their own forced-password-change flag after setting a new
          // password. They may only flip login.mustChangePassword to false; every other login field
          // (username, internalEmailAlias, provider) must stay exactly as it was. The Admin SDK
          // resetChildPassword function is what sets the flag to true in the first place.
          signedIn()
          && request.auth.uid == userId
          && resource.data.accountType == 'child'
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['login', 'updatedAt'])
          && request.resource.data.login.mustChangePassword == false
          && request.resource.data.login.username == resource.data.login.username
          && request.resource.data.login.internalEmailAlias == resource.data.login.internalEmailAlias
          && request.resource.data.login.provider == resource.data.login.provider
        );
      allow delete: if false;
    }

    match /usernameIndex/{normalizedUsername} {
      allow get: if true;
      allow list: if false;
      allow create: if canManageChildCredentials(currentHouseholdId())
        && !exists(/databases/$(database)/documents/usernameIndex/$(normalizedUsername))
        && request.resource.data.childPersonId is string
        && request.resource.data.authUid is string
        && request.resource.data.status == 'active'
        && isActiveChildInCurrentHousehold(request.resource.data.childPersonId);
      allow update, delete: if false;
    }

    match /childLinks/{linkId} {
      allow get: if isActiveParentForHousehold(currentHouseholdId());
      allow list: if false;
      allow create: if canManageChildren(currentHouseholdId())
        && !exists(childLinkPath(linkId))
        && request.resource.data.linkId == linkId
        && request.resource.data.childPersonId is string
        && isActiveChildInCurrentHousehold(request.resource.data.childPersonId)
        && request.resource.data.sourceHouseholdId == currentHouseholdId()
        && request.resource.data.targetHouseholdId == null
        && request.resource.data.createdByPersonId == currentPersonId()
        && request.resource.data.status == 'pending'
        && request.resource.data.expiresAt > request.time
        && isSupportedHouseholdSwitchPolicy(request.resource.data.intendedChildPolicies.householdSwitchPolicy);
      allow update: if canManageChildren(currentHouseholdId())
        && resource.data.status == 'pending'
        && resource.data.childPersonId is string
        && request.time < resource.data.expiresAt
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'targetHouseholdId',
          'acceptedByPersonId',
          'acceptedAt',
          'acceptedChildPolicies',
          'status',
          'updatedAt'
        ])
        && request.resource.data.status == 'accepted'
        && request.resource.data.targetHouseholdId == currentHouseholdId()
        && resource.data.sourceHouseholdId != currentHouseholdId()
        && request.resource.data.acceptedByPersonId == currentPersonId()
        && isSupportedHouseholdSwitchPolicy(request.resource.data.acceptedChildPolicies.householdSwitchPolicy);
      allow delete: if false;
    }

    match /people/{personId} {
      allow read: if signedIn()
        && (
          (hasAuthAccount() && currentPersonId() == personId)
          || (isActiveParentForHousehold(currentHouseholdId()) && isActiveChildInCurrentHousehold(personId))
        );
      allow create: if isBootstrapParentPersonCreate(personId)
        || (
          canManageChildren(currentHouseholdId())
          && !exists(/databases/$(database)/documents/people/$(personId))
          && request.resource.data.type == 'child'
          && request.resource.data.personId == personId
        ) || (
          canInviteParents(currentHouseholdId())
          && !exists(/databases/$(database)/documents/people/$(personId))
          && request.resource.data.type == 'parent'
          && request.resource.data.personId == personId
        );
      allow update: if canManageChildren(currentHouseholdId())
        && isActiveChildInCurrentHousehold(personId);
      allow delete: if false;
    }

    match /childProfiles/{childId} {
      allow read: if (
          isActiveParentForHousehold(currentHouseholdId()) && isActiveChildInCurrentHousehold(childId)
        ) || isCurrentChildMember(currentHouseholdId(), childId);
      allow create: if canManageChildren(currentHouseholdId())
        && !exists(/databases/$(database)/documents/childProfiles/$(childId))
        && request.resource.data.childPersonId == childId;
      allow update: if canManageChildren(currentHouseholdId())
        && isActiveChildInCurrentHousehold(childId);
      allow delete: if false;
    }

    match /households/{householdId} {
      allow read: if isCurrentPersonActiveMemberOfHousehold(householdId);
      allow create: if signedIn()
        && !exists(/databases/$(database)/documents/households/$(householdId))
        && getAfter(authAccountPath(request.auth.uid)).data.defaultHouseholdId == householdId
        && getAfter(authAccountPath(request.auth.uid)).data.personId == request.resource.data.createdByPersonId
        && request.resource.data.status == 'active';
      allow update, delete: if false;

      match /members/{personId} {
        allow read: if isActiveParentForHousehold(householdId) || isCurrentChildMember(householdId, personId) || isSelfActiveMembership(householdId, personId);
        allow create: if (
            signedIn()
            && !exists(/databases/$(database)/documents/households/$(householdId)/members/$(personId))
            && getAfter(authAccountPath(request.auth.uid)).data.personId == personId
            && getAfter(authAccountPath(request.auth.uid)).data.defaultHouseholdId == householdId
            && request.resource.data.role == 'owner'
            && request.resource.data.status == 'active'
          ) || (
            canManageChildren(householdId)
            && request.resource.data.role == 'child'
            && request.resource.data.status == 'active'
            && (
              isNewCanonicalChildBeingCreated(personId)
              || isAcceptedChildLinkMembershipCreate(householdId, personId)
            )
          ) || (
            // An inviting parent adds a co-parent membership (full-rights parent_admin, never owner).
            canInviteParents(householdId)
            && !exists(/databases/$(database)/documents/households/$(householdId)/members/$(personId))
            && (request.resource.data.role == 'parent_admin' || request.resource.data.role == 'parent_member')
            && request.resource.data.status == 'active'
          );
        allow update, delete: if false;
      }

      match /settings/{settingId} {
        allow read: if isActiveParentForHousehold(householdId) || isCurrentChildMember(householdId, currentPersonId());
        allow create, update: if (
            canManageHouseholdSettings(householdId)
            && settingId == 'app'
            && request.resource.data.activeModeId is string
          ) || (
            canManagePrivileges(householdId)
            && settingId == 'privileges'
            && request.resource.data.rules is list
          );
        allow delete: if false;
      }

      match /quests/{questId} {
        allow read: if isActiveParentForHousehold(householdId) || isCurrentChildMember(householdId, currentPersonId());
        allow create, update, delete: if canManageQuests(householdId);
      }

      match /questCompletions/{completionId} {
        allow read: if isActiveParentForHousehold(householdId)
          || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && (
              isCurrentChildCompletionId(completionId)
              || resource.data.childId == currentPersonId()
            )
          );
        allow create, update: if (
            canManageQuests(householdId)
            && request.resource.data.childId is string
            && isActiveChildInCurrentHousehold(request.resource.data.childId)
          ) || (
            request.auth != null
            && request.resource.data.childId == currentPersonId()
            && isCurrentChildMember(householdId, currentPersonId())
          ) || (
            // A parent self-certifies their own personal quest. No childState/points side effects.
            isActiveParentForHousehold(householdId)
            && request.resource.data.childId == currentPersonId()
            && request.resource.data.status == 'autoApproved'
          );
        allow delete: if canManageQuests(householdId);
      }

      match /rewardRedemptions/{redemptionId} {
        allow read: if isActiveParentForHousehold(householdId)
          || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && resource.data.childId == currentPersonId()
          );
        allow create: if (
            request.auth != null
            && request.resource.data.childId == currentPersonId()
            && isCurrentChildMember(householdId, currentPersonId())
            && request.resource.data.rewardId is string
            && request.resource.data.pointCost is int
            && (
              request.resource.data.status == 'pending'
              || request.resource.data.status == 'fulfilled'
            )
          ) || (
            canManageRewards(householdId)
            && request.resource.data.childId is string
            && isActiveChildInCurrentHousehold(request.resource.data.childId)
          );
        allow update: if canManageRewards(householdId)
          && resource.data.status == 'pending'
          && request.resource.data.childId == resource.data.childId
          && request.resource.data.rewardId == resource.data.rewardId
          && request.resource.data.pointCost == resource.data.pointCost
          && (
            request.resource.data.status == 'fulfilled'
            || request.resource.data.status == 'declined'
          );
        allow delete: if false;
      }

      match /bonusMoments/{bonusId} {
        allow read: if isActiveParentForHousehold(householdId)
          || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && resource.data.childId == currentPersonId()
          );
        allow create: if canManageChildren(householdId)
          && request.resource.data.childId is string
          && request.resource.data.points is int
          && request.resource.data.points > 0
          && isActiveChildInCurrentHousehold(request.resource.data.childId);
        allow update, delete: if false;
      }

      match /goals/{goalId} {
        allow read: if isActiveParentForHousehold(householdId)
          || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && resource.data.childId == currentPersonId()
          );
        allow create: if canManageGoals(householdId)
          && request.resource.data.childId is string
          && request.resource.data.title is string
          && request.resource.data.target is int
          && request.resource.data.target > 0
          && request.resource.data.current is int
          && request.resource.data.current >= 0
          && request.resource.data.current <= request.resource.data.target
          && request.resource.data.unit is string
          && (
            isActiveChildInCurrentHousehold(request.resource.data.childId)
            // A parent can own a personal goal targeted at their own personId.
            || request.resource.data.childId == currentPersonId()
          );
        allow update: if canManageGoals(householdId)
          || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && resource.data.childId == currentPersonId()
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['current', 'updatedAt'])
            && request.resource.data.current is int
            && request.resource.data.current >= resource.data.current
            && request.resource.data.current <= resource.data.target
          );
        allow delete: if canManageGoals(householdId);
      }

      match /journalEntries/{entryId} {
        allow read: if isActiveParentForHousehold(householdId)
          || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && resource.data.childId == currentPersonId()
          );
        allow create: if (
            request.auth != null
            && request.resource.data.childId == currentPersonId()
            && isCurrentChildMember(householdId, currentPersonId())
            && request.resource.data.accomplished is string
            && request.resource.data.learned is string
            && request.resource.data.proudOf is string
          ) || (
            canManageJournalResponses(householdId)
            && request.resource.data.childId is string
            && isActiveChildInCurrentHousehold(request.resource.data.childId)
            && request.resource.data.accomplished is string
            && request.resource.data.learned is string
            && request.resource.data.proudOf is string
          );
        allow update: if (
            canManageJournalResponses(householdId)
            && request.resource.data.childId == resource.data.childId
          ) || (
            request.auth != null
            && isCurrentChildMember(householdId, currentPersonId())
            && resource.data.childId == currentPersonId()
            && request.resource.data.childId == resource.data.childId
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
              'journalEntryId',
              'date',
              'accomplished',
              'learned',
              'proudOf',
              'needsParentResponse',
              'parentReaction',
              'parentNote',
              'updatedAt'
            ])
            && request.resource.data.accomplished is string
            && request.resource.data.learned is string
            && request.resource.data.proudOf is string
            && (
              request.resource.data.needsParentResponse == true
              || request.resource.data.needsParentResponse == resource.data.needsParentResponse
            )
            && (
              request.resource.data.parentReaction == null
              || request.resource.data.parentReaction == resource.data.parentReaction
            )
            && (
              request.resource.data.parentNote == null
              || request.resource.data.parentNote == resource.data.parentNote
            )
          );
        allow delete: if false;
      }

      match /childState/{childId} {
        allow read: if (
            isActiveParentForHousehold(householdId) && isActiveChildInCurrentHousehold(childId)
          ) || isCurrentChildMember(householdId, childId);
        allow create: if canManageChildren(householdId)
          && request.resource.data.childPersonId == childId
          && (
            (
              isNewCanonicalChildBeingCreated(childId)
              && isChildMembershipBeingCreated(householdId, childId)
            ) || isAcceptedChildLinkStateCreate(householdId, childId)
          );
        allow update: if canManageChildren(householdId) && isActiveChildInCurrentHousehold(childId);
        allow delete: if false;
      }
    }

    match /userProfiles/{userId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

This is still a prototype rule set. It is deliberately more permissive than the long-term target because:

- parent signup still writes bootstrap docs from the client
- child creation still writes Firestore directly from the client
- child username login currently uses a client-readable `usernameIndex/{normalizedUsername}` get path so signed-out children can look up their hidden Firebase email alias before sign-in
- household quests, quest approvals, rewards, bonus points, goals, seasonal mode settings, and privilege rules now also write directly from the client for this prototype pass

Important:

- Child creation currently writes the child membership doc and the `childState` doc in the same Firestore transaction.
- Because of that, the `childState` create rule must use `getAfter(...)` to inspect the child membership being created in the same request.
- Using `exists(...)` or `get(...)` there will fail because those only see the pre-transaction database state.
- Child username sign-in currently uses `allow get: if true` on `usernameIndex/{normalizedUsername}`. That is acceptable for this prototype pass, but the long-term direction is still a secure backend lookup with generic failure responses and rate limiting.
- Child-to-second-household linking now uses a parent-generated Firestore link code. That keeps the prototype fully testable in-app, but the longer-term direction is still a backend-issued or hashed token flow.
- Parent signup now depends on the rules allowing the bootstrap transaction to create both `authAccounts/{uid}` and the matching parent `people/{personId}` document in the same request.
- Child household link acceptance should not pre-read the target household `childState/{childId}` document before the child is linked there, because the current rules only allow that read after the child becomes active in the household.
- The `canManageChildCredentials` helper intentionally falls back to `permissions.canManageChildren == true` so older parent membership docs created before the new credential flag existed can still complete child login setup during this prototype phase.
- The `canManageQuests` helper intentionally falls back to `permissions.canManageChildren == true` so older parent membership docs can still manage the quest board during this prototype phase.
- The `canManageRewards` helper intentionally falls back to `permissions.canManageChildren == true` so older parent membership docs can still review reward requests during this prototype phase.
- The `canManageGoals` helper intentionally falls back to `permissions.canManageChildren == true` so older parent membership docs can still manage child goals during this prototype phase.
- The `canManagePrivileges` helper intentionally falls back to `permissions.canManageChildren == true` so older parent membership docs can still save shared privilege rules during this prototype phase.
- Child household sharing is now driven from `/parent/children`, but parent multi-household/co-parent linking still remains a later chunk.

The intended later direction is still:

- parent child creation logic moves behind a secure backend or callable function
- child credential enablement moves behind a secure backend or callable function
- household quest and approval mutations move behind a secure backend or callable function
- household reward request and review mutations move behind a secure backend or callable function
- household bonus point awards move behind a secure backend or callable function
- household goal management and child progress logging move behind a secure backend or callable function
- household seasonal mode and privilege-rule mutations move behind a secure backend or callable function
- co-parent household-link approval still needs a dedicated app flow
- client write permissions narrow again
- child username login swaps from the public Firestore lookup to a secure backend lookup

## Inviting A Second Parent

The parent child manager page (`/parent/children`) now has a Child / Parent toggle on the create card. In Parent
mode, a signed-in parent can invite a co-parent into the same household. The flow:

1. The app mints the co-parent's Firebase Auth user on a throwaway secondary app (so the inviting parent stays
   signed in), using an auto-generated easy temporary password.
2. As the inviting parent, it writes three Firestore docs in one transaction:
   - `authAccounts/{newUid}` with `accountType: 'parent'`, `defaultHouseholdId`/`lastActiveHouseholdId` = current household.
   - `people/person_{newUid}` with `type: 'parent'`.
   - `households/{householdId}/members/person_{newUid}` with `role: 'parent_admin'`, `status: 'active'`, and a full
     co-parent permission set (`canManageChildren`, `canManageQuests`, `canApproveRewards`, `canManageChildCredentials`,
     `canInviteParents` all `true`).
3. The generated temporary password is shown once to the inviting parent to hand off. The co-parent signs in from the
   parent door on the login screen with their email + that password.

The original creator keeps `role: 'owner'`, so a later "remove parent" flow can reserve parent/child removal for the
owner. Note `isActiveParentForHousehold` recognizes `owner`, `parent_admin`, and `parent_member` — a plain `parent`
role is intentionally **not** recognized, which is why invited co-parents use `parent_admin`.

These writes are gated by the new `canInviteParents(householdId)` helper plus the extra branches added above to the
`authAccounts`, `people`, and `households/{id}/members/{personId}` create rules. Deploy those rule additions before
testing, or each invite write returns `permission-denied`. A password-reset flow for the co-parent is a follow-up.

### Troubleshooting `permission-denied` on invite

If inviting a parent still returns `permission-denied` after you deployed the rules, check these in order:

1. **Did the rules actually compile and publish?** If you pasted the new create branches but left out the
   `canInviteParents(...)` helper definition, the rules fail to compile and your **previous** rules stay live. Re-paste
   the full functions section (it must include `canInviteParents`) and confirm the console/CLI reports a successful
   publish with no syntax errors.
2. **Owner membership missing the permission field.** Older owner accounts were bootstrapped before
   `permissions.canInviteParents` existed. The hardened `canInviteParents` helper above handles this by letting any
   `role == 'owner'` membership invite unconditionally, and by using `.get('canInviteParents', false)` so a missing
   key never errors. Make sure you deployed the **hardened** version of the helper, not the first draft.
3. **Wrong rules block.** This document contains more than one full `rules_version = '2'` block. Deploy the one under
   "Extra Rules For Temporary Firestore Child Profiles And Child Login" (it is the superset that also covers child
   creation, which your app already uses), with the invite additions merged in.

## Parent Personal Goals & Quests

Parents can now set goals and quests for **themselves** (not only for children), tracked on the `/parent/me`
"My Board" page. The implementation reuses the existing child-keyed fields rather than renaming them:

- A personal **goal** is a normal `households/{id}/goals/{goalId}` doc whose `childId` holds the parent's own
  `personId`. The goal create rule now allows `request.resource.data.childId == currentPersonId()` in addition
  to active children; goal update/delete/progress were already covered by `canManageGoals`.
- A personal **quest** is a normal quest whose `assignedTo` includes the parent's `personId` (quest writes were
  already unconstrained under `canManageQuests`). Completing it is **self-certified**: the client writes a
  `questCompletions` doc with `childId == parentPersonId` and `status: 'autoApproved'` and performs **no**
  `childState` points write. "Undo" deletes that completion (covered by the existing `canManageQuests` delete).

The questCompletions create/update rule has a new branch gating exactly that self-certified parent write
(`isActiveParentForHousehold && childId == currentPersonId() && status == 'autoApproved'`). Deploy the updated
rules before testing, or the goal create / quest self-completion writes return `permission-denied`. This is
self-only for now — assigning personal items to a co-parent is a follow-up.

## Recommended Test Flow

1. Sign in as a parent Firebase user.
2. Confirm the app routes to the parent lane.
3. Open `/parent/children`.
4. Create a brand-new child profile.
5. Confirm the child appears in the parent child roster immediately and that Firestore now includes:
   - `people/{childId}`
   - `childProfiles/{childId}`
   - `households/{householdId}/members/{childId}`
   - `households/{householdId}/childState/{childId}`
6. From that same child card, click `Enable login`.
7. Choose a child username and starter password.
8. Confirm Firestore now also includes:
   - `authAccounts/{childAuthUid}`
   - `usernameIndex/{normalizedUsername}`
   - `childProfiles/{childId}.login.enabled == true`
9. Sign out.
10. On `/login`, sign in through the child lane with the new username and password.
11. Confirm the app lands on that child's board without exposing parent-only views.
12. Sign back in as a parent.
13. Create a quest from `/parent/quests`.
14. Open the child board on another session or device and complete that quest.
15. Confirm the parent approval lane updates from Firestore and that approving the quest updates the child's points across auth-backed household sessions.
16. Open the child's reward store and request or redeem a reward.
17. Confirm the reward request appears on the parent dashboard and that approving or declining it syncs across sessions.
18. From `/parent/quests`, award bonus points to a child.
19. Confirm the child's point balance updates on the child account without needing a parent-only refresh.
20. From `/parent/goals`, create a goal assigned to that child.
21. Open the child's goals page from the child account and confirm the goal appears.
22. Log progress from the child goal board and confirm the parent goal manager reflects the updated progress.
23. Open the child's journal page from the child account and save today's reflection.
24. Confirm the parent dashboard shows the journal reply card for that child.
25. Send a heart or star reply from the parent dashboard and confirm the child journal shows the parent response.
26. From the parent dashboard or `/parent/modes`, switch the live seasonal mode.
27. Confirm the child account updates to the same live mode and the child board recalculates its must-do tracks.
28. Open `/parent/privileges`, change the screen-time or privilege rule copy, and save it.
29. Confirm the parent page keeps the new rule text and the child-facing reminders update from the same shared household data on another session.
30. If you need a second household, sign up a second parent account from `/signup/parent`.
31. Sign in as the source-household parent and open `/parent/children`.
32. On the child card you want to share, click `Create household link code`.
33. Keep that code handy, or reuse the device-saved helper if you are testing on one device.
34. Sign out and sign in as the receiving-household parent.
35. Open `/parent/children`, paste the code into `Add an existing child to this household`, choose the target household switch style, and submit.
36. Confirm Firestore now includes:
   - `childLinks/{linkCode}` with `status == accepted`
   - `households/{targetHouseholdId}/members/{childId}`
   - `households/{targetHouseholdId}/childState/{childId}`
37. Open `/family-access` as the linked child account and confirm the household lane reflects the new linked membership.
38. If the child is allowed to self-switch, switch to the other household and confirm the app shell title and family data reload into that household without a sign-out.
39. For a login-enabled child linked to the current household, open `/parent/children` and click `Point this child to this household`.
40. Confirm the child session on another device or tab updates into that household after the auth account document changes.

## Cloud Functions Backend (Child Password Reset)

Child password reset is the first privileged backend operation in the repo. It cannot run from the
client: a forgotten password for another account requires the Admin SDK, and the child alias is a
non-deliverable address so reset email is not an option. The callable lives in `functions/`.

Prerequisites:

- The Firebase project must be on the **Blaze** plan (Cloud Functions requirement).
- Functions run in region `us-central1`; the web client targets the same region via
  `getFunctions(app, 'us-central1')`.

Install and deploy:

```bash
cd functions
npm install
npm run build
cd ..
npx firebase-tools deploy --only functions
```

Use `firebase-tools` (not `firebase`, which resolves to the JS SDK and errors with "could not
determine executable to run"), and run from the repo root where `firebase.json` lives.

One-time IAM grant after the first deploy: this is a Gen 2 callable (runs on Cloud Run). Recent
Firebase CLI versions do not auto-allow public invocation, so browser calls fail CORS preflight with
a 403 until you grant the Cloud Run service the invoker role. The function still enforces its own
parent-permission check; this only lets the request reach the function:

- Cloud Console → Cloud Functions → select `resetChildPassword` → Permissions → Add principal
  `allUsers` → role **Cloud Run Invoker** (`roles/run.invoker`) → Save.
- Or with gcloud:
  `gcloud run services add-iam-policy-binding resetchildpassword --region=us-central1 --member=allUsers --role=roles/run.invoker --project=chorechamp-9be80`

The binding persists across redeploys of the same function, but must be reapplied for a fresh-project
deploy. If the project is under an org with domain-restricted sharing, `allUsers` is blocked and a
Gen 1 deploy (which auto-grants public invoke) is the fallback.

What `resetChildPassword({ childId })` does (Admin SDK, bypasses rules):

1. Verifies the caller is a signed-in parent with `canManageChildCredentials` (or `canManageChildren`)
   in the child's household, and that the child is an active member with sign-in enabled.
2. Generates a friendly temporary password, sets it via `auth.updateUser`, and revokes the child's
   existing sessions with `auth.revokeRefreshTokens`.
3. Flags `login.mustChangePassword = true` (plus `login.passwordResetAt`) on both
   `childProfiles/{childId}` and `authAccounts/{childAuthUid}`.
4. Returns the temp password to the authenticated parent only — it is never stored in Firestore.

The child then signs in with the temp password, is routed to a "create your own password" screen,
sets a new password client-side (they hold a fresh credential, so `updatePassword` works), and the
narrow `authAccounts` update rule above lets them flip `login.mustChangePassword` back to false.

## Emulator Option

If you want local-only Firebase development:

1. Turn on `useAuthEmulator`.
2. Turn on `useFirestoreEmulator`.
3. Point the host/port fields at your local emulators.

## Current Limitation

- Parent-managed child login enablement is now working.
- Child username sign-in is now working.
- The child can read only the child identity docs needed to open their board.
- Household quest creation, quest completion, and parent approval are now Firestore-backed for auth-backed households.
- Household reward requests and parent reward review are now Firestore-backed for auth-backed households, while the reward catalog itself is still seeded locally in the app.
- Parent bonus point awards are now Firestore-backed for auth-backed households and update shared child point balances.
- Household goals are now Firestore-backed for auth-backed households, including parent goal CRUD and child progress logging.
- Household journal entries are now Firestore-backed for auth-backed households, including child reflection saves and parent dashboard replies.
- The active household seasonal mode is now Firestore-backed for auth-backed households and syncs to parent and child sessions.
- Household privilege rules and screen-time settings are now Firestore-backed for auth-backed households and sync to parent and child sessions.
- Child-to-second-household linking is now supported from `/parent/children` through a prototype parent-generated link code flow.
- Household context switching is now supported for already-linked household memberships, including parent-controlled `point this child here` updates for login-enabled child accounts.
- Parent multi-household/co-parent invite flows are still a later chunk.
- Some remaining family progress surfaces are still mock/local after login, so cross-device shared family data is not fully migrated yet.
