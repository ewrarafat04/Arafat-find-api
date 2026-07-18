# 🎵 Finds API — Shazam Song Detector
> Clone of `mahiru-shazam-api` · Built from GoatBot `find.js` by **Arafat**

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Homepage (HTML) |
| `GET` | `/health` | Health check |
| `GET` | `/api/find?url=MEDIA_URL` | Detect song from video/audio URL |

---

### `GET /api/find?url=MEDIA_URL`

**Example:**
```
GET /api/find?url=https://example.com/video.mp4
```

**Success response:**
```json
{
  "success": true,
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "album": "After Hours",
  "genre": "Pop",
  "label": "Republic Records",
  "released": "2019",
  "duration": "3:22",
  "coverUrl": "https://is1-ssl.mzstatic.com/...",
  "lyrics": "I said ooh, I'm blinded by the lights...",
  "songLink": "https://www.shazam.com/track/...",
  "youtubeUrl": null,
  "spotifyUrl": null,
  "appleMusicUrl": null,
  "shazamKey": "549812632"
}
```

**Error responses:**
```json
{ "success": false, "error": "No song detected in this media." }
{ "success": false, "error": "Missing 'url' query parameter." }
```

---

## Deploy to Railway

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USER/song-find-api.git
git push -u origin main
```

### 2. Create Railway project
- [railway.app](https://railway.app) → New Project → Deploy from GitHub → select repo
- Railway reads `nixpacks.toml` → installs **Node 20 + ffmpeg** automatically

### 3. Set env variables (Railway → Variables tab)
```
SHAZAM_API_KEY = your_rapidapi_key
SC_CLIENT_ID   = your_soundcloud_client_id
```

### 4. Your URL will be:
```
https://your-app.up.railway.app/api/find?url=MEDIA_URL
```

---

## Use from GoatBot find.js
```js
const FIND_API = "https://your-app.up.railway.app";

const res = await axios.get(`${FIND_API}/api/find?url=${encodeURIComponent(mediaUrl)}`);
if (res.data.success) {
  const { title, artist, coverUrl, lyrics } = res.data;
}
```
