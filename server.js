// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Render kompatibilné
const ADMIN_PASSWORD = "Fracture123"; // rovnaké ako v HTML

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const wlFile = path.join(__dirname, 'whitelist.json');

function readWL() {
  if (!fs.existsSync(wlFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(wlFile, 'utf8') || '[]');
  } catch (e) {
    // keď je súbor rozbitý, aspoň nespadne server
    return [];
  }
}

function writeWL(data) {
  fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

// prijatie WL
app.post('/api/whitelist', (req, res) => {
  const { Meno, Vek, Discord, Skusenosti, Preco } = req.body;

  if (!Meno || !Vek || !Discord || !Skusenosti || !Preco) {
    return res.json({ success: false, error: 'Nevyplnené polia!' });
  }

  const wl = readWL();
  wl.push({ Meno, Vek, Discord, Skusenosti, Preco, status: 'pending', createdAt: new Date().toISOString() });
  writeWL(wl);

  res.json({ success: true });
});

// admin list (vracia všetko -> index sedí s tvojím HTML)
app.get('/api/whitelist', (req, res) => {
  res.json(readWL());
});

// approve/reject
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

app.listen(PORT, () => {
  console.log(`Server beží na porte ${PORT}`);
});
