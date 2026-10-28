/* ============ Bala - live app (API client) ============ */
const DAY=864e5, HOUR=36e5, MIN=6e4;
var API_URL=window.API_URL||'';
let S=null;            // state from backend
let TOKEN=localStorage.getItem('bala.token')||'';

/* ---------- tiny helpers ---------- */
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function rel(ts){const d=Date.now()-ts;if(d<MIN)return 'just now';if(d<HOUR)return Math.floor(d/MIN)+' min ago';if(d<DAY)return Math.floor(d/HOUR)+(d<2*HOUR?' hr ago':' hrs ago');if(d<7*DAY)return Math.floor(d/DAY)+(d<2*DAY?' day ago':' days ago');return new Date(ts).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}
function fullTime(ts){return new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})}
function initials(n){return n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}
function projectName(id){const p=S&&S.projects[id];return p?p.name:'—'}
function go(h){location.hash=h}
let toastT;function toast(msg){clearTimeout(toastT);const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);toastT=setTimeout(()=>t.remove(),2600)}
const app=document.getElementById('app'), overlayRoot=document.getElementById('overlay-root');
function topbar(crumb){
  return `<div class="topbar"><div class="wordmark">Brightlook Homes</div>
  ${S?`<span class="user-pill">${esc(S.me.name)} · ${esc(S.me.role==='pm'?'Project Manager':S.me.role)}</span><button class="role-switch" onclick="logout()">Log out</button>`:''}
  ${crumb?`<div class="crumb">${crumb}</div>`:''}</div>`;
}
function chipFor(status){if(status==='pending')return '<span class="chip amber">Awaiting customer</span>';if(status==='approved')return '<span class="chip green">Approved</span>';return '<span class="chip red">Changes requested</span>'}
function typeChip(t){return t==='material'?'<span class="chip blue">Material delivery</span>':'<span class="chip grey">Progress</span>'}
function photosHtml(photos){if(!photos||!photos.length)return '';const n=Math.min(photos.length,4);return `<div class="photo-grid n${n}">`+photos.slice(0,4).map(p=>`<img src="${mediaUrl(p)}" loading="lazy" alt="Site photo" onclick="lightbox('${mediaUrl(p)}')">`).join('')+`</div>`}
function lightbox(src){overlayRoot.innerHTML=`<div class="lb" onclick="closeOverlay()"><button>Close</button><img src="${src}" alt="Site photo full view"></div>`}
function closeOverlay(){overlayRoot.innerHTML=''}

/* ---------- WhatsApp ---------- */
function waNum(){return (S&&S.settings&&S.settings.waNumber)||'916303115658'}
function waLink(text){return 'https://wa.me/'+waNum().replace(/\D/g,'')+'?text='+encodeURIComponent(text)}
function appLink(h){return location.origin+location.pathname+h}
function showWaMsg(o){
  const t=new Date().toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',hour12:true});
  const real=waLink(o.plain+(o.plainSuffix||''));
  overlayRoot.innerHTML=`<div class="wa-overlay" onclick="if(event.target===this)closeWa('${o.after||''}')">
  <button class="wa-close" onclick="closeWa('${o.after||''}')">Close</button>
  <div class="phone"><div class="scr">
    <div class="wa-head"><div class="wa-av">B</div><div><div class="nm">Brightlook Homes Updates</div><div class="st">To: ${esc(o.to)} · WhatsApp</div></div></div>
    <div class="wa-chat"><div class="wa-msg"><div class="biz">~ Brightlook Homes Updates</div><p>${o.body}</p>
      ${o.href?`<a class="walink" href="${o.href}" onclick="closeWa('')">${o.btn}</a>`:''}<div class="meta">${t} <b>✓✓</b></div></div></div>
    <div class="wa-note">Tap below — WhatsApp opens with this message pre-filled. Just press send.<br><a href="${real}" target="_blank" rel="noopener" style="display:block;background:#25d366;color:#07300f;font-weight:800;text-align:center;padding:12px;border-radius:10px;margin-top:8px;font-size:14.5px">Send on WhatsApp →</a></div>
  </div></div></div>`;
}
function closeWa(after){overlayRoot.innerHTML='';if(after)go(after);else render()}

/* ---------- API ---------- */
async function api(req){
  if(!API_URL)throw 'App is still being set up.';
  const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(req)});
  const j=await r.json();
  if(!j.ok)throw j.error||'Something went wrong.';
  if(j.state)S=j.state;
  return j;
}
async function apiBusy(btn,req){
  const old=btn?btn.textContent:'';if(btn){btn.disabled=true;btn.textContent='Working…'}
  try{return await api(req)}catch(e){toast(String(e));return null}
  finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
function fileToB64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res({b64:String(r.result).split(',')[1],mime:file.type||'image/jpeg'});r.onerror=rej;r.readAsDataURL(file)})}
function fileToPhoto(file){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>{const M=1600;let w=img.naturalWidth,h=img.naturalHeight;if(w>M||h>M){const k=M/Math.max(w,h);w=Math.round(w*k);h=Math.round(h*k)}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);URL.revokeObjectURL(img.src);res({b64:c.toDataURL('image/jpeg',0.82).split(',')[1],mime:'image/jpeg'})};img.onerror=()=>{URL.revokeObjectURL(img.src);rej('Could not read that image')};img.src=URL.createObjectURL(file)})}
function mediaUrl(p){const m=String(p||'').match(/[?&]id=([\w-]+)/)||String(p||'').match(/\/d\/([\w-]+)/);return m?('https://lh3.googleusercontent.com/d/'+m[1]):p}

