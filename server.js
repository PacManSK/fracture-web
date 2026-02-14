// server.js (FINAL - Discord OAuth + Multi Admins + WL only for logged-in users + Webhook colors + Admin name)
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================= */
/* ENV (Render) */
/* ============================= */
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_CALLBACK_URL = String(process.env.DISCORD_CALLBACK_URL || '')
  .replace(/[\r\n]/g, '')
  .trim();

const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || '').trim();

// logo pre webhook správy (môžeš zmeniť v Render ENV: BRAND_LOGO_URL)
const BRAND_LOGO_URL = String(
  process.env.BRAND_LOGO_URL || 'https://fracture-web-let4.onrender.com/logo.png'
).trim();

// Multi-admin IDs (Render ENV ADMIN_DISCORD_IDS="id1,id2,id3" má prednosť)
const DEFAULT_ADMIN_IDS = [
  "802210683541389332",
  "1084959527255949423",
  "569858258626412559",
  "964552958886961152",
  "800012301331202068"
];

const ADMIN_DISCORD_IDS = (String(process.env.ADMIN_DISCORD_IDS || '').trim()
  ? String(process.env.ADMIN_DISCORD_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  : DEFAULT_ADMIN_IDS
);

const SESSION_SECRET = String(process.env.SESSION_SECRET || 'fracture_secret_dev_only').trim();

console.log("DISCORD_CLIENT_ID:", DISCORD_CLIENT_ID || "(missing)");
console.log("DISCORD_CALLBACK_URL CLEAN:", DISCORD_CALLBACK_URL || "(missing)");
console.log("DISCORD_WEBHOOK_URL:", DISCORD_WEBHOOK_URL ? "(set)" : "(missing)");
console.log("BRAND_LOGO_URL:", BRAND_LOGO_URL);
console.log("ADMIN_DISCORD_IDS:", ADMIN_DISCORD_IDS);

/* ============================= */
/* MIDDLEWARE */
/* ============================= */
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'fracture.sid',
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: true, // Render = HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dní
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

/* ============================= */
/* HELPERS */
/* ============================= */
function isAdminUser(req) {
  if (!req.user) return false;
  return ADMIN_DISCORD_IDS.includes(String(req.user.id));
}

function clip(str, max = 1000) {
  const s = String(str ?? '');
  return s.length <= max ? s : (s.slice(0, max - 3) + '...');
}

async function sendDiscordWebhook(payload) {
  if (!DISCORD_WEBHOOK_URL) return;

  // Render Node 22 má fetch, ale nech je to safe
  const f = globalThis.fetch;
  if (!f) {
    console.log("Webhook: fetch not available. (Install node-fetch if needed)");
    return;
  }

  try {
    const r = await f(DISCORD_WEBHOOK_URL, {
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

if (!discordEnvOk) {
  console.log("⚠️ Discord OAuth is DISABLED (missing ENV).");
} else {
  passport.use(new DiscordStrategy(
    {
      clientID: DISCORD_CLIENT_ID,
      clientSecret: DISCORD_CLIENT_SECRET,
      callbackURL: DISCORD_CALLBACK_URL,
      scope: ['identify']
    },
    (accessToken, refreshToken, profile, done) => {
      const defaultAvatar = `https://cdn.discordapp.com/embed/avatars/${Number(profile.discriminator) % 5}.png`;
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
app.get('/auth/discord',
  (req, res, next) => {
    if (!discordEnvOk) {
      return res.status(500).send(
        "Discord OAuth nie je nastavený. Skontroluj Render ENV: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL."
      );
    }
    next();
  },
  passport.authenticate('discord')
);

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/?tab=admin' }),
  (req, res) => res.redirect('/?tab=admin')
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
      // musí sedieť s "name: fracture.sid"
      res.clearCookie('fracture.sid', { path: '/' });
      res.redirect('/?tab=admin');
    });
  });
});
app.get('/logout', (req, res) => res.redirect('/auth/logout'));

/* ============================= */
/* WHITELIST SYSTEM */
/* ============================= */
const wlFile = path.join(__dirname, 'whitelist.json');

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

/* ✅ WL iba pre prihlásených cez Discord */
app.post('/api/whitelist', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Najprv sa prihlás cez Discord.' });
  }

  const { Meno, Vek, Skusenosti, Preco } = req.body;

  // Discord údaje berieme z loginu
  const discordUserId = String(req.user.id);
  const discordTag = `${req.user.username}#${req.user.discriminator}`;
  const avatarUrl = req.user.avatarUrl || req.user.defaultAvatarUrl || "";

  if (!Meno || !Vek || !Skusenosti || !Preco) {
    return res.json({ success: false, error: 'Nevyplnené polia!' });
  }

  const wl = readWL();
  wl.push({
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

  // 🟡 webhook - nová WL
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

  res.json({ success: true });
});

/* ✅ list žiadostí: iba admin */
app.get('/api/whitelist', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Admin prístup má iba vybraný účet.' });
  }
  res.json(readWL());
});

/* approve/reject iba admin + webhook farby + admin meno */
app.post('/api/whitelist/action', async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Admin prístup má iba vybraný účet.' });
  }

  const { index, action } = req.body;
  const wl = readWL();

  if (typeof index !== 'number' || !wl[index]) {
    return res.json({ success: false, error: 'Neexistujúca žiadosť' });
  }

  if (action === 'approve') wl[index].status = 'approved';
  else if (action === 'reject') wl[index].status = 'rejected';
  else return res.json({ success: false, error: 'Neznáma akcia' });

  wl[index].updatedAt = new Date().toISOString();
  writeWL(wl);

  const adminName = req.user?.username
    ? `${req.user.username}#${req.user.discriminator}`
    : "Admin";

  const statusEmoji = action === 'approve' ? "🟢" : "🔴";
  const statusText = action === 'approve' ? "SCHVÁLENÉ" : "ZAMIETNUTÉ";
  const color = action === 'approve' ? 0x2ECC71 : 0xE74C3C;

  await sendDiscordWebhook({
    username: "Fracture Roleplay WL",
    avatar_url: BRAND_LOGO_URL,
    embeds: [{
      title: `${statusEmoji} Whitelist ${statusText}`,
      color,
      fields: [
        { name: "Meno / Nick", value: clip(wl[index].Meno, 1024), inline: true },
        { name: "Discord", value: clip(wl[index].Discord, 1024), inline: true },
        { name: "Status", value: statusText, inline: true },
        { name: "Admin", value: clip(adminName, 1024), inline: false },
      ],
      footer: { text: "Fracture Roleplay" },
      timestamp: new Date().toISOString(),
    }]
  });

  res.json({ success: true });
});

/* ============================= */
/* GLOBAL ERROR HANDLER */
/* ============================= */
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).send("Internal Server Error (pozri Render Logs).");
});

/* ============================= */
/* START */
/* ============================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server beží na porte ${PORT}`);
});
