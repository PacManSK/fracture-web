const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "Fracture123";

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

app.post('/api/whitelist', (req, res) => {
  const { Meno, Vek, Discord, DiscordId, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || !Discord || !DiscordId || !Skusenosti || !Preco) {
    return res.json({ success:false, error:'Nevyplnené polia!' });
  }

  const wl = readWL();

  wl.push({
    Meno,
    Vek,
    Discord,
    DiscordId: String(DiscordId).trim(),
    Skusenosti,
    Preco,
    status:'pending',
    createdAt: new Date().toISOString()
  });

  writeWL(wl);
  res.json({ success:true });
});

app.get('/api/whitelist', (req,res)=>{
  res.json(readWL());
});

app.post('/api/whitelist/action', (req,res)=>{
  const { index, action, password } = req.body;

  if(password !== ADMIN_PASSWORD)
    return res.json({success:false,error:'Zlé heslo'});

  const wl = readWL();
  if(!wl[index])
    return res.json({success:false,error:'Neexistuje'});

  wl[index].status = action === 'approve' ? 'approved' : 'rejected';
  wl[index].updatedAt = new Date().toISOString();

  writeWL(wl);
  res.json({success:true});
});

app.listen(PORT, ()=>{
  console.log("Server beží na porte " + PORT);
});
