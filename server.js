const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UP_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UP_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UP_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- tiny JSON db ----------
function load(name, def) {
  const p = path.join(DATA_DIR, name + '.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; }
}
function save(name, obj) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(obj, null, 2));
}
let users = load('users', []);
let works = load('works', []);
let danmus = load('danmus', []);
let comments = load('comments', []);
let history = load('history', []);
// interactions: { [userId]: { like:{workId:1}, coin:{}, fav:{} } }
let inter = load('inter', { users: {} });
let nextId = load('nextid', { id: 100 });
function nid() { return nextId.id++; save('nextid', nextId); }

function hash(pw, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.createHash('sha256').update(salt + pw).digest('hex');
}
function verify(pw, stored) {
  const [salt, h] = stored.split(':');
  return h === crypto.createHash('sha256').update(salt + pw).digest('hex');
}

// ---------- seed admin + welcome post ----------
if (!users.find(u => u.name === '管理员账号')) {
  users.push({
    id: nid(), name: '管理员账号', pass: hash('508679mn114514'),
    avatar: '', level: 1000, exp: 999000, isAdmin: true, createdAt: Date.now(), token: null
  });
  save('users', users);
}
if (!works.find(w => w.title === '欢迎来到我自制的网站')) {
  works.unshift({
    id: nid(), type: 'post', title: '欢迎来到我自制的网站',
    content: '欢迎来到我自制的网站，欢迎大家使用',
    videoUrl: '', coverUrl: '', images: [], category: 'life',
    authorId: users.find(u => u.name === '管理员账号').id,
    authorName: '管理员账号', playCount: 0, createdAt: Date.now()
  });
  save('works', works);
}

// ---------- auth middleware ----------
function auth(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return null;
  return users.find(u => u.token === t) || null;
}
function needAdmin(req, res, next) {
  const u = auth(req);
  if (!u || !u.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
  req.user = u; next();
}

// ---------- level / exp ----------
function expForLevel(L) { return L * (L + 1) * 5; }
function addExp(userId, amt) {
  const u = users.find(x => x.id === userId);
  if (!u) return;
  u.exp = (u.exp || 0) + amt;
  // compute level from exp
  let lvl = 0;
  while (lvl < 1000 && u.exp >= expForLevel(lvl + 1)) lvl++;
  u.level = lvl;
  save('users', users);
}

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10) || '';
    cb(null, Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// ---------- auth routes ----------
app.post('/api/register', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (users.find(u => u.name === name)) return res.status(400).json({ error: '用户名已存在' });
  const u = { id: nid(), name, pass: hash(password), avatar: '', level: 0, exp: 0, isAdmin: false, createdAt: Date.now(), token: crypto.randomBytes(16).toString('hex') };
  users.push(u); save('users', users);
  res.json({ token: u.token, user: pub(u) });
});
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  const u = users.find(x => x.name === name);
  if (!u || !verify(password || '', u.pass)) return res.status(400).json({ error: '用户名或密码错误' });
  u.token = crypto.randomBytes(16).toString('hex'); save('users', users);
  res.json({ token: u.token, user: pub(u) });
});
app.get('/api/auth/me', (req, res) => {
  const u = auth(req);
  res.json({ user: u ? pub(u) : null });
});
function pub(u) {
  return { id: u.id, name: u.name, avatar: u.avatar, level: u.level, exp: u.exp, isAdmin: !!u.isAdmin };
}

// avatar upload
app.post('/api/upload/avatar', authOpt(), upload.single('file'), (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: '未登录' });
  u.avatar = '/uploads/' + req.file.filename; save('users', users);
  res.json({ url: u.avatar });
});
function authOpt() { return (req, res, next) => next(); }

// ---------- works ----------
app.get('/api/works', (req, res) => {
  const cat = req.query.category;
  let list = [...works].sort((a, b) => b.createdAt - a.createdAt);
  if (cat && cat !== 'all') list = list.filter(w => w.category === cat);
  res.json(list.map(w => workCard(w)));
});
function workCard(w) {
  return {
    id: w.id, type: w.type, title: w.title, content: (w.content || '').slice(0, 80),
    coverUrl: w.coverUrl, videoUrl: w.videoUrl, images: w.images, category: w.category,
    authorName: w.authorName, authorId: w.authorId, createdAt: w.createdAt,
    playCount: w.playCount || 0,
    likeCount: (inter.usersLike && inter.usersLike[w.id]) ? inter.usersLike[w.id].length : 0,
    coinCount: (inter.usersCoin && inter.usersCoin[w.id]) ? inter.usersCoin[w.id].length : 0,
    favCount: (inter.usersFav && inter.usersFav[w.id]) ? inter.usersFav[w.id].length : 0,
    danmuCount: danmus.filter(d => d.workId === w.id).length,
    commentCount: comments.filter(c => c.workId === w.id).length
  };
}

