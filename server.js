const express  = require("express");
const axios    = require("axios");
const fs       = require("fs-extra");
const path     = require("path");
const https    = require("https");
const http     = require("http");
const { execSync } = require("child_process");

// ─── Config ───────────────────────────────────────────────────────────────────
const SHAZAM_API_KEY = process.env.SHAZAM_API_KEY || "22e4dc54fbmshc442d6d00749ccbp1ce002jsn880baa31246f";
const SHAZAM_HOST    = "shazam.p.rapidapi.com";
const SHAZAM_URL     = "https://shazam.p.rapidapi.com";
const SC_CLIENT_ID   = process.env.SC_CLIENT_ID   || "yNSW5UvBmb1A5j7qPUtIMuB9Itx3jsOC";
const TMP_DIR        = path.join(__dirname, "cache");
const MAX_BYTES      = 100 * 1024 * 1024;
const PORT           = process.env.PORT || 3000;

const YTSAVE_HEADERS = {
  authority: "ytsave.to",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  origin: "https://ytsave.to",
  referer: "https://ytsave.to/en2/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest"
};

const GV_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "accept": "*/*",
  "accept-encoding": "identity",
  "accept-language": "en-US,en;q=0.9"
};

const app = express();
app.use(express.json());
fs.ensureDirSync(TMP_DIR);

// ─── Keep-alive (Railway free tier) ──────────────────────────────────────────
setInterval(() => {
  http.get(`http://localhost:${PORT}/health`, () => {}).on("error", () => {});
}, 4 * 60 * 1000);

// ─── Homepage ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>🎵 Finds API - Shazam Song Detector</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0c29;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:rgba(255,255,255,0.05);border:1px solid rgba(167,139,250,0.3);border-radius:16px;padding:40px 36px;max-width:560px;width:100%;text-align:center}
    h1{font-size:2rem;margin-bottom:8px}
    .badge{display:inline-block;background:#22c55e22;color:#22c55e;border:1px solid #22c55e55;border-radius:999px;padding:4px 14px;font-size:.85rem;margin-bottom:16px}
    .sub{color:#94a3b8;margin-bottom:28px;font-size:.95rem}
    .endpoint{background:rgba(0,0,0,0.3);border:1px solid rgba(167,139,250,0.2);border-radius:10px;padding:16px 20px;margin-bottom:14px;text-align:left}
    .endpoint label{display:block;font-size:.75rem;color:#a78bfa;font-weight:700;letter-spacing:.05em;margin-bottom:6px}
    .endpoint code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.88rem;color:#e2e8f0;word-break:break-all}
    .footer{margin-top:24px;font-size:.78rem;color:#475569}
  </style>
</head>
<body>
  <div class="card">
    <h1>🎵 Finds API</h1>
    <div class="badge">✅ API is Running</div>
    <p class="sub">Shazam Song Detection Service</p>
    <div class="endpoint">
      <label>🔍 Detect Song:</label>
      <code>GET /api/find?url=MEDIA_URL</code>
    </div>
    <div class="endpoint">
      <label>💚 Health Check:</label>
      <code>GET /health</code>
    </div>
    <p class="sub" style="margin-bottom:0;margin-top:10px">Use this API to detect songs from video/audio URLs</p>
    <div class="footer">System by Arafat &nbsp;·&nbsp; Powered by Shazam</div>
  </div>
</body>
</html>`);
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), time: new Date().toISOString() });
});

// ─── GET /api/find?url=MEDIA_URL ──────────────────────────────────────────────
// Response shape exactly as find.js expects:
// { success: true, data: { title, artist, thumbnail, shazamLink, detectedAt, audioUrl, album, genre, label, duration, lyrics } }
app.get("/api/find", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "Missing 'url' query parameter.",
      usage: "GET /api/find?url=MEDIA_URL"
    });
  }

  const ts        = Date.now();
  const mediaPath = path.join(TMP_DIR, `fm_${ts}.media`);
  const pcmPath   = path.join(TMP_DIR, `fp_${ts}.raw`);

  try {
    // 1. Download media file
    await streamDownload(url, mediaPath, MAX_BYTES);

    // 2. Extract 5-second raw PCM mono for Shazam fingerprint
    execSync(
      `ffmpeg -y -i "${mediaPath}" -vn -ar 44100 -ac 1 -t 5 -acodec pcm_s16le -f s16le "${pcmPath}"`,
      { stdio: "pipe" }
    );

    const pcmBuffer = fs.readFileSync(pcmPath);
    if (pcmBuffer.length < 8000) {
      return res.status(422).json({ success: false, error: "Audio too short or silent." });
    }

    // 3. Shazam detect
    const detectRes = await axios.post(
      `${SHAZAM_URL}/songs/v2/detect?timezone=America%2FChicago&locale=en-US`,
      pcmBuffer.toString("base64"),
      {
        headers: {
          "Content-Type":    "text/plain",
          "x-rapidapi-host": SHAZAM_HOST,
          "x-rapidapi-key":  SHAZAM_API_KEY,
        },
        timeout: 30000,
      }
    );

    const track = detectRes.data?.track;
    if (!track) {
      return res.status(404).json({ success: false, error: "No song detected in this media." });
    }

    // 4. Parse metadata
    const songMeta  = track.sections?.find(s => s.type === "SONG");
    const lyricsSec = track.sections?.find(s => s.type === "LYRICS");
    const metaGet   = (title) => (songMeta?.metadata || []).find(m => m.title === title)?.text || null;

    const title  = track.title    || null;
    const artist = track.subtitle || null;

    // 5. Try to get audio download URL (Azad → SoundCloud fallback)
    let audioUrl = null;
    const searchQuery = `${title} ${artist}`;

    // Try Azad API first
    try {
      const azadRes = await axios.get(
        `https://azadx69x-all-apis-top.vercel.app/api/sing?song=${encodeURIComponent(searchQuery)}`,
        { timeout: 25000 }
      );
      if (azadRes.data?.success && azadRes.data?.audio?.url) {
        audioUrl = azadRes.data.audio.url;
      }
    } catch (_) {}

    // Fallback: SoundCloud
    if (!audioUrl) {
      try {
        const scSearch = await axios.get(
          `https://api-v2.soundcloud.com/search/tracks?client_id=${SC_CLIENT_ID}&q=${encodeURIComponent(searchQuery)}&limit=1`,
          { timeout: 15000 }
        );
        const scTrack = (scSearch.data.collection || [])[0];
        if (scTrack) {
          const trackUrl   = `https://soundcloud.com/${scTrack.user.permalink}/${scTrack.permalink}`;
          const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${SC_CLIENT_ID}`;
          const { data: resolved } = await axios.get(resolveUrl, { timeout: 15000 });
          const streamInfo = resolved.media?.transcodings?.find(t => t.format.protocol === "progressive");
          if (streamInfo) {
            const { data: stream } = await axios.get(`${streamInfo.url}?client_id=${SC_CLIENT_ID}`, { timeout: 15000 });
            if (stream.url) audioUrl = stream.url;
          }
        }
      } catch (_) {}
    }

    // Fallback: YouTube
    if (!audioUrl) {
      try {
        const ytResults = await searchYT(searchQuery);
        if (ytResults.length) {
          const ytUrl = `https://www.youtube.com/watch?v=${ytResults[0].id}`;
          const ytApi = await fetchYTSave(ytUrl);
          const items = ytApi.mediaItems || [];
          const audios = items.filter(i => i.type === "Audio");
          const item   = audios.find(i => i.mediaQuality === "128K") || audios[0];
          if (item?.mediaPreviewUrl) audioUrl = item.mediaPreviewUrl;
        }
      } catch (_) {}
    }

    // 6. Build response — exact shape find.js reads from data.data
    const responseData = {
      title,
      artist,
      album:      metaGet("Album"),
      genre:      metaGet("Genre"),
      label:      metaGet("Label"),
      duration:   metaGet("Duration"),
      thumbnail:  track.images?.coverarthq || track.images?.coverart || null,
      lyrics:     lyricsSec?.text?.[0] || null,
      shazamLink: track.share?.href || null,
      audioUrl,
      detectedAt: new Date().toISOString(),
      shazamKey:  track.key || null,
    };

    return res.json({ success: true, data: responseData });

  } catch (err) {
    console.error("[/api/find]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    cleanFile(mediaPath);
    cleanFile(pcmPath);
  }
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found.",
    routes: ["GET /", "GET /health", "GET /api/find?url=MEDIA_URL"]
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
}

function streamDownload(url, destPath, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const doRequest = (currentUrl, hops = 0) => {
      if (hops >= 5) return reject(new Error("Too many redirects"));
      const mod = currentUrl.startsWith("https") ? https : http;
      mod.get(currentUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "*/*" }
      }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location)
          return doRequest(res.headers.location, hops + 1);
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode} from media URL`));
        const out = fs.createWriteStream(destPath);
        res.on("data", chunk => {
          received += chunk.length;
          if (maxBytes > 0 && received > maxBytes) {
            res.destroy(); out.close();
            reject(new Error(`File exceeds ${maxBytes / 1024 / 1024} MB limit`));
          }
        });
        res.pipe(out);
        out.on("finish", resolve);
        out.on("error",  reject);
        res.on("error",  reject);
      }).on("error", reject)
        .setTimeout(120000, () => reject(new Error("Stream timeout")));
    };
    doRequest(url);
  });
}

async function getFreshSession() {
  try {
    const res = await axios.get("https://ytsave.to/en2/", {
      headers: { "user-agent": YTSAVE_HEADERS["user-agent"], "accept": "text/html,*/*" },
      timeout: 15000
    });
    const cookies = res.headers["set-cookie"] || [];
    return cookies.map(c => c.split(";")[0]).find(c => c.startsWith("PHPSESSID=")) || null;
  } catch (_) { return null; }
}

async function fetchYTSave(ytUrl, retries = 2) {
  for (let i = 1; i <= retries; i++) {
    const session = await getFreshSession();
    const h = { ...YTSAVE_HEADERS };
    if (session) h.cookie = session;
    const { data } = await axios.post(
      "https://ytsave.to/proxy.php",
      `url=${encodeURIComponent(ytUrl)}`,
      { headers: h, timeout: 30000 }
    );
    if (data?.api?.status === "ok") return data.api;
    if (i === retries) throw new Error(data?.api?.message || "ytsave failed");
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function searchYT(query) {
  const { data } = await axios.get(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, timeout: 15000 }
  );
  const raw = data.split("ytInitialData = ")[1]?.split(";</script>")[0];
  if (!raw) throw new Error("Failed to parse YT search results");
  const json = JSON.parse(raw);
  const contents =
    json.contents.twoColumnSearchResultsRenderer.primaryContents
      .sectionListRenderer.contents[0].itemSectionRenderer.contents;
  return contents
    .filter(i => i.videoRenderer?.videoId)
    .map(i => ({ id: i.videoRenderer.videoId, title: i.videoRenderer.title.runs[0].text }));
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Finds API running → http://localhost:${PORT}`);
});
