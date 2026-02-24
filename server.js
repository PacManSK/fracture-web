// server.js (FINAL – Fly/Render ready + Discord OAuth + WL + Admin + Webhooks + DM Bot)

const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================= */
/* AUTO PUBLIC DIR DETECT */
/* ============================= */
const HERE = __dirname;
const ROOT = path.join(__dirname, '..');

const INDEX_HERE = path.join(HERE, 'index.html');
const INDEX_ROOT = path.join(ROOT, 'index.html');

const PUBLIC_DIR = fs.existsSync(INDEX_HERE)
  ? HERE
  : (fs.existsSync(INDEX_ROOT) ? ROOT : HERE);

const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

console.log('[PUBLIC_DIR]', PUBLIC_DIR);
console.log('[INDEX_PATH exists?]', fs.existsSync(INDEX_PATH));

/* ============================= */
/* ENV */
/* ============================= */
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_CALLBACK_URL = String(process.env.DISCORD_CALLBACK_URL || '')
  .replace(/[\r\n]/g, '')
  .trim();

const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || '').trim();

// ✅ Bot token pre DM (nové)
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const DISCORD_DM_ON_DECISION =
  String(process.env.DISCORD_DM_ON_DECISION || 'true').toLowerCase() === 'true';

const BRAND_LOGO_URL = String(
  process.env.BRAND_LOGO_URL || 'https://fracture-web.fly.dev/logo.png'
).trim();

const DEFAULT_ADMIN_IDS = [
  "802210683541389332",
  "1084959527255949423",
  "569858258626412559",
  "964552958886961152",
  "800012301331202068"
];

const ADMIN_DISCORD_IDS = (String(process.env.ADMIN_DISCORD_IDS || '').trim()
  ? String(process.env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_ADMIN_IDS
);

const SESSION_SECRET = String(process.env.SESSION_SECRET || 'fracture_secret_dev_only').trim();

/* ============================= */
/* MIDDLEWARE */
/* ============================= */
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'fracture.sid',
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Fly/Render prod je https → secure true, lokálne http → false
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

/* ============================= */
/* ROOT + DEBUG */
/* ============================= */
app.get('/', (req, res) => {
  res.sendFile(INDEX_PATH);
});

app.get('/__debug', (req, res) => {
  res.type('text/plain').send(
    `PUBLIC_DIR=${PUBLIC_DIR}\nINDEX_PATH=${INDEX_PATH}\nINDEX_EXISTS=${fs.existsSync(INDEX_PATH)}\n` +
    `DISCORD_CLIENT_ID_SET=${!!DISCORD_CLIENT_ID}\nDISCORD_CLIENT_SECRET_SET=${!!DISCORD_CLIENT_SECRET}\nDISCORD_CALLBACK_URL=${DISCORD_CALLBACK_URL || '(empty)'}\n` +
    `DISCORD_BOT_TOKEN_SET=${!!DISCORD_BOT_TOKEN}\nDM_ON_DECISION=${DISCORD_DM_ON_DECISION}\n` +
    `NODE_ENV=${process.env.NODE_ENV || '(empty)'}\n`
  );
});

app.get('/__debug/index', (req, res) => {
  res.sendFile(INDEX_PATH);
});

/* ============================= */
/* HELPERS */
/* ============================= */
function isAdminUser(req) {
  return req.user && ADMIN_DISCORD_IDS.includes(String(req.user.id));
}

function clip(str, max = 1000) {
  const s = String(str ?? '');
  return s.length <= max ? s : (s.slice(0, max - 3) + '...');
}

const fetchFn = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : async (...args) => {
      const mod = await import('node-fetch');
      return mod.default(...args);
    };

async function sendDiscordWebhook(payload) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    const r = await fetchFn(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.log("Webhook error:", r.status, text);
    }
  } catch (e) {
    console.log("Webhook exception:", e?.message || e);
  }
}

