// server.js (FINAL – auto index.html detect + debug endpoints + Discord OAuth + WL + Admin)

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
const DISCORD_CALLBACK_URL = String(process.env.DISCORD_CALLBACK_URL || '').replace(/[\r\n]/g, '').trim();

const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || '').trim();

const BRAND_LOGO_URL = String(
  process.env.BRAND_LOGO_URL || 'https://fracture-web-let4.onrender.com/logo.png'
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
    secure: true, // Render HTTPS
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

// Debug: ukáže, či server fakt vidí index a z akého priečinka servuje
app.get('/__debug', (req, res) => {
  res.type('text/plain').send(
    `PUBLIC_DIR=${PUBLIC_DIR}\nINDEX_PATH=${INDEX_PATH}\nINDEX_EXISTS=${fs.existsSync(INDEX_PATH)}\n`
  );
});

// Debug: naservuje index priamo
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
    console.log("Webhook exception:", e);
  }
}

/* ============================= */
/* DISCORD OAUTH */
/* ============================= */
const discordEnvOk = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL);

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
} else {
  console.log("⚠️ Discord OAuth is DISABLED (missing ENV).");
}

/* ============================= */
/* AUTH ROUTES */
/* ============================= */
app.get('/auth/discord', (req, res, next) => {
  if (!discordEnvOk) {
    return res.status(500).send("Discord OAuth nie je nastavený.");
  }

  const nextTab = String(req.query.next || '').toLowerCase();
  req.session.afterLoginTab = (nextTab === 'whitelist') ? 'whitelist' : 'admin';

  next();
}, passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/?tab=admin' }),
  (req, res) => {
    const tab = req.session?.afterLoginTab || 'admin';
    req.session.afterLoginTab = null;
    res.redirect(`/?tab=${tab}`);
  }
);

app.get('/auth/me', (req, res) => {
  const loggedIn = !!req.user;
  res.json({
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
const wlFile = path.join(PUBLIC_DIR, 'whitelist.json');

function readWL() {
  if (!fs.existsSync(wlFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(wlFile, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeWL(data) {
  fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

/* WL iba pre prihlásených */
app.post('/api/whitelist', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Najprv sa prihlás cez Discord.' });
  }

  const { Meno, Vek, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || !Skusenosti || !Preco) {
    return res.json({ success: false, error: 'Nevyplnené polia!' });
  }

  const wl = readWL();

  const discordUserId = String(req.user.id);
  const alreadyPending = wl.find(x =>
    String(x.DiscordId) === discordUserId && String(x.status) === 'pending'
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
    createdAt: new Date().toISOString()
  });

  writeWL(wl);

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
      ],
      footer: { text: "Fracture Roleplay" },
      timestamp: new Date().toISOString(),
    }]
  });

  res.json({ success: true, id });
});

/* list žiadostí: iba admin */
app.get('/api/whitelist', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Admin prístup má iba vybraný účet.' });
  }
  res.json(readWL());
});

/* approve/reject: iba admin, podľa ID */
app.post('/api/whitelist/action', async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Admin prístup má iba vybraný účet.' });
  }

  const { id, action } = req.body;
  if (!id || (action !== 'approve' && action !== 'reject')) {
    return res.status(400).json({ success: false, error: 'Zlé dáta (id/action).' });
  }

  const wl = readWL();
  const idx = wl.findIndex(x => String(x.id) === String(id));
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Neexistujúca žiadosť' });
  }

  wl[idx].status = (action === 'approve') ? 'approved' : 'rejected';
  wl[idx].updatedAt = new Date().toISOString();
  writeWL(wl);

  res.json({ success: true });
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