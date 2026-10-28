/* ============ Brightlook Homes live app (API client) ============ */
const DAY = 864e5, HOUR = 36e5, MIN = 6e4;
const DEFAULT_BRAND = 'Brightlook Homes';
var API_URL = window.API_URL || '';
let S = null, LAST = '', STATE_CHANGED = false;
let TOKEN = localStorage.getItem('bala.token') || '';
let OUTBOX = [];
let PH = {}, PHN = 0;
let tlOrder = localStorage.getItem('bl.order') || 'new';
let payProj = '';

if (TOKEN) {
    try {
        const c = localStorage.getItem('bl.state');
        if (c) { S = JSON.parse(c); LAST = c; }
    } catch (e) { S = null; }
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rel(ts) {
    const d = Date.now() - ts;
    if (d < MIN) return 'just now';
    if (d < HOUR) return Math.floor(d / MIN) + ' min ago';
    if (d < DAY) return Math.floor(d / HOUR) + (d < 2 * HOUR ? ' hr ago' : ' hrs ago');
    if (d < 7 * DAY) return Math.floor(d / DAY) + (d < 2 * DAY ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fullTime(ts) {
    return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDate(s) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(s + 'T00:00:00') : new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function rupee(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }
function initials(n) { return String(n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function projectName(id) { const p = S && S.projects[id]; return p ? p.name : '-'; }
function go(h) { location.hash = h; }
function home() { return S.me.role === 'admin' ? '#/admin' : S.me.role === 'pm' ? '#/pm' : '#/customer'; }

let toastT;
function toast(msg) {
    clearTimeout(toastT);
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    toastT = setTimeout(() => t.remove(), 2800);
}

const app = document.getElementById('app'), overlayRoot = document.getElementById('overlay-root');
const navRoot = document.createElement('div');
navRoot.id = 'nav-root';
document.body.appendChild(navRoot);

function brand() { return (S && S.settings && S.settings.brandName) || localStorage.getItem('bl.brand') || DEFAULT_BRAND; }
function brandHtml() {
    const w = brand().split(' '), last = w.length > 1 ? w.pop() : '';
    return esc(w.join(' ')) + (last ? ` <span>${esc(last)}</span>` : '');
}

function setState(s) {
    s.payments = s.payments || [];
    S = s;
    const j = JSON.stringify(s);
    STATE_CHANGED = (j !== LAST);
    LAST = j;
    try { localStorage.setItem('bl.state', j); } catch (e) {}
    if (s.settings && s.settings.brandName) {
        try { localStorage.setItem('bl.brand', s.settings.brandName); } catch (e) {}
    }
}

function cacheState() {
    try { const j = JSON.stringify(S); LAST = j; localStorage.setItem('bl.state', j); } catch (e) {}
}

function upsert(arr, item) {
    const i = arr.findIndex(x => x.id === item.id);
    if (i >= 0) arr[i] = item; else arr.push(item);
}

function topbar(crumb, back) {
    return `<div class="topbar">
        ${back ? `<a class="back" href="${back}" aria-label="Back">‹ Back</a>` : ''}
        <div class="wordmark">${brandHtml()}</div>
        ${S ? `<span class="user-pill">${esc(S.me.name)} &bull; ${esc(S.me.role === 'pm' ? 'Project Manager' : S.me.role)}</span><button class="role-switch" onclick="logout()">Log out</button>` : ''}
        ${crumb ? `<div class="crumb">${crumb}</div>` : ''}
    </div>`;
}

function updateNav(h) {
    let items = [];
    if (S && h) {
        const role = S.me.role, parts = h.split('/');
        if (h.startsWith('#/project/') && (role === 'customer' || role === 'admin')) {
            const pid = parts[2], tab = parts[3] || 'updates';
            const pend = S.approvals.filter(a => a.projectId === pid && a.status === 'pending').length;
            items = [
                { h: '#/project/' + pid, l: 'Updates', on: tab === 'updates' },
                { h: '#/project/' + pid + '/approvals', l: 'Approvals', b: pend, on: tab === 'approvals' },
                { h: '#/project/' + pid + '/payments', l: 'Payments', on: tab === 'payments' }
            ];
        } else if (role === 'admin' && /^#\/admin(\/(payments|projects|users))?$/.test(h)) {
            items = [
                { h: '#/admin', l: 'Home', on: h === '#/admin' },
                { h: '#/admin/payments', l: 'Payments', on: h === '#/admin/payments' },
                { h: '#/admin/projects', l: 'Projects', on: h === '#/admin/projects' },
                { h: '#/admin/users', l: 'Logins', on: h === '#/admin/users' }
            ];
        }
    }
    navRoot.innerHTML = items.length ? `<nav class="tabbar">${items.map(i => `<button class="${i.on ? 'on' : ''}" onclick="go('${i.h}')">${i.l}${i.b ? `<span class="dot">${i.b}</span>` : ''}</button>`).join('')}</nav>` : '';
}

function showSkeleton() {
    app.innerHTML = '<div class="card empty" style="margin-top:20vh">Loading securely...</div>';
}

function chipFor(status) {
    if (status === 'pending') return '<span class="chip amber">Awaiting customer</span>';
    if (status === 'approved') return '<span class="chip green">Approved</span>';
    return '<span class="chip red">Changes requested</span>';
}
function typeChip(t) { return t === 'material' ? '<span class="chip blue">Material delivery</span>' : '<span class="chip grey">Progress</span>'; }

function mediaUrl(p) {
    const m = String(p || '').match(/[?&]id=([\w-]+)/) || String(p || '').match(/\/d\/([\w-]+)/);
    return m ? ('https://lh3.googleusercontent.com/d/' + m[1]) : p;
}

function regPH(photos) {
    const k = 'k' + (PHN++);
    PH[k] = photos.map(mediaUrl);
    return k;
}

const IMG_ATTR = 'loading="lazy" alt="Site photo" onload="this.classList.add(\'ld\')" onerror="this.classList.add(\'ld\')"';

function photosHtml(photos) {
    if (!photos || !photos.length) return '';
    const k = regPH(photos), n = Math.min(photos.length, 4);
    return `<div class="photo-grid n${n}">${photos.slice(0, 4).map((p, i) => `<img ${IMG_ATTR} src="${mediaUrl(p)}" onclick="openPhotos('${k}', ${i})">`).join('')}</div>`;
}

function openPhotos(k, i) {
    const slides = PH[k] || [];
    if (!slides.length) return;
    overlayRoot.innerHTML = `<div class="lb" onclick="closeOverlay()">
        <button onclick="closeOverlay()">Close</button>
        <img src="${slides[i]}" alt="Fullscreen photo" onclick="event.stopPropagation()">
    </div>`;
}

function closeOverlay() { overlayRoot.innerHTML = ''; }

function firstPhoto(pid) {
    const p = S.projects[pid];
    if (p && p.cover) return mediaUrl(p.cover);
    const u = updatesFor(pid).filter(u => u.photos && u.photos.length).sort((a, b) => a.ts - b.ts)[0];
    return u ? mediaUrl(u.photos[0]) : '';
}

function waNum() { return (S && S.settings && S.settings.waNumber) || '916303115658'; }
function waLink(text) { return 'https://wa.me/' + waNum().replace(/\D/g, '') + '?text=' + encodeURIComponent(text); }
function appLink(h) { return location.origin + location.pathname + h; }

function showWaMsg(o) {
    const t = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    const real = waLink(o.plain + (o.plainSuffix || ''));
    overlayRoot.innerHTML = `<div class="lb" style="z-index:999" onclick="if(event.target===this)closeWa('${o.after || ''}')">
        <div class="card" style="width: min(380px, 100%); padding:24px; position: relative;">
            <h3 style="margin-bottom:12px; font-weight:800;">Send via WhatsApp</h3>
            <p style="font-size:14px; margin-bottom:16px; white-space:pre-wrap; background:#F3F4F6; padding:12px; border-radius:8px;">${o.plain}</p>
            <a href="${real}" target="_blank" rel="noopener" class="btn wa block" onclick="closeWa('${o.after || ''}')">Open WhatsApp</a>
            <button class="btn ghost block" style="margin-top:10px" onclick="closeWa('${o.after || ''}')">Close</button>
        </div>
    </div>`;
}

function closeWa(after) {
    overlayRoot.innerHTML = '';
    if (after && location.hash !== after) go(after); else render();
}

async function api(req) {
    if (!API_URL) throw 'App is still being set up.';
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 60000);
    let r;
    try {
        r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(req), signal: ctl.signal });
    } catch (e) {
        throw 'No connection. Check your internet and try again.';
    } finally {
        clearTimeout(to);
    }
    const j = await r.json();
    if (!j.ok) throw j.error || 'Something went wrong.';
    if (j.state) setState(j.state);
    return j;
}

async function apiBusy(btn, req) {
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }
    try {
        return typeof req === 'function' ? await req() : await api(req);
    } catch (e) {
        toast(String(e)); return null;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = old; }
    }
}

function fileToB64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res({ b64: String(r.result).split(',')[1], mime: file.type || 'image/jpeg' });
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

function fileToPhoto(file, M, q) {
    M = M || 1280; q = q || 0.72;
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
            let w = img.naturalWidth, h = img.naturalHeight;
            if (w > M || h > M) {
                const k = 1 / Math.max(w, h);
                w = Math.round(w * k); h = Math.round(h * k);
            }
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(img.src);
            res({ b64: c.toDataURL('image/jpeg', q).split(',')[1], mime: 'image/jpeg' });
        };
        img.onerror = () => { URL.revokeObjectURL(img.src); rej('Could not read image'); };
        img.src = URL.createObjectURL(file);
    });
}