/* ============================= */
/* DISCORD BOT DM (NEW) */
/* ============================= */
async function discordApi(apiPath, options = {}) {
  if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");

  const r = await fetchFn(`https://discord.com/api/v10${apiPath}`, {
    ...options,
    headers: {
      "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await r.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!r.ok) {
    const msg = json?.message || text || `HTTP ${r.status}`;
    throw new Error(`Discord API ${r.status}: ${msg}`);
  }
  return json;
}

async function sendDiscordDM(userId, content) {
  // open/create DM channel
  const dm = await discordApi(`/users/@me/channels`, {
    method: "POST",
    body: JSON.stringify({ recipient_id: String(userId) })
  });

  // send message
  await discordApi(`/channels/${dm.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

/* ============================= */
/* DISCORD OAUTH */
/* ============================= */
const discordEnvOk = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL);

console.log("[DISCORD ENV OK?]", discordEnvOk);
if (!discordEnvOk) {
  console.log("⚠️ Discord OAuth is DISABLED (missing ENV).");
}

if (discordEnvOk) {
  passport.use(new DiscordStrategy(
    {
      clientID: DISCORD_CLIENT_ID,
      clientSecret: DISCORD_CLIENT_SECRET,
      callbackURL: DISCORD_CALLBACK_URL,
      scope: ['identify']
    },
    (accessToken, refreshToken, profile, done) => {
      const discNum = Number(profile.discriminator || 0);
      const defaultAvatar = `https://cdn.discordapp.com/embed/avatars/${discNum % 5}.png`;

      const avatarUrl = profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
        : defaultAvatar;

      profile.avatarUrl = avatarUrl;
      profile.defaultAvatarUrl = defaultAvatar;

      console.log("Discord login OK:", profile.username, profile.id);
      return done(null, profile);
    }
  ));
}

/* ============================= */
/* AUTH ROUTES */
/* ============================= */
app.get('/auth/discord', (req, res, next) => {
  if (!discordEnvOk) {
    return res.status(500).send("Discord OAuth nie je nastavený.");
  }

  // 🔒 ANTI-SPAM LOCK (max 1 pokus za 5 sekúnd)
  const now = Date.now();
  const last = Number(req.session.lastDiscordAuthAt || 0);
  if (now - last < 5000) {
    console.log("Discord auth blocked (too fast)");
    return res.status(429).send("Prihlasuješ sa príliš rýchlo. Skús o chvíľu.");
  }
  req.session.lastDiscordAuthAt = now;

  const nextTab = String(req.query.next || '').toLowerCase();
  req.session.afterLoginTab = (nextTab === 'whitelist') ? 'whitelist' : 'admin';

  next();
}, passport.authenticate('discord'));

/**
 * Debug callback – užitočné pri chybách (redirect mismatch, invalid_client, rate limit, ...)
 */
app.get("/auth/discord/callback", (req, res, next) => {
  if (!discordEnvOk) return res.status(500).send("Discord OAuth nie je nastavený.");

  passport.authenticate("discord", (err, user, info) => {
    if (err) {
      console.error("DISCORD OAUTH ERROR:", err);
      console.error("RAW:", err.oauthError?.data || err.data || info || err);
      return res.status(500).send("OAuth error - check logs");
    }

    if (!user) {
      console.error("NO USER. INFO:", info);
      return res.redirect("/?tab=admin");
    }

    req.logIn(user, (e) => {
      if (e) return next(e);

      const tab = req.session?.afterLoginTab || 'admin';
      req.session.afterLoginTab = null;
      return res.redirect(`/?tab=${tab}`);
    });
  })(req, res, next);
});

app.get('/auth/me', (req, res) => {
  const loggedIn = !!req.user;
  return res.json({
    loggedIn,
    isAdmin: loggedIn && isAdminUser(req),
    user: loggedIn ? {
      id: req.user.id,
      username: req.user.username,
      discriminator: req.user.discriminator,
      avatarUrl: req.user.avatarUrl,
      defaultAvatarUrl: req.user.defaultAvatarUrl
    } : null
  });
});

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy(() => {
      res.clearCookie('fracture.sid', { path: '/' });
      res.redirect('/?tab=admin');
    });
  });
});

/* ============================= */
/* WHITELIST SYSTEM */
/* ============================= */
// Fly: /data (volume). Render: môžeš dať WL_FILE na disk alebo na /tmp
const wlFile = process.env.WL_FILE
  ? String(process.env.WL_FILE)
  : '/data/whitelist.json';

