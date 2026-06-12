# Chore Champ Account, Identity, and Household Plan

Last updated: 2026-06-08

## Purpose

This document captures the current architectural decisions for authentication, account creation, identity modeling, and multi-household behavior so they survive conversation compaction and can guide later Firebase and app work.

This is not the final Firestore schema document yet. It is the decision record that the concrete schema plan should follow.

## Locked Decisions

### Account creation happens in the app

- Prospective users should create accounts through Chore Champ app flows.
- Firebase Console user creation is only acceptable for local development, QA setup, or emergency admin/debug work.
- Production user provisioning should use the Firebase client SDK for standard parent signup and secure backend or Admin SDK flows for child account creation, linking, password reset, and other privileged actions.

### Parent auth and child auth are different on purpose

- Parents sign in with `email + password`.
- Children sign in with `username + password`.
- Children should not need an email address.
- Child-facing login should never expose the internal email alias used under the hood.

### Child auth should still lean on Firebase Auth

- We should avoid building a fully custom username/password auth server unless absolutely necessary.
- The recommended direction is for child accounts to use Firebase Auth password accounts with an internal, non-human email alias.
- The app should treat the child's username as the visible login handle and resolve it through app/backend logic.
- The preferred child sign-in pattern is:
  - child enters `username + password`
  - app sends the username to a secure backend lookup
  - backend resolves the username to the hidden internal Firebase email alias
  - app completes Firebase `email + password` sign-in using that alias
- This keeps password verification in Firebase while still giving children a true username-based experience in the app.

### Child recovery should be parent-mediated

- Parents should be able to view a child's username from a secure parent surface.
- Parents should be able to reset a child's password from within the app through a privileged backend path.
- Children should not depend on password reset email because many children will not control an inbox.
- For child credential recovery, the parent is the safety and recovery channel.

### One child identity can belong to more than one household

- Child identity must not be permanently owned by one parent or one household.
- Household linkage should be modeled separately from the child identity itself.
- Household-specific state such as points, streaks, quests, rewards, approvals, and seasonal mode should remain household-scoped.

## Core Modeling Direction

The model should keep these concepts separate:

- `auth account`
  - The Firebase-authenticated login identity.
- `person`
  - The human being using the app.
- `household`
  - The family workspace, rules, and day-to-day operating context.
- `membership`
  - The relationship between a person and a household.
- `child login handle`
  - The username-based sign-in surface for child accounts.

This separation is what makes the following possible without major rewrites:

- more than one parent per household
- one parent linked to multiple households
- one child linked to multiple households
- child identity that stays consistent across households
- household-specific points and rules that do not leak across homes

## Auth Strategy

### Parents

- Parents sign up in the app with `email + password`.
- Parents use standard Firebase password reset email flows.
- A parent signup flow should eventually create:
  - the Firebase Auth account
  - the canonical person record
  - the first household
  - the parent membership in that household

### Children

- Children do not sign up independently.
- A parent should create the child profile first.
- Child login should be an explicit enablement step, not automatic.
- When login is enabled for a child:
  - the parent chooses or confirms a unique username
  - the system provisions the child's Firebase Auth account using a backend or Admin SDK path
  - the account is linked to the existing child identity, not a new duplicate child record

### Why not direct custom auth right away

- Firebase officially supports custom token auth, but that requires a server that accepts custom credentials and returns signed tokens.
- That approach is powerful, but it also shifts more credential handling and security responsibility onto us.
- For this app, the better long-term balance is child-facing usernames with Firebase-managed password accounts behind the scenes.
- Username lookup should be rate-limited and should return generic failure messages so we do not make username enumeration easy.

## Recovery Strategy

### Parent recovery

- Use normal Firebase password reset email.
- Later we can add stronger options such as passkeys or MFA, but they are not required for MVP.

### Child recovery

- Child username lookup should happen in the parent app.
- Parent password reset for a child should happen in the parent app.
- The likely backend behavior should be one of these:
  - set a temporary password
  - force a password change on next sign-in
  - revoke existing sessions when appropriate
- Parent should re-authenticate before sensitive credential actions.

## Household Switching Direction

## Guiding Principle

A child account should not permanently "point at" one household. Instead, the child should have:

