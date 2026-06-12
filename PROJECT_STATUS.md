# Chore Champ Progress Tracker

Last updated: 2026-06-12

## Purpose

This is the repo source of truth for build progress, current MVP state, and the next queue of work.
Update this file at the end of each completed implementation pass.

## Current Snapshot

- Angular 22 PWA shell is in place and the build passes, though the initial bundle now exceeds the old warning budget after Firebase was added.
- Mock-data-first architecture is active.
- The current build is a strong prototype, but MVP is not complete under the revised scope.
- Route guards and role-aware shell navigation now separate child lanes from parent dashboards and approval views.
- A basic mock auth flow now exists with a dedicated public login page, sign-in/out states, persisted session role, and post-login role-aware routing.
- Firebase Auth wiring is now live with the Firebase SDK installed, environment-based config files, auth-aware guards, email/password login support, and Firestore-backed role/profile lookup.
- Account, identity, child username login, recovery, and multi-household design decisions are now captured in `ACCOUNT_IDENTITY_PLAN.md` so they persist outside the chat history.
- Login bootstrap now prefers the new `authAccounts/{uid}` plus `people/{personId}` model, while still falling back to legacy `userProfiles/{uid}` during migration.
- Public parent signup is now implemented with a dedicated route plus a temporary client-side Firestore bootstrap transaction for the first household owner flow.
- Signed-in real parent households now load child profiles from Firestore, and the parent child manager can create or edit child profiles in Firestore instead of only mutating the seeded demo roster.
- Signed-in parent households can now enable real child username login from the child manager, and the public child login lane now accepts child usernames or direct email during the transition.
- Auth-backed households now sync the quest library plus quest completion and approval flow through Firestore, so the core daily loop is no longer trapped in local mock data.
- Auth-backed households now also sync reward requests and parent reward review through Firestore, with point spending derived from base child points minus the shared pending/fulfilled reward redemption ledger.
- Auth-backed households now sync goals through Firestore, including parent goal CRUD and child progress logging.
- Parent self-board goals are now easier to reach from the shell and dashboard, and the parent goals manager now previews self-assigned goals alongside child boards.
- Auth-backed households now sync privilege rules and screen-time settings through Firestore, so parent edits carry across parent and child sessions instead of staying browser-local.
- Auth-backed accounts can now switch among linked household contexts, and parents can both link an existing child into a second household from the app and point a login-enabled child account at the parent’s current household without forcing a sign-out.
- Production builds now emit the Angular service worker and GitHub Pages deployment assets, and the repo includes SPA fallback plus a deploy workflow for real-device PWA testing.
- GitHub Pages deployment now generates Angular Firebase environment files from GitHub Actions secrets, while local Firebase env files stay gitignored and can be recreated from `.env.example`.
- MVP now requires:
  - Firebase-backed shared data so parents and children can use separate devices with the same family account
- The app currently has working MVP slices for:
  - Family dashboard
  - Public login page for parent vs child entry
  - Child Today View
  - Parent quest manager with quest creation, editing, and deletion
  - Parent privilege rules and screen-time settings editor
  - Parent bonus points and task-status override flow
  - Parent approval queue for quest completions
  - Rewards display and purchase flow
  - Parent-side reward request review on the family dashboard
  - Seasonal mode manager with preview, activation, and deeper editing flow
  - Child profile page
  - Parent child-profile manager
  - Local mock family account shell
  - Child goals page with synced progress logging
  - Child journal page with daily entry flow and timeline
  - Parent journal reaction flow on the family dashboard
  - Parent goals manager with synced goal creation, editing, and deletion

## Completed Passes

