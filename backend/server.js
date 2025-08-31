/**
Visual Product Matcher - Backend Server
---------------------------------------
- Built with Express.js
- Serves frontend (public/index.html)
- Provides REST API endpoints:

Endpoints:
1. GET  /api/health
   → Health check with server + Python info

2. GET  /api/products
   → Returns product catalog from data/products.json

3. POST /api/search
   → Accepts image file or URL
   → Calls Python (clip_model.py) to compute CLIP embeddings
   → Returns top_k similar products above min_score

4. POST /api/add-product
   → Accepts product { name, category, image_url }
   → Appends product to data/products.json
   → Automatically triggers embedding rebuild (clip_model.py --rebuild)
   → Ensures new product is searchable immediately

Other:
- Uses multer for uploads
- Uses child_process.spawn to run Python
- Auto-manages uploads and product data
*/

const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const PY_BIN = process.env.PYTHON_BIN || 'python';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer 
const upload = multer({ dest: UPLOADS_DIR });

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), python: PY_BIN });
});

// Products list
app.get('/api/products', (req, res) => {
  try {
    const p = path.join(__dirname, 'data', 'products.json');
    const products = JSON.parse(fs.readFileSync(p, 'utf8'));
    res.json(products);
  } catch (err) {
    console.error('Failed to read products.json', err);
    res.status(500).json({ error: 'Could not load products' });
  }
});

// Search endpoint
app.post('/api/search', upload.single('file'), (req, res) => {
  const { url, top_k, min_score } = req.body;
  const hasFile = !!req.file;
  const hasUrl = typeof url === 'string' && url.trim().length > 0;

  if (!hasFile && !hasUrl) return res.status(400).json({ error: 'Provide Either File or URL' });

  const query = hasFile ? req.file.path : url.trim();
  const pyScript = path.join(__dirname, 'clip_model.py');
  const args = [pyScript, '--image', query, '--top_k', String(top_k || 12), '--min_score', String(min_score || 0.0)];

  const py = spawn(PY_BIN, args, { cwd: __dirname });
  let stdout = '';
  let stderr = '';

  py.stdout.on('data', (d) => { stdout += d.toString(); });
  py.stderr.on('data', (d) => { stderr += d.toString(); });

  py.on('close', (code) => {
    if (stderr) console.error('Python stderr:', stderr);

    if (hasFile) {
      try { fs.unlinkSync(query); } catch (e) { /* ignore */ }
    }

    if (code !== 0) {
      return res.status(500).json({ error: 'Python failed', code, stderr });
    }

    try {
      if (!stdout || !stdout.trim()) throw new Error('Empty output from Model');
      const payload = JSON.parse(stdout);
      if (payload && payload.error) return res.status(500).json({ error: payload.error });
      return res.json(payload);
    } catch (err) {
      console.error('JSON parse error:', err, 'raw:', stdout);
      return res.status(500).json({ error: 'Invalid output from Model' });
    }
  });
});

// Add Product endpoint
app.post('/api/add-product', (req, res) => {
  const { name, category, image_url } = req.body;
  if (!name || !category || !image_url) {
    return res.status(400).json({ error: 'Name, category, and image_url are required' });
  }

  try {
    const productsPath = path.join(__dirname, 'data', 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

    const newId = `${category}-${Date.now()}`;
    const newProduct = { id: newId, name, category, image_url };

    products.push(newProduct);
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));

    console.log('✅Added New Product:', newProduct);

    // 🔥 Rebuild embeddings automatically
    const pyScript = path.join(__dirname, 'clip_model.py');
    const args = [pyScript, '--image', image_url, '--rebuild'];
    const py = spawn(PY_BIN, args, { cwd: __dirname });

    py.stdout.on('data', (d) => console.log('[Rebuild stdout]', d.toString()));
    py.stderr.on('data', (d) => console.error('[Rebuild stderr]', d.toString()));
    py.on('close', (code) => {
      if (code === 0) console.log('✅Embeddings Rebuilt Successfully');
      else console.error('❌Failed To Rebuild Embeddings');
    });

    return res.json({ success: true, product: newProduct });
  } catch (err) {
    console.error('Add Product Failed:', err);
    return res.status(500).json({ error: 'Failed to add product' });
  }
});

// Serve Testing Frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
