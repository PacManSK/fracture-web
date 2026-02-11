const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;
const ADMIN_PASSWORD = "admin123";

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

function readFile(file){
    if(!fs.existsSync(file)) fs.writeFileSync(file, '[]');
    return JSON.parse(fs.readFileSync(file));
}

function writeFile(file, data){
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* Odoslanie WL */
app.post('/api/whitelist', (req, res) => {
    const data = readFile('pending.json');
    data.push(req.body);
    writeFile('pending.json', data);
    res.json({success:true});
});

/* Zobraziť čakajúce */
app.get('/api/whitelist', (req, res) => {
    res.json(readFile('pending.json'));
});

/* Schváliť / odmietnuť */
app.post('/api/whitelist/action', (req, res) => {
    const {index, action, password} = req.body;

    if(password !== ADMIN_PASSWORD){
        return res.json({success:false, error:"Zlé heslo"});
    }

    let pending = readFile('pending.json');
    if(!pending[index]) return res.json({success:false});

    const request = pending.splice(index,1)[0];
    writeFile('pending.json', pending);

    if(action === 'approve'){
        let approved = readFile('approved.json');
        approved.push(request);
        writeFile('approved.json', approved);
    }

    if(action === 'reject'){
        let rejected = readFile('rejected.json');
        rejected.push(request);
        writeFile('rejected.json', rejected);
    }

    res.json({success:true});
});

/* Zobraziť schválené */
app.get('/api/approved', (req,res)=>{
    res.json(readFile('approved.json'));
});

/* Zobraziť odmietnuté */
app.get('/api/rejected', (req,res)=>{
    res.json(readFile('rejected.json'));
});

app.listen(PORT, () => {
    console.log("Server beží na http://localhost:"+PORT);
});