- Scaffolded the Angular application and added PWA support.
- Added route-level scroll restoration so page navigation reliably lands at the top of the destination view.
- Built the Family Dashboard with family snapshot cards, child progress cards, seasonal mode switching, and pending approvals.
- Built the Child Today View with required vs bonus quests, progress messaging, completion states, and celebration state.
- Built the Parent Quest Manager using Angular Signal Forms and mock quest creation.
- Added quest edit/delete depth so parents can maintain the live mock quest library from the same manager screen.
- Polished the quest editor interaction so the main editor card hugs its content, selected quests are visibly active, and edit actions scroll smoothly into view.
- Added a parent privilege rules and screen-time settings editor with live current-mode preview and dashboard entry points.
- Added parent bonus-point awards plus direct task-status overrides so parents can flex the board without breaking the core responsibility-first rules.
- Added parent approval polish with grouped review cards, impact messaging, and direct approve / retry actions.
- Built the child rewards store with mock redemption / request flow, reward history, and a clear privileges-vs-rewards distinction.
- Added parent-side reward request review with approve / decline-and-refund flow in the parent desk.
- Moved reward request review onto the family dashboard as the top-priority parent approval lane and fixed the child-side panel column so compact cards hug their content.
- Built the seasonal mode manager and made seasonal modes change which quests count as today's must-do board versus optional live tracks.
- Polished seasonal mode card spacing so label/value pairs breathe a bit more and required tracks read more clearly.
- Added deeper seasonal mode editing with save/reset controls for intensity, streak policy, required tracks, screen-time guidance, and daily minimums.
- Added a dedicated child profile page with profile stats, growth badges, focus cards, and route entry points from the dashboard and child board.
- Added a parent child-profile manager with create/edit flow so the family roster is no longer fixed demo data.
- Added a local mock family account shell with a shared-device launchpad and app-level family access chrome.
- Built the child goals and journal flows with route entry points from the child board, progress logging, and a saved journal timeline.
- Fixed the child journal status-card rendering so the journal rhythm label comes from the view model instead of a brittle inline interpolation.
- Added parent journal reactions on the family dashboard with one-tap encouragement replies that feed straight back into the child journal timeline.
- Added a parent goals manager with create/edit flow, seasonal mode targeting, and live child-preview cards wired to the shared goal source.
- Finished goal CRUD by adding goal deletion to the parent goals manager and mock data layer.
- Added a role-based access split with child-safe route guards, role-aware shell navigation, and child-page back-links that no longer funnel kids toward parent surfaces.
- Added a dedicated public login page so sign-in happens before any family-specific data renders, while mock auth still persists role state and routes parents vs children into the correct post-login lane.
- Started Firebase Auth wiring by installing the Firebase SDK, adding environment config files, waiting on auth state in route guards, and upgrading the login page to use Firebase email/password when the project keys are configured.
- Added Firestore-backed Firebase role/profile lookup so signed-in users can resolve into the parent lane or the correct child board via `userProfiles/{uid}`, and documented the required Firebase project setup in `FIREBASE_SETUP.md`.
- Fixed a Firebase login race where profile lookup could run before the local auth-state signal updated, and improved Firestore profile errors so missing docs, malformed docs, and permission problems are easier to diagnose.
- Documented the current Firestore security rule needed for login: authenticated users may read only their own `userProfiles/{uid}` document while all other client reads and writes remain blocked.
- Captured the current account and identity architecture direction in `ACCOUNT_IDENTITY_PLAN.md`, including parent email login, child username login, parent-mediated child recovery, and configurable household-switch authority.
- Started the concrete schema planning work in `FIRESTORE_SCHEMA_PLAN.md` with Chunk 1 covering core collections plus the parent signup and household bootstrap flow.
- Expanded `FIRESTORE_SCHEMA_PLAN.md` with Chunk 2 covering co-parent invites, invite acceptance, and multi-household parent membership behavior.
- Completed the remaining Firestore schema planning work in `FIRESTORE_SCHEMA_PLAN.md`, covering child creation, child username login, child-to-second-household linking, household context, and parent-mediated child recovery.
- Replaced the login bootstrap path so Firebase sign-in now prefers `authAccounts/{uid}` plus `people/{personId}`, with a backward-compatible fallback to legacy `userProfiles/{uid}` and updated setup documentation for the migration.
- Added the first real parent account creation flow at `/signup/parent`, including Firebase user creation plus Firestore bootstrap writes for `authAccounts`, `people`, `households`, and the initial owner membership.
- Added Firestore-backed child creation and child profile editing for signed-in parent households, plus Firestore child-roster loading so real households no longer depend on the seeded Ava/Leo demo roster.
- Fixed the Angular environment typing setup so file replacement no longer breaks `ng serve`; shared environment interfaces now live in `src/environments/environment.model.ts`.
- Corrected the Firestore child-creation setup docs so `childState` creation uses `getAfter(...)` against the same-transaction child membership write instead of pre-transaction `get/exists` checks.
- Added parent-managed child login enablement, child username-or-email sign-in, and child self-read Firestore bootstrap loading so real child accounts can land on their own board without relying on the old demo-only path.
- Polished the child login enablement entry point so clicking the child-card action now scrolls to the real setup panel, focuses the username field, and shows explicit in-UI guidance instead of feeling like a dead click.
- Refined the child login setup UX again so the selected child card expands inline for username/password setup, and added a clearer preflight error when older parent membership docs are missing the child-credential permission needed by Firestore rules.
- Fixed the Firestore child-login transaction so it no longer tries to read the future `authAccounts/{childUid}` document before creating it, which had been tripping the parent-vs-child account read rules and causing a misleading permission-denied failure.
- Added Firestore-backed household quests and quest completions, then wired `MockFamilyData` to use those listeners and mutations for auth-backed households so parent quest creation, child completion, and parent approval now sync across sessions.
- Updated the parent quest manager so Firestore quest mutations show a visible sync-error banner instead of looking like successful saves, and cleaned up quest copy now that the quest board is household-backed rather than mock-only.
- Fixed Firestore quest creation/editing when the optional due date is blank by omitting `dueDate: undefined` from quest writes, and added a clearer invalid-payload error for future Firestore quest save debugging.
- Fixed child quest completion so standard parent-review submissions no longer pre-read a missing completion document, added child-side success/error feedback with a working button state, and added matching parent-dashboard feedback for Firestore-backed quest approval actions.
- Added Firestore-backed reward requests and parent reward review, updated the shared child point balance to reflect pending and fulfilled reward redemptions, and added success/error feedback for reward actions on the child store plus parent review surfaces.
- Fixed a runtime login-page freeze caused by tracked `rewardRedemptions()` reads inside `MockFamilyData` effects; those reward-balance adjustment reads now use `untracked(...)` so the signed-out reset path no longer loops on itself.
- Fixed parent-awarded bonus points so auth-backed households write a `bonusMoments` record and increment the child's shared Firestore `childState.points`, with listeners refreshing child sessions so the awarded points appear outside the parent browser.
- Hardened reward/bonus sync by keeping base child points separate from reward redemption offsets, optimistically merging reward and bonus mutations into local signals, and refreshing Firebase child state after parent bonus awards so the parent child-focus card updates immediately.
- Moved API/action feedback banners to the top of the routed page content and added success, warning, and error visual states so sync results are more noticeable and easier to interpret.
- Added Firestore-backed household goals with parent CRUD, child-only goal reads, child progress logging, optimistic local updates, parent/child goal feedback banners, and updated setup rules for `households/{householdId}/goals`.
- Fixed goal creation feedback so signed-in Firebase sessions can no longer silently fall back to local-only goal saves; parent goal success banners now explicitly name Firestore versus local demo persistence.
- Added Firestore-backed household journal entries with child save sync, parent dashboard reply sync, top-of-page journal feedback banners, and updated setup rules for `households/{householdId}/journalEntries`.
- Fixed journal reply visibility by marking changed child reflections as needing a fresh parent response and surfacing Firestore journal listener errors inside the parent dashboard journal panel.
- Added Firestore-backed active household seasonal mode sync through `households/{householdId}/settings/app`, with parent dashboard and seasonal manager feedback for mode-switch saves.
- Hardened active seasonal mode sync by mirroring the live mode into household `childState` docs and surfacing household-mode listener failures directly on the child board.
- Added Firestore-backed household privilege-rule sync through `households/{householdId}/settings/privileges`, plus parent-page save feedback and child-facing privilege refreshes.
- Added live auth-account household-context syncing plus the first household-switch flow for already-linked memberships, including `/family-access` switching UI and a parent child-manager action to point a login-enabled child account at the current household.
- Added the first in-app child-to-second-household flow from `/parent/children`, including parent-generated child link codes, receiving-household acceptance, shared child roster creation in the second household, and updated Firestore rule guidance for the new link flow.
- Corrected the Firestore signup rule guidance so parent bootstrap can create its matching `people/{personId}` document again, which unblocks retrying a parent account after Firebase Auth succeeded but Firestore bootstrap was denied.
- Hardened child household-access syncing so child accounts now resolve linked households through either child identity key (`personId` or `childId`) during migration-era data, and made the shell header name the active household explicitly.
- Replaced raw household-id fallbacks in the UI with household-name-first display logic, broadened household name hydration to support compatible Firestore doc shapes, and kept human-facing labels from surfacing machine ids.
- Added a direct current-household doc subscription so signed-in parent and child views pull the active household label from `households/{householdId}/name` instead of waiting on the linked-household roster to hydrate it indirectly.
- Surfaced the parent self board in the main parent navigation and dashboard, then updated the parent goals manager so self-assigned goals preview clearly and point back to `/parent/me` instead of feeling lost after save.
- Simplified live seasonal mode sync so `households/{householdId}/settings/app.activeModeId` is now the Firestore source of truth, while child profile hydration derives the active mode from household settings instead of requiring extra `childState` mode mirroring writes.
- Hardened the new parent self-board entry points against Angular live-reload stale-instance errors by moving new template-facing checks onto component methods instead of newly added instance fields.
- Prepared the app for GitHub Pages PWA deployment by adding theme/install metadata, a Pages-friendly SPA `404.html` fallback, `.nojekyll`, a GitHub Actions Pages deploy workflow, and deployment notes including the Firebase Auth authorized-domain requirement.
- Hardened deployment readiness by removing tracked Angular Firebase env files from the repo index, generating them from local `.env` or GitHub Actions secrets instead, and documenting the remaining git-history cleanup caveat for the earlier pushed prototype config.

