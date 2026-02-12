// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "Fracture123";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";

app.use(express.json());
app.use(express.static(path.join(__dirname)));

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

function defaultDiscordAvatar(discordId) {
  const id = String(discordId || "").trim();
  const idx = Number(id.slice(-1)) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function fetchDiscordAvatar(discordId) {
  const id = String(discordId || "").trim();
  if (!/^\d{10,25}$/.test(id)) return { ok: false, error: "bad_id" };

  // bez tokenu aspoň default
  if (!DISCORD_BOT_TOKEN) {
    return { ok: true, avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
  }

  try {
    const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
    });

    if (!r.ok) {
      return { ok: true, avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
    }

    const u = await r.json();
    const avatarHash = u.avatar || null;

    const avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.png?size=128`
      : null;

    return {
      ok: true,
      avatarHash,
      avatarUrl,
      defaultAvatarUrl: defaultDiscordAvatar(id)
    };
  } catch {
    return { ok: true, avatarHash: null, avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(id) };
  }
}

// ============ WL SUBMIT ============
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
    Meno,
    Vek,
    Discord,
    DiscordId: idStr,
    Skusenosti,
    Preco,
    status: 'pending',
    createdAt: new Date().toISOString(),
    avatarHash: av.avatarHash,
    avatarUrl: av.avatarUrl,
    defaultAvatarUrl: av.defaultAvatarUrl,
    avatarUpdatedAt: new Date().toISOString()
  });
  writeWL(wl);

  res.json({ success: true });
});

// ============ LIST ============
app.get('/api/whitelist', (req, res) => {
  res.json(readWL());
});

// ============ APPROVE/REJECT ============
app.post('/api/whitelist/action', (req, res) => {
  const { index, action, password } = req.body;

  if (password !== ADMIN_PASSWORD) return res.json({ success: false, error: 'Nesprávne heslo' });

  const wl = readWL();
  if (!wl[index]) return res.json({ success: false, error: 'Neexistujúca žiadosť' });

  if (action === 'approve') wl[index].status = 'approved';
  else if (action === 'reject') wl[index].status = 'rejected';
  else return res.json({ success: false, error: 'Neznáma akcia' });

  wl[index].updatedAt = new Date().toISOString();
  writeWL(wl);

  res.json({ success: true });
});

// ============ REFRESH AVATARS ============
app.post('/api/refresh-avatars', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: "Nesprávne heslo" });
  }

  const wl = readWL();
  let updated = 0;
  let skipped = 0;

  // postupne, aby sme nerobili rate-limit
  for (let i = 0; i < wl.length; i++) {
    const item = wl[i];
    const idStr = String(item.DiscordId || "").trim();

    if (!/^\d{10,25}$/.test(idStr)) { skipped++; continue; }

    // dopĺňaj len tým, čo nemajú reálny avatar
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