app.post('/api/works', authOpt(), upload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }, { name: 'images', maxCount: 9 }]), (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: '请先登录' });
  const { type, title, content, category } = req.body;
  if (!title) return res.status(400).json({ error: '标题必填' });
  const files = req.files || {};
  const w = {
    id: nid(), type: type === 'post' ? 'post' : 'video',
    title, content: content || '', category: category || 'life',
    videoUrl: files.video ? '/uploads/' + files.video[0].filename : '',
    coverUrl: files.cover ? '/uploads/' + files.cover[0].filename : '',
    images: files.images ? files.images.map(f => '/uploads/' + f.filename) : [],
    authorId: u.id, authorName: u.name, playCount: 0, createdAt: Date.now()
  };
  works.unshift(w); save('works', works);
  addExp(u.id, w.type === 'video' ? 50 : 10);
  res.json(workCard(w));
});

app.get('/api/works/:id', (req, res) => {
  const w = works.find(x => x.id == req.params.id);
  if (!w) return res.status(404).json({ error: '作品不存在' });
  // record history + play count if logged in and it's a video/viewable
  const u = auth(req);
  w.playCount = (w.playCount || 0) + 1; save('works', works);
  if (u) {
    history = history.filter(h => !(h.userId === u.id && h.workId === w.id));
    history.unshift({ userId: u.id, workId: w.id, time: Date.now() });
    save('history', history);
  }
  res.json(workCard(w));
});

// interactions: like / coin / fav  (body: {action:'like'|'coin'|'fav'})
app.post('/api/works/:id/act', authOpt(), (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: '请先登录' });
  const w = works.find(x => x.id == req.params.id);
  if (!w) return res.status(404).json({ error: '作品不存在' });
  const action = req.body.action;
  inter.usersLike = inter.usersLike || {};
  inter.usersCoin = inter.usersCoin || {};
  inter.usersFav = inter.usersFav || {};
  inter.usersLike[w.id] = inter.usersLike[w.id] || [];
  inter.usersCoin[w.id] = inter.usersCoin[w.id] || [];
  inter.usersFav[w.id] = inter.usersFav[w.id] || [];
  let liked = false, coined = false, faved = false;
  if (action === 'like') {
    const i = inter.usersLike[w.id].indexOf(u.id);
    if (i >= 0) inter.usersLike[w.id].splice(i, 1); else { inter.usersLike[w.id].push(u.id); addExp(u.id, 1); }
    liked = inter.usersLike[w.id].includes(u.id);
  } else if (action === 'coin') {
    const i = inter.usersCoin[w.id].indexOf(u.id);
    if (i < 0) { inter.usersCoin[w.id].push(u.id); addExp(u.id, 2); }
    coined = true;
  } else if (action === 'fav') {
    const i = inter.usersFav[w.id].indexOf(u.id);
    if (i >= 0) inter.usersFav[w.id].splice(i, 1); else inter.usersFav[w.id].push(u.id);
    faved = inter.usersFav[w.id].includes(u.id);
  }
  save('inter', inter);
  res.json({ liked, coined, faved, likeCount: inter.usersLike[w.id].length, coinCount: inter.usersCoin[w.id].length, favCount: inter.usersFav[w.id].length });
});

// my works / history
app.get('/api/my/works', authOpt(), (req, res) => {
  const u = auth(req); if (!u) return res.status(401).json({ error: '未登录' });
  res.json(works.filter(w => w.authorId === u.id).map(workCard));
});
app.get('/api/my/history', authOpt(), (req, res) => {
  const u = auth(req); if (!u) return res.status(401).json({ error: '未登录' });
  const list = history.filter(h => h.userId === u.id).map(h => {
    const w = works.find(x => x.id === h.workId);
    return w ? { ...workCard(w), watchTime: h.time } : null;
  }).filter(Boolean);
  res.json(list);
});
app.delete('/api/my/history/:id', authOpt(), (req, res) => {
  const u = auth(req); if (!u) return res.status(401).json({ error: '未登录' });
  history = history.filter(h => !(h.userId === u.id && h.workId == req.params.id));
  save('history', history); res.json({ ok: true });
});

