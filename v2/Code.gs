/* ================================================================
   Bala - construction site updates & approvals
   Backend: Google Apps Script web app (runs under the OWNER's Google
   account; all data + photos + bills live in the OWNER's Drive).
   v3: cache layer (fast reads), bills review workflow, fileId for bills.
   Setup: paste this file into script.google.com, Deploy > New
   deployment > Web app > Execute as: Me > Access: Anyone.
   ================================================================ */

var FOLDER_NAME = 'Bala App Data';
var DB_FILE = 'data.json';

/* ---------- storage (with cache layer) ---------- */
var CK = 'db_v1';            // cache key prefix for the database
var CHUNK = 90000;           // CacheService allows ~100 KB per key
function props_() { return PropertiesService.getScriptProperties(); }
function emptyDb_() { return { users: [], projects: {}, updates: [], approvals: [], bills: [], log: [], settings: { waNumber: '' } }; }

function folder_() {
  var P = props_(), id = P.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  P.setProperty('FOLDER_ID', f.getId());
  return f;
}
function mediaFolder_() {
  var P = props_(), id = P.getProperty('MEDIA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var root = folder_();
  var it = root.getFoldersByName('media');
  var f = it.hasNext() ? it.next() : root.createFolder('media');
  P.setProperty('MEDIA_ID', f.getId());
  return f;
}
function dbFile_() {
  var P = props_(), id = P.getProperty('DB_ID');
  if (id) { try { return DriveApp.getFileById(id); } catch (e) {} }
  var it = folder_().getFilesByName(DB_FILE);
  if (!it.hasNext()) return null;
  var f = it.next();
  P.setProperty('DB_ID', f.getId());
  return f;
}
function cacheGet_() {
  try {
    var c = CacheService.getScriptCache();
    var n = c.get(CK + '_n');
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < Number(n); i++) keys.push(CK + '_' + i);
    var got = c.getAll(keys), txt = '';
    for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) return null; txt += got[keys[j]]; }
    return JSON.parse(txt);
  } catch (e) { return null; }
}
function cachePut_(json) {
  try {
    var c = CacheService.getScriptCache(), obj = {}, n = Math.ceil(json.length / CHUNK);
    for (var i = 0; i < n; i++) obj[CK + '_' + i] = json.substr(i * CHUNK, CHUNK);
    obj[CK + '_n'] = String(n);
    c.putAll(obj, 21600);
  } catch (e) { try { CacheService.getScriptCache().remove(CK + '_n'); } catch (e2) {} }
}
function normalize_(db) {
  ['users', 'approvals', 'bills', 'log', 'updates'].forEach(function (k) { if (!db[k]) db[k] = []; });
  if (!db.projects) db.projects = {};
  if (!db.settings) db.settings = { waNumber: '' };
  db.bills.forEach(function (b) {
    if (!b.status) b.status = 'pending';          // older bills go to the review board
    if (!b.fileId && b.file) { var m = String(b.file).match(/[?&]id=([\w-]+)/) || String(b.file).match(/\/d\/([\w-]+)/); b.fileId = m ? m[1] : String(b.file); }
  });
  return db;
}
function load_() {
  var cached = cacheGet_();
  if (cached) return normalize_(cached);
  var f = dbFile_();
  if (!f) return emptyDb_();
  var txt = f.getBlob().getDataAsString(), db;
  try { db = JSON.parse(txt); } catch (e) { return emptyDb_(); }
  cachePut_(txt);
  return normalize_(db);
}
function save_(db) {
  var json = JSON.stringify(db);
  var f = dbFile_();
  if (f) f.setContent(json);
  else { var nf = folder_().createFile(DB_FILE, json, MimeType.PLAIN_TEXT); props_().setProperty('DB_ID', nf.getId()); }
  cachePut_(json);          // write-through: next read is instant
}
function storeFile_(name, mime, b64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
  var f = mediaFolder_().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getId();
}
function fileUrl_(id) { return id ? 'https://drive.usercontent.google.com/download?id=' + id + '&export=view' : ''; }

