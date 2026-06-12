# GitHub Pages Deployment

This app is now wired for GitHub Pages PWA deployment.

## What Is Included

- Angular service worker registration in production builds
- `ngsw-config.json` production service worker output
- GitHub Pages SPA fallback via `public/404.html`
- `.nojekyll` so GitHub Pages serves the built app without Jekyll processing
- A GitHub Actions workflow at `.github/workflows/deploy-pages.yml`

## First-Time GitHub Setup

1. Push the repo to GitHub.
2. In GitHub, open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.

## Firebase Auth Setup

If this deployed app will use Firebase Authentication, add the GitHub Pages host to Firebase Auth authorized domains.

Example:

- `your-user-name.github.io`

If you later use a custom domain, add that too.

## Deployment Flow

The workflow deploys on pushes to `main` and on manual workflow runs.

It builds with:

```bash
ng build --configuration production --base-href /<repo-name>/
```

The workflow automatically uses the GitHub repository name as the base href.

## Local Verification

To verify the GitHub Pages build locally, run:

```bash
npm run build -- --configuration production --base-href /ChoreChamp/
```

Then inspect the output in `dist/chore-champ/browser`.

If this repository name changes, replace `ChoreChamp` in the local verification command with the new repo name.