/* ---------- login ---------- */
function viewLogin(){
  app.innerHTML=`<div class="login-wrap"><div class="wordmark">Brightlook Homes</div>
  <div class="hero" style="padding:0 0 14px"><h1 style="font-size:24px">Sign in to continue</h1><p>Site updates and approvals for your project.</p></div>
  <div class="card" style="padding:18px"><form onsubmit="doLogin(this);return false">
    <div class="field"><label>ID</label><input type="text" id="lg-id" autocomplete="username" autocapitalize="none" placeholder="Your ID"></div>
    <div class="field"><label>Password</label><input type="password" id="lg-pw" autocomplete="current-password" placeholder="Password"></div>
    <div class="err" id="lg-err"></div>
    <button class="btn primary block" type="submit">Sign in</button></form></div>
  <div class="cred-hint" style="text-align:center"><a href="#/setup" style="color:var(--muted)">First time? Set up the app</a></div></div>`;
}
async function doLogin(){
  const username=document.getElementById('lg-id').value, pass=document.getElementById('lg-pw').value;
  const j=await apiBusy(document.querySelector('.login-wrap .btn'),{action:'login',username,pass});
  if(!j)return document.getElementById('lg-err').textContent='Wrong ID or password, or still setting up.';
  TOKEN=j.token;localStorage.setItem('bala.token',TOKEN);
  go(S.me.role==='admin'?'#/admin':S.me.role==='pm'?'#/pm':'#/customer');
}
function logout(){TOKEN='';localStorage.removeItem('bala.token');S=null;go('#/login')}

/* ---------- first-time setup ---------- */
function viewSetup(){
  app.innerHTML=`<div class="login-wrap"><div class="wordmark">Brightlook Homes</div>
  <div class="hero" style="padding:0 0 14px"><h1 style="font-size:24px">First-time setup</h1><p>Create the admin login. This works only once, before any login exists.</p></div>
  <div class="card" style="padding:18px"><form onsubmit="doSetup(this);return false">
    <div class="field"><label>Your name</label><input type="text" id="su-name" placeholder="e.g. Prakash"></div>
    <div class="field"><label>Choose an admin ID</label><input type="text" id="su-id" autocapitalize="none" placeholder="e.g. admin"></div>
    <div class="field"><label>Choose a password</label><input type="text" id="su-pw" placeholder="Something you will remember"></div>
    <div class="field"><label>WhatsApp number for notifications (with country code)</label><input type="tel" id="su-wa" placeholder="e.g. 9163XXXXXXXX"></div>
    <div class="err" id="su-err"></div>
    <button class="btn primary block" type="submit">Create admin &amp; start</button></form></div></div>`;
}
async function doSetup(){
  const btn=document.querySelector('.login-wrap .btn');
  const j=await apiBusy(btn,{action:'bootstrap',name:document.getElementById('su-name').value,username:document.getElementById('su-id').value,pass:document.getElementById('su-pw').value,waNumber:document.getElementById('su-wa').value});
  if(!j)return document.getElementById('su-err').textContent='Setup failed - the app may already be set up. Sign in instead.';
  TOKEN=j.token;localStorage.setItem('bala.token',TOKEN);
  toast('Admin created - welcome');go('#/admin');
}

/* ---------- shared cards ---------- */
function updateCard(u){
  return `<div class="card update-card">
    <div class="update-head"><div class="avatar">${initials(u.author)}</div>
      <div><div class="who">${esc(u.author)}</div><div class="when">${rel(u.ts)} · ${fullTime(u.ts)}</div></div>
      <div style="margin-left:auto">${typeChip(u.type)}</div></div>
    <div class="update-body">
      ${u.progressPct!=null?`<div style="display:flex;align-items:center;gap:10px;margin:6px 0"><div class="progress" style="flex:1"><i style="width:${u.progressPct}%"></i></div><b style="font-size:13px">${u.progressPct}%</b></div>`:''}
      <div class="note">${esc(u.note)}</div>
      ${photosHtml(u.photos)}
    </div></div>`;
}
function approvalCard(a,customerView){
  const p=S.projects[a.projectId]||{customers:['Customer']};
  return `<div class="card approval-card"><div class="body">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="chip amber">Approval request</span>${chipFor(a.status)}</div>
    <h3 style="margin-top:8px">${esc(a.title)}</h3>
    <div class="ask">${esc(a.detail)}</div>
    ${photosHtml(a.photos)}
    ${a.options&&a.options.length?`<div style="margin:10px 0 2px">`+a.options.map(o=>`<div style="padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;margin-bottom:6px;font-size:13.5px;font-weight:600;background:#fff">${esc(o)}</div>`).join('')+`</div>`:''}
    ${a.status==='pending'
      ? (customerView?`<div class="decision-bar"><button class="btn primary block" onclick="go('#/approve/${a.id}')">Review &amp; respond</button></div>`
        :`<div style="margin-top:10px;color:var(--muted);font-size:13px">Waiting on customer · sent ${rel(a.ts)}</div>`)
      : `<div style="margin-top:10px;font-size:13.5px"><b>${esc(a.decidedBy||'Customer')}</b> ${a.status==='approved'?'approved':'asked for changes'} ${rel(a.decidedTs)}${a.comment?`:<br>“${esc(a.comment)}”`:''}</div>`}
  </div></div>`;
}

