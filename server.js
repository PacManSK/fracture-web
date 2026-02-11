// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname)); // slúži index.html, css, logo, atď.

// cesta k súboru s WL žiadosťami
const wlFile = path.join(__dirname, 'whitelist.json');

// načítanie žiadostí, ak súbor neexistuje, vytvorí prázdny
function readWL() {
    if (!fs.existsSync(wlFile)) return [];
    const data = fs.readFileSync(wlFile);
    return JSON.parse(data);
}

// uloženie žiadostí
function writeWL(data) {
    fs.writeFileSync(wlFile, JSON.stringify(data, null, 2));
}

// --- API pre prijímanie WL formulára ---
app.post('/api/whitelist', (req, res) => {
    const { Meno, Vek, Discord, Skusenosti, Preco } = req.body;
    if (!Meno || !Vek || !Discord || !Skusenosti || !Preco) {
        return res.json({ success: false, error: 'Nevyplnené polia!' });
    }

    const wl = readWL();
    wl.push({ Meno, Vek, Discord, Skusenosti, Preco, status: 'pending' });
    writeWL(wl);
    res.json({ success: true });
});

// --- API pre admin panel ---
app.get('/api/whitelist', (req, res) => {
    const wl = readWL();
    res.json(wl);
});

app.post('/api/whitelist/action', (req, res) => {
    const { index, action, password } = req.body;
    const ADMIN_PASSWORD = "Fracture123"; // rovnaké ako v HTML

    if (password !== ADMIN_PASSWORD) return res.json({ success: false, error: 'Nesprávne heslo' });

    const wl = readWL();
    if (!wl[index]) return res.json({ success: false, error: 'Neexistujúca žiadosť' });

    if (action === 'approve') wl[index].status = 'approved';
    else if (action === 'reject') wl[index].status = 'rejected';
    else return res.json({ success: false, error: 'Neznáma akcia' });

    writeWL(wl);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server beží na porte ${PORT}`);
});