// ---------- danmaku (SSE realtime) ----------
const sseClients = [];
app.get('/api/danmu/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
});
function broadcast(ev) {
  const s = `data: ${JSON.stringify(ev)}\n\n`;
  sseClients.forEach(c => { try { c.write(s); } catch (e) {} });
}
app.get('/api/danmu/:workId', (req, res) => {
  res.json(danmus.filter(d => d.workId == req.params.workId).sort((a, b) => a.time - b.time));
});
app.post('/api/danmu', authOpt(), (req, res) => {
  const u = auth(req);
  const { workId, text, color } = req.body;
  if (!text || !workId) return res.status(400).json({ error: '内容不能为空' });
  const d = {
    id: nid(), workId: Number(workId),
    userId: u ? u.id : null, userName: u ? u.name : '游客',
    avatar: u ? u.avatar : '', text: String(text).slice(0, 50),
    color: color || 'white', time: Date.now()
  };
  // enforce rainbow lock
  if (d.color === 'rainbow' && (!u || u.level < 3)) return res.status(403).json({ error: '渐变彩色需要 LV3 及以上等级解锁' });
  danmus.push(d); save('danmus', danmus);
  if (u) addExp(u.id, 2);
  broadcast({ type: 'danmu', data: d });
  res.json(d);
});

// ---------- comments (nested) ----------
app.get('/api/comments/:workId', (req, res) => {
  res.json(comments.filter(c => c.workId == req.params.workId).sort((a, b) => b.time - a.time));
});
app.post('/api/comments', authOpt(), (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: '请先登录后再评论' });
  const { workId, text, parentId } = req.body;
  if (!text) return res.status(400).json({ error: '评论不能为空' });
  const c = {
    id: nid(), workId: Number(workId), parentId: parentId ? Number(parentId) : null,
    userId: u.id, userName: u.name, avatar: u.avatar,
    text: String(text).slice(0, 500), likes: [], time: Date.now()
  };
  comments.push(c); save('comments', comments);
  addExp(u.id, 3);
  res.json(c);
});
app.post('/api/comments/:id/like', authOpt(), (req, res) => {
  const u = auth(req); if (!u) return res.status(401).json({ error: '请先登录' });
  const c = comments.find(x => x.id == req.params.id); if (!c) return res.status(404).json({ error: '评论不存在' });
  c.likes = c.likes || [];
  const i = c.likes.indexOf(u.id);
  if (i >= 0) c.likes.splice(i, 1); else c.likes.push(u.id);
  save('comments', comments);
  res.json({ liked: i < 0, count: c.likes.length });
});

// ---------- admin ----------
app.get('/api/admin/users', needAdmin, (req, res) => {
  res.json(users.map(u => ({ id: u.id, name: u.name, level: u.level, exp: u.exp, isAdmin: u.isAdmin, createdAt: u.createdAt })));
});
app.post('/api/admin/users/:id/level', needAdmin, (req, res) => {
  const u = users.find(x => x.id == req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  u.level = Math.max(0, Math.min(1000, Number(req.body.level) || 0));
  save('users', users);
  res.json({ ok: true, level: u.level });
});
app.delete('/api/admin/users/:id', needAdmin, (req, res) => {
  users = users.filter(u => u.id != req.params.id || u.isAdmin);
  save('users', users); res.json({ ok: true });
});
app.get('/api/admin/danmu', needAdmin, (req, res) => res.json(danmus));
app.delete('/api/admin/danmu/:id', needAdmin, (req, res) => {
  danmus = danmus.filter(d => d.id != req.params.id); save('danmus', danmus); res.json({ ok: true });
});
app.get('/api/admin/comments', needAdmin, (req, res) => res.json(comments));
app.delete('/api/admin/comments/:id', needAdmin, (req, res) => {
  comments = comments.filter(c => c.id != req.params.id); save('comments', comments); res.json({ ok: true });
});
app.get('/api/admin/works', needAdmin, (req, res) => res.json(works.map(workCard)));
app.delete('/api/admin/works/:id', needAdmin, (req, res) => {
  works = works.filter(w => w.id != req.params.id); save('works', works); res.json({ ok: true });
});
// likers for author
app.get('/api/works/:id/likers', authOpt(), (req, res) => {
  const w = works.find(x => x.id == req.params.id);
  if (!w) return res.status(404).json({ error: '作品不存在' });
  const u = auth(req);
  const isAuthor = u && (u.id === w.authorId || u.isAdmin);
  const ids = (inter.usersLike && inter.usersLike[w.id]) || [];
  res.json({ canSee: !!isAuthor, likers: isAuthor ? ids.map(id => { const uu = users.find(x=>x.id===id); return uu ? {name: uu.name, avatar: uu.avatar} : null; }).filter(Boolean) : [] });
});

app.listen(PORT, '0.0.0.0', () => console.log('汐弹幕站运行在 http://0.0.0.0:' + PORT));
