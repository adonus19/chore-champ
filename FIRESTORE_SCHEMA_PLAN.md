# Chore Champ Firestore Schema Plan

Last updated: 2026-06-08

## Purpose

This document turns the identity and account decisions from `ACCOUNT_IDENTITY_PLAN.md` into a concrete Firestore planning sequence.

This plan is intentionally split into logical chunks so we can review and approve the data model step by step before implementation.

## Planning Chunks

### Chunk 1

- Core collections and document responsibilities
- Parent signup flow
- Parent-first household bootstrap

### Chunk 2

- Co-parent invite flow
- Membership acceptance
- Household access expansion

### Chunk 3

- Child creation flow
- Child login enablement with username
- Username index strategy

### Chunk 4

- Child-to-second-household linking
- Household switching state
- Recovery and child credential management

## Guardrails

- Account creation must happen through app flows, not the Firebase console.
- Parent auth uses Firebase `email + password`.
- Child auth uses app-facing `username + password`, backed by Firebase Auth behind the scenes.
- Child identity is canonical and can belong to more than one household.
- Household-specific progress data stays household-scoped.
- Do not rely on Firebase custom claims for active household or fine-grained membership permissions. Those should remain in Firestore because they change more often and can differ across households.

## Chunk 1: Core Collections

This first chunk defines the minimum durable records required for a parent to sign up in the app and own the first household.

## Top-Level Collections

### `authAccounts/{uid}`

Purpose:

- one record per Firebase Auth account
- links Firebase Auth to the app's person and household context

Suggested fields:

```ts
{
  uid: string;
  personId: string;
  accountType: 'parent' | 'child';
  status: 'active' | 'pending' | 'disabled';
  defaultHouseholdId: string | null;
  lastActiveHouseholdId: string | null;
  login: {
    provider: 'password';
    email?: string;
    username?: string;
    internalEmailAlias?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- Parents will use `email`.
- Children will later use `username` plus a hidden `internalEmailAlias`.
- `lastActiveHouseholdId` is session-friendly convenience state, not a source of truth for permissions.
- During the current prototype migration, child auth account docs may temporarily carry `prototypeChildId` to map the signed-in child onto the existing mock child boards. That field is a bridge, not part of the long-term final model.

### `people/{personId}`

Purpose:

- canonical human identity
- stable even if auth credentials or household links change later

Suggested fields:

```ts
{
  personId: string;
  type: 'parent' | 'child';
  displayName: string;
  avatarUrl: string | null;
  themeColor: string | null;
  status: 'active' | 'pending' | 'archived';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- This is where the human lives.
- Household-specific stats should not go here.

### `households/{householdId}`

Purpose:

- top-level family workspace
- the place where household-scoped data will live

Suggested fields:

```ts
{
  householdId: string;
  name: string;
  createdByPersonId: string;
  status: 'active' | 'archived';
  settings: {
    timezone: string;
    defaultModeId: string | null;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- The UI can still say `Family`.
- Internally, `household` is the more durable model name.

### `households/{householdId}/members/{personId}`

Purpose:

- person-to-household membership record
- household-specific role and permissions

Suggested fields:

```ts
{
  personId: string;
  role: 'owner' | 'parent_admin' | 'parent_member' | 'child';
  status: 'active' | 'invited' | 'pending' | 'revoked';
  permissions?: {
    canManageChildren: boolean;
    canManageQuests: boolean;
    canApproveRewards: boolean;
    canInviteParents: boolean;
    canManageChildCredentials: boolean;
  };
  childPolicies?: {
    householdSwitchPolicy: 'parentOnly' | 'childAllowed' | 'childRequest';
  };
  joinedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- This is the record that allows multi-parent households cleanly.
- `permissions` primarily applies to parent roles.
- `childPolicies` primarily applies to child roles.
- Children are members too, but their progress data should still live elsewhere.

## Reserved Collections For Later Chunks

These are not fully defined in Chunk 1, but we should reserve the naming now:

- `usernameIndex/{normalizedUsername}`
- `householdInvites/{inviteId}`
- `childLinks/{linkId}`

## Parent Signup Flow

This is the first production-grade account creation flow we should support.

### User-facing flow

1. Parent opens the public login/signup page.
2. Parent chooses `Create parent account`.
3. Parent enters:
   - email
   - password
   - display name
   - household name
4. App creates the Firebase Auth user with `createUserWithEmailAndPassword`.
5. App calls a secure backend bootstrap endpoint or Cloud Function.
6. Backend creates the Firestore records that establish the parent, person, household, and membership.
7. App refreshes session context and routes the parent into the new household.

### Backend bootstrap operation

Suggested operation name:

- `initializeParentAccount`

Responsibility:

- trust the authenticated Firebase UID
- create the canonical app records exactly once
- be idempotent enough to recover from partial client retry situations

Records created:

1. `authAccounts/{uid}`
2. `people/{personId}`
3. `households/{householdId}`
4. `households/{householdId}/members/{personId}`

### Example parent signup records

Example Firebase Auth user:

- `uid`: `uid_parent_123`
- `email`: `parent@example.com`

Example `authAccounts/uid_parent_123`

```json
{
  "uid": "uid_parent_123",
  "personId": "person_parent_123",
  "accountType": "parent",
  "status": "active",
  "defaultHouseholdId": "household_sunrise_home",
  "lastActiveHouseholdId": "household_sunrise_home",
  "login": {
    "provider": "password",
    "email": "parent@example.com"
  }
}
```

Example `people/person_parent_123`

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

Example `households/household_sunrise_home`

```json
{
  "householdId": "household_sunrise_home",
  "name": "Sunrise Home",
  "createdByPersonId": "person_parent_123",
  "status": "active",
  "settings": {
    "timezone": "America/New_York",
    "defaultModeId": null
  }
}
```

Example `households/household_sunrise_home/members/person_parent_123`

```json
{
  "personId": "person_parent_123",
  "role": "owner",
  "status": "active",
  "permissions": {
    "canManageChildren": true,
    "canManageQuests": true,
    "canApproveRewards": true,
    "canInviteParents": true,
    "canManageChildCredentials": true
  }
}
```

## Read Model For App Startup

Once Chunk 1 is implemented, a signed-in parent session should resolve like this:

1. Firebase Auth provides `uid`.
2. App reads `authAccounts/{uid}`.
3. App gets:
   - `personId`
   - `accountType`
   - `defaultHouseholdId`
4. App reads `households/{defaultHouseholdId}/members/{personId}` to confirm access and permissions.
5. App sets current household context from there.

This is the path that should gradually replace the current `userProfiles/{uid}` bootstrap model.

## Why this is a good first chunk

- It solves parent self-service account creation first.
- It establishes the durable identity model before we add co-parents or child usernames.
- It avoids hard-coding assumptions that would block multi-household support later.
- It gives us a clean migration target away from the current `userProfiles/{uid}` prototype docs.

## Not In Scope For Chunk 1

- co-parent invites
- child creation
- child username provisioning
- child password reset
- child-to-second-household linking
- household switching policies

Those should be handled in the next chunks rather than folded into the first implementation pass.

## Chunk 2: Co-Parent Invite Flow

This chunk defines how an existing household adds another parent without assuming that the invited adult is new to the app or permanently tied to only one household.

## Goal

Support both of these cases cleanly:

1. A parent invites another adult who has never used Chore Champ before.
2. A parent invites another adult who already has a Chore Champ account and possibly belongs to another household.

## Invite Collection

### `householdInvites/{inviteId}`

Purpose:

- durable invite record
- tracks who invited whom, into which household, with what permissions
- supports emailed invite links and acceptance flows

Suggested fields:

```ts
{
  inviteId: string;
  householdId: string;
  invitedEmailNormalized: string;
  invitedDisplayName: string | null;
  invitedByPersonId: string;
  intendedRole: 'parent_admin' | 'parent_member';
  intendedPermissions: {
    canManageChildren: boolean;
    canManageQuests: boolean;
    canApproveRewards: boolean;
    canInviteParents: boolean;
    canManageChildCredentials: boolean;
  };
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  tokenHash: string;
  claimedByUid: string | null;
  claimedByPersonId: string | null;
  acceptedAt: Timestamp | null;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- `invitedEmailNormalized` should be lowercase and trimmed.
- `tokenHash` is safer than storing a raw invite token in Firestore.
- The raw token should live only in the emailed link and request payload at accept time.
- We should not create the household membership document until the invite is actually accepted.

## Invite Creation Flow

### User-facing flow

1. An existing household parent opens a future `Invite co-parent` flow in the app.
2. They enter:
   - email address
   - optional display name
   - role choice
   - permission level
3. App calls a secure backend operation.
4. Backend validates the inviter's membership and permission set.
5. Backend creates `householdInvites/{inviteId}` with a hashed token and expiration.
6. Backend sends an email containing the invite link.

### Backend operation

Suggested operation name:

- `createHouseholdInvite`

Required checks:

- authenticated caller exists
- caller has an active membership in the target household
- caller has `canInviteParents`
- invited email is not already an active parent member in the same household
- inviter is not exceeding invite abuse limits

### Example invite record

Example `householdInvites/invite_abc123`

```json
{
  "inviteId": "invite_abc123",
  "householdId": "household_sunrise_home",
  "invitedEmailNormalized": "coparent@example.com",
  "invitedDisplayName": "Dad",
  "invitedByPersonId": "person_parent_123",
  "intendedRole": "parent_admin",
  "intendedPermissions": {
    "canManageChildren": true,
    "canManageQuests": true,
    "canApproveRewards": true,
    "canInviteParents": false,
    "canManageChildCredentials": true
  },
  "status": "pending",
  "tokenHash": "sha256:8f7b...",
  "claimedByUid": null,
  "claimedByPersonId": null
}
```

## Invite Acceptance Flow

The app should support two acceptance branches.

### Branch A: Invited adult is brand new

1. Adult opens the invite link.
2. App shows the household invite screen.
3. Adult creates a parent account in-app with the same email address.
4. App signs them in with Firebase Auth.
5. App calls `acceptHouseholdInvite`.
6. Backend creates the missing app identity records if they do not already exist.
7. Backend adds the new membership to the household.

### Branch B: Invited adult already has a Chore Champ account

1. Adult opens the invite link.
2. App prompts them to sign in.
3. App calls `acceptHouseholdInvite`.
4. Backend verifies that the signed-in Firebase account email matches the invited email.
5. Backend adds a second household membership for that existing parent identity.

## Acceptance Backend Operation

Suggested operation name:

- `acceptHouseholdInvite`

Responsibilities:

- validate raw invite token against `tokenHash`
- validate invite status is still `pending`
- validate invite is not expired
- validate authenticated Firebase email matches `invitedEmailNormalized`
- look up or create the caller's app identity records
- create the household membership
- update the invite record to accepted

## Identity Behavior On Acceptance

### If `authAccounts/{uid}` already exists

- do not create a duplicate person
- reuse `personId`
- add a new active membership under the invited household
- keep the existing `defaultHouseholdId` unless the user explicitly chooses to switch

### If `authAccounts/{uid}` does not exist yet

- create `people/{personId}`
- create `authAccounts/{uid}`
- set `defaultHouseholdId` and `lastActiveHouseholdId` to the invited household
- create the new active membership

This split is one of the main reasons the app model must separate:

- auth account
- person
- household
- membership

## Example Acceptance Outcome

Example existing-user acceptance creates:

`households/household_sunrise_home/members/person_parent_456`

```json
{
  "personId": "person_parent_456",
  "role": "parent_admin",
  "status": "active",
  "permissions": {
    "canManageChildren": true,
    "canManageQuests": true,
    "canApproveRewards": true,
    "canInviteParents": false,
    "canManageChildCredentials": true
  }
}
```

And updates:

`householdInvites/invite_abc123`

```json
{
  "status": "accepted",
  "claimedByUid": "uid_parent_456",
  "claimedByPersonId": "person_parent_456"
}
```

## Access Listing After Acceptance

Once a parent can belong to more than one household, the app needs a reliable way to list all active household memberships for the signed-in person.

Recommended first approach:

- read `authAccounts/{uid}` to get `personId`
- run a collection group query across `members` where:
  - `personId == current personId`
  - `status == 'active'`

Why this is good enough initially:

- avoids premature denormalization
- supports parents in multiple households
- also supports children in multiple households later

If this becomes awkward at scale, we can later add a derived index collection for fast household listings.

## Invite UX Considerations

- Invite links should clearly show the household name before acceptance.
- If the signed-in email does not match the invited email, the app should block acceptance and explain why.
- If the invite is expired or revoked, the app should show a clean error state instead of a dead end.
- If the parent already belongs to the household, the app should short-circuit into a friendly `already connected` state.

## Why this chunk matters before child creation

- It finishes the adult household membership model first.
- It proves the multi-household parent path before we add child username logic.
- It avoids baking child-account assumptions into an adult-only household model that will need to be redone later.

## Not In Scope For Chunk 2

- child profile creation
- child username provisioning
- child recovery
- child-to-second-household linking
- active household switching policy

Those belong in the next chunks.

## Chunk 3: Child Creation and Child Username Login

This chunk defines the canonical child record, how a parent adds a child to a household, and how child login is enabled later without requiring the child to have an email address.

## Child-Specific Canonical Collection

### `childProfiles/{childPersonId}`

Purpose:

- one canonical child profile per child identity
- stores child-specific identity and login state that should not be duplicated per household

Suggested fields:

```ts
{
  childPersonId: string;
  profile: {
    displayName: string;
    ageYears: number | null;
    avatarPresetId: string | null;
    customAvatarUrl: string | null;
    themeColor: string | null;
  };
  login: {
    enabled: boolean;
    authUid: string | null;
    usernameNormalized: string | null;
    usernameDisplay: string | null;
  };
  status: 'active' | 'archived';
  createdByPersonId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- `people/{personId}` remains the canonical human record.
- `childProfiles/{childPersonId}` holds child-only details and login linkage.
- `childPersonId` should match the `personId` used in `people/{personId}`.

## Household Child State Collection

### `households/{householdId}/childState/{childPersonId}`

Purpose:

- household-specific child progress and focus state
- this is where household-local values live instead of on the canonical child identity

Suggested fields:

```ts
{
  childPersonId: string;
  points: number;
  streakDays: number;
  activeModeId: string | null;
  currentBook: string | null;
  currentLifeSkill: string | null;
  sportsGoal: string | null;
  yearGoal: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- This is intentionally household-scoped.
- If the same child belongs to two households, each household gets its own `childState` record.

## Child Membership Extension

The existing membership shape from Chunk 1 should be extended so child members can carry child-specific household access policy.

Updated `households/{householdId}/members/{personId}` shape:

```ts
{
  personId: string;
  role: 'owner' | 'parent_admin' | 'parent_member' | 'child';
  status: 'active' | 'invited' | 'pending' | 'revoked';
  permissions?: {
    canManageChildren: boolean;
    canManageQuests: boolean;
    canApproveRewards: boolean;
    canInviteParents: boolean;
    canManageChildCredentials: boolean;
  };
  childPolicies?: {
    householdSwitchPolicy: 'parentOnly' | 'childAllowed' | 'childRequest';
  };
  joinedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- `permissions` primarily applies to parent roles.
- `childPolicies` primarily applies to child roles.
- The default `householdSwitchPolicy` for new child memberships should be `parentOnly`.

## Child Creation Flow

### User-facing flow

1. Parent opens a future `Add child` flow in the app.
2. Parent enters:
   - display name
   - age
   - avatar or theme choices
3. App calls a secure backend operation.
4. Backend creates the child identity and links that child to the current household.
5. App refreshes the household roster.

### Backend operation

Suggested operation name:

- `createChildProfile`

Required checks:

- authenticated caller exists
- caller has an active household membership
- caller has `canManageChildren`

Records created:

1. `people/{childPersonId}`
2. `childProfiles/{childPersonId}`
3. `households/{householdId}/members/{childPersonId}`
4. `households/{householdId}/childState/{childPersonId}`

### Example child creation records

Example `people/person_child_ava`

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

Example `childProfiles/person_child_ava`

```json
{
  "childPersonId": "person_child_ava",
  "profile": {
    "displayName": "Ava",
    "ageYears": 10,
    "avatarPresetId": "rocket-raccoon",
    "customAvatarUrl": null,
    "themeColor": "#ff7f6e"
  },
  "login": {
    "enabled": false,
    "authUid": null,
    "usernameNormalized": null,
    "usernameDisplay": null
  },
  "status": "active",
  "createdByPersonId": "person_parent_123"
}
```

Example `households/household_sunrise_home/members/person_child_ava`

```json
{
  "personId": "person_child_ava",
  "role": "child",
  "status": "active",
  "childPolicies": {
    "householdSwitchPolicy": "parentOnly"
  }
}
```

Example `households/household_sunrise_home/childState/person_child_ava`

```json
{
  "childPersonId": "person_child_ava",
  "points": 0,
  "streakDays": 0,
  "activeModeId": null,
  "currentBook": null,
  "currentLifeSkill": null,
  "sportsGoal": null,
  "yearGoal": null
}
```

## Username Index Strategy

### `usernameIndex/{normalizedUsername}`

Purpose:

- enforce global username uniqueness for child login
- map a child-facing username to the hidden Firebase-backed login account

Suggested fields:

```ts
{
  normalizedUsername: string;
  usernameDisplay: string;
  childPersonId: string;
  authUid: string | null;
  internalEmailAlias: string | null;
  status: 'reserved' | 'active' | 'disabled';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- The document ID should be the normalized username.
- Normalization should be lowercase plus trim, with validation for allowed characters.
- This gives us atomic uniqueness using Firestore transactions.
- `reserved` is useful during multi-step provisioning so we do not accidentally double-assign a username.

## Child Login Enablement Flow

This flow provisions the child's actual Firebase Auth account only after a parent chooses to allow login.

### User-facing flow

1. Parent opens a future `Child access` settings screen.
2. Parent chooses `Enable login`.
3. Parent enters:
   - desired username
   - temporary password
4. App calls a secure backend operation.
5. Backend reserves the username, creates the hidden Firebase Auth account, and links it to the child identity.
6. App shows the username to the parent and confirms that the child can now sign in.

### Backend operation

Suggested operation name:

- `enableChildLogin`

Required checks:

- authenticated caller exists
- caller is an active parent member of the child's household
- caller has `canManageChildCredentials`
- child exists and belongs to that household
- child does not already have an enabled login
- requested username is available

Records created or updated:

1. reserve `usernameIndex/{normalizedUsername}`
2. create Firebase Auth user with:
   - hidden internal email alias
   - provided temporary password
3. create `authAccounts/{childUid}`
4. update `childProfiles/{childPersonId}.login`
5. update `usernameIndex/{normalizedUsername}` from `reserved` to `active`

### Internal email alias strategy

Recommended format:

- opaque and non-human, for example:
  - `child.uid_abc123@children.auth.chorechamp.app`

Why:

- avoids exposing a real email dependency for children
- keeps Firebase password auth usable
- avoids leaking parent email structure into child accounts

### Example records after login enablement

Example `authAccounts/uid_child_ava`

```json
{
  "uid": "uid_child_ava",
  "personId": "person_child_ava",
  "accountType": "child",
  "status": "active",
  "defaultHouseholdId": "household_sunrise_home",
  "lastActiveHouseholdId": "household_sunrise_home",
  "prototypeChildId": "ava",
  "login": {
    "provider": "password",
    "username": "avaquest",
    "internalEmailAlias": "child.uid_child_ava@children.auth.chorechamp.app"
  }
}
```

Example updated `childProfiles/person_child_ava`

```json
{
  "login": {
    "enabled": true,
    "authUid": "uid_child_ava",
    "usernameNormalized": "avaquest",
    "usernameDisplay": "AvaQuest"
  }
}
```

Example `usernameIndex/avaquest`

```json
{
  "normalizedUsername": "avaquest",
  "usernameDisplay": "AvaQuest",
  "childPersonId": "person_child_ava",
  "authUid": "uid_child_ava",
  "internalEmailAlias": "child.uid_child_ava@children.auth.chorechamp.app",
  "status": "active"
}
```

## Child Sign-In Flow

To preserve a username-based child experience without building full custom auth, the app should use this sign-in pattern:

1. Child enters `username + password`.
2. App calls a secure backend operation with the username only.
3. Backend normalizes the username and looks up `usernameIndex/{normalizedUsername}`.
4. Backend returns the hidden `internalEmailAlias` only if the username is valid and active.
5. App completes Firebase `signInWithEmailAndPassword(internalEmailAlias, password)`.
6. App resolves `authAccounts/{uid}` and household context normally after Firebase sign-in succeeds.

### Backend operation

Suggested operation name:

- `beginChildUsernameSignIn`

Required safeguards:

- rate limiting
- generic error responses
- username normalization
- disabled username handling

Important:

- the backend should not reveal whether the username or password was wrong in a user-distinguishable way
- the app should show a generic message such as `We couldn't sign you in with that username and password`

## Why this chunk matters

- It gives children a true username-based login without requiring child email accounts.
- It keeps password verification in Firebase.
- It creates the canonical child identity before multi-household child sharing is added.

## Not In Scope For Chunk 3

- linking a child to a second household
- household switching behavior between multiple households
- parent-mediated child password reset flows

Those belong in Chunk 4.

## Chunk 4: Child Linking, Switching, and Recovery

This chunk finishes the model for shared child accounts across multiple households, parent-mediated credential recovery, and household-context behavior.

## Child-to-Second-Household Linking

### `childLinks/{linkId}`

Purpose:

- secure, explicit approval record for linking an existing canonical child identity to another household

Suggested fields:

```ts
{
  linkId: string;
  childPersonId: string;
  sourceHouseholdId: string;
  targetHouseholdId: string | null;
  targetParentEmailNormalized: string | null;
  createdByPersonId: string;
  intendedChildPolicies: {
    householdSwitchPolicy: 'parentOnly' | 'childAllowed' | 'childRequest';
  };
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  tokenHash: string;
  acceptedByPersonId: string | null;
  acceptedAt: Timestamp | null;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- The source household is the household that already has the child.
- The target household is the household that wants to add the same child.
- `targetParentEmailNormalized` can be optional, but targeted links are safer than untargeted links.

## Recommended Linking Direction

Recommended first implementation:

- an authorized parent in the source household generates the child link
- an authorized parent in the target household accepts the link

Why this is the best starting direction:

- it keeps child sharing explicit
- it avoids letting strangers search for children
- it cleanly supports separate-household families without duplicating the child identity

## Child Link Creation Flow

Suggested backend operation:

- `createChildHouseholdLink`

Required checks:

- caller is an active parent member of the source household
- caller can manage children in the source household
- child is an active member of the source household

## Child Link Acceptance Flow

Suggested backend operation:

- `acceptChildHouseholdLink`

Required checks:

- caller is an active parent member of the target household
- caller can manage children in the target household
- raw token matches `tokenHash`
- link is still `pending`
- link is not expired
- if `targetParentEmailNormalized` is set, signed-in email must match it

Records created on acceptance:

1. `households/{targetHouseholdId}/members/{childPersonId}`
2. `households/{targetHouseholdId}/childState/{childPersonId}`
3. update `childLinks/{linkId}` to `accepted`

Important:

- do not create a second child person
- do not create a second child auth account
- do not copy points or streaks from the source household

### Example membership in target household

Example `households/household_river_home/members/person_child_ava`

```json
{
  "personId": "person_child_ava",
  "role": "child",
  "status": "active",
  "childPolicies": {
    "householdSwitchPolicy": "parentOnly"
  }
}
```

Example `households/household_river_home/childState/person_child_ava`

```json
{
  "childPersonId": "person_child_ava",
  "points": 0,
  "streakDays": 0,
  "activeModeId": null,
  "currentBook": null,
  "currentLifeSkill": null,
  "sportsGoal": null,
  "yearGoal": null
}
```

## Household Context For Child Accounts

The existing `authAccounts/{uid}` document should remain the place where we track the child's account-level household landing context.

Relevant fields:

- `defaultHouseholdId`
- `lastActiveHouseholdId`

Recommended meaning:

- `defaultHouseholdId`
  - the household the child should land in for a fresh session
  - parent-controlled
- `lastActiveHouseholdId`
  - the last household the child actively used
  - useful for restoring context when self-switching is allowed

Recommended behavior:

1. On fresh sign-in, the app should prefer `defaultHouseholdId`.
2. During a running session, if child self-switching is allowed, the app may update `lastActiveHouseholdId`.
3. If a parent intentionally changes `defaultHouseholdId`, the child app should converge to that household and refresh its data context.

This gives us remote parent control without requiring a forced logout by default.

## Household Switching Authority

The first implementation should use the child membership policy:

- `households/{householdId}/members/{childPersonId}.childPolicies.householdSwitchPolicy`

Supported values:

- `parentOnly`
- `childAllowed`
- `childRequest`

Recommended first-phase behavior:

- if `parentOnly`, child does not see a household switch control
- if `childAllowed`, child can switch among already-linked households
- if `childRequest`, child can ask but cannot complete the switch without parent approval

The more advanced rule where a switch from household `A` to `B` needs both leave and enter permission stays backlogged and should not shape the first implementation.

## Parent-Mediated Child Recovery

Child recovery should be implemented through privileged backend operations, not public reset flows.

### Reveal username

Suggested backend operation:

- `revealChildUsername`

Behavior:

- parent must be authenticated
- parent must have `canManageChildCredentials`
- parent should re-authenticate recently before this action
- backend returns the child's display username

### Reset child password

Suggested backend operation:

- `resetChildPassword`

Behavior:

- parent must be authenticated
- parent must have `canManageChildCredentials`
- parent should re-authenticate recently before this action
- backend generates or accepts a temporary password
- backend updates the Firebase Auth password via Admin SDK
- backend can also update `authAccounts/{uid}` or `childProfiles/{childPersonId}` with a flag requiring password change on next sign-in

Optional future extension:

- audit these actions in a household-scoped admin log

## Username Lookup Recovery

For forgotten child usernames:

- there should be no public `forgot username` flow
- the parent should retrieve the username from a secure parent surface after re-authentication

This is safer and aligns with the reality that many children will not control an email inbox.

## Why this finishes the planning pass well

- It completes the exact flows the app needs for shared child identity across households.
- It preserves household-local progress data.
- It keeps recovery and credential power in parent-controlled flows.
- It stays aligned with the earlier decision to avoid a full custom auth server.

## After Chunk 4

The account and identity schema planning work is complete enough to move into implementation planning.

The next practical implementation sequence should be:

1. replace `userProfiles/{uid}` login resolution with `authAccounts/{uid}` and the new bootstrap model
2. implement parent signup bootstrap
3. implement co-parent invites
4. implement child profile creation
5. implement child login enablement with username lookup

## Current Prototype Implementation Note

The current parent signup implementation uses a client-side Firestore transaction to bootstrap:

- `authAccounts/{uid}`
- `people/{personId}`
- `households/{householdId}`
- `households/{householdId}/members/{personId}`

That is acceptable for the current prototype chunk, but the intended long-term direction remains:

- client creates the Firebase Auth parent account
- client calls a secure backend or callable function
- backend performs the bootstrap writes

That future move should let the app tighten client write rules again without changing the parent signup UX.

The current child creation implementation follows the same temporary prototype pattern:

- signed-in parent creates or edits child identity data directly from the client
- Firestore stores the canonical child profile plus household child state
- the signed-in prototype app now loads that household child roster from Firestore instead of always showing the seeded demo children

Child username sign-in itself is intentionally still deferred because the secure long-term version should use a backend or callable lookup rather than a client-readable username index.
