# Rowsan Play: video streaming website

A responsive, YouTube-style website starter with:
- Homepage video grid, categories and search
- Watch page with direct MP4/WebM playback or trusted-host embed URL
- Admin login using bcrypt password hash and server-side sessions
- SQLite database for videos and ad/site settings
- Admin create/edit/delete/publish video management
- Configurable click-through ad link and embedded ad iframe URL
- Helmet security headers, rate limits, URL protocol validation, HttpOnly session cookie

## Requirements
Node.js 20 or newer and npm.

## 1. Install
```bash
npm install
cp .env.example .env
```
On Windows, copy `.env.example` to `.env` manually if `cp` is unavailable.

## 2. Set a strong admin password
Create a bcrypt hash. Replace `YOUR_STRONG_PASSWORD` with a unique password:
```bash
node -e "require('bcryptjs').hash('YOUR_STRONG_PASSWORD',12).then(console.log)"
```
Copy the printed hash into `ADMIN_PASSWORD_HASH` in `.env`. Set `ADMIN_USERNAME` too.
Set `SESSION_SECRET` to a random secret at least 32 characters long. Do not share `.env` or commit it to Git.

## 3. Run locally
```bash
npm start
```
Open `http://localhost:3000`. Admin panel: `http://localhost:3000/admin`.

## Add videos
In Admin > Add / edit video, provide:
- Title and category
- Optional thumbnail image URL
- Either a direct MP4/WebM URL or a video embed URL (or both)
- Description

The embed field expects a URL such as a provider's official `/embed/VIDEO_ID` URL, not raw iframe HTML. The provider must allow embedding. This starter does not upload or host video files itself.

## Configure ads
In Admin > Website & Ads settings:
- **Ad link URL**: shown as a clearly labeled sponsor link that opens only when a visitor clicks.
- **Ad iframe URL**: embedded in the watch page in a sandboxed iframe.

Use only ad code and placements approved by your ad network. Many networks prohibit forced redirects, misleading buttons, self-clicking, or artificial traffic. A normal iframe URL is not guaranteed to work with every ad network; use that network's official format and instructions. Do not use the ad iframe field for arbitrary untrusted pages.

## Production deployment checklist
1. Use a Node.js host that supports persistent disk storage, or switch SQLite to a managed database.
2. Use HTTPS and set `NODE_ENV=production`, `COOKIE_SECURE=true`, a strong `SESSION_SECRET`, and a real `ADMIN_PASSWORD_HASH`.
3. The default Express MemoryStore is intended for local testing only. For production, configure a persistent session store such as a compatible SQLite or Redis session store.
4. Back up the database file regularly and restrict server filesystem access.
5. Review ad network policies, copyright, privacy notice, and local legal requirements.
6. Test your selected hosting provider's iframe/CSP behavior before publishing.

## Notes
This is a functional starter project, not a hosted public website. It needs installation and deployment to be accessible online. It does not include user registration, comments, likes, video upload storage, payments, or a custom transcoding pipeline.