/* ---------- auth ---------- */
function tokenFor_(userId) {
  var t = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('t_' + t, userId, 21600); // 6 h
  return t;
}
function userFor_(db, token) {
  if (!token) return null;
  var uid = CacheService.getScriptCache().get('t_' + token);
  if (!uid) return null;
  for (var i = 0; i < db.users.length; i++) if (db.users[i].id === uid) return db.users[i];
  return null;
}
function require_(db, token, roles) {
  var u = userFor_(db, token);
  if (!u) throw 'Sign in again.';
  if (roles && roles.indexOf(u.role) < 0) throw 'Not allowed for your login.';
  return u;
}
function uid_(p) { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function logIt_(db, actor, projectId, action, detail) {
  db.log.push({ ts: Date.now(), actor: actor, projectId: projectId || '', action: action, detail: detail || '' });
  if (db.log.length > 2000) db.log = db.log.slice(-2000);
}

/* ---------- state shaping per role ---------- */
function stateFor_(db, u) {
  var out = { me: { id: u.id, name: u.name, role: u.role, username: u.username }, settings: db.settings, projects: {}, updates: [], approvals: [] };
  var ids = u.role === 'admin' ? Object.keys(db.projects) : (u.projectIds || []);
  ids.forEach(function (pid) { if (db.projects[pid]) out.projects[pid] = db.projects[pid]; });
  out.updates = db.updates.filter(function (x) { return out.projects[x.projectId]; });
  out.approvals = db.approvals.filter(function (x) { return out.projects[x.projectId]; });
  if (u.role === 'pm') out.bills = db.bills.filter(function (b) { return b.byId === u.id || (!b.byId && b.by === u.name); });
  if (u.role === 'admin') {
    out.bills = db.bills;
    out.log = db.log.slice(-400).reverse();
    out.users = db.users.map(function (x) { return { id: x.id, username: x.username, name: x.name, role: x.role, projectIds: x.projectIds || [], phone: x.phone || '' }; });
  }
  return out;
}

/* ---------- entry points ---------- */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'bala-backend', time: Date.now() }))
    .setMimeType(ContentService.MimeType.JSON);
}
var READ_ONLY_ = { login: 1, state: 1 };
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'Bad request.' }); }
  var readOnly = READ_ONLY_[req.action] === 1;
  var lock = null;
  try {
    if (!readOnly) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    var db = load_();
    var res = handle_(db, req);
    if (!readOnly) save_(db);
    return out_(res);
  } catch (err) {
    if (!readOnly) { try { CacheService.getScriptCache().remove(CK + '_n'); } catch (e2) {} }  // drop cache after a failed write
    return out_({ ok: false, error: String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function handle_(db, req) {
  var a = req.action;

  if (a === 'login') {
    for (var i = 0; i < db.users.length; i++) {
      var u = db.users[i];
      if (u.username.toLowerCase() === String(req.username || '').trim().toLowerCase() && u.pass === req.pass) {
        return { ok: true, token: tokenFor_(u.id), state: stateFor_(db, u) };
      }
    }
    throw 'Wrong ID or password.';
  }

  if (a === 'bootstrap') {
    // one-time: create the first admin. Refuses once any user exists.
    if (db.users.length) throw 'Already set up.';
    if (!req.name || !req.username || !req.pass) throw 'Name, ID and password are needed.';
    var admin = { id: uid_('u'), username: String(req.username).trim(), pass: String(req.pass), role: 'admin', name: String(req.name).trim(), projectIds: [], phone: '' };
    db.users.push(admin);
    if (req.waNumber) db.settings.waNumber = String(req.waNumber);
    logIt_(db, admin.name, '', 'set up the app', 'Admin account created');
    return { ok: true, token: tokenFor_(admin.id), state: stateFor_(db, admin) };
  }

  var u = require_(db, req.token, null);

  if (a === 'state') return { ok: true, state: stateFor_(db, u) };

  /* ----- settings ----- */
  if (a === 'saveSettings') {
    require_(db, req.token, ['admin']);
    if (req.waNumber != null) db.settings.waNumber = String(req.waNumber).trim();
    return { ok: true, state: stateFor_(db, u) };
  }

  /* ----- users (admin) ----- */
  if (a === 'addUser') {
    require_(db, req.token, ['admin']);
    if (!req.name || !req.username || !req.pass || !req.role) throw 'Name, ID, password and role are needed.';
    if (['admin', 'pm', 'customer'].indexOf(req.role) < 0) throw 'Role must be admin, pm or customer.';
    for (var i = 0; i < db.users.length; i++)
      if (db.users[i].username.toLowerCase() === String(req.username).trim().toLowerCase()) throw 'That ID is already taken.';
    var nu = { id: uid_('u'), username: String(req.username).trim(), pass: String(req.pass), role: req.role, name: String(req.name).trim(), projectIds: req.projectIds || [], phone: req.phone || '' };
    db.users.push(nu);
    logIt_(db, u.name, '', 'added a login', nu.name + ' (' + req.role + ')');
    return { ok: true, state: stateFor_(db, u) };
  }
  if (a === 'updateUser') {
    require_(db, req.token, ['admin']);
    var tu = null;
    for (var i = 0; i < db.users.length; i++) if (db.users[i].id === req.userId) tu = db.users[i];
    if (!tu) throw 'Login not found.';
    if (req.name) tu.name = String(req.name).trim();
    if (req.pass) tu.pass = String(req.pass);
    if (req.projectIds) tu.projectIds = req.projectIds;
    if (req.phone != null) tu.phone = String(req.phone);
    logIt_(db, u.name, '', 'updated a login', tu.name);
    return { ok: true, state: stateFor_(db, u) };
  }
  if (a === 'deleteUser') {
    require_(db, req.token, ['admin']);
    if (req.userId === u.id) throw 'You cannot delete your own login.';
    db.users = db.users.filter(function (x) { return x.id !== req.userId; });
    logIt_(db, u.name, '', 'removed a login', req.userId);
    return { ok: true, state: stateFor_(db, u) };
  }

  /* ----- projects (admin) ----- */
  if (a === 'addProject') {
    require_(db, req.token, ['admin']);
    if (!req.name) throw 'Project name is needed.';
    var pid = uid_('p');
    db.projects[pid] = {
      id: pid, name: String(req.name).trim(), loc: req.loc || '', type: req.type || '',
      customers: req.customers || [], pm: req.pm || '', progress: 0,
      cover: req.coverB64 ? fileUrl_(storeFile_('cover-' + pid + '.jpg', req.coverMime || 'image/jpeg', req.coverB64)) : ''
    };
    logIt_(db, u.name, pid, 'added a project', req.name);
    return { ok: true, projectId: pid, state: stateFor_(db, u) };
  }
  if (a === 'updateProject') {
    require_(db, req.token, ['admin']);
    var p = db.projects[req.projectId];
    if (!p) throw 'Project not found.';
    ['name', 'loc', 'type', 'pm'].forEach(function (k) { if (req[k] != null) p[k] = String(req[k]); });
    if (req.customers) p.customers = req.customers;
    if (req.progress != null) p.progress = Number(req.progress);
    if (req.coverB64) p.cover = fileUrl_(storeFile_('cover-' + p.id + '-' + Date.now() + '.jpg', req.coverMime || 'image/jpeg', req.coverB64));
    logIt_(db, u.name, p.id, 'updated project details', p.name);
    return { ok: true, state: stateFor_(db, u) };
  }
  if (a === 'deleteProject') {
    require_(db, req.token, ['admin']);
    delete db.projects[req.projectId];
    db.updates = db.updates.filter(function (x) { return x.projectId !== req.projectId; });
    db.approvals = db.approvals.filter(function (x) { return x.projectId !== req.projectId; });
    db.bills = db.bills.filter(function (x) { return x.projectId !== req.projectId; });
    logIt_(db, u.name, '', 'removed a project', req.projectId);
    return { ok: true, state: stateFor_(db, u) };
  }

  /* ----- updates (pm or admin) ----- */
  if (a === 'postUpdate') {
    require_(db, req.token, ['pm', 'admin']);
    var p2 = db.projects[req.projectId];
    if (!p2) throw 'Project not found.';
    if (!req.note) throw 'Write a short note.';
    var photos = [];
    (req.photos || []).forEach(function (ph, i) {
      photos.push(fileUrl_(storeFile_('update-' + Date.now() + '-' + i + '.jpg', ph.mime || 'image/jpeg', ph.b64)));
    });
    var pct = req.progressPct != null ? Number(req.progressPct) : null;
    db.updates.push({ id: uid_('u'), projectId: p2.id, type: req.type === 'material' ? 'material' : 'progress', author: u.name, note: String(req.note), photos: photos, progressPct: pct, ts: Date.now() });
    if (pct != null) p2.progress = pct;
    logIt_(db, u.name, p2.id, req.type === 'material' ? 'logged a material delivery' : 'posted a progress update', String(req.note).slice(0, 70));
    return { ok: true, state: stateFor_(db, u) };
  }

  /* ----- approvals ----- */
  if (a === 'requestApproval') {
    require_(db, req.token, ['pm', 'admin']);
    var p3 = db.projects[req.projectId];
    if (!p3) throw 'Project not found.';
    if (!req.title) throw 'Add what the customer should decide.';
    var aphotos = [];
    (req.photos || []).forEach(function (ph, i) {
      aphotos.push(fileUrl_(storeFile_('approval-' + Date.now() + '-' + i + '.jpg', ph.mime || 'image/jpeg', ph.b64)));
    });
    var ap = { id: uid_('a'), projectId: p3.id, title: String(req.title).trim(), detail: req.detail || 'Please review and respond.', photos: aphotos, options: req.options || [], status: 'pending', comment: '', decidedBy: '', ts: Date.now(), decidedTs: null };
    db.approvals.push(ap);
    logIt_(db, u.name, p3.id, 'requested an approval', ap.title);
    return { ok: true, approval: ap, state: stateFor_(db, u) };
  }
  if (a === 'decide') {
    var ap2 = null;
    for (var i = 0; i < db.approvals.length; i++) if (db.approvals[i].id === req.approvalId) ap2 = db.approvals[i];
    if (!ap2) throw 'Approval not found.';
    if (ap2.status !== 'pending') throw 'Already decided.';
    var p4 = db.projects[ap2.projectId];
    // customer must belong to the project; pm/admin may also record a decision
    ap2.status = req.status === 'approved' ? 'approved' : 'rejected';
    ap2.decidedTs = Date.now();
    ap2.decidedBy = u.name;
    ap2.comment = (req.choice ? req.choice + '. ' : '') + (req.comment || '');
    logIt_(db, u.name, ap2.projectId, ap2.status === 'approved' ? 'approved' : 'asked for changes on', ap2.title + (ap2.comment ? ': "' + ap2.comment + '"' : ''));
    return { ok: true, approval: ap2, projectName: p4 ? p4.name : '', state: stateFor_(db, u) };
  }

  /* ----- bills ----- */
  if (a === 'addBill') {
    require_(db, req.token, ['pm', 'admin']);
    var p5 = db.projects[req.projectId];
    if (!p5) throw 'Project not found.';
    if (!req.vendor) throw 'Add the vendor name.';
    if (!(Number(req.amount) > 0)) throw 'Add the bill amount.';
    var fid = req.fileB64 ? storeFile_('bill-' + Date.now() + '-' + (req.fileName || 'bill'), req.fileMime || 'application/pdf', req.fileB64) : '';
    db.bills.push({ id: uid_('b'), projectId: p5.id, vendor: String(req.vendor).trim(), no: req.no || '', amount: Number(req.amount), date: req.date || new Date().toISOString().slice(0, 10), note: req.note || '', file: fid, fileId: fid, fileName: req.fileName || '', status: 'pending', adminNote: '', by: u.name, byId: u.id, ts: Date.now() });
    logIt_(db, u.name, p5.id, 'added a bill', req.vendor + ' · Rs.' + Number(req.amount).toLocaleString('en-IN') + ' (sent for admin review)');
    return { ok: true, state: stateFor_(db, u) };
  }
  if (a === 'reviewBill') {
    require_(db, req.token, ['admin']);
    var rb = null;
    for (var i = 0; i < db.bills.length; i++) if (db.bills[i].id === req.billId) rb = db.bills[i];
    if (!rb) throw 'Bill not found.';
    if (req.decision === 'approved') {
      rb.status = 'approved';
      rb.adminNote = req.note ? String(req.note) : rb.adminNote;
      rb.reviewedTs = Date.now();
      logIt_(db, u.name, rb.projectId, 'approved a bill', rb.vendor + ' · Rs.' + rb.amount.toLocaleString('en-IN') + ' (moved to the project)');
    } else if (req.decision === 'addons') {
      if (!req.note) throw 'Say what add-on is needed (document, detail or correction).';
      rb.status = 'addons';
      rb.adminNote = String(req.note);
      rb.reviewedTs = Date.now();
      logIt_(db, u.name, rb.projectId, 'asked for add-ons on a bill', rb.vendor + ': "' + rb.adminNote + '"');
    } else throw 'Unknown decision.';
    return { ok: true, state: stateFor_(db, u) };
  }
  if (a === 'resubmitBill') {
    // PM (owner of the bill) or admin sends an add-on / corrected file back for review
    var ru = require_(db, req.token, ['pm', 'admin']);
    var sb = null;
    for (var i = 0; i < db.bills.length; i++) if (db.bills[i].id === req.billId) sb = db.bills[i];
    if (!sb) throw 'Bill not found.';
    if (ru.role === 'pm' && sb.byId !== ru.id && sb.by !== ru.name) throw 'Not your bill.';
    if (sb.status === 'approved') throw 'This bill is already approved.';
    if (req.note) sb.note = (sb.note ? sb.note + '\n' : '') + 'Add-on: ' + String(req.note);
    if (req.fileB64) { var nid = storeFile_('bill-' + Date.now() + '-' + (req.fileName || 'addon'), req.fileMime || 'application/pdf', req.fileB64); sb.file = nid; sb.fileId = nid; sb.fileName = req.fileName || ''; }
    sb.status = 'pending';
    logIt_(db, u.name, sb.projectId, 'sent a bill back for review', sb.vendor + (req.note ? ': "' + String(req.note).slice(0, 60) + '"' : ''));
    return { ok: true, state: stateFor_(db, u) };
  }

  throw 'Unknown action: ' + a;
}
