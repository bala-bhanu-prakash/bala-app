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
    overlayRoot.innerHTML = `<div class="lb" onclick="if(event.target===this)closeWa('${o.after || ''}')">
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

function updatesFor(pid) {
    return S.updates.filter(u => u.projectId === pid).concat(OUTBOX.filter(j => j.tmp.projectId === pid).map(j => j.tmp));
}

function tlCard(u, idx) {
    const st = u._state;
    return `<div style="margin-bottom:24px; animation-delay: ${Math.min(idx, 8) * 45}ms">
        <div style="color:var(--muted); font-size:13px; font-weight:600; margin-bottom:8px; display:flex; justify-content:space-between;">
            <span>${fullTime(u.ts)}</span> <span>${rel(u.ts)}</span>
        </div>
        <div class="card update-card">
            <div class="update-head">
                <div class="avatar">${initials(u.author)}</div>
                <div><div style="font-weight:700;">${esc(u.author)}</div></div>
                <div style="margin-left:auto">${typeChip(u.type)}</div>
            </div>
            <div class="update-body">
                ${u.progressPct != null ? `<div style="display:flex; align-items:center; gap:12px; margin:12px 0;"><div class="progress" style="flex:1"><i style="width:${u.progressPct}%"></i></div><b style="font-size:14px">${u.progressPct}%</b></div>` : ''}
                <div class="note">${esc(u.note)}</div>
                ${photosHtml(u.photos)}
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

async function reviewBill(btn, id, decision, note) {
    const reqBody = { action: 'reviewBill', token: TOKEN, billId: id, decision: decision, note: note || '' };
    const j = await apiBusy(btn, reqBody);
    if (j) { toast(decision === 'approved' ? 'Bill approved — moved to project' : 'Sent back for add-ons'); render(true); }
}

async function savePayment(btn, pid, payId) {
    const amount = parseFloat(document.getElementById('pf-amt').value);
    if (!(amount > 0)) return toast('Add the amount received');
    
    const reqBody = {
        action: payId ? 'updatePayment' : 'addPayment', 
        token: TOKEN, 
        lite: true, 
        projectId: pid, 
        paymentId: payId || undefined, 
        amount: amount, 
        date: document.getElementById('pf-date').value, 
        mode: document.getElementById('pf-mode').value, 
        stage: document.getElementById('pf-stage').value.trim(),
        ref: document.getElementById('pf-ref').value.trim(), 
        note: document.getElementById('pf-note').value.trim()
    };
    
    const j = await apiBusy(btn, reqBody);
    if (!j) return;
    
    if (j.payment) upsert(S.payments, j.payment); 
    cacheState();
    toast('Payment saved');
    
    if (payId) return render(true);
    const p = S.projects[pid], t = payTotals(pid), pay = j.payment;
    
    showWaMsg({
        to: (p.customers || ['customer'])[0],
        plain: `Payment received ${p.name}\n\n${rupee(pay.amount)} received on ${fmtDate(pay.date)}${pay.mode ? ' via ' + pay.mode : ''}.\nTotal received so far: ${rupee(t.rec)}${t.total ? '\nBalance: ' + rupee(t.bal) : ''}\n\nThank you!\nView payments: ${appLink('#/project/'+pid+'/payments')}`,
        after: ''
    });
}

function payTotals(pid) {
    const p = S.projects[pid] || {};
    const rec = (S.payments || []).filter(x => x.projectId === pid).reduce((s, x) => s + x.amount, 0);
    const total = Number(p.contractValue) || 0;
    return { rec, total, bal: Math.max(total - rec, 0), pct: total ? Math.min(100, Math.round(rec / total * 100)) : 0 };
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
        ${ups.length ? `<div class="tl">${ups.map(tlCard).join('')}</div>` : `<div class="card empty">No updates yet.</div>`}`;
    } else if (tab === 'approvals') {
        body = `${pend.length ? `<div class="section-label">Needs your decision</div><div class="feed">${pend.map(a => approvalCard(a, customerView)).join('')}</div>` : ''}
        ${done.length ? `<div class="section-label">Past decisions</div><div class="feed">${done.map(a => approvalCard(a, customerView)).join('')}</div>` : ''}
        ${!approvals.length ? `<div class="card empty" style="margin-top:24px">Nothing to approve right now.</div>` : ''}`;
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
    if (!S) {
        if (TOKEN) {
            showSkeleton(); updateNav('');
            try { await api({ action: 'state', token: TOKEN }); } 
            catch (e) { TOKEN = ''; localStorage.removeItem('bala.token'); return viewLogin(); }
        } else {
            updateNav(''); return viewLogin();
        }
    }
    if (h === '#/login') { updateNav(''); return go(home()); }
    if (!canView(S.me.role, h)) { toast('Page not available.'); return go(home()); }
    
    updateNav(h);
    const parts = h.split('/');
    if (h.startsWith('#/pm/post/')) return viewPMPost(parts[3]);
    if (h === '#/pm') return viewPM(); // pm logic omitted for brevity in snippet, assumes existing structure
    if (h === '#/customer') {
        const ids = Object.keys(S.projects);
        if (ids.length === 1) { location.replace(location.pathname + location.search + '#/project/' + ids[0]); return; }
        return viewCustomer();
    }
    if (h.startsWith('#/project/')) return viewProject(parts[2], parts[3]);
    if (h.startsWith('#/approve/')) return viewApprove(parts[2]);
    if (h === '#/admin') return viewAdmin(); // admin logic omitted for brevity in snippet, assumes existing structure
    
    return go(home());
}

window.addEventListener('hashchange', () => render());

function canSoft() {
    if (!TOKEN || !S || document.hidden || OUTBOX.length || overlayRoot.innerHTML) return false;
    const el = document.activeElement;
    if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return false;
    return /^#\/(customer|pm|admin)$/.test(location.hash) || /^#\/project\/[^/]+(\/(approvals|payments))?$/.test(location.hash);
}

async function softRefresh() {
    if (!TOKEN || !S || document.hidden) return;
    try {
        STATE_CHANGED = false; await api({ action: 'state', token: TOKEN });
        if (STATE_CHANGED && canSoft()) render(true);
    } catch (e) { if (String(e) === 'Sign in again.') logout(); }
}

setInterval(() => { if (canSoft()) softRefresh(); }, 45000); // Polling reduced for better performance
document.addEventListener('visibilitychange', () => { if (!document.hidden) softRefresh(); });

fetch('config.js').then(r => r.text()).then(t => {
    const m = t.match(/API_URL\s*=\s*['"]([^'"]+)['"]/);
    if (m) API_URL = m[1];
}).catch(() => {}).finally(() => {
    render().then(() => { if (TOKEN && S) softRefresh(); });
});
