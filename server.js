// server.js (FINAL + DEBUG + RENDER SESSION FIX)
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// ENV (Render)
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL;

// kto je admin (tvoje Discord user ID)
const ADMIN_DISCORD_ID = String(process.env.ADMIN_DISCORD_ID || '').trim();

// session secret (daj do Render ENV)
const SESSION_SECRET = process.env.SESSION_SECRET || 'fracture_secret_dev_only';

console.log("CLIENT ID:", DISCORD_CLIENT_ID);
console.log("CALLBACK URL:", DISCORD_CALLBACK_URL);
console.log("ADMIN DISCORD ID:", ADMIN_DISCORD_ID);

// Render / proxy - MUSÍ byť pred session
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

/**
 * Render session fix:
 * - proxy: true
 * - secure: true
 * - sameSite: 'none'
 * Toto je najstabilnejšie pre OAuth redirect + cookies na Render.
 */
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'fracture.sid',
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dní
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy(
  {
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify']
  },
  (accessToken, refreshToken, profile, done) => {
    // real avatar URL ak existuje, inak default
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

/* ============================= */
/* DEBUG ENDPOINTS */
/* ============================= */

app.get('/debug/ping', (req, res) => {
  res.json({
    ok: true,
    https: req.secure,
    proto: req.headers['x-forwarded-proto'],
    host: req.headers.host,
    cookieHeader: req.headers.cookie || null
  });
});

app.get('/debug/session', (req, res) => {
  res.json({
    hasSession: !!req.session,
    sessionID: req.sessionID || null,
    user: req.user ? { id: req.user.id, username: req.user.username } : null
  });
});

app.get('/debug/callback-hit', (req, res) => {
  res.send('callback route reached');
});

/* ============================= */
/* DISCORD AUTH ROUTES */
/* ============================= */

app.get('/auth/discord',
  (req, res, next) => {
    console.log("CALLBACK URL USED:", DISCORD_CALLBACK_URL);
    next();
  },
  passport.authenticate('discord')
);

app.get(
  '/auth/discord/callback',
  (req, res, next) => {
    console.log("HIT /auth/discord/callback");
    next();
  },
  passport.authenticate('discord', { failureRedirect: '/?tab=admin' }),
  (req, res) => {
    console.log("AUTH OK, USER:", req.user?.id, req.user?.username);
    res.redirect('/?tab=admin');
  }
);

// test endpoint (uvidíš či si prihlásený)
app.get('/api/user', (req, res) => {
  if (!req.user) return res.json(null);
  res.json(req.user);
});

// index.html volá /auth/me
app.get('/auth/me', (req, res) => {
  const loggedIn = !!req.user;
  const isAdmin = loggedIn && ADMIN_DISCORD_ID && String(req.user.id) === ADMIN_DISCORD_ID;

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

// logout
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy(() => {
      res.clearCookie('fracture.sid');
      res.redirect('/?tab=admin');
    });
  });
});

// starý endpoint
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

// prijatie WL
app.post('/api/whitelist', (req, res) => {
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
  res.json({ success: true });
});

// list žiadostí
app.get('/api/whitelist', (req, res) => {
  res.json(readWL());
});

// approve/reject iba pre prihláseného admina
app.post('/api/whitelist/action', (req, res) => {
  const loggedIn = !!req.user;
  const isAdmin = loggedIn && ADMIN_DISCORD_ID && String(req.user.id) === ADMIN_DISCORD_ID;

  if (!isAdmin) {
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

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server beží na porte ${PORT}`);
});