## In Progress

- No active implementation pass is open in this file right now.

## Remaining Before MVP

- Replace or adapt the mock family data layer so core flows persist through Firestore.
- Validate cross-device family syncing for quests, rewards, goals, and journal entries.
- Validate cross-device family syncing for privilege rules and screen-time settings.
- Validate cross-device family syncing for household switching and child household redirection.
- Finish moving the remaining family progress flows from local mock state into Firestore-backed household data.

## Queue

- Cross-device validation pass for reward multi-request review, reward approval/refund behavior, and the derived point ledger
- Cross-device validation pass for Firestore-backed active seasonal mode switching
- Cross-device validation pass for Firestore-backed privilege rules and screen-time settings
- Cross-device validation pass for household switching across already-linked memberships
- Cross-device validation pass for Firestore-backed journal entries
- Cross-device validation pass for Firestore-backed goals
- Cross-device validation pass for parent and child accounts

## Backlog

- Custom seasonal mode creation
- Parents can assign themselves quests so they can hold each other accountable.
- Children can view parent quests and encourage their parents.
- Shared child accounts across separate-parent households so the child has one consistent account across both homes.
- Skipped for this MVP: parent multi-household/co-parent invite flows so adults can belong to more than one household without manual Firestore setup.
- Remove the prototype device-stored `latest child link code` helper before release so the receiving-household form is always empty and relies on manual paste only.
- Dark mode styling preference for parents and kids.
- Expanded avatar options plus custom avatar uploads.
- Emoji or custom artwork reactions for hearts, stars, and similar encouragement moments.
- More visible lightweight gamification for quests, bonuses, and progress.
- Confetti and other celebration animations.
- Younger-kid character companions or caricatures for encouragement during task flows.
- Smooth forward/back page transition animations.
- Guided tour for new users so families can learn the app through an in-product tutorial.
- Advanced child-initiated household switching rules where switching from household `A` to `B` may require both permission to leave `A` and permission to enter `B`.

## Notes

- Keep privileges separate from purchasable rewards in both UX and data behavior.
- Keep mock services as the integration layer until the UI flows are stable enough for Firebase wiring.
- Firebase increased the initial bundle enough to trigger the current warning budget. We should revisit bundle strategy or budgets after the Firestore migration settles.
- The repo head no longer needs committed Firebase env files, but the original pushed prototype commit still contains the old web config in git history until we choose to rewrite history and rotate or restrict that Firebase key.
- Parent signup bootstrap currently writes Firestore directly from the client as a prototype step. Move that bootstrap behind a secure backend or callable function later without changing the public signup UX.
- Child creation and child profile editing also currently write Firestore directly from the client as a prototype step. Move that child management flow behind a secure backend or callable function later without changing the parent UX.