function readWL() {
  if (!fs.existsSync(wlFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(wlFile, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeWL(data) {
  try {
    const dir = path.dirname(wlFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

/* WL submit: iba prihlásený */
app.post('/api/whitelist', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Najprv sa prihlás cez Discord.' });
  }

  const { Meno, Vek, RPRoky, FiveMHodiny, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || RPRoky === undefined || FiveMHodiny === undefined || !Skusenosti || !Preco) {
    return res.json({ success: false, error: 'Nevyplnené polia!' });
  }

  const wl = readWL();

  const discordUserId = String(req.user.id);

  const alreadyPending = wl.find(x =>
    String(x.DiscordId) === discordUserId && String(x.status).toLowerCase() === 'pending'
  );
  if (alreadyPending) {
    return res.status(409).json({ success: false, error: 'Už máš odoslanú žiadosť (pending).' });
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const discordTag = `${req.user.username}#${req.user.discriminator}`;
  const avatarUrl = req.user.avatarUrl || req.user.defaultAvatarUrl || "";

  wl.push({
    id,
    Meno,
    Vek,
    Discord: discordTag,
    DiscordId: discordUserId,
    avatarUrl,
    Skusenosti,
    Preco,
    status: 'pending',
    RPRoky,
    FiveMHodiny,
    createdAt: new Date().toISOString()
  });

  writeWL(wl);

  // ✅ webhook: nová whitelist žiadosť
  await sendDiscordWebhook({
    username: "Fracture Roleplay WL",
    avatar_url: BRAND_LOGO_URL,
    embeds: [{
      title: "🟡 Nová whitelist žiadosť",
      color: 0xF1C40F,
      fields: [
        { name: "Meno / Nick", value: clip(Meno, 1024), inline: true },
        { name: "Vek", value: clip(Vek, 1024), inline: true },
        { name: "Discord", value: clip(discordTag, 1024), inline: false },
        { name: "Discord ID", value: clip(discordUserId, 1024), inline: false },
        { name: "Skúsenosti s RP", value: clip(Skusenosti, 1024), inline: false },
        { name: "Prečo sa chce pripojiť", value: clip(Preco, 1024), inline: false },
        { name: "RP roky", value: clip(RPRoky, 1024), inline: true },
        { name: "FiveM hodiny", value: clip(FiveMHodiny, 1024), inline: true },
      ],
      footer: { text: "Fracture Roleplay" },
      timestamp: new Date().toISOString(),
    }]
  });

  return res.json({ success: true, id });
});

/* list žiadostí: iba admin */
app.get('/api/whitelist', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Admin prístup má iba vybraný účet.' });
  }
  return res.json(readWL());
});

/* approve/reject: iba admin – prijme {id, action} alebo {index, action} */
app.post('/api/whitelist/action', async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Admin prístup má iba vybraný účet.' });
  }

  const { id, index, action } = req.body;

  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ success: false, error: 'Zlé dáta (action).' });
  }

  const wl = readWL();

  let idx = -1;
  if (id) {
    idx = wl.findIndex(x => String(x.id) === String(id));
  } else if (Number.isInteger(index)) {
    idx = index;
  }

  if (idx < 0 || idx >= wl.length) {
    return res.status(404).json({ success: false, error: 'Neexistujúca žiadosť' });
  }

  // 🔒 LOCK: ak už nie je pending, nedá sa zmeniť
  const currentStatus = String(wl[idx].status || 'pending').toLowerCase();
  if (currentStatus !== 'pending') {
    return res.status(409).json({
      success: false,
      error: `Táto žiadosť už bola rozhodnutá (${currentStatus}). Zmeniť sa to nedá.`
    });
  }

  wl[idx].status = (action === 'approve') ? 'approved' : 'rejected';
  wl[idx].updatedAt = new Date().toISOString();
  writeWL(wl);

  const reqItem = wl[idx];

  // ✅ webhook: výsledok (approve/reject)
  const actionLabel = action === 'approve' ? '🟢 Schválené' : '🔴 Zamietnuté';
  const color = action === 'approve' ? 0x2ECC71 : 0xE74C3C;

  await sendDiscordWebhook({
    username: "Fracture Roleplay WL",
    avatar_url: BRAND_LOGO_URL,
    embeds: [{
      title: `${actionLabel} whitelist žiadosť`,
      color,
      fields: [
        { name: "Meno / Nick", value: clip(reqItem.Meno, 1024), inline: true },
        { name: "Vek", value: clip(reqItem.Vek, 1024), inline: true },
        { name: "Discord", value: clip(reqItem.Discord, 1024), inline: false },
        { name: "Discord ID", value: clip(reqItem.DiscordId, 1024), inline: false },
        { name: "Status", value: clip(reqItem.status, 1024), inline: true },
      ],
      footer: { text: "Fracture Roleplay" },
      timestamp: new Date().toISOString(),
    }]
  });

  // ✅ DM user po rozhodnutí (ak máš bot token)
  if (DISCORD_DM_ON_DECISION && DISCORD_BOT_TOKEN) {
    const ok = action === 'approve';
    const msg = ok
      ? `✅ Tvoja whitelist žiadosť na **Fracture Roleplay** bola **SCHVÁLENÁ**.\nVidíme sa v Los Santos! 🔥`
      : `❌ Tvoja whitelist žiadosť na **Fracture Roleplay** bola **ZAMIETNUTÁ**.\nAk chceš, skús to neskôr znova alebo si otvor ticket.`;

    sendDiscordDM(reqItem.DiscordId, msg)
      .catch(e => console.log("DM failed:", e.message));
  }

  return res.json({ success: true });
});

/* ============================= */
/* CATCH-ALL (SPA FIX) */
/* ============================= */
app.get('*', (req, res) => {
  res.sendFile(INDEX_PATH);
});

/* ============================= */
/* START */
/* ============================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server beží na porte ${PORT}`);
});