const express = require('express');
const fs = require('fs');
const path = require('path');

const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// Admin (len tvoje Discord ID)
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || "1084959527255949423";

// OAuth (login cez Discord)
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL || "http://localhost:3000/auth/discord/callback";

// Bot token (real avatar pre WL)
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Session + Passport
app.use(session({
  secret: process.env.SESSION_SECRET || "change-me-please",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // Render = production
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dní
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Discord OAuth strategy (len identify)
if (DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify']
  }, (accessToken, refreshToken, profile, done) => {
    // uložíme minimum: id + username + avatar
    done(null, {
      id: profile.id,
      username: profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar
    });
  }));
}

// ---- Auth helpers
function isAdmin(req) {
  return req.isAuthenticated?.() && req.user?.id === ADMIN_DISCORD_ID;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ success: false, error: "Not authorized" });
  next();
}

// ---- Auth routes
app.get('/auth/discord', (req, res, next) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(500).send("Discord OAuth nie je nastavené (chýba DISCORD_CLIENT_ID/SECRET).");
  }
  next();
}, passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/?login=fail' }),
  (req, res) => {
    // po prihlásení skočí na admin tab
    res.redirect('/?tab=admin');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy(() => res.redirect('/'));
  });
});

app.get('/auth/me', (req, res) => {
  if (!req.isAuthenticated?.()) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    user: req.user,
    isAdmin: req.user?.id === ADMIN_DISCORD_ID
  });
});

// ---- WL storage
const wlFile = path.join(__dirname, 'whitelist.json');

function readWL() {
  if (!fs.existsSync(wlFile)) return [];
  try { return JSON.parse(fs.readFileSync(wlFile, 'utf8') || '[]'); }
  catch { return []; }
}
function writeWL(data) {
  fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

function defaultDiscordAvatar(discordId) {
  const id = String(discordId || "").trim();
  const idx = Number(id.slice(-1)) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function fetchDiscordAvatar(discordId) {
  const id = String(discordId || "").trim();
  if (!/^\d{10,25}$/.test(id)) {
    return { avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
  }

  // bez bota aspoň default
  if (!DISCORD_BOT_TOKEN) {
    return { avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
  }

  try {
    const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
    });

    if (!r.ok) {
      return { avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
    }

    const u = await r.json();
    const avatarHash = u.avatar || null;
    const avatarUrl = avatarHash ? `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.png?size=128` : null;

    return { avatarHash, avatarUrl, defaultAvatarUrl: defaultDiscordAvatar(id) };
  } catch {
    return { avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
  }
}

// ---- API: WL submit
app.post('/api/whitelist', async (req, res) => {
  const { Meno, Vek, Discord, DiscordId, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || !Discord || !DiscordId || !Skusenosti || !Preco) {
    return res.json({ success: false, error: 'Nevyplnené polia!' });
  }

  const idStr = String(DiscordId).trim();
  if (!/^\d{10,25}$/.test(idStr)) {
    return res.json({ success: false, error: 'Discord ID je neplatné (musí byť číslo).' });
  }

  const av = await fetchDiscordAvatar(idStr);

  const wl = readWL();
  wl.push({
    Meno, Vek, Discord,
    DiscordId: idStr,
    Skusenosti, Preco,
    status: 'pending',
    createdAt: new Date().toISOString(),
    avatarHash: av.avatarHash,
    avatarUrl: av.avatarUrl,
    defaultAvatarUrl: av.defaultAvatarUrl
  });

  writeWL(wl);
  res.json({ success: true });
});

// list (verejné)
app.get('/api/whitelist', (req, res) => {
  res.json(readWL());
});

// approve/reject (IBA po Discord prihlásení)
app.post('/api/whitelist/action', requireAdmin, (req, res) => {
  const { index, action } = req.body;

  const wl = readWL();
  if (!wl[index]) return res.json({ success: false, error: 'Neexistujúca žiadosť' });

  if (action === 'approve') wl[index].status = 'approved';
  else if (action === 'reject') wl[index].status = 'rejected';
  else return res.json({ success: false, error: 'Neznáma akcia' });

  wl[index].updatedAt = new Date().toISOString();
  writeWL(wl);

  res.json({ success: true });
});

// refresh avatary (IBA admin)
app.post('/api/refresh-avatars', requireAdmin, async (req, res) => {
  const wl = readWL();
  let updated = 0, skipped = 0;

  for (let i = 0; i < wl.length; i++) {
    const item = wl[i];
    const idStr = String(item.DiscordId || "").trim();

    if (!/^\d{10,25}$/.test(idStr)) { skipped++; continue; }
    if (item.avatarUrl || item.avatarHash) { skipped++; continue; }

    const av = await fetchDiscordAvatar(idStr);
    item.avatarHash = av.avatarHash;
    item.avatarUrl = av.avatarUrl;
    item.defaultAvatarUrl = av.defaultAvatarUrl;
    item.avatarUpdatedAt = new Date().toISOString();
    updated++;
  }

  writeWL(wl);
  res.json({ success: true, updated, skipped });
});

app.listen(PORT, () => console.log(`Server beží na porte ${PORT}`));