function viewLogin() {
    app.innerHTML = `<div style="max-width:420px; margin:8vh auto 0">
        <div class="wordmark" id="lg-brand">${brandHtml()}</div>
        <div class="hero" style="padding:16px 0 24px">
            <h1 style="font-size:28px" id="lg-title">Welcome to ${esc(brand())}</h1>
            <p>Sign in to see your site updates, approvals and payments.</p>
        </div>
        <div class="card" style="padding: 24px">
            <form onsubmit="doLogin(this); return false">
                <div class="field"><label>ID</label><input type="text" id="lg-id" autocomplete="username" autocapitalize="none" placeholder="Your ID"></div>
                <div class="field"><label>Password</label><input type="password" id="lg-pw" autocomplete="current-password" placeholder="Password"></div>
                <div class="err" id="lg-err" style="color:var(--red); font-size:14px; margin-bottom:12px; font-weight:600;"></div>
                <button class="btn primary block" type="submit">Sign in</button>
            </form>
        </div>
        <div style="text-align:center; margin-top:20px;"><a href="#/setup" style="color:var(--muted)">First time? Set up the app</a></div>
    </div>`;
    if (API_URL) api({ action: 'public' }).then(j => {
        if (j.brandName && j.brandName !== brand()) { try { localStorage.setItem('bl.brand', j.brandName); } catch (e) {} }
        const t = document.getElementById('lg-title'), b = document.getElementById('lg-brand');
        if (t) t.textContent = 'Welcome to ' + j.brandName;
        if (b) b.innerHTML = brandHtml();
        document.title = j.brandName + ' Updates';
    }).catch(() => {});
}

async function doLogin() {
    const username = document.getElementById('lg-id').value, pass = document.getElementById('lg-pw').value;
    const j = await apiBusy(document.querySelector('.btn'), { action: 'login', username, pass });
    if (!j) return document.getElementById('lg-err').textContent = 'Wrong ID or password.';
    TOKEN = j.token; localStorage.setItem('bala.token', TOKEN);
    go(home());
}

function logout() {
    TOKEN = ''; localStorage.removeItem('bala.token'); localStorage.removeItem('bl.state');
    LAST = ''; S = null; OUTBOX = []; go('#/login'); render();
}

function viewSetup() {
    app.innerHTML = `<div style="max-width:420px; margin:8vh auto 0">
        <div class="wordmark">${brandHtml()}</div>
        <div class="hero" style="padding:0 0 14px"><h1 style="font-size:24px">First-time setup</h1><p>Create the admin login. This works only once.</p></div>
        <div class="card" style="padding:18px"><form onsubmit="doSetup(this); return false">
        <div class="field"><label>Your name</label><input type="text" id="su-name" placeholder="e.g. Bala"></div>
        <div class="field"><label>Choose an admin ID</label><input type="text" id="su-id" autocapitalize="none" placeholder="e.g. admin"></div>
        <div class="field"><label>Choose a password</label><input type="password" id="su-pw" placeholder="Password"></div>
        <div class="field"><label>WhatsApp number (with country code)</label><input type="tel" id="su-wa" placeholder="e.g. 9163XXXXXXXX"></div>
        <div class="err" id="su-err" style="color:var(--red); font-weight:600; margin-bottom:10px;"></div>
        <button class="btn primary block" type="submit">Create admin &amp; start</button></form></div>
    </div>`;
}

async function doSetup(form) {
    const btn = form.querySelector('.btn');
    const j = await apiBusy(btn, {action: 'bootstrap', name: document.getElementById('su-name').value, username: document.getElementById('su-id').value, pass: document.getElementById('su-pw').value, waNumber: document.getElementById('su-wa').value});
    if(!j) return document.getElementById('su-err').textContent = 'Setup failed - app may already be set up.';
    TOKEN = j.token; localStorage.setItem('bala.token', TOKEN);
    toast('Admin created - welcome'); go('#/admin');
}

function updatesFor(pid) {
    return S.updates.filter(u => u.projectId === pid).concat(OUTBOX.filter(j => j.tmp.projectId === pid).map(j => j.tmp));
}

function tlCard(u, idx) {
    const st = u._state;
    return `<div style="margin-bottom:24px; animation-delay: ${Math.min(idx, 8) * 45}ms">
        <div style="color:var(--muted); font-size:13px; font-weight:600; margin-bottom:8px; display:flex; justify-content:space-between;">
            <span>${fullTime(u.ts)}</span> <span>${rel(u.ts)}</span>
        </div>
        <div class="card update-card ${st === 'failed' ? 'failed' : ''}">
            <div class="update-head">
                <div class="avatar">${initials(u.author)}</div>
                <div><div style="font-weight:700;">${esc(u.author)}</div></div>
                <div style="margin-left:auto">${typeChip(u.type)}</div>
            </div>
            <div class="update-body">
                ${u.progressPct != null ? `<div style="display:flex; align-items:center; gap:12px; margin:12px 0;"><div class="progress" style="flex:1"><i style="width:${u.progressPct}%"></i></div><b style="font-size:14px">${u.progressPct}%</b></div>` : ''}
                <div class="note">${esc(u.note)}</div>
                ${photosHtml(u.photos)}
                ${st === 'failed' ? `<div style="display:flex; gap:8px; margin-top:12px"><button class="btn primary sm" onclick="retryPost('${u.id}')">Retry</button><button class="btn ghost sm" onclick="discardPost('${u.id}')">Discard</button></div>` : ''}
            </div>
        </div>
    </div>`;
}

function setOrder(o) { tlOrder = o; localStorage.setItem('bl.order', o); render(true); }

function approvalCard(a, customerView) {
    return `<div class="card approval-card"><div class="body">
        <div style="display: flex; align-items:center; gap:8px; flex-wrap:wrap"><span class="chip amber">Approval request</span>${chipFor(a.status)}</div>
        <h3 style="margin-top:12px">${esc(a.title)}</h3>
        <div class="ask">${esc(a.detail)}</div>
        ${photosHtml(a.photos)}
        ${a.options && a.options.length ? `<div style="margin:16px 0 8px">${a.options.map(o => `<div style="padding:10px 14px; border:1.5px solid var(--line); border-radius:8px; margin-bottom:8px; font-weight:600; background:#fff">${esc(o)}</div>`).join('')}</div>` : ''}
        ${a.status === 'pending'
            ? (customerView ? `<div class="decision-bar"><button class="btn primary block" onclick="go('#/approve/${a.id}')">Review & respond</button></div>`
                : `<div style="margin-top:12px; color:var(--muted); font-size:13px; font-weight:600;">Waiting on customer &bull; sent ${rel(a.ts)}</div>`)
            : `<div style="margin-top:16px; font-size:14px; padding:12px; background:#F9FAFB; border-radius:8px;"><b>${esc(a.decidedBy || 'Customer')}</b> ${a.status === 'approved' ? 'approved' : 'asked for changes'} ${rel(a.decidedTs)}${a.comment ? `<br><br>"${esc(a.comment)}"` : ''}</div>`
        }
    </div></div>`;
}

