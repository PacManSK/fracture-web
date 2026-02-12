// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// ENV z Render
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL;

console.log("CLIENT ID:", DISCORD_CLIENT_ID);
console.log("CALLBACK URL:", DISCORD_CALLBACK_URL);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use(session({
  secret: 'fracture_secret',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify']
  },
  (accessToken, refreshToken, profile, done) => {
    console.log("Discord login:", profile.username);

    profile.avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${profile.discriminator % 5}.png`;

    return done(null, profile);
  }
));

/* ============================= */
/* DISCORD AUTH ROUTES */
/* ============================= */

app.get('/auth/discord',
  (req,res,next)=>{
    console.log("CALLBACK URL USED:", DISCORD_CALLBACK_URL);
    next();
  },
  passport.authenticate('discord')
);

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/api/user', (req,res)=>{
  if(!req.user) return res.json(null);
  res.json(req.user);
});

app.get('/logout',(req,res)=>{
  req.logout(()=>{});
  res.redirect('/');
});

/* ============================= */
/* WHITELIST SYSTEM */
/* ============================= */

const wlFile = path.join(__dirname, 'whitelist.json');

function readWL() {
  if (!fs.existsSync(wlFile)) return [];
  return JSON.parse(fs.readFileSync(wlFile, 'utf8') || '[]');
}

function writeWL(data) {
  fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

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

app.get('/api/whitelist', (req,res)=>{
  res.json(readWL());
});

app.post('/api/whitelist/action', (req,res)=>{
  const { index, action } = req.body;
  const wl = readWL();

  if(!wl[index]) return res.json({success:false});

  if(action === 'approve') wl[index].status = 'approved';
  if(action === 'reject') wl[index].status = 'rejected';

  writeWL(wl);
  res.json({success:true});
});

app.listen(PORT, ()=>{
  console.log(`Server beží na porte ${PORT}`);
});
