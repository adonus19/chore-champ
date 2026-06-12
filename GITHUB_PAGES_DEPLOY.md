# GitHub Pages Deployment

This app is now wired for GitHub Pages PWA deployment.

## What Is Included

- Angular service worker registration in production builds
- `ngsw-config.json` production service worker output
- GitHub Pages SPA fallback via `public/404.html`
- `.nojekyll` so GitHub Pages serves the built app without Jekyll processing
- A GitHub Actions workflow at `.github/workflows/deploy-pages.yml`
- GitHub Actions generation of Angular environment files from repository secrets

## First-Time GitHub Setup

1. Push the repo to GitHub.
2. In GitHub, open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. In GitHub, open `Settings -> Secrets and variables -> Actions`.
5. Add these repository secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_STORAGE_BUCKET`

## Firebase Auth Setup

If this deployed app will use Firebase Authentication, add the GitHub Pages host to Firebase Auth authorized domains.

Example:

- `your-user-name.github.io`

For this repository, that host will be:

- `adonus19.github.io`

If you later use a custom domain, add that too.

## Deployment Flow

The workflow deploys on pushes to `main` and on manual workflow runs.

It builds with:

```bash
ng build --configuration production --base-href /<repo-name>/
```

The workflow automatically uses the GitHub repository name as the base href.

## Local Environment Files

`src/environments/environment.ts` and `src/environments/environment.development.ts` are now generated locally and ignored by git.

To create them for local development:

1. Copy `.env.example` to `.env`.
2. Fill in the Firebase values locally.
3. Run:

```bash
npm run env:write
```

Then start Angular normally. The local `.env` file is ignored by git.

## Local Verification

To verify the GitHub Pages build locally, run:

```bash
npm run build -- --configuration production --base-href /chore-champ/
```

Then inspect the output in `dist/chore-champ/browser`.

If this repository name changes, replace `chore-champ` in the local verification command with the new repo name.

## If Pages Still Fails

The most common causes are:

- GitHub Pages has not been switched to `GitHub Actions`
- one or more Firebase repository secrets are missing
- Firebase Auth authorized domains do not include the GitHub Pages host

## Security Follow-Up

The Firebase web config should now stay out of normal commits because the generated Angular env files and local `.env` are gitignored.

Because this repository already had an earlier pushed commit with Firebase web config values in tracked env files, finish the cleanup before public launch:

- rotate or at least restrict the Firebase Web API key in Google Cloud
- keep Firebase Auth authorized domains limited to `localhost`, `adonus19.github.io`, and any real production domain you actually use
- rewrite git history and force-push if you want the old config values removed from the GitHub commit history instead of only from the latest branch state
