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
  return JSON.parse(fs.readFileSync(wlFile, 'utf8') || '[]');
}

function writeWL(data) {
  fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

function defaultDiscordAvatar(discordId) {
  const idx = Number(discordId.slice(-1)) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function fetchDiscordAvatar(discordId) {
  if (!DISCORD_BOT_TOKEN) {
    return { avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(discordId) };
  }

  try {
    const r = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
    });

    if (!r.ok) return { avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(discordId) };

    const u = await r.json();
    const avatarUrl = u.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${u.avatar}.png?size=128`
      : null;

    return {
      avatarUrl,
      defaultAvatarUrl: defaultDiscordAvatar(discordId)
    };
  } catch {
    return { avatarUrl: null, defaultAvatarUrl: defaultDiscordAvatar(discordId) };
  }
}

app.post('/api/whitelist', async (req, res) => {
  const { Meno, Vek, Discord, DiscordId, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || !Discord || !DiscordId || !Skusenosti || !Preco) {
    return res.json({ success: false });
  }

  const avatar = await fetchDiscordAvatar(DiscordId);

  const wl = readWL();
  wl.push({
    Meno,
    Vek,
    Discord,
    DiscordId,
    Skusenosti,
    Preco,
    status: "pending",
    avatarUrl: avatar.avatarUrl,
    defaultAvatarUrl: avatar.defaultAvatarUrl
  });

  writeWL(wl);
  res.json({ success: true });
});

app.get('/api/whitelist', (req,res)=>{
  res.json(readWL());
});

app.post('/api/whitelist/action', (req,res)=>{
  const {index,action,password} = req.body;
  if(password!==ADMIN_PASSWORD) return res.json({success:false});

  const wl = readWL();
  if(!wl[index]) return res.json({success:false});

  wl[index].status = action === "approve" ? "approved" : "rejected";
  writeWL(wl);

  res.json({success:true});
});

app.listen(PORT,()=>console.log("Server running"));
