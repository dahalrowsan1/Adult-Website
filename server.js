require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || '';
if (isProduction && sessionSecret.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters in production.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_USERNAME) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in .env before starting.');
  process.exit(1);
}

const dbPath = path.resolve(process.env.DATABASE_FILE || './data/videos.sqlite');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS videos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'Other',
 thumbnail_url TEXT NOT NULL DEFAULT '',
 video_url TEXT NOT NULL DEFAULT '',
 embed_url TEXT NOT NULL DEFAULT '',
 published INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL DEFAULT ''
);
`);
const defaults = {
  site_name: 'Rowsan Play',
  ad_link: '',
  ad_label: 'Sponsored',
  ad_iframe_url: ''
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k,v] of Object.entries(defaults)) insertSetting.run(k,v);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      mediaSrc: ["'self'", 'https:'],
      frameSrc: ["'self'", 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  name: 'rowsan.sid',
  secret: sessionSecret || 'development-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 4
  }
}));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false });
const adminOnly = (req,res,next) => req.session && req.session.admin ? next() : res.status(401).json({ error: 'Admin login required.' });
const clean = (v, max=2000) => String(v ?? '').trim().slice(0,max);
function safeHttpUrl(value, allowEmpty=true) {
  const v = clean(value, 2000);
  if (!v && allowEmpty) return '';
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}
function settingsObject() {
  return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key,r.value]));
}
function publicVideo(v) {
  return { id:v.id, title:v.title, description:v.description, category:v.category,
    thumbnail_url:v.thumbnail_url, video_url:v.video_url, embed_url:v.embed_url, created_at:v.created_at };
}
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/watch', (req,res) => res.sendFile(path.join(__dirname,'public','watch.html')));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname,'public','admin.html')));

app.get('/api/config', (req,res) => {
  const s=settingsObject();
  res.json({ site_name:s.site_name, ad_link:s.ad_link, ad_label:s.ad_label, ad_iframe_url:s.ad_iframe_url });
});
app.get('/api/categories', (req,res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM videos WHERE published=1 ORDER BY category COLLATE NOCASE').all();
  res.json(['All', ...rows.map(x=>x.category)]);
});
app.get('/api/videos', (req,res) => {
  const q=clean(req.query.q,120);
  const category=clean(req.query.category,80);
  const where=['published=1']; const params=[];
  if(q) { where.push('(title LIKE ? OR description LIKE ? OR category LIKE ?)'); const term='%'+q.replace(/[%_]/g,'\\$&')+'%'; params.push(term,term,term); }
  if(category && category!=='All') { where.push('category=?'); params.push(category); }
  const rows=db.prepare(`SELECT * FROM videos WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 100`).all(...params);
  res.json(rows.map(publicVideo));
});
app.get('/api/videos/:id', (req,res) => {
  const v=db.prepare('SELECT * FROM videos WHERE id=? AND published=1').get(Number(req.params.id));
  if(!v) return res.status(404).json({error:'Video not found.'});
  res.json(publicVideo(v));
});
app.get('/api/admin/me', (req,res) => res.json({ authenticated:!!(req.session && req.session.admin), username:req.session?.admin?.username || '' }));
app.post('/api/admin/login', loginLimiter, async (req,res) => {
  const username=clean(req.body.username,100);
  const password=String(req.body.password ?? '');
  const expectedUser=process.env.ADMIN_USERNAME;
  const hash=process.env.ADMIN_PASSWORD_HASH;
  let ok=false;
  try { ok=username===expectedUser && await bcrypt.compare(password,hash); } catch {}
  if(!ok) return res.status(401).json({error:'Invalid username or password.'});
  req.session.regenerate(err => {
    if(err) return res.status(500).json({error:'Could not create session.'});
    req.session.admin={username};
    res.json({ok:true});
  });
});
app.post('/api/admin/logout', adminOnly, (req,res) => req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/videos', adminOnly, (req,res) => {
  res.json(db.prepare('SELECT * FROM videos ORDER BY id DESC').all().map(v=>({...publicVideo(v),published:!!v.published})));
});
app.post('/api/admin/videos', adminOnly, writeLimiter, (req,res) => {
  const title=clean(req.body.title,180);
  const description=clean(req.body.description,3000);
  const category=clean(req.body.category,80) || 'Other';
  const thumbnail=safeHttpUrl(req.body.thumbnail_url);
  const video=safeHttpUrl(req.body.video_url);
  const embed=safeHttpUrl(req.body.embed_url);
  if(!title) return res.status(400).json({error:'Title is required.'});
  if(thumbnail===null || video===null || embed===null) return res.status(400).json({error:'URLs must be valid http/https URLs.'});
  if(!video && !embed) return res.status(400).json({error:'Provide a direct video URL or an embed URL.'});
  const result=db.prepare(`INSERT INTO videos (title,description,category,thumbnail_url,video_url,embed_url,published)
    VALUES (?,?,?,?,?,?,?)`).run(title,description,category,thumbnail,video,embed,req.body.published===false?0:1);
  res.json({ok:true,id:result.lastInsertRowid});
});
app.put('/api/admin/videos/:id', adminOnly, writeLimiter, (req,res) => {
  const id=Number(req.params.id);
  const old=db.prepare('SELECT * FROM videos WHERE id=?').get(id);
  if(!old) return res.status(404).json({error:'Video not found.'});
  const title=clean(req.body.title,180);
  const description=clean(req.body.description,3000);
  const category=clean(req.body.category,80) || 'Other';
  const thumbnail=safeHttpUrl(req.body.thumbnail_url);
  const video=safeHttpUrl(req.body.video_url);
  const embed=safeHttpUrl(req.body.embed_url);
  if(!title) return res.status(400).json({error:'Title is required.'});
  if(thumbnail===null || video===null || embed===null) return res.status(400).json({error:'URLs must be valid http/https URLs.'});
  if(!video && !embed) return res.status(400).json({error:'Provide a direct video URL or an embed URL.'});
  db.prepare(`UPDATE videos SET title=?,description=?,category=?,thumbnail_url=?,video_url=?,embed_url=?,published=? WHERE id=?`)
    .run(title,description,category,thumbnail,video,embed,req.body.published===false?0:1,id);
  res.json({ok:true});
});
app.delete('/api/admin/videos/:id', adminOnly, writeLimiter, (req,res) => {
  const result=db.prepare('DELETE FROM videos WHERE id=?').run(Number(req.params.id));
  if(!result.changes) return res.status(404).json({error:'Video not found.'});
  res.json({ok:true});
});
app.put('/api/admin/settings', adminOnly, writeLimiter, (req,res) => {
  const site=clean(req.body.site_name,80) || 'Rowsan Play';
  const link=safeHttpUrl(req.body.ad_link);
  const iframe=safeHttpUrl(req.body.ad_iframe_url);
  const label=clean(req.body.ad_label,80) || 'Sponsored';
  if(link===null || iframe===null) return res.status(400).json({error:'Ad URLs must be valid http/https URLs.'});
  const put=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  put.run('site_name',site); put.run('ad_link',link); put.run('ad_label',label); put.run('ad_iframe_url',iframe);
  res.json({ok:true});
});

app.use((err,req,res,next) => {
  console.error(err);
  res.status(500).json({error:'Server error.'});
});
app.listen(PORT, () => console.log(`Rowsan Play running on http://localhost:${PORT}`));