function viewPM() {
    const myProjects = Object.values(S.projects);
    const cards = myProjects.map(p => {
        const pend = S.approvals.filter(a => a.projectId === p.id && a.status === 'pending').length;
        return `<div class="card proj-card">
            ${p.cover ? `<div class="cover" style="background-image:url('${mediaUrl(p.cover)}')"><span class="pct">${p.progress}% complete</span></div>` : ''}
            <div class="body"><h3>${esc(p.name)}</h3><div class="proj-meta">${esc(p.loc)} ${p.type ? ' &bull; ' + esc(p.type) : ''}<br>Customer: ${esc((p.customers||[]).join(' & '))}</div>
            <div class="progress"><i style="width:${p.progress}%"></i></div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:4px; flex-wrap:wrap;">
            ${pend ? `<span class="chip amber">${pend} approval${pend > 1 ? 's' : ''} pending</span>` : `<span class="chip green">Nothing pending</span>`}
            <button class="btn primary sm" style="margin-left:auto" onclick="go('#/pm/post/${p.id}')">+ Post update</button>
            <button class="btn ghost sm" onclick="go('#/project/${p.id}')">View</button></div></div></div>`;
    }).join('');

    app.innerHTML = `${topbar('Project Manager view')}
    <div class="hero" style="padding-top: 10px"><h1>Namaste, ${esc(S.me.name.split(' ')[0])}</h1><p>Post an update instantly.</p></div>
    <div class="card" style="padding: 14px 16px; margin-bottom:14px; display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1; min-width:200px"><b>Bills &amp; invoices</b><div style="color:var(--muted); font-size:13px">Add vendor bills.</div></div>
        <button class="btn primary sm" onclick="go('#/pm/bill')">+ Add bill</button>
    </div>
    ${myBillsHtml()}
    ${myProjects.length ? `<div class="section-label">Your projects</div><div class="grid proj-grid">${cards}</div>` : `<div class="card empty">No projects assigned.</div>`}`;
}

let draft = { type: 'progress', photos: [] };
function viewPMPost(pid) {
    const p = S.projects[pid]; if (!p) return viewPM();
    draft = { type: 'progress', photos: [] };
    app.innerHTML = `${topbar('Project Manager view', '#/pm')}
    <div class="hero" style="padding: 14px 0 4px"><h1 style="font-size:22px">Post an update</h1><p>${esc(p.name)} &bull; ${esc(p.loc)}</p></div>
    <div class="card" style="padding: 18px; margin-top: 10px">
        <div class="field"><label>Update type</label>
            <div class="seg" id="seg">
                <button class="on" data-t="progress" onclick="setType('progress')">Progress</button>
                <button data-t="material" onclick="setType('material')">Material</button>
                <button data-t="approval" onclick="setType('approval')">Approval</button>
            </div>
        </div>
        <div class="field" id="f-progress"><label>Overall progress</label>
            <div style="display:flex; align-items:center; gap:12px;">
                <input type="range" id="inp-pct" min="0" max="100" value="${p.progress}" oninput="document.getElementById('pct-val').textContent = this.value + '%'" style="flex:1;">
                <div style="font-weight:800; font-size:18px; min-width:52px; text-align:right;" id="pct-val">${p.progress}%</div>
            </div>
        </div>
        <div id="f-approval" style="display:none">
            <div class="field"><label>What should the customer decide?</label><input type="text" id="inp-title" placeholder="e.g. Kitchen countertop material"></div>
            <div class="field"><label>Options (one per line)</label><textarea id="inp-options" style="min-height:70px" placeholder="Black Galaxy (within BOQ)\nTan Brown (+180/sqft)"></textarea></div>
        </div>
        <div class="field"><label id="note-label">Note for the customer</label><textarea id="inp-note" placeholder="What happened on site today?"></textarea></div>
        <div class="field"><label>Photos (up to 4)</label>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px;" id="gal">
                <label style="display:flex; align-items:center; justify-content:center; background:#F3F4F6; color:var(--muted); font-size:26px; cursor:pointer; border-radius:10px; aspect-ratio:1;">+<input type="file" accept="image/*" multiple hidden onchange="uploadPhotos(this)"></label>
            </div>
        </div>
        <button class="btn primary block" onclick="submitUpdate(this, '${pid}')">Post update</button>
    </div>`;
}

function setType(t) {
    draft.type = t;
    document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    document.getElementById('f-progress').style.display = (t === 'progress') ? '' : 'none';
    document.getElementById('f-approval').style.display = (t === 'approval') ? '' : 'none';
    document.getElementById('note-label').textContent = (t === 'approval') ? 'Details for the customer' : 'Note for the customer';
}

function uploadPhotos(input) {
    const room = 4 - draft.photos.length;
    const files = [...input.files].slice(0, room); input.value = '';
    files.forEach(f => {
        const ph = { preview: URL.createObjectURL(f), fileId: '', failed: false };
        draft.photos.push(ph);
        const g = document.createElement('div');
        g.style.backgroundImage = `url('${ph.preview}')`;
        g.style.backgroundSize = 'cover';
        g.style.backgroundPosition = 'center';
        g.style.borderRadius = '10px';
        g.style.aspectRatio = '1';
        g.style.cursor = 'pointer';
        g.onclick = () => { const i = draft.photos.indexOf(ph); if (i >= 0) draft.photos.splice(i, 1); g.remove(); };
        document.getElementById('gal').appendChild(g);
        
        ph.p = (async () => {
            try {
                const b = await fileToPhoto(f);
                for (let t = 0; t < 2 && !ph.fileId; t++) {
                    try { const j = await api({ action: 'uploadPhoto', token: TOKEN, b64: b.b64, mime: b.mime }); ph.fileId = j.fileId; } 
                    catch (e) { if (t === 1) throw e; }
                }
            } catch (e) { ph.failed = true; g.style.opacity = '0.5'; }
        })();
    });
}

async function submitUpdate(btn, pid) {
    const note = document.getElementById('inp-note').value.trim();
    const p = S.projects[pid];
    if (draft.type === 'approval') {
        const title = document.getElementById('inp-title').value.trim();
        if (!title) return toast('Add what the customer should decide');
        const options = document.getElementById('inp-options').value.split('\n').map(s => s.trim()).filter(Boolean);
        const photos = draft.photos.slice();
        
        const j = await apiBusy(btn, async () => {
            await Promise.all(photos.map(x => x.p));
            return api({ action: 'requestApproval', token: TOKEN, lite: true, projectId: pid, title, detail: note || 'Please review and respond.', options, photoIds: photos.filter(x => x.fileId).map(x => x.fileId) });
        });
        
        if (!j) return;
        const a = j.approval; upsert(S.approvals, a); cacheState();
        const link = appLink('#/approve/' + a.id);
        
        showWaMsg({
            to: (p.customers || ['customer'])[0],
            plain: `Approval needed - ${p.name}\n\n${p.pm || 'Your site team'} requests your decision:\n${a.title}\n\n${a.detail}\n\nReview and respond: ${link}`,
            btn: 'Review & respond', href: '#/approve/' + a.id, after: '#/project/' + pid
        });
    } else {
        if (!note) return toast('Write a short note');
        const pct = draft.type === 'progress' ? parseInt(document.getElementById('inp-pct').value) : null;
        const photos = draft.photos.filter(x => !x.failed);
        if (draft.photos.some(x => x.failed)) toast('A photo failed to upload and was skipped');
        
        const tmp = { id: 'tmp' + Date.now(), projectId: pid, type: draft.type, author: S.me.name, note, photos: photos.map(x => x.preview), progressPct: pct, ts: Date.now(), _state: 'posting' };
        const job = { tmp, photos, req: { action: 'postUpdate', projectId: pid, type: draft.type, note, progressPct: pct } };
        OUTBOX.push(job);
        if (pct != null) p.progress = pct;
        sendJob(job);
        
        showWaMsg({
            to: (p.customers || ['customer'])[0],
            plain: `Site update - ${p.name}\n\n${note}${pct != null ? `\n\nProgress: ${pct}%` : ''}\n\nView project: ${appLink('#/project/' + pid)}`,
            btn: 'View project', href: '#/project/' + pid, after: '#/project/' + pid
        });
    }
}

async function sendJob(job) {
    const pid = job.tmp.projectId;
    try {
        await Promise.all(job.photos.map(x => x.p));
        const ids = job.photos.filter(x => x.fileId).map(x => x.fileId);
        if (ids.length < job.photos.length) toast('Some photos failed to upload');
        const j = await api(Object.assign({}, job.req, { token: TOKEN, lite: true, photoIds: ids }));
        OUTBOX = OUTBOX.filter(x => x !== job);
        if (j.update) upsert(S.updates, j.update);
        if (j.progress != null && S.projects[pid]) S.projects[pid].progress = j.progress;
        cacheState();
    } catch (e) { job.tmp._state = 'failed'; toast('Update not posted. Tap Retry.'); }
    refreshIfOn(pid);
}

function refreshIfOn(pid) { if ((location.hash || '').startsWith('#/project/' + pid) && !overlayRoot.innerHTML) render(true); }
function retryPost(id) { const job = OUTBOX.find(j => j.tmp.id === id); if (!job) return; job.tmp._state = 'posting'; render(true); sendJob(job); }
function discardPost(id) { OUTBOX = OUTBOX.filter(j => j.tmp.id !== id); render(true); }

let billFile = null;
function viewBillForm() {
    billFile = null;
    const opts = Object.values(S.projects).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    app.innerHTML = `${topbar('Project Manager view', '#/pm')}
    <div class="hero" style="padding: 14px 0 4px"><h1 style="font-size:22px">Add bill / invoice</h1><p>Goes to the admin for review.</p></div>
    <div class="card" style="padding: 18px; margin-top:10px">
        <div class="field"><label>Project</label><select id="b-proj">${opts}</select></div>
        <div class="field"><label>Vendor / supplier</label><input type="text" id="b-vendor" placeholder="e.g. Sri Lakshmi Cement Traders"></div>
        <div class="field"><label>Bill / invoice no.</label><input type="text" id="b-no" placeholder="e.g. INV-2041"></div>
        <div class="field"><label>Amount (₹)</label><input type="number" id="b-amt" inputmode="decimal" min="0" placeholder="e.g. 48500"></div>
        <div class="field"><label>Bill date</label><input type="date" id="b-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Note (optional)</label><textarea id="b-note" style="min-height:64px" placeholder="What is this bill for?"></textarea></div>
        <div class="field"><label>Upload bill (photo or PDF, max ~4 MB)</label><input type="file" accept="image/*, application/pdf" onchange="pickBill(this)"><div id="b-file" style="color:var(--muted); font-size:12px; margin-top:6px">No file chosen.</div></div>
        <div style="display:flex; gap:10px"><button class="btn ghost" onclick="go('#/pm')">Cancel</button><button class="btn primary" style="flex:1" onclick="submitBill(this)">Submit to admin</button></div>
    </div>`;
}

async function readBill(f) {
    if (f.type && f.type.startsWith('image/')) { const b = await fileToPhoto(f, 1800, 0.8); b.name = f.name.replace(/\.\w+$/, '') + '.jpg'; return b; }
    if (f.size > 4 * 1024 * 1024) { toast('File too large (max ~4 MB)'); return null; }
    const b = await fileToB64(f); b.name = f.name; return b;
}

async function pickBill(input) {
    const f = input.files[0]; if (!f) return;
    const b = await readBill(f); if (!b) { input.value = ''; return; }
    billFile = b; document.getElementById('b-file').textContent = 'Attached: ' + f.name;
}

async function submitBill(btn) {
    const vendor = document.getElementById('b-vendor').value.trim();
    const amt = parseFloat(document.getElementById('b-amt').value);
    if (!vendor) return toast('Add the vendor name');
    if (!(amt > 0)) return toast('Add the bill amount');
    const pid = document.getElementById('b-proj').value;
    
    const j = await apiBusy(btn, { action: 'addBill', token: TOKEN, projectId: pid, vendor, no: document.getElementById('b-no').value.trim(), amount: amt, date: document.getElementById('b-date').value, note: document.getElementById('b-note').value.trim(), fileB64: billFile ? billFile.b64 : null, fileMime: billFile ? billFile.mime : null, fileName: billFile ? billFile.name : null });
    if (!j) return;
    
    const p = S.projects[pid];
    showWaMsg({
        to: 'admin',
        plain: `New bill added - ${p.name}\n\n${S.me.name} added a bill from ${vendor} for ₹${amt.toLocaleString('en-IN')}.\n\nSign in to view: ${appLink('#/admin')}`,
        btn: 'Open bills', href: '#/admin', after: '#/pm'
    });
}

function billFileId(b) {
    const v = String(b.fileId || b.file || ''); if (!v) return '';
    const m = v.match(/[?&]id=([\w-]+)/) || v.match(/\/d\/([\w-]+)/);
    return m ? m[1] : v;
}

function billFileLink(b) { const id = billFileId(b); return id ? `<a href="https://drive.google.com/file/d/${id}/view" target="_blank" rel="noopener" style="font-size:13px; font-weight:600; text-decoration:underline;">View file</a>` : '<span style="font-size:12px; color:var(--muted)">No file</span>'; }
function billStatusChip(b) { return b.status === 'approved' ? '<span class="chip green">Approved</span>' : (b.status === 'addons' ? '<span class="chip red">Add-ons asked</span>' : '<span class="chip amber">Needs review</span>'); }

function billRow(b, showProject, actions) {
    return `<div class="bill-row">
        <div style="flex:1; min-width:200px;"><b>${esc(b.vendor)}</b> ${b.no ? `&bull; ${esc(b.no)}` : ''} ${billStatusChip(b)}<br>
        <span style="color:var(--muted); font-size:13px;">${showProject ? esc(projectName(b.projectId)) + ' &bull; ' : ''}added by ${esc(b.by)} &bull; ${b.date ? new Date(b.date).toLocaleDateString('en-IN', {day:'numeric', month:'short'}) : fullTime(b.ts)}${b.note ? '<br>' + esc(b.note) : ''}${b.status === 'addons' && b.adminNote ? `<br><b style="color:var(--red)">Admin asked: ${esc(b.adminNote)}</b>` : ''}</span></div>
        <div class="amt">₹${b.amount.toLocaleString('en-IN')}<br><div style="margin-top:4px; font-weight:normal;">${billFileLink(b)}</div></div>
        ${actions ? `<div style="flex-basis:100%; display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">${actions}</div>` : ''}
    </div>`;
}

function billsHtml() {
    const all = [...(S.bills || [])].sort((a, b) => b.ts - a.ts);
    const open = all.filter(b => b.status !== 'approved');
    const apprTotal = all.filter(b => b.status === 'approved').reduce((s, b) => s + b.amount, 0);
    return `<div class="section-label">Bills to review</div>
    <div class="card"><div style="padding:12px 16px; font-size:13.5px; color:var(--muted); background:#F9FAFB;">${open.length} waiting &bull; approved bills (₹${apprTotal.toLocaleString('en-IN')}) move into each project's page</div>
    ${open.map(b => billRow(b, true, b.status === 'pending' ? `<button class="btn green sm" onclick="reviewBill(this, '${b.id}', 'approved')">Approve</button><button class="btn ghost sm" onclick="askAddons(this, '${b.id}')">Ask for add-ons</button>` : `<span style="font-size:13px; color:var(--muted)">Waiting for ${esc(b.by)} to send the add-on.</span><button class="btn green sm" onclick="reviewBill(this, '${b.id}', 'approved')">Approve anyway</button>`)).join('') || '<div class="card empty">No bills waiting for review.</div>'}</div>`;
}

function projectBillsHtml(pid) {
    if (S.me.role !== 'admin') return '';
    const bills = (S.bills || []).filter(b => b.projectId === pid && b.status === 'approved').sort((a, b) => b.ts - a.ts);
    const waiting = (S.bills || []).filter(b => b.projectId === pid && b.status !== 'approved').length;
    const total = bills.reduce((s, b) => s + b.amount, 0);
    return `<div class="section-label">Bills (Admin Only)</div>
    <div class="card"><div style="padding:12px 16px; font-size:13.5px; color:var(--muted); background:#F9FAFB;">${bills.length} approved &bull; total <b style="color:var(--ink)">₹${total.toLocaleString('en-IN')}</b>${waiting ? ` &bull; ${waiting} still waiting on the admin board` : ''}</div>
    ${bills.map(b => billRow(b, false, '')).join('') || '<div class="card empty">No approved bills for this project yet.</div>'}</div>`;
}

function myBillsHtml() {
    const mine = (S.bills || []).filter(b => b.status !== 'approved').sort((a, b) => b.ts - a.ts);
    if (!mine.length) return '';
    return `<div class="section-label">Your bills in review</div><div class="card">${mine.map(b => billRow(b, true, b.status === 'addons' ? `<button class="btn primary sm" onclick="addonForm('${b.id}')">Send add-on</button>` : '')).join('')}<div id="addon-form"></div></div>`;
}

async function reviewBill(btn, id, decision, note) {
    const reqBody = { action: 'reviewBill', token: TOKEN, billId: id, decision: decision, note: note || '' };
    const j = await apiBusy(btn, reqBody);
    if (j) { toast(decision === 'approved' ? 'Bill approved — moved to project' : 'Sent back for add-ons'); render(true); }
}

function askAddons(btn, id) {
    const note = prompt('What add-on do you need from the PM? (e.g. GST invoice copy, correct amount)');
    if (note && note.trim()) reviewBill(btn, id, 'addons', note.trim());
}

let addonFile = null;
function addonForm(id) {
    addonFile = null;
    document.getElementById('addon-form').innerHTML = `<div style="padding:16px; border-top:1px solid var(--line); background:#F9FAFB;">
        <div class="field"><label>Add-on note</label><textarea id="ad-note" style="min-height:60px" placeholder="What did you add or fix?"></textarea></div>
        <div class="field"><label>New file (optional)</label><input type="file" accept="image/*, application/pdf" onchange="pickAddon(this)"></div>
        <button class="btn primary sm" onclick="sendAddon(this, '${id}')">Send back for review</button>
    </div>`;
}

async function pickAddon(input) { const f = input.files[0]; if (!f) return; const b = await readBill(f); if (!b) { input.value = ''; return; } addonFile = b; }

async function sendAddon(btn, id) {
    const note = document.getElementById('ad-note').value.trim();
    if (!note && !addonFile) return toast('Add a note or a file');
    const j = await apiBusy(btn, { action: 'resubmitBill', token: TOKEN, billId: id, note, fileB64: addonFile ? addonFile.b64 : null, fileMime: addonFile ? addonFile.mime : null, fileName: addonFile ? addonFile.name : null });
    if (j) { toast('Sent back to admin'); render(true); }
}

function payTotals(pid) {
    const p = S.projects[pid] || {};
    const rec = (S.payments || []).filter(x => x.projectId === pid).reduce((s, x) => s + x.amount, 0);
    const total = Number(p.contractValue) || 0;
    return { rec, total, bal: Math.max(total - rec, 0), pct: total ? Math.min(100, Math.round(rec / total * 100)) : 0 };
}

function paymentsPanel(pid, admin) {
    const t = payTotals(pid);
    const list = (S.payments || []).filter(x => x.projectId === pid).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.ts - a.ts);
    return `<div class="card" style="padding:20px;">
        <div style="font-weight:600; color:var(--muted); margin-bottom:8px;">Total received</div>
        <div style="font-size:32px; font-weight:800; color:var(--green); margin-bottom:16px;">₹${t.rec.toLocaleString('en-IN')}</div>
        ${t.total ? `<div class="progress" style="margin-bottom:12px;"><i style="width:${t.pct}%"></i></div>
        <div style="display:flex; justify-content:space-between; font-size:14px;">
            <div><span style="color:var(--muted)">Contract value:</span> <b>₹${t.total.toLocaleString('en-IN')}</b></div>
            <div><span style="color:var(--muted)">Balance:</span> <b>₹${t.bal.toLocaleString('en-IN')}</b></div>
        </div>` : (admin ? `<div style="font-size:13px; color:var(--muted)">Tip: set the contract value in Manage projects to show the balance.</div>` : '')}
    </div>
    ${admin ? `<div style="margin:16px 0;"><button class="btn primary block" onclick="showPayForm('${pid}','')">+ Record a payment</button></div><div id="pay-form"></div>` : ''}
    <div class="section-label">Payment history</div>
    <div class="card">${list.map(x => `<div class="bill-row">
        <div style="flex:1;"><b>${esc(x.stage || 'Payment received')}</b><br><span style="color:var(--muted); font-size:13px;">${fmtDate(x.date)}${x.mode ? ' &bull; ' + esc(x.mode) : ''}${x.ref ? ' &bull; Ref: ' + esc(x.ref) : ''}</span>${x.note ? `<br><span style="font-size:13px;">${esc(x.note)}</span>` : ''}</div>
        <div class="amt">₹${x.amount.toLocaleString('en-IN')}</div>
        ${admin ? `<div style="display:flex; gap:8px;"><button class="btn ghost sm" onclick="showPayForm('${pid}','${x.id}')">Edit</button><button class="btn ghost sm" onclick="deletePayment(this,'${x.id}')">Delete</button></div>` : ''}
    </div>`).join('') || '<div class="card empty">No payments recorded yet.</div>'}</div>`;
}

function showPayForm(pid, payId) {
    const x = payId ? ((S.payments || []).find(y => y.id === payId) || {}) : {};
    const modes = ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Other'];
    if (x.mode && modes.indexOf(x.mode) < 0) modes.push(x.mode);
    const box = document.getElementById('pay-form');
    box.innerHTML = `<div class="card" style="padding:20px; margin:16px 0; background:#F9FAFB;">
        <b style="font-size:16px;">${payId ? 'Edit payment' : 'Record a payment'}</b>
        <div class="field" style="margin-top:16px;"><label>Amount received (₹)</label><input type="number" id="pf-amt" inputmode="decimal" min="0" value="${x.amount || ''}" placeholder="e.g. 250000"></div>
        <div class="field"><label>Date</label><input type="date" id="pf-date" value="${esc(x.date || new Date().toISOString().slice(0, 10))}"></div>
        <div class="field"><label>Mode</label><select id="pf-mode">${modes.map(m => `<option ${x.mode === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
        <div class="field"><label>Stage / for (optional)</label><input type="text" id="pf-stage" list="pf-stages" value="${esc(x.stage || '')}" placeholder="e.g. Advance, Slab, Finishing"><datalist id="pf-stages"><option>Booking advance</option><option>Advance</option><option>Foundation</option><option>Slab</option><option>Brickwork</option><option>Plastering</option><option>Flooring</option><option>Finishing</option><option>Handover</option></datalist></div>
        <div class="field"><label>Reference no. (optional)</label><input type="text" id="pf-ref" value="${esc(x.ref || '')}" placeholder="UPI / cheque / transaction no."></div>
        <div class="field"><label>Note (optional)</label><textarea id="pf-note" style="min-height:60px">${esc(x.note || '')}</textarea></div>
        <div style="display:flex; gap:10px;"><button class="btn ghost" onclick="document.getElementById('pay-form').innerHTML=''">Cancel</button><button class="btn primary" style="flex:1;" onclick="savePayment(this, '${pid}', '${payId || ''}')">Save payment</button></div>
    </div>`;
    if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function savePayment(btn, pid, payId) {
    const amount = parseFloat(document.getElementById('pf-amt').value);
    if (!(amount > 0)) return toast('Add the amount received');
    
    const reqBody = { action: payId ? 'updatePayment' : 'addPayment', token: TOKEN, lite: true, projectId: pid, paymentId: payId || undefined, amount: amount, date: document.getElementById('pf-date').value, mode: document.getElementById('pf-mode').value, stage: document.getElementById('pf-stage').value.trim(), ref: document.getElementById('pf-ref').value.trim(), note: document.getElementById('pf-note').value.trim() };
    const j = await apiBusy(btn, reqBody);
    if (!j) return;
    if (j.payment) upsert(S.payments, j.payment); cacheState(); toast('Payment saved');
    if (payId) return render(true);
    
    const p = S.projects[pid], t = payTotals(pid), pay = j.payment;
    showWaMsg({
        to: (p.customers || ['customer'])[0],
        plain: `Payment received - ${p.name}\n\n${rupee(pay.amount)} received on ${fmtDate(pay.date)}${pay.mode ? ' via ' + pay.mode : ''}.\nTotal received so far: ${rupee(t.rec)}${t.total ? '\nBalance: ' + rupee(t.bal) : ''}\n\nThank you!\nView payments: ${appLink('#/project/' + pid + '/payments')}`,
        after: ''
    });
}

async function deletePayment(btn, id) {
    if (!confirm('Delete this payment entry?')) return;
    const j = await apiBusy(btn, { action: 'deletePayment', token: TOKEN, lite: true, paymentId: id });
    if (!j) return;
    S.payments = S.payments.filter(x => x.id !== id); cacheState(); toast('Payment removed'); render(true);
}

function setPayProj(v) { payProj = v; render(true); }

function viewAdminPayments() {
    const projs = Object.values(S.projects);
    const all = (S.payments || []).reduce((s, x) => s + x.amount, 0);
    if (!projs.length) { app.innerHTML = `${topbar('Admin Payments', '#/admin')}<div class="card empty" style="margin-top:14px">Add a project first.</div>`; return; }
    if (!S.projects[payProj]) payProj = projs[0].id;
    app.innerHTML = `${topbar('Admin Payments', '#/admin')}
    <div class="hero" style="padding-top:10px"><h1>Payments</h1><p>Record what each customer has paid.</p></div>
    <div class="card stat" style="margin-top:10px;"><div class="lbl">Received across all projects</div><div class="num" style="color:var(--green)">₹${all.toLocaleString('en-IN')}</div></div>
    <div class="field" style="margin-top:24px"><label>Select Project</label><select onchange="setPayProj(this.value)">${projs.map(p => `<option value="${p.id}" ${p.id === payProj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    ${paymentsPanel(payProj, true)}`;
}

function viewProject(pid, tab) {
    const p = S.projects[pid];
    if (!p) return S.me.role === 'pm' ? viewPM() : (S.me.role === 'admin' ? viewAdmin() : viewCustomer());
    const role = S.me.role;
    tab = tab || 'updates';
    if (tab === 'payments' && role === 'pm') tab = 'updates';
    const customerView = role === 'customer' || role === 'admin';
    const approvals = S.approvals.filter(a => a.projectId === pid).sort((x, y) => y.ts - x.ts);
    const pend = approvals.filter(a => a.status === 'pending'), done = approvals.filter(a => a.status !== 'pending');
    const back = role === 'admin' ? '#/admin' : role === 'pm' ? '#/pm' : (Object.keys(S.projects).length > 1 ? '#/customer' : '');
    
    let body = '';
    if (tab === 'updates') {
        const ups = updatesFor(pid).sort((a, b) => tlOrder === 'new' ? b.ts - a.ts : a.ts - b.ts);
        body = `${pend.length && customerView ? `<div class="section-label">Needs your decision</div><div class="feed">${pend.map(a => approvalCard(a, customerView)).join('')}</div>` : ''}
        <div style="display:flex; align-items:center; justify-content:space-between; margin:32px 0 16px;">
            <div class="section-label" style="margin:0; border:none; padding:0;">Site updates</div>
            <div class="seg"><button class="${tlOrder === 'new' ? 'on' : ''}" onclick="setOrder('new')">Latest</button><button class="${tlOrder === 'old' ? 'on' : ''}" onclick="setOrder('old')">Oldest</button></div>
        </div>
        ${ups.length ? `<div class="tl">${ups.map(tlCard).join('')}</div>` : `<div class="card empty">No updates yet.</div>`}
        ${projectBillsHtml(pid)}
        ${role === 'pm' ? `${pend.length ? `<div class="section-label">Waiting on customer</div><div class="feed">${pend.map(a => approvalCard(a, false)).join('')}</div>` : ''}${done.length ? `<div class="section-label">Past decisions</div><div class="feed">${done.map(a => approvalCard(a, false)).join('')}</div>` : ''}` : ''}`;
    } else if (tab === 'approvals') {
        body = `${pend.length ? `<div class="section-label">Needs your decision</div><div class="feed">${pend.map(a => approvalCard(a, customerView)).join('')}</div>` : ''}
        ${done.length ? `<div class="section-label">Past decisions</div><div class="feed">${done.map(a => approvalCard(a, customerView)).join('')}</div>` : ''}
        ${!approvals.length ? `<div class="card empty" style="margin-top:24px">Nothing to approve right now.</div>` : ''}`;
    } else {
        body = `<div style="margin-top:24px">${paymentsPanel(pid, role === 'admin')}</div>`;
    }
    
    app.innerHTML = `${topbar('', back)} ${heroHtml(pid)}
    ${role !== 'customer' ? `<div style="display:flex; margin-top:24px;"><button class="btn primary block" onclick="go('#/pm/post/${pid}')">+ Post update</button></div>` : ''}
    ${body}`;
}

function viewCustomer() {
    const items = Object.values(S.projects).map(p => {
        const pend = S.approvals.filter(a => a.projectId === p.id && a.status === 'pending').length;
        return `<div class="card proj-card" onclick="go('#/project/${p.id}')">
            ${p.cover ? `<div class="cover" style="background-image:url('${mediaUrl(p.cover)}'); height:190px"><span class="pct">${p.progress}% complete</span></div>` : ''}
            <div class="body"><h3>${esc(p.name)}</h3><div class="proj-meta">${esc(p.loc)} ${p.type ? ' &bull; ' + esc(p.type) : ''}</div>
            <div class="progress"><i style="width:${p.progress}%"></i></div>
            <div style="display:flex; gap:8px; align-items:center;">${pend ? `<span class="chip amber">${pend} awaiting you</span>` : `<span class="chip green">All caught up</span>`}
            <span style="margin-left:auto; font-weight:700; color:var(--brand); font-size:14px;">Open &rarr;</span></div></div></div>`;
    }).join('');
    
    app.innerHTML = `${topbar('Customer view')}
    <div class="hero"><h1>Welcome to ${esc(brand())}</h1><p>Namaste, ${esc(S.me.name.split(' ')[0])}. Your project's progress and photos.</p></div>
    <div class="grid proj-grid">${items || '<div class="card empty">No projects linked to your login yet.</div>'}</div>`;
}

function heroHtml(pid) {
    const p = S.projects[pid], src = firstPhoto(pid), cust = S.me.role === 'customer';
    return `<div class="cust-hero hero-fade" style="${src ? `background-image:url('${src}')` : 'background: linear-gradient(135deg, #2563EB, #1D4ED8)'}">
        <div class="in">
            <div style="flex:1; min-width:0">
                <div class="hi">${cust ? 'Namaste, ' + esc(S.me.name.split(' ')[0]) : 'Project Manager: ' + esc(p.pm || '-')}</div>
                <h1>${esc(p.name)}</h1>
                <div class="sub">${esc(p.loc)} ${p.type ? ' &bull; ' + esc(p.type) : ''}</div>
            </div>
            <div style="text-align:right;">
                <b style="font-size:24px;">${p.progress}%</b><br><small style="opacity:0.9">complete</small>
            </div>
        </div>
    </div>`;
}

function viewApprove(aid) {
    const a = S.approvals.find(x => x.id === aid); if (!a) return go('#/customer');
    const p = S.projects[a.projectId] || { name: '', pm: '' };
    if (a.status !== 'pending') {
        app.innerHTML = `${topbar('', false)}
        <div class="card" style="padding: 32px 20px; margin-top:24px; text-align:center;">
            <h1 style="font-size:24px; font-weight:800; color:var(--ink);">${a.status === 'approved' ? 'Approved' : 'Response recorded'}</h1>
            <p style="color:var(--muted); margin-top: 12px; font-size:15px;">"${esc(a.title)}" &bull; ${esc(p.name)}<br>${a.comment ? `Your response: "${esc(a.comment)}"<br>` : ''}Recorded ${rel(a.decidedTs)}.</p>
            <div class="decision-bar" style="justify-content:center;">
                <button class="btn ghost block" onclick="go('#/project/${p.id}')">Back to project</button>
            </div>
        </div>`;
        return;
    }
    app.innerHTML = `${topbar('Approval request', '#/project/' + a.projectId)}
    <div class="card approval-card" style="margin-top:24px"><div class="body">
        <div style="display:flex; gap:8px; align-items:center;"><span class="chip amber">Approval request</span><span class="chip grey">${esc(p.name)}</span></div>
        <h3 style="margin-top:16px; font-size:20px;">${esc(a.title)}</h3>
        <div class="ask">From ${esc(p.pm || 'your site team')} &bull; ${rel(a.ts)}</div>
        <div style="font-size:15px; white-space:pre-wrap; margin-bottom:16px;">${esc(a.detail)}</div>
        ${photosHtml(a.photos)}
        ${a.options && a.options.length ? `<div class="field" style="margin-top:24px;"><label>Your choice</label><select id="inp-choice">${a.options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>` : ''}
        <div class="field" style="margin-top:24px;"><label>Comment (optional)</label><textarea id="inp-comment" style="min-height:80px" placeholder="Anything the site team should know?"></textarea></div>
        <div class="decision-bar">
            <button class="btn green" onclick="decide(this, '${a.id}', 'approved')">Approve</button>
            <button class="btn red" onclick="decide(this, '${a.id}', 'rejected')">Request changes</button>
        </div>
    </div></div>`;
}

async function decide(btn, aid, status) {
    const a = S.approvals.find(x => x.id === aid); if (!a || a.status !== 'pending') return;
    const comment = (document.getElementById('inp-comment') || {}).value?.trim() || '';
    const choice = (document.getElementById('inp-choice') || {}).value || '';
    const snap = Object.assign({}, a);
    a.status = status === 'approved' ? 'approved' : 'rejected'; a.decidedTs = Date.now(); a.decidedBy = S.me.name; a.comment = (choice ? choice + '.' : '') + comment;
    viewApprove(aid); toast('Response sent');
    try {
        const j = await api({ action: 'decide', token: TOKEN, lite: true, approvalId: aid, status, comment, choice });
        if (j.approval) Object.assign(a, j.approval); cacheState();
    } catch (e) { Object.assign(a, snap); toast(String(e)); if (location.hash === '#/approve/' + aid) viewApprove(aid); }
}

function viewAdmin() {
    const projs = Object.values(S.projects);
    const pend = S.approvals.filter(a => a.status === 'pending');
    const week = S.updates.filter(u => Date.now() - u.ts < 7 * DAY).length;
    const log = S.log || [];
    const filter = document.getElementById('log-filter')?.value || 'all';
    const received = (S.payments || []).reduce((s, x) => s + x.amount, 0);
    
    const rows = log.filter(l => filter === 'all' || l.projectId === filter).map(l => {
        const dc = l.action.startsWith('approved') ? 'var(--green)' : (l.action.startsWith('asked') ? 'var(--red)' : 'var(--brand)');
        return `<div class="log-row"><div class="log-dot" style="background:${dc}"></div>
        <div style="flex:1"><div class="txt"><b>${esc(l.actor)}</b> ${esc(l.action)} ${l.projectId ? `<b>${esc(projectName(l.projectId))}</b>` : ''}<br><span style="color:var(--muted)">${esc(l.detail)}</span></div>
        <div class="time">${Date.now() - l.ts < 7 * DAY ? fullTime(l.ts) + ' &bull; ' + rel(l.ts) : fullTime(l.ts)}</div></div></div>`;
    }).join('');
    
    app.innerHTML = `${topbar('Admin view')}
    <div class="hero"><h1>${esc(brand())}</h1><p>Every project, pending decision, payment and action.</p></div>
    <div class="grid admin-stats">
        <div class="card stat"><div class="num">${projs.length}</div><div class="lbl">Active projects</div></div>
        <div class="card stat"><div class="num" style="color:var(--amber)">${pend.length}</div><div class="lbl">Approvals pending</div></div>
        <div class="card stat"><div class="num">${week}</div><div class="lbl">Updates this week</div></div>
    </div>
    
    <div class="card" onclick="go('#/admin/payments')" style="padding:20px; margin-top:16px; display:flex; align-items:center; gap:16px; cursor:pointer;">
        <div style="flex:1;">
            <div style="font-weight:600; color:var(--muted); margin-bottom:8px;">Payments received</div>
            <div style="font-size:28px; font-weight:800; color:var(--green)">₹${received.toLocaleString('en-IN')}</div>
        </div>
        <span style="font-weight:700; color:var(--brand); font-size:15px;">Manage &rarr;</span>
    </div>
    
    <div class="card" style="padding:20px; margin-top:16px; display:flex; gap:12px; flex-wrap:wrap;">
        <button class="btn primary sm" onclick="go('#/admin/projects')">Manage projects</button>
        <button class="btn primary sm" onclick="go('#/admin/users')">Manage logins</button>
        <button class="btn ghost sm" onclick="go('#/admin/whatsapp')">Settings</button>
    </div>
    
    <div class="section-label">Projects</div>
    <div class="grid proj-grid">${projs.map(p => {
        const pc = S.approvals.filter(a => a.projectId === p.id && a.status === 'pending').length;
        return `<div class="card proj-card" onclick="go('#/project/${p.id}')">
            ${p.cover ? `<div class="cover" style="background-image:url('${mediaUrl(p.cover)}')"><span class="pct">${p.progress}% complete</span></div>` : ''}
            <div class="body">
                <div style="display:flex; align-items:center; gap:8px;"><h3 style="flex:1;">${esc(p.name)}</h3>${pc ? `<span class="chip amber">${pc} pending</span>` : `<span class="chip green">Clear</span>`}</div>
                <div class="proj-meta">${esc(p.loc)} &bull; PM: ${esc(p.pm || '-')}<br>Customer: ${esc((p.customers || []).join(' & '))}</div>
                <div style="display:flex; align-items:center; gap:12px;"><div class="progress" style="flex:1;"><i style="width:${p.progress}%"></i></div><b style="font-size:14px;">${p.progress}%</b></div>
            </div>
        </div>`;
    }).join('') || '<div class="card empty">No projects yet.</div>'}</div>
    
    <div class="section-label">Pending approvals</div>
    <div class="feed">${pend.length ? pend.map(a => approvalCard(a, false)).join('') : '<div class="card empty">Nothing waiting on a customer.</div>'}</div>
    
    ${billsHtml()}
    
    <div class="section-label">Activity log</div>
    <div class="card">
        <div style="padding:16px; border-bottom:1px solid var(--line);"><select id="log-filter" onchange="viewAdmin()" style="width:100%; border:1.5px solid var(--line); border-radius:8px; padding:10px; background:#fff; font-size:14px;">
            <option value="all">All projects</option>${projs.map(p => `<option value="${p.id}" ${filter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
        <div class="log">${rows || '<div class="card empty" style="border:none;">No activity yet.</div>'}</div>
    </div>`;
}

function viewAdminProjects() {
    const projs = Object.values(S.projects);
    app.innerHTML = `${topbar('Admin &bull; Manage projects', '#/admin')}
    <div class="hero"><h1>Projects</h1><p>Add a project for each site.</p></div>
    <div class="card" style="padding: 24px; margin-bottom: 24px;">
        <h3 style="margin-bottom:16px;">+ Add project</h3>
        <div class="field"><label>Project name</label><input type="text" id="np-name" placeholder="e.g. Lakeview Villa"></div>
        <div class="field"><label>Location</label><input type="text" id="np-loc" placeholder="e.g. Kokapet, Hyderabad"></div>
        <div class="field"><label>Type</label><input type="text" id="np-type" placeholder="e.g. Independent villa 3 BHK"></div>
        <div class="field"><label>Customer name(s)</label><input type="text" id="np-cust" placeholder="e.g. Ananya Reddy & Vikram Reddy"></div>
        <div class="field"><label>Project Manager name</label><input type="text" id="np-pm" placeholder="e.g. Rajesh Verma"></div>
        <div class="field"><label>Contract value (₹)</label><input type="number" id="np-cv" inputmode="decimal" min="0" placeholder="e.g. 4500000"></div>
        <div class="field"><label>Cover photo (optional)</label><input type="file" accept="image/*" id="np-cover"></div>
        <button class="btn primary block" onclick="addProject(this)">Add project</button>
    </div>
    ${projs.map(p => `<div class="card" style="padding:20px; margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <b style="flex:1; font-size:16px;">${esc(p.name)}</b>
            <button class="btn ghost sm" onclick="editProject('${p.id}')">Edit</button>
            <button class="btn red sm" onclick="deleteProject(this, '${p.id}', '${esc(p.name)}')">Delete</button>
        </div>
        <div class="proj-meta">${esc(p.loc)} ${p.type ? '&bull; ' + esc(p.type) : ''} &bull; PM: ${esc(p.pm || '-')}<br>Customer: ${esc((p.customers || []).join(' & '))} &bull; ${p.progress}% complete ${p.contractValue ? '&bull; Contract: ₹' + p.contractValue.toLocaleString('en-IN') : ''}</div>
        <div id="edit-${p.id}"></div>
    </div>`).join('')}`;
}

async function addProject(btn) {
    const name = document.getElementById('np-name').value.trim();
    if (!name) return toast('Add the project name');
    const j = await apiBusy(btn, async () => {
        let cover = null, coverMime = null;
        const cf = document.getElementById('np-cover').files[0];
        if (cf) { const b = await fileToPhoto(cf, 1600, 0.8); cover = b.b64; coverMime = b.mime; }
        return api({ action: 'addProject', token: TOKEN, name, loc: document.getElementById('np-loc').value.trim(), type: document.getElementById('np-type').value.trim(), customers: document.getElementById('np-cust').value.split('&').map(s => s.trim()).filter(Boolean), pm: document.getElementById('np-pm').value.trim(), contractValue: document.getElementById('np-cv').value, coverB64: cover, coverMime });
    });
    if (j) { toast('Project added'); viewAdminProjects(); }
}

function editProject(pid) {
    const p = S.projects[pid];
    document.getElementById('edit-' + pid).innerHTML = `<div style="border-top:1px solid var(--line); margin-top:16px; padding-top:16px;">
        <div class="field"><label>Name</label><input type="text" id="ep-name-${pid}" value="${esc(p.name)}"></div>
        <div class="field"><label>Location</label><input type="text" id="ep-loc-${pid}" value="${esc(p.loc)}"></div>
        <div class="field"><label>Type</label><input type="text" id="ep-type-${pid}" value="${esc(p.type)}"></div>
        <div class="field"><label>Customer name(s)</label><input type="text" id="ep-cust-${pid}" value="${esc((p.customers || []).join(' & '))}"></div>
        <div class="field"><label>Project Manager</label><input type="text" id="ep-pm-${pid}" value="${esc(p.pm || '')}"></div>
        <div class="field"><label>Contract value (₹)</label><input type="number" id="ep-cv-${pid}" inputmode="decimal" min="0" value="${p.contractValue || ''}"></div>
        <div class="field"><label>Progress (%)</label><input type="number" id="ep-prog-${pid}" min="0" max="100" value="${p.progress}"></div>
        <div class="field"><label>New cover photo (optional)</label><input type="file" accept="image/*" id="ep-cover-${pid}"></div>
        <button class="btn primary sm" onclick="saveProject(this, '${pid}')">Save changes</button>
    </div>`;
}

async function saveProject(btn, pid) {
    const j = await apiBusy(btn, async () => {
        let cover = null, coverMime = null;
        const cf = document.getElementById('ep-cover-' + pid).files[0];
        if (cf) { const b = await fileToPhoto(cf, 1600, 0.8); cover = b.b64; coverMime = b.mime; }
        return api({ action: 'updateProject', token: TOKEN, projectId: pid, name: document.getElementById('ep-name-' + pid).value, loc: document.getElementById('ep-loc-' + pid).value, type: document.getElementById('ep-type-' + pid).value, customers: document.getElementById('ep-cust-' + pid).value.split('&').map(s => s.trim()).filter(Boolean), pm: document.getElementById('ep-pm-' + pid).value, contractValue: document.getElementById('ep-cv-' + pid).value, progress: document.getElementById('ep-prog-' + pid).value, coverB64: cover, coverMime });
    });
    if (j) { toast('Saved'); viewAdminProjects(); }
}

async function deleteProject(btn, pid, name) {
    if (!confirm(`Delete "${name}" and all its data? This cannot be undone.`)) return;
    const j = await apiBusy(btn, { action: 'deleteProject', token: TOKEN, projectId: pid });
    if (j) { toast('Deleted'); viewAdminProjects(); }
}

function viewAdminUsers() {
    const projs = Object.values(S.projects);
    const userRow = u => `<div class="card" style="padding:20px; margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
            <b style="flex:1; font-size:16px;">${esc(u.name)} <span style="color:var(--muted); font-weight:400; font-size:14px;">${esc(u.username)}</span></b>
            <span class="chip ${u.role === 'admin' ? 'blue' : 'grey'}">${u.role === 'pm' ? 'Project Manager' : u.role}</span>
            ${u.id !== S.me.id ? `<button class="btn red sm" onclick="deleteUser(this, '${u.id}', '${esc(u.name)}')">Remove</button>` : ''}
        </div>
        <div class="proj-meta" style="margin-bottom:16px;">Projects: ${(u.projectIds || []).map(projectName).join(', ') || '-'}</div>
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <input type="text" id="pw-${u.id}" placeholder="New password" style="flex:1; min-width:140px; border:1.5px solid var(--line); border-radius:8px; padding:10px; font-size:14px;">
            <select id="pj-${u.id}" multiple size="3" style="flex:2; min-width:180px; border:1.5px solid var(--line); border-radius:8px; padding:10px; font-size:14px;">${projs.map(p => `<option value="${p.id}" ${(u.projectIds || []).includes(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            <button class="btn primary sm" onclick="saveUser(this, '${u.id}')">Save</button>
        </div>
    </div>`;

    app.innerHTML = `${topbar('Admin &bull; Manage logins', '#/admin')}
    <div class="hero"><h1>Logins</h1><p>Create a login for each project manager, customer and admin.</p></div>
    <div class="card" style="padding: 24px; margin-bottom: 24px;">
        <h3 style="margin-bottom:16px;">+ Add login</h3>
        <div class="field"><label>Full name</label><input type="text" id="nu-name" placeholder="e.g. Rajesh Verma"></div>
        <div class="field"><label>Login ID</label><input type="text" id="nu-id" autocapitalize="none" placeholder="e.g. rajesh"></div>
        <div class="field"><label>Password</label><input type="text" id="nu-pw" placeholder="Share it with them privately"></div>
        <div class="field"><label>Role</label><select id="nu-role"><option value="pm">Project Manager</option><option value="customer">Customer</option><option value="admin">Admin</option></select></div>
        <div class="field"><label>Projects (Hold Ctrl/Cmd to pick multiple)</label><select id="nu-pj" multiple size="4">${projs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <button class="btn primary block" onclick="addUser(this)">Add login</button>
    </div>
    ${(S.users || []).map(userRow).join('')}`;
}

async function addUser(btn) {
    const name = document.getElementById('nu-name').value.trim(), id = document.getElementById('nu-id').value.trim(), pw = document.getElementById('nu-pw').value;
    if (!name || !id || !pw) return toast('Name, ID and password are needed');
    const pj = [...document.getElementById('nu-pj').selectedOptions].map(o => o.value);
    const j = await apiBusy(btn, { action: 'addUser', token: TOKEN, name, username: id, pass: pw, role: document.getElementById('nu-role').value, projectIds: pj });
    if (j) { toast('Login added'); viewAdminUsers(); }
}

async function saveUser(btn, uid) {
    const pw = document.getElementById('pw-' + uid).value;
    const pj = [...document.getElementById('pj-' + uid).selectedOptions].map(o => o.value);
    const j = await apiBusy(btn, { action: 'updateUser', token: TOKEN, userId: uid, pass: pw || undefined, projectIds: pj });
    if (j) { toast('Saved'); viewAdminUsers(); }
}

async function deleteUser(btn, uid, name) {
    if (!confirm(`Remove the login for ${name}?`)) return;
    const j = await apiBusy(btn, { action: 'deleteUser', token: TOKEN, userId: uid });
    if (j) { toast('Removed'); viewAdminUsers(); }
}

function viewWaSetup() {
    app.innerHTML = `${topbar('Settings', '#/admin')}
    <div class="hero"><h1>Settings</h1></div>
    <div class="card" style="padding:24px; margin-bottom:24px;">
        <div class="field"><label>Company / brand name</label><input type="text" id="st-brand" value="${esc(brand())}"></div>
        <div class="field"><label>WhatsApp number (with country code)</label><input type="tel" id="wa-num" value="${esc(waNum())}"></div>
        <button class="btn primary block" onclick="saveWa(this)">Save settings</button>
    </div>`;
}

async function saveWa(btn) {
    const j = await apiBusy(btn, { action: 'saveSettings', token: TOKEN, waNumber: document.getElementById('wa-num').value.trim(), brandName: document.getElementById('st-brand').value.trim() });
    if (j) { toast('Saved'); document.title = brand() + ' Updates'; }
}

function canView(role, h) {
    if (h.startsWith('#/pm')) return role === 'pm' || role === 'admin';
    if (h.startsWith('#/admin')) return role === 'admin';
    return true;
}

async function render(soft) {
    const h = location.hash || '#/';
    closeOverlay(); PH = {}; PHN = 0;
    if (!soft) window.scrollTo(0, 0);
    document.title = brand() + ' Updates';
    
    if (h === '#/setup') { updateNav(''); return viewSetup(); }
    
    if (!S) {
        if (TOKEN) {
            showSkeleton(); updateNav('');
            try { await api({ action: 'state', token: TOKEN }); } 
            catch (e) { TOKEN = ''; localStorage.removeItem('bala.token'); return viewLogin(); }
        } else {
            updateNav('');
            if (h !== '#/login') { location.hash = '#/login'; return; }
            return viewLogin();
        }
    }
    if (h === '#/login') { updateNav(''); return go(home()); }
    if (!canView(S.me.role, h)) { toast('That page is not available for your login'); return go(home()); }
    
    updateNav(h);
    const parts = h.split('/');
    if (h.startsWith('#/pm/post/')) return viewPMPost(parts[3]);
    if (h === '#/pm') return viewPM();
    if (h === '#/customer') {
        const ids = Object.keys(S.projects);
        if (ids.length === 1) { location.replace(location.pathname + location.search + '#/project/' + ids[0]); return; }
        return viewCustomer();
    }
    if (h.startsWith('#/project/')) return viewProject(parts[2], parts[3]);
    if (h.startsWith('#/approve/')) return viewApprove(parts[2]);
    if (h === '#/pm/bill') return viewBillForm();
    if (h === '#/admin') return viewAdmin();
    if (h === '#/admin/payments') return viewAdminPayments();
    if (h === '#/admin/projects') return viewAdminProjects();
    if (h === '#/admin/users') return viewAdminUsers();
    if (h === '#/admin/whatsapp') return viewWaSetup();
    
    return go(home());
}

window.addEventListener('hashchange', () => render());

function canSoft() {
    if (!TOKEN || !S || document.hidden || OUTBOX.length || overlayRoot.innerHTML) return false;
    const el = document.activeElement;
    if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return false;
    const pf = document.getElementById('pay-form'); if (pf && pf.innerHTML) return false;
    return /^#\/(customer|pm|admin)$/.test(location.hash || '#/') || /^#\/project\/[^/]+(\/(approvals|payments))?$/.test(location.hash);
}

async function softRefresh() {
    if (!TOKEN || !S || document.hidden) return;
    try {
        STATE_CHANGED = false; await api({ action: 'state', token: TOKEN });
        if (STATE_CHANGED && canSoft()) render(true);
    } catch (e) { if (String(e) === 'Sign in again.') logout(); }
}

setInterval(() => { if (canSoft()) softRefresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) softRefresh(); });

fetch('config.js').then(r => r.text()).then(t => {
    const m = t.match(/API_URL\s*=\s*['"]([^'"]+)['"]/);
    if (m) API_URL = m[1];
}).catch(() => {}).finally(() => {
    render().then(() => { if (TOKEN && S) softRefresh(); });
});
