// server.js (FINAL - Discord OAuth + Multi Admins + WL + Discord Webhook Notifs)
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================= */
/* ENV (Render) - CLEANED */
/* ============================= */
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_CALLBACK_URL = String(process.env.DISCORD_CALLBACK_URL || '')
  .replace(/[\r\n]/g, '')
  .trim();

const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || '').trim();

// Multi-admin (môžeš prepísať cez Render ENV: ADMIN_DISCORD_IDS="id1,id2,id3")
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
console.log("DISCORD_CALLBACK_URL RAW JSON:", JSON.stringify(process.env.DISCORD_CALLBACK_URL));
console.log("DISCORD_CALLBACK_URL CLEAN:", DISCORD_CALLBACK_URL || "(missing)");
console.log("ADMIN_DISCORD_IDS:", ADMIN_DISCORD_IDS);
console.log("DISCORD_WEBHOOK_URL:", DISCORD_WEBHOOK_URL ? "(set)" : "(missing)");

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
  const loggedIn = !!req.user;
  if (!loggedIn) return false;
  return ADMIN_DISCORD_IDS.includes(String(req.user.id));
}

function clip(str, max = 1000) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

// Discord webhook sender (Node 18+ má fetch)
async function sendDiscordWebhook(payload) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    const r = await fetch(DISCORD_WEBHOOK_URL, {
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
/* DISCORD STRATEGY */
/* ============================= */
const discordEnvOk = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL);

if (!discordEnvOk) {
  console.log("⚠️ Discord OAuth is DISABLED (missing ENV). Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL.");
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
/* DISCORD AUTH ROUTES */
/* ============================= */
app.get('/auth/discord', (req, res, next) => {
  if (!discordEnvOk) {
    return res.status(500).send(
      "Discord OAuth nie je nastavený.\n" +
      "Skontroluj Render ENV:\n" +
      "- DISCORD_CLIENT_ID\n" +
      "- DISCORD_CLIENT_SECRET\n" +
      "- DISCORD_CALLBACK_URL = https://fracture-web-let4.onrender.com/auth/discord/callback\n"
    );
  }
  console.log("CALLBACK URL USED:", DISCORD_CALLBACK_URL);
  next();
}, passport.authenticate('discord'));

app.get('/auth/discord/callback',
  (req, res, next) => {
    console.log("HIT /auth/discord/callback");
    console.log("QUERY:", req.query);
    next();
  },
  passport.authenticate('discord', { failureRedirect: '/?tab=admin' }),
  (req, res) => {
    console.log("AUTH OK, USER:", req.user?.id, req.user?.username);
    res.redirect('/?tab=admin');
  }
);

app.get('/auth/me', (req, res) => {
  const loggedIn = !!req.user;
  const isAdmin = isAdminUser(req);

  res.json({
    loggedIn,
    isAdmin,
    user: loggedIn ? {
      id: req.user.id,
      username: req.user.username,
      discriminator: req.user.discriminator,
      avatar: req.user.avatar,
      avatarUrl: req.user.avatarUrl,
      defaultAvatarUrl: req.user.defaultAvatarUrl
    } : null
  });
});

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy(() => {
      res.clearCookie('fracture.sid');
      res.redirect('/?tab=admin');
    });
  });
});

// kompatibilita
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

// prijatie WL + webhook notif
app.post('/api/whitelist', async (req, res) => {
  const { Meno, Vek, Discord, DiscordId, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || !Discord || !Skusenosti || !Preco) {
    return res.json({ success: false, error: 'Nevyplnené polia!' });
  }

  const wl = readWL();
  wl.push({
    Meno,
    Vek,
    Discord,
    DiscordId,
    Skusenosti,
    Preco,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  writeWL(wl);

  // DISCORD WEBHOOK: new WL
  await sendDiscordWebhook({
    username: "Fracture WL",
    embeds: [{
      title: "📝 Nová whitelist žiadosť",
      color: 0xff4b5c,
      fields: [
        { name: "Meno / Nick", value: clip(Meno, 1024), inline: true },
        { name: "Vek", value: clip(Vek, 1024), inline: true },
        { name: "Discord", value: clip(Discord, 1024), inline: false },
        { name: "Discord ID", value: clip(DiscordId || "-", 1024), inline: false },
        { name: "Skúsenosti s RP", value: clip(Skusenosti, 1024), inline: false },
        { name: "Prečo sa chce pripojiť", value: clip(Preco, 1024), inline: false },
      ],
      footer: { text: "Fracture Roleplay" },
      timestamp: new Date().toISOString(),
    }]
  });

  res.json({ success: true });
});

// list žiadostí
app.get('/api/whitelist', (req, res) => {
  res.json(readWL());
});

// approve/reject iba admin + webhook notif
app.post('/api/whitelist/action', async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Nemáš prístup (prihlás sa ako admin).' });
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

  // DISCORD WEBHOOK: action
  const statusEmoji = action === 'approve' ? "✅" : "❌";
  const statusText  = action === 'approve' ? "SCHVÁLENÉ" : "ZAMIETNUTÉ";

  const adminName = req.user?.username ? `${req.user.username}#${req.user.discriminator}` : "Admin";

  await sendDiscordWebhook({
    username: "Fracture WL",
    embeds: [{
      title: `${statusEmoji} Whitelist ${statusText}`,
      color: action === 'approve' ? 0x16a34a : 0xdc2626,
      fields: [
        { name: "Meno / Nick", value: clip(wl[index].Meno, 1024), inline: true },
        { name: "Discord", value: clip(wl[index].Discord, 1024), inline: true },
        { name: "Status", value: statusText, inline: true },
        { name: "Urobil", value: clip(adminName, 1024), inline: false },
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