/* ---------- PM ---------- */
function viewPM(){
  const myProjects=Object.values(S.projects);
  const cards=myProjects.map(p=>{
    const pend=S.approvals.filter(a=>a.projectId===p.id&&a.status==='pending').length;
    return `<div class="card proj-card">${p.cover?`<div class="cover" style="background-image:url('${mediaUrl(p.cover)}')"><span class="pct">${p.progress}% complete</span></div>`:''}
    <div class="body"><h3>${esc(p.name)}</h3><div class="proj-meta">${esc(p.loc)} ${p.type?'· '+esc(p.type):''}<br>Customer: ${esc((p.customers||[]).join(' & '))}</div>
    <div class="progress"><i style="width:${p.progress}%"></i></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:4px">${pend?`<span class="chip amber">${pend} approval${pend>1?'s':''} pending</span>`:'<span class="chip green">Nothing pending</span>'}
    <button class="btn primary sm" style="margin-left:auto" onclick="go('#/pm/post/${p.id}')">+ Post update</button>
    <button class="btn ghost sm" onclick="go('#/project/${p.id}')">View</button></div></div></div>`;
  }).join('');
  app.innerHTML=`${topbar('Project Manager view')}
  <div class="hero" style="padding-top:10px"><h1>Namaste, ${esc(S.me.name.split(' ')[0])} 👋</h1><p>Post an update — customers see it instantly, and you can send it on WhatsApp in one tap.</p></div>
  <div class="card" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:200px"><b>Bills &amp; invoices</b> <span class="admin-only">Admin only</span><div style="color:var(--muted);font-size:13px">Add vendor bills and invoices. The admin reviews them and approves or asks for add-ons.</div></div>
    <button class="btn primary sm" onclick="go('#/pm/bill')">+ Add bill / invoice</button></div>
  ${myBillsHtml()}
  ${myProjects.length?`<div class="section-label">Your projects</div><div class="grid proj-grid">${cards}</div>`:'<div class="card empty">No projects assigned to you yet - ask the admin.</div>'}`;
}
let draft={type:'progress',photos:[]};
function viewPMPost(pid){
  const p=S.projects[pid]; if(!p)return viewPM();
  draft={type:'progress',photos:[]};
  app.innerHTML=`${topbar('Project Manager view')}
  <div class="hero" style="padding:14px 0 4px"><h1 style="font-size:22px">Post an update</h1><p>${esc(p.name)} · ${esc(p.loc)}</p></div>
  <div class="card" style="padding:18px;margin-top:10px">
    <div class="field"><label>Update type</label>
      <div class="seg" id="seg">
        <button class="on" data-t="progress" onclick="setType('progress')">📈 Progress</button>
        <button data-t="material" onclick="setType('material')">🧱 Material</button>
        <button data-t="approval" onclick="setType('approval')">✅ Request approval</button>
      </div></div>
    <div class="field" id="f-progress"><label>Overall progress</label>
      <div class="range-row"><input type="range" id="inp-pct" min="0" max="100" value="${p.progress}" oninput="document.getElementById('pct-val').textContent=this.value+'%'"><div class="val" id="pct-val">${p.progress}%</div></div></div>
    <div id="f-approval" style="display:none">
      <div class="field"><label>What should the customer decide?</label><input type="text" id="inp-title" placeholder="e.g. Kitchen countertop material"></div>
      <div class="field"><label>Options (one per line)</label><textarea id="inp-options" style="min-height:70px" placeholder="Black Galaxy (within BOQ)&#10;Tan Brown (+₹180/sqft)"></textarea></div>
    </div>
    <div class="field"><label id="note-label">Note for the customer</label><textarea id="inp-note" placeholder="What happened on site today?"></textarea></div>
    <div class="field"><label>Photos (up to 4)</label>
      <div class="gal" id="gal"><label class="g" style="display:flex;align-items:center;justify-content:center;background:#f3efe8;color:var(--muted);font-size:26px;cursor:pointer">+<input type="file" accept="image/*" multiple hidden onchange="uploadPhotos(this)"></label></div>
      <div style="color:var(--muted);font-size:12px;margin-top:6px">Photos are stored in the company Google Drive.</div></div>
    <button class="btn primary block" onclick="submitUpdate(this,'${pid}')">Post update</button>
  </div>`;
}
function setType(t){draft.type=t;document.querySelectorAll('#seg button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));document.getElementById('f-progress').style.display=(t==='progress')?'':'none';document.getElementById('f-approval').style.display=(t==='approval')?'':'none';document.getElementById('note-label').textContent=(t==='approval')?'Details for the customer':'Note for the customer'}
async function uploadPhotos(input){
  const room=4-draft.photos.length;
  for(const f of [...input.files].slice(0,room)){
    const b=await fileToPhoto(f);
    draft.photos.push(b);
    const g=document.createElement('div');g.className='g sel';g.style.backgroundImage=`url('${URL.createObjectURL(f)}')`;
    g.onclick=()=>{draft.photos.splice(draft.photos.indexOf(b),1);g.remove()};
    document.getElementById('gal').appendChild(g);
  }
}
async function submitUpdate(btn,pid){
  const note=document.getElementById('inp-note').value.trim();
  const p=S.projects[pid];
  if(draft.type==='approval'){
    const title=document.getElementById('inp-title').value.trim();
    if(!title)return toast('Add what the customer should decide');
    const options=document.getElementById('inp-options').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const j=await apiBusy(btn,{action:'requestApproval',token:TOKEN,projectId:pid,title,detail:note||'Please review and respond.',options,photos:draft.photos});
    if(!j)return;
    const a=j.approval, link=appLink('#/approve/'+a.id);
    showWaMsg({to:(p.customers||['customer'])[0],
      body:`🏗️ <b>Approval needed</b> — ${esc(p.name)}${p.loc?', '+esc(p.loc):''}\n\n${esc(a.title)}\n\n${esc(a.detail)}`,
      plain:`🏗️ Approval needed — ${p.name}${p.loc?', '+p.loc:''}\n\n${p.pm||'Your site team'} requests your decision:\n${a.title}\n\n${a.detail}${a.options&&a.options.length?'\n\nOptions:\n'+a.options.map(o=>'• '+o).join('\n'):''}\n\nReview and respond: ${link}`,
      btn:'Review & respond →',href:'#/approve/'+a.id,after:'#/project/'+pid});
  }else{
    if(!note)return toast('Write a short note');
    const pct=draft.type==='progress'?parseInt(document.getElementById('inp-pct').value):null;
    const j=await apiBusy(btn,{action:'postUpdate',token:TOKEN,projectId:pid,type:draft.type,note,progressPct:pct,photos:draft.photos});
    if(!j)return;
    showWaMsg({to:(p.customers||['customer'])[0],
      body:`📸 <b>Site update</b> — ${esc(p.name)}\n\n${esc(note)}${pct!=null?`\n\nProgress: ${pct}%`:''}`,
      plain:`📸 Site update — ${p.name}\n\n${note}${pct!=null?`\n\nProgress: ${pct}%`:''}\n\nView project: ${appLink('#/project/'+pid)}`,
      btn:'View project →',href:'#/project/'+pid,after:'#/project/'+pid});
  }
}

/* ---------- bills ---------- */
let billFile=null;
function viewBillForm(){
  billFile=null;
  const opts=Object.values(S.projects).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  app.innerHTML=`${topbar('Project Manager view')}
  <div class="hero" style="padding:14px 0 4px"><h1 style="font-size:22px">Add bill / invoice <span class="admin-only">Admin only</span></h1><p>Goes to the admin for review. Stored in the company Google Drive.</p></div>
  <div class="card" style="padding:18px;margin-top:10px">
    <div class="field"><label>Project</label><select id="b-proj">${opts}</select></div>
    <div class="field"><label>Vendor / supplier</label><input type="text" id="b-vendor" placeholder="e.g. Sri Lakshmi Cement Traders"></div>
    <div class="field"><label>Bill / invoice no.</label><input type="text" id="b-no" placeholder="e.g. INV-2041"></div>
    <div class="field"><label>Amount (₹)</label><input type="number" id="b-amt" inputmode="decimal" min="0" placeholder="e.g. 48500"></div>
    <div class="field"><label>Bill date</label><input type="date" id="b-date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div class="field"><label>Note (optional)</label><textarea id="b-note" style="min-height:64px" placeholder="What is this bill for?"></textarea></div>
    <div class="field"><label>Upload bill (photo or PDF, max ~4 MB)</label><input type="file" accept="image/*,application/pdf" onchange="pickBill(this)"><div id="b-file" style="color:var(--muted);font-size:12px;margin-top:6px">No file chosen.</div></div>
    <div style="display:flex;gap:10px"><button class="btn ghost" onclick="go('#/pm')">Cancel</button><button class="btn primary" style="flex:1" onclick="submitBill(this)">Submit to admin</button></div>
  </div>`;
}
async function pickBill(input){
  const f=input.files[0];if(!f)return;
  if(f.size>4*1024*1024){toast('File too large (max ~4 MB)');input.value='';return}
  billFile=await fileToB64(f);billFile.name=f.name;
  document.getElementById('b-file').textContent='Attached: '+f.name;
}
async function submitBill(btn){
  const vendor=document.getElementById('b-vendor').value.trim();
  const amt=parseFloat(document.getElementById('b-amt').value);
  if(!vendor)return toast('Add the vendor name');
  if(!(amt>0))return toast('Add the bill amount');
  const pid=document.getElementById('b-proj').value;
  const j=await apiBusy(btn,{action:'addBill',token:TOKEN,projectId:pid,vendor,no:document.getElementById('b-no').value.trim(),amount:amt,date:document.getElementById('b-date').value,note:document.getElementById('b-note').value.trim(),fileB64:billFile?billFile.b64:null,fileMime:billFile?billFile.mime:null,fileName:billFile?billFile.name:null});
  if(!j)return;
  const p=S.projects[pid];
  showWaMsg({to:'admin',title:'New bill uploaded',
    body:`🧾 <b>New bill added</b> — ${esc(p.name)}\n\n${esc(S.me.name)} added a bill from <b>${esc(vendor)}</b> for <b>₹${amt.toLocaleString('en-IN')}</b>.`,
    plain:`🧾 New bill added — ${p.name}\n\n${S.me.name} added a bill from ${vendor} for ₹${amt.toLocaleString('en-IN')}.\n\nSign in to view: ${appLink('#/admin')}`,
    btn:'Open bills →',href:'#/admin',after:'#/pm'});
}
function billFileId(b){
  const v=String(b.fileId||b.file||'');if(!v)return '';
  const m=v.match(/[?&]id=([\w-]+)/)||v.match(/\/d\/([\w-]+)/);
  return m?m[1]:v;
}
function billFileLink(b){const id=billFileId(b);return id?`<a href="https://drive.google.com/file/d/${id}/view" target="_blank" rel="noopener" style="font-size:12.5px;font-weight:600">View file</a>`:'<span style="font-size:12px;color:var(--muted)">No file</span>'}
function billStatusChip(b){return b.status==='approved'?'<span class="chip green">Approved</span>':(b.status==='addons'?'<span class="chip red">Add-ons asked</span>':'<span class="chip amber">Needs review</span>')}
function billRow(b,showProject,actions){
  return `<div class="bill-row" style="align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>${esc(b.vendor)}</b>${b.no?` · ${esc(b.no)}`:''} ${billStatusChip(b)}<br><span style="color:var(--muted);font-size:12.5px">${showProject?esc(projectName(b.projectId))+' · ':''}added by ${esc(b.by)} · ${b.date?new Date(b.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):fullTime(b.ts)}${b.note?'<br>'+esc(b.note):''}${b.status==='addons'&&b.adminNote?`<br><b style="color:var(--red)">Admin asked: ${esc(b.adminNote)}</b>`:''}</span></div>
    <div class="amt">₹${b.amount.toLocaleString('en-IN')}<br>${billFileLink(b)}</div>
    ${actions?`<div style="flex-basis:100%;display:flex;gap:8px;flex-wrap:wrap">${actions}</div>`:''}</div>`;
}
/* universal board: bills waiting for admin review */
function billsHtml(){
  const all=[...(S.bills||[])].sort((a,b)=>b.ts-a.ts);
  const open=all.filter(b=>b.status!=='approved');
  const apprTotal=all.filter(b=>b.status==='approved').reduce((s,b)=>s+b.amount,0);
  return `<div class="section-label">Bills to review <span class="admin-only">Admin only</span></div>
  <div class="card"><div style="padding:12px 16px;font-size:13.5px;color:var(--muted)">${open.length} waiting · approved bills (₹${apprTotal.toLocaleString('en-IN')}) move into each project's page</div>
  ${open.map(b=>billRow(b,true,b.status==='pending'?`<button class="btn green sm" onclick="reviewBill(this,'${b.id}','approved')">✓ Approve</button><button class="btn ghost sm" onclick="askAddons(this,'${b.id}')">Ask for add-ons</button>`:`<span style="font-size:12.5px;color:var(--muted)">Waiting for ${esc(b.by)} to send the add-on.</span><button class="btn green sm" onclick="reviewBill(this,'${b.id}','approved')">✓ Approve anyway</button>`)).join('')||'<div class="empty">No bills waiting for review.</div>'}</div>`;
}
/* per-project bills section: approved bills only */
function projectBillsHtml(pid){
  if(S.me.role!=='admin')return '';
  const bills=(S.bills||[]).filter(b=>b.projectId===pid&&b.status==='approved').sort((a,b)=>b.ts-a.ts);
  const waiting=(S.bills||[]).filter(b=>b.projectId===pid&&b.status!=='approved').length;
  const total=bills.reduce((s,b)=>s+b.amount,0);
  return `<div class="section-label">Bills <span class="admin-only">Admin only</span></div>
  <div class="card"><div style="padding:12px 16px;font-size:13.5px;color:var(--muted)">${bills.length} approved · total <b style="color:var(--ink)">₹${total.toLocaleString('en-IN')}</b>${waiting?` · ${waiting} still waiting on the admin board`:''}</div>
  ${bills.map(b=>billRow(b,false,'')).join('')||'<div class="empty">No approved bills for this project yet.</div>'}</div>`;
}
/* PM: own bills that were sent back */
function myBillsHtml(){
  const mine=(S.bills||[]).filter(b=>b.status!=='approved').sort((a,b)=>b.ts-a.ts);
  if(!mine.length)return '';
  return `<div class="section-label">Your bills in review</div><div class="card">${mine.map(b=>billRow(b,true,b.status==='addons'?`<button class="btn primary sm" onclick="addonForm('${b.id}')">Send add-on</button>`:'')).join('')}<div id="addon-form"></div></div>`;
}
async function reviewBill(btn,id,decision,note){
  const j=await apiBusy(btn,{action:'reviewBill',token:TOKEN,billId:id,decision,note:note||''});
  if(j){toast(decision==='approved'?'Bill approved - moved to its project':'Sent back for add-ons');render()}
}
function askAddons(btn,id){
  const note=prompt('What add-on do you need from the PM? (e.g. GST invoice copy, vendor name, correct amount)');
  if(note&&note.trim())reviewBill(btn,id,'addons',note.trim());
}
let addonFile=null;
function addonForm(id){
  addonFile=null;
  document.getElementById('addon-form').innerHTML=`<div style="padding:14px 16px;border-top:1px solid var(--line)"><div class="field"><label>Add-on note</label><textarea id="ad-note" style="min-height:60px" placeholder="What did you add or fix?"></textarea></div>
  <div class="field"><label>New file (optional)</label><input type="file" accept="image/*,application/pdf" onchange="pickAddon(this)"></div>
  <button class="btn primary sm" onclick="sendAddon(this,'${id}')">Send back for review</button></div>`;
}
async function pickAddon(input){const f=input.files[0];if(!f)return;if(f.size>4*1024*1024){input.value='';return toast('File too large (max ~4 MB)')}addonFile=await fileToB64(f);addonFile.name=f.name}
async function sendAddon(btn,id){
  const note=document.getElementById('ad-note').value.trim();
  if(!note&&!addonFile)return toast('Add a note or a file');
  const j=await apiBusy(btn,{action:'resubmitBill',token:TOKEN,billId:id,note,fileB64:addonFile?addonFile.b64:null,fileMime:addonFile?addonFile.mime:null,fileName:addonFile?addonFile.name:null});
  if(j){toast('Sent back to admin');render()}
}
/* ---------- customer ---------- */
function viewCustomer(){
  const items=Object.values(S.projects).map(p=>{
    const pend=S.approvals.filter(a=>a.projectId===p.id&&a.status==='pending').length;
    return `<button class="card role-card" onclick="go('#/project/${p.id}')"><h3>${esc(p.name)}</h3>
    <p>${esc(p.loc)} ${p.type?'· '+esc(p.type):''}</p>
    <div style="display:flex;gap:8px;align-items:center">${pend?`<span class="chip amber">${pend} awaiting you</span>`:'<span class="chip green">All caught up</span>'}<span class="go" style="margin-left:auto;font-weight:700;color:var(--brand);font-size:13.5px">Open →</span></div></button>`;
  }).join('');
  app.innerHTML=`${topbar('Customer view')}
  <div class="hero" style="padding-top:10px"><h1>Namaste, ${esc(S.me.name.split(' ')[0])} 👋</h1><p>Your project's progress, photos and decisions - all in one place.</p></div>
  <div class="grid" style="margin-top:14px">${items||'<div class="card empty">No projects linked to your login yet - ask your builder.</div>'}</div>`;
}
function viewProject(pid){
  const p=S.projects[pid]; if(!p)return S.me.role==='pm'?viewPM():viewCustomer();
  const approvals=S.approvals.filter(a=>a.projectId===pid).sort((x,y)=>y.ts-x.ts);
  const updates=S.updates.filter(u=>u.projectId===pid).sort((x,y)=>y.ts-x.ts);
  const pend=approvals.filter(a=>a.status==='pending');
  const customerView=S.me.role==='customer'||S.me.role==='admin';
  app.innerHTML=`${topbar(S.me.role==='pm'?'Project Manager view':(S.me.role==='admin'?'Project view':'Customer view'))}
  <div class="card proj-card" style="margin-top:10px">${p.cover?`<div class="cover" style="background-image:url('${mediaUrl(p.cover)}');height:170px"><span class="pct">${p.progress}% complete</span></div>`:''}
  <div class="body"><h3>${esc(p.name)}</h3><div class="proj-meta">${esc(p.loc)} ${p.type?'· '+esc(p.type):''}<br>Project Manager: ${esc(p.pm||'-')}</div>
  <div class="progress"><i style="width:${p.progress}%"></i></div></div></div>
  ${pend.length?`<div class="section-label">Needs your decision</div><div class="feed">${pend.map(a=>approvalCard(a,customerView)).join('')}</div>`:''}
  <div class="section-label">Site updates</div>
  <div class="feed">${updates.length?updates.map(updateCard).join(''):'<div class="card empty">No updates yet.</div>'}</div>
  ${projectBillsHtml(pid)}
  ${approvals.filter(a=>a.status!=='pending').length?`<div class="section-label">Past decisions</div><div class="feed">${approvals.filter(a=>a.status!=='pending').map(a=>approvalCard(a,customerView)).join('')}</div>`:''}`;
}
function viewApprove(aid){
  const a=S.approvals.find(x=>x.id===aid); if(!a)return go('#/customer');
  const p=S.projects[a.projectId]||{name:'',pm:''};
  if(a.status!=='pending'){
    app.innerHTML=`${topbar('',false)}
    <div class="card" style="padding:26px 20px;margin-top:14px"><div class="center">
    <div class="success-ic">${a.status==='approved'?'✓':'✎'}</div>
    <h1 style="font-size:20px;font-weight:800">${a.status==='approved'?'Approved':'Response recorded'}</h1>
    <p style="color:var(--muted);margin-top:6px">“${esc(a.title)}” — ${esc(p.name)}<br>${a.comment?`Your response: “${esc(a.comment)}”<br>`:''}Recorded ${rel(a.decidedTs)}.</p>
    <div class="decision-bar"><a class="btn wa block" style="text-align:center" href="${waLink((a.status==='approved'?'✅ Approved: ':'✏️ Changes requested: ')+a.title+' — '+p.name+(a.comment?'\n\nResponse: '+a.comment:''))}" target="_blank" rel="noopener">Send this response on WhatsApp →</a>
    <button class="btn ghost block" onclick="go('#/project/${p.id}')">View project feed</button></div></div></div>`;
    return;
  }
  app.innerHTML=`${topbar('Approval request',false)}
  <div class="card approval-card" style="margin-top:14px"><div class="body">
    <div style="display:flex;gap:8px;align-items:center"><span class="chip amber">Approval request</span><span class="chip grey">${esc(p.name)}</span></div>
    <h3 style="margin-top:10px;font-size:19px">${esc(a.title)}</h3>
    <div class="ask">From ${esc(p.pm||'your site team')} (Project Manager) · ${rel(a.ts)}</div>
    <div style="font-size:14.5px;white-space:pre-wrap">${esc(a.detail)}</div>
    ${photosHtml(a.photos)}
    ${a.options&&a.options.length?`<div class="field" style="margin-top:12px"><label>Your choice</label><select id="inp-choice">${a.options.map(o=>`<option>${esc(o)}</option>`).join('')}</select></div>`:''}
    <div class="field" style="margin-top:12px"><label>Comment (optional)</label><textarea id="inp-comment" style="min-height:64px" placeholder="Anything the site team should know?"></textarea></div>
    <div class="decision-bar"><button class="btn green" onclick="decide(this,'${a.id}','approved')">✓ Approve</button><button class="btn red" onclick="decide(this,'${a.id}','rejected')">Request changes</button></div>
  </div></div>`;
}
async function decide(btn,aid,status){
  const comment=(document.getElementById('inp-comment')||{}).value?.trim()||'';
  const choice=(document.getElementById('inp-choice')||{}).value||'';
  const j=await apiBusy(btn,{action:'decide',token:TOKEN,approvalId:aid,status,comment,choice});
  if(j){toast('Response saved');viewApprove(aid)}
}

/* ---------- admin ---------- */
function viewAdmin(){
  const projs=Object.values(S.projects);
  const pend=S.approvals.filter(a=>a.status==='pending');
  const week=S.updates.filter(u=>Date.now()-u.ts<7*DAY).length;
  const log=S.log||[];
  const filter=document.getElementById('log-filter')?.value||'all';
  const rows=log.filter(l=>filter==='all'||l.projectId===filter).map(l=>{
    const dc=l.action.startsWith('approved')?'var(--green)':(l.action.startsWith('asked')?'var(--red)':'var(--brand)');
    return `<div class="log-row"><div class="log-dot" style="background:${dc}"></div>
    <div style="flex:1"><div class="txt"><b>${esc(l.actor)}</b> ${esc(l.action)}${l.projectId?` — <b>${esc(projectName(l.projectId))}</b>`:''}<br><span style="color:var(--muted)">${esc(l.detail)}</span></div>
    <div class="time">${Date.now()-l.ts<7*DAY?fullTime(l.ts)+' · '+rel(l.ts):fullTime(l.ts)}</div></div></div>`;
  }).join('');
  app.innerHTML=`${topbar('Admin view')}
  <div class="hero" style="padding-top:10px"><h1>Builder admin</h1><p>Every project, pending decision and action across the company — one log.</p></div>
  <div class="grid admin-stats">
    <div class="card stat"><div class="num">${projs.length}</div><div class="lbl">Active projects</div></div>
    <div class="card stat"><div class="num" style="color:var(--amber)">${pend.length}</div><div class="lbl">Approvals pending</div></div>
    <div class="card stat"><div class="num">${week}</div><div class="lbl">Updates this week</div></div>
  </div>
  <div class="card" style="padding:14px 16px;margin-top:4px;display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn primary sm" onclick="go('#/admin/projects')">Manage projects</button>
    <button class="btn primary sm" onclick="go('#/admin/users')">Manage logins</button>
    <button class="btn wa sm" onclick="go('#/admin/whatsapp')">WhatsApp number</button>
  </div>
  <div class="section-label">Projects</div>
  <div class="grid proj-grid">${projs.map(p=>{
    const pc=S.approvals.filter(a=>a.projectId===p.id&&a.status==='pending').length;
    return `<div class="card proj-card" onclick="go('#/project/${p.id}')" style="cursor:pointer">${p.cover?`<div class="cover" style="background-image:url('${mediaUrl(p.cover)}')"><span class="pct">${p.progress}% complete</span></div>`:''}<div class="body"><div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">${esc(p.name)}</h3>${pc?`<span class="chip amber">${pc} pending</span>`:'<span class="chip green">Clear</span>'}</div>
    <div class="proj-meta">${esc(p.loc)} · PM ${esc(p.pm||'-')}<br>Customer: ${esc((p.customers||[]).join(' & '))}</div>
    <div style="display:flex;align-items:center;gap:10px"><div class="progress" style="flex:1"><i style="width:${p.progress}%"></i></div><b style="font-size:13px">${p.progress}%</b></div></div></div>`;
  }).join('')||'<div class="card empty">No projects yet - add your first from Manage projects.</div>'}</div>
  <div class="section-label">Pending approvals</div>
  <div class="feed">${pend.length?pend.map(a=>approvalCard(a,false)).join(''):'<div class="card empty">Nothing waiting on a customer.</div>'}</div>
  ${billsHtml()}
  <div class="section-label">Activity log</div>
  <div class="card"><div style="padding:12px 16px 4px"><select id="log-filter" onchange="viewAdmin()" style="border:1.5px solid var(--line);border-radius:10px;padding:8px 10px;background:#fff;font-size:13px">
    <option value="all">All projects</option>${projs.map(p=>`<option value="${p.id}" ${filter===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
  <div class="log">${rows||'<div class="empty">No activity yet.</div>'}</div></div>`;
}

/* ---------- admin: projects CRUD ---------- */
function viewAdminProjects(){
  const projs=Object.values(S.projects);
  app.innerHTML=`${topbar('Admin · Manage projects')}
  <div class="hero" style="padding-top:10px"><h1>Projects</h1><p>Add a project for each site. Customers and PMs see only their projects.</p></div>
  <div class="card" style="padding:18px;margin-top:10px"><b>+ Add project</b>
    <div class="field" style="margin-top:10px"><label>Project name</label><input type="text" id="np-name" placeholder="e.g. Lakeview Villa"></div>
    <div class="field"><label>Location</label><input type="text" id="np-loc" placeholder="e.g. Kokapet, Hyderabad"></div>
    <div class="field"><label>Type</label><input type="text" id="np-type" placeholder="e.g. Independent villa · 3 BHK"></div>
    <div class="field"><label>Customer name(s)</label><input type="text" id="np-cust" placeholder="e.g. Ananya Reddy & Vikram Reddy"></div>
    <div class="field"><label>Project Manager name</label><input type="text" id="np-pm" placeholder="e.g. Rajesh Verma"></div>
    <div class="field"><label>Cover photo (optional)</label><input type="file" accept="image/*" id="np-cover"></div>
    <button class="btn primary block" onclick="addProject(this)">Add project</button></div>
  ${projs.map(p=>`<div class="card" style="padding:16px 18px;margin-top:12px"><div style="display:flex;align-items:center;gap:8px"><b style="flex:1">${esc(p.name)}</b>
    <button class="btn ghost sm" onclick="editProject('${p.id}')">Edit</button>
    <button class="btn red sm" onclick="deleteProject(this,'${p.id}','${esc(p.name)}')">Delete</button></div>
    <div class="proj-meta" style="margin-top:6px">${esc(p.loc)} ${p.type?'· '+esc(p.type):''} · PM ${esc(p.pm||'-')}<br>Customer: ${esc((p.customers||[]).join(' & '))} · ${p.progress}% complete</div>
    <div id="edit-${p.id}"></div></div>`).join('')}
  <div class="footer-note"><a href="javascript:go('#/admin')">Back to admin</a></div>`;
}
async function addProject(btn){
  const name=document.getElementById('np-name').value.trim();
  if(!name)return toast('Add the project name');
  let cover=null,coverMime=null;
  const cf=document.getElementById('np-cover').files[0];
  if(cf){const b=await fileToPhoto(cf);cover=b.b64;coverMime=b.mime}
  const j=await apiBusy(btn,{action:'addProject',token:TOKEN,name,loc:document.getElementById('np-loc').value.trim(),type:document.getElementById('np-type').value.trim(),customers:document.getElementById('np-cust').value.split('&').map(s=>s.trim()).filter(Boolean),pm:document.getElementById('np-pm').value.trim(),coverB64:cover,coverMime});
  if(j){toast('Project added');viewAdminProjects()}
}
function editProject(pid){
  const p=S.projects[pid];
  document.getElementById('edit-'+pid).innerHTML=`<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
    <div class="field"><label>Name</label><input type="text" id="ep-name-${pid}" value="${esc(p.name)}"></div>
    <div class="field"><label>Location</label><input type="text" id="ep-loc-${pid}" value="${esc(p.loc)}"></div>
    <div class="field"><label>Type</label><input type="text" id="ep-type-${pid}" value="${esc(p.type)}"></div>
    <div class="field"><label>Customer name(s)</label><input type="text" id="ep-cust-${pid}" value="${esc((p.customers||[]).join(' & '))}"></div>
    <div class="field"><label>Project Manager name</label><input type="text" id="ep-pm-${pid}" value="${esc(p.pm||'')}"></div>
    <div class="field"><label>Progress (%)</label><input type="number" id="ep-prog-${pid}" min="0" max="100" value="${p.progress}"></div>
    <div class="field"><label>New cover photo (optional)</label><input type="file" accept="image/*" id="ep-cover-${pid}"></div>
    <button class="btn primary sm" onclick="saveProject(this,'${pid}')">Save changes</button></div>`;
}
async function saveProject(btn,pid){
  let cover=null,coverMime=null;
  const cf=document.getElementById('ep-cover-'+pid).files[0];
  if(cf){const b=await fileToPhoto(cf);cover=b.b64;coverMime=b.mime}
  const j=await apiBusy(btn,{action:'updateProject',token:TOKEN,projectId:pid,name:document.getElementById('ep-name-'+pid).value,loc:document.getElementById('ep-loc-'+pid).value,type:document.getElementById('ep-type-'+pid).value,customers:document.getElementById('ep-cust-'+pid).value.split('&').map(s=>s.trim()).filter(Boolean),pm:document.getElementById('ep-pm-'+pid).value,progress:document.getElementById('ep-prog-'+pid).value,coverB64:cover,coverMime});
  if(j){toast('Saved');viewAdminProjects()}
}
async function deleteProject(btn,pid,name){
  if(!confirm(`Delete "${name}" and all its updates, approvals and bills? This cannot be undone.`))return;
  const j=await apiBusy(btn,{action:'deleteProject',token:TOKEN,projectId:pid});
  if(j){toast('Deleted');viewAdminProjects()}
}

/* ---------- admin: users CRUD ---------- */
function viewAdminUsers(){
  const projs=Object.values(S.projects);
  const userRow=u=>`<div class="card" style="padding:14px 16px;margin-top:10px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <b style="flex:1">${esc(u.name)} <span style="color:var(--muted);font-weight:400">· ${esc(u.username)}</span></b>
    <span class="chip ${u.role==='admin'?'blue':'grey'}">${u.role==='pm'?'Project Manager':u.role}</span>
    ${u.id!==S.me.id?`<button class="btn red sm" onclick="deleteUser(this,'${u.id}','${esc(u.name)}')">Remove</button>`:''}</div>
    <div class="proj-meta" style="margin-top:6px">Projects: ${(u.projectIds||[]).map(projectName).join(', ')||'-'}</div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <input type="text" id="pw-${u.id}" placeholder="New password" style="flex:1;min-width:140px;border:1.5px solid var(--line);border-radius:10px;padding:8px 12px;font-size:13px">
      <select id="pj-${u.id}" multiple size="${Math.min(Math.max(projs.length,1),3)}" style="flex:2;min-width:180px;border:1.5px solid var(--line);border-radius:10px;padding:6px;font-size:13px">${projs.map(p=>`<option value="${p.id}" ${(u.projectIds||[]).includes(p.id)?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <button class="btn primary sm" onclick="saveUser(this,'${u.id}')">Save</button></div></div>`;
  app.innerHTML=`${topbar('Admin · Manage logins')}
  <div class="hero" style="padding-top:10px"><h1>Logins</h1><p>Create a login for each project manager, customer and admin. Hold Ctrl/Cmd to pick multiple projects.</p></div>
  <div class="card" style="padding:18px;margin-top:10px"><b>+ Add login</b>
    <div class="field" style="margin-top:10px"><label>Full name</label><input type="text" id="nu-name" placeholder="e.g. Rajesh Verma"></div>
    <div class="field"><label>Login ID</label><input type="text" id="nu-id" autocapitalize="none" placeholder="e.g. rajesh"></div>
    <div class="field"><label>Password</label><input type="text" id="nu-pw" placeholder="Share it with them privately"></div>
    <div class="field"><label>Role</label><select id="nu-role"><option value="pm">Project Manager</option><option value="customer">Customer</option><option value="admin">Admin</option></select></div>
    <div class="field"><label>Projects (their access)</label><select id="nu-pj" multiple size="${Math.min(Math.max(projs.length,1),3)}">${projs.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
    <button class="btn primary block" onclick="addUser(this)">Add login</button></div>
  ${(S.users||[]).map(userRow).join('')}
  <div class="footer-note"><a href="javascript:go('#/admin')">Back to admin</a></div>`;
}
async function addUser(btn){
  const name=document.getElementById('nu-name').value.trim(), id=document.getElementById('nu-id').value.trim(), pw=document.getElementById('nu-pw').value;
  if(!name||!id||!pw)return toast('Name, ID and password are needed');
  const pj=[...document.getElementById('nu-pj').selectedOptions].map(o=>o.value);
  const j=await apiBusy(btn,{action:'addUser',token:TOKEN,name,username:id,pass:pw,role:document.getElementById('nu-role').value,projectIds:pj});
  if(j){toast('Login added');viewAdminUsers()}
}
async function saveUser(btn,uid){
  const pw=document.getElementById('pw-'+uid).value;
  const pj=[...document.getElementById('pj-'+uid).selectedOptions].map(o=>o.value);
  const j=await apiBusy(btn,{action:'updateUser',token:TOKEN,userId:uid,pass:pw||undefined,projectIds:pj});
  if(j){toast('Saved');viewAdminUsers()}
}
async function deleteUser(btn,uid,name){
  if(!confirm(`Remove the login for ${name}?`))return;
  const j=await apiBusy(btn,{action:'deleteUser',token:TOKEN,userId:uid});
  if(j){toast('Removed');viewAdminUsers()}
}

/* ---------- admin: whatsapp settings ---------- */
function viewWaSetup(){
  app.innerHTML=`${topbar('WhatsApp number')}
  <div class="hero" style="padding-top:10px"><h1>WhatsApp notifications</h1><p>Click-to-WhatsApp: every notification opens WhatsApp with the message pre-filled, addressed to this number — you just press send.</p></div>
  <div class="card" style="padding:18px;margin-bottom:14px">
    <div class="field"><label>WhatsApp number (with country code)</label><input type="tel" id="wa-num" value="${esc(waNum())}"></div>
    <button class="btn primary" onclick="saveWa(this)">Save</button>
  </div>
  <div class="card" style="padding:18px"><b>How it works — click-to-WhatsApp</b>
    <ol class="wa-steps"><li>A PM posts an update, approval request or bill.</li>
    <li>Bala opens WhatsApp on the spot with the message pre-filled, addressed to the number above.</li>
    <li>You press send — done. Nothing to set up with Meta, no message charges.</li></ol>
    <span style="color:var(--muted);font-size:12.5px">Later, messages can go out automatically through the WhatsApp Business Platform (Cloud API). Not needed for this version.</span></div>
  <div class="footer-note"><a href="javascript:go('#/admin')">Back to admin</a></div>`;
}
async function saveWa(btn){
  const j=await apiBusy(btn,{action:'saveSettings',token:TOKEN,waNumber:document.getElementById('wa-num').value.trim()});
  if(j)toast('Saved');
}

/* ---------- router ---------- */
function canView(role,h){
  if(h.startsWith('#/pm'))return role==='pm'||role==='admin';
  if(h.startsWith('#/admin'))return role==='admin';
  if(h==='#/customer')return true;
  if(h.startsWith('#/approve/'))return true;
  if(h.startsWith('#/project/'))return true;
  return true;
}
async function render(){
  const h=location.hash||'#/';
  overlayRoot.innerHTML='';window.scrollTo(0,0);
  if(h==='#/setup')return viewSetup();
  if(!S){
    if(TOKEN){
      app.innerHTML='<div class="card empty" style="margin-top:20vh">Loading…</div>';
      try{const j=await api({action:'state',token:TOKEN});S=j.state}catch(e){TOKEN='';localStorage.removeItem('bala.token');return viewLogin()}
    }else{
      if(h!=='#/login'){location.hash='#/login';return}
      return viewLogin();
    }
  }
  if(h==='#/login')return go(S.me.role==='admin'?'#/admin':S.me.role==='pm'?'#/pm':'#/customer');
  if(!canView(S.me.role,h)){toast('That page is not available for your login');return go(S.me.role==='admin'?'#/admin':S.me.role==='pm'?'#/pm':'#/customer')}
  if(h.startsWith('#/pm/post/'))return viewPMPost(h.split('/')[3]);
  if(h==='#/pm')return viewPM();
  if(h==='#/customer')return viewCustomer();
  if(h.startsWith('#/project/'))return viewProject(h.split('/')[2]);
  if(h.startsWith('#/approve/'))return viewApprove(h.split('/')[2]);
  if(h==='#/pm/bill')return viewBillForm();
  if(h==='#/admin')return viewAdmin();
  if(h==='#/admin/projects')return viewAdminProjects();
  if(h==='#/admin/users')return viewAdminUsers();
  if(h==='#/admin/whatsapp')return viewWaSetup();
  return go(S.me.role==='admin'?'#/admin':S.me.role==='pm'?'#/pm':'#/customer');
}
window.addEventListener('hashchange',render);

/* boot: read API URL from config.js, then render */
fetch('config.js').then(r=>r.text()).then(t=>{const m=t.match(/API_URL\s*=\s*['"]([^'"]+)['"]/);if(m)API_URL=m[1]}).catch(()=>{}).finally(render);