- one canonical identity
- one set of allowed household memberships
- one active household context at a time

That active household context is what the child board, quests, goals, and rewards should read from.

## Recommended Design

### Separate current household from default household

- `defaultHouseholdId`
  - The household the child should normally land in when a new session starts.
- `activeHouseholdId`
  - The household currently in use in the running app session.

Recommended behavior:

- `defaultHouseholdId` should live in persistent account-linked data.
- `activeHouseholdId` should be treated as session context.
- The app can remember the most recent active household locally for convenience, but the server-side default still matters.

### Support configurable switch authority

Each child account should eventually have a household-switch policy. The best starting modes are:

- `parentOnly`
  - Only a parent can change the child's household context or default household.
- `childAllowed`
  - The child can switch among already-approved household memberships.
- `childRequest`
  - The child can ask to switch, but a parent has to approve it.

Recommended default:

- younger children default to `parentOnly`
- older children can optionally use `childAllowed`

Long-term, this policy is probably best stored on the child-to-household membership rather than as a single global child flag. That gives different households room to enforce different switching expectations later.

In a more advanced version, a child-initiated switch from household `A` to household `B` may need to respect both:

- the rule for leaving the current active household
- the rule for entering the target household

This is a strong future direction, but it should stay backlogged for now rather than shaping the first implementation pass.

### Parent-initiated switching should not require logout by default

The first-choice experience should be:

- parent changes the child's default or active household from a parent surface
- child app listens for that change
- child app swaps to the new household context and reloads data

Forced logout should be reserved for special cases:

- security-sensitive credential changes
- explicit parent action to end child sessions
- invalid or revoked household access

### Same-device scenario

For children using the same physical device across households:

- the app should keep the child signed in
- the app should switch household context in-place when appropriate
- the app should clearly show which household is active

This is better than forcing frequent sign-out/sign-in cycles and keeps the experience simpler for kids.

### Remote parent control

If a parent is allowed to control the child's household selection, the parent should be able to:

- set the child's default household
- optionally push an immediate household switch
- optionally revoke the child's active session in edge cases

The child app should respond gracefully with:

- a clear banner or message
- refreshed data for the new household
- minimal disruption when security does not require full sign-out

## What the current brainstorming got right

- It is correct that a child using the same device across households needs an in-app way to land in the right household.
- It is correct that parent-controlled switching should be supported.
- It is correct that self-switch permission should be configurable rather than assumed.
- It is correct that this decision needs to align with the broader multi-parent, multi-household identity model.

## What should be refined

- We should avoid modeling the child as permanently attached to one household.
- We should avoid making logout the default switching mechanism.
- We should avoid a binary all-or-nothing rule where only the child or only the parent can ever control switching.

Instead, the stronger model is:

- canonical child identity
- multiple household memberships
- active household as context
- configurable switching authority

## Recommended UX Direction

### Parent surfaces

Parents should eventually have:

- a child access or account settings area
- a switch-policy control for that child
- a way to set the child's default household
- a way to issue a temporary password reset
- a way to view the child's username after re-authentication

### Child surfaces

If `childAllowed` is enabled, the child should eventually have:

- a `Switch household` entry on the child profile page or child board header
- a clear current-household indicator
- a simple chooser that only lists approved household memberships

If `parentOnly` is enabled:

- the child should not see the switch control, or should see a passive status message only

## Forward-Looking Permission Idea

We should plan for a permission like:

- `canManageChildCredentials`

That permission should not automatically belong to every adult forever. It should be household- and child-aware so we can support more nuanced guardianship and multi-household arrangements later.

## Concrete Schema Plan Must Eventually Cover

The next Firestore schema document should include exact collection paths and example documents for:

- parent signup
- co-parent invite
- child creation
- child login enablement with username
- child credential recovery
- child-to-second-household linking
- household switch policy and active/default household behavior

## Open Questions

- Should `activeHouseholdId` be persisted only locally, or also mirrored server-side for real-time remote switching?
- Should child self-switch be immediate, or should some households require parent approval?
- Should the child be prompted to confirm a household change when a remote parent switch occurs?
- What re-authentication threshold should apply before a parent can reveal or reset child credentials?
