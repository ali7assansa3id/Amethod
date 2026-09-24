/* ============================================================
   AHMETHOD — js/app.js
   المحرك المحاسبي الأصلي كاملًا (نفس ملف COFFE-BATRA2026-9.html):
   المبيعات / المشتريات / المخازن / الخزائن والبنوك / الموظفين /
   حقوق الملكية / المصروفات / اليومية / التقارير / الإعدادات / المستخدمين.

   التعديلات الوحيدة عن الملف الأصلي:
   - تخزين بيانات كل شركة على مفتاح مستقل (localStorage + Firebase)
   - loadDB(companyId, cb) بدل loadDB() ، وsaveDB() يزامن مع Firebase
   - showApp / doLogout / buildNav (اسم الشركة + زر الرجوع للوحة الإدارة)
   - saveUser/deleteUser (تفرّد اسم المستخدم على مستوى المنصة)
   - importBackup لا يستبدل مستخدمي الشركة
   - حذف مستمع DOMContentLoaded الأصلي (انتقل إلى js/auth.js)
   ============================================================ */
/* ============ CORE DATA & UTIL ============ */
const ALL_MODULES=[
 {id:'dashboard',label:'الرئيسية'},
 {id:'sales',label:'المبيعات'},
 {id:'purchases',label:'المشتريات'},
 {id:'inventory',label:'المخازن'},
 {id:'treasury',label:'البنوك والخزينة'},
 {id:'employees',label:'الموظفين'},
 {id:'equity',label:'حقوق الملكية'},
 {id:'expenses',label:'المصروفات'},
 {id:'journal',label:'اليومية الأمريكية'},
 {id:'reports',label:'التقارير'},
 {id:'users',label:'المستخدمين'},
 {id:'settings',label:'الإعدادات'},
];

function defaultData(){
 return {
  users:[{id:1,username:'admin',password:'admin123',isAdmin:true,perms:{}}],
  customers:[], suppliers:[],
  warehouses:[{id:1,name:'المخزن الرئيسي'}],
  items:[],
  stockBatches:[],
  stockOps:[], // log of all inventory operations
  salesInvoices:[], salesReturns:[],
  purchaseInvoices:[], purchaseReturns:[],
  supplierCommissions:[],
  expenseCategories:[{id:1,name:'ضيافة'},{id:2,name:'نثريات'},{id:3,name:'مصاريف بنكية'},{id:4,name:'خصم مسموح به'},{id:5,name:'عمولة منصات البيع'}],
  expenses:[],
  cashboxes:[{id:1,name:'الخزينة الرئيسية',balance:0}],
  banks:[{id:1,name:'البنك الرئيسي',balance:0}],
  vouchers:[], // cash/bank receipt & payment
  transfers:[], // cashbox<->bank
  checks:[],
  custodies:[],
  employees:[],
  attendance:[],
  advances:[],
  salaryClosures:[],
  partners:[],
  fixedAssets:[],
  otherIncome:[],
  platformSettlements:[],
  profitDistributions:[],
  settings:{companyName:'', logo:''},
  capitalTx:[],
  partnersCurrent:[],
  journal:[],
  auditLog:[],
  counters:{inv:1000, pinv:2000, sret:3000, pret:4000, exp:5000, vch:6000, jrn:7000, chk:8000, cust:9000, inc:9500},
  currentUserId:null,
 };
}

let DB = defaultData();

/* ---------- التخزين: localStorage (فوري) + Firebase (مزامنة سحابية) ---------- */
// إعدادات مشروعك على Firebase (ahmethodpro). المفتاح ده client-side وعادي يكون ظاهر،
// الحماية الحقيقية بتيجي من الـ Security Rules في لوحة تحكم Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyCnuv-hBxucSgRN-_SD0i6jx3Xv7CR_gQU",
  authDomain: "ahmethodpro.firebaseapp.com",
  databaseURL: "https://ahmethodpro-default-rtdb.firebaseio.com",
  projectId: "ahmethodpro",
  storageBucket: "ahmethodpro.firebasestorage.app",
  messagingSenderId: "545312965626",
  appId: "1:545312965626:web:94eb7366be72a6dc965a43",
  measurementId: "G-L542GK25F0"
};
const FB_AVAILABLE = (typeof firebase !== 'undefined');
if (FB_AVAILABLE && !firebase.apps.length) firebase.initializeApp(firebaseConfig);

// كل شركة ليها مفتاح localStorage ومسار Firebase خاص بيها فقط.
let STORAGE_KEY = 'acc_system_data_v1';      // يتحول إلى acc_system_data_v1__<companyId> في loadDB
let fbRef = null;                            // ERP_COMPANIES/<companyId>
let _usersSig = null;                        // آخر توقيع مستخدمين تمت مزامنته مع فهرس المنصة

function parseRemoteDB(remote){
  // النسخة الحالية بتتخزن على Firebase كنص JSON (عشان Firebase بيمسح المصفوفات/الكائنات الفاضية
  // وبيرفض أي قيمة undefined). بنقبل كمان الشكل القديم (كائن) للشركات اللي اتسجلت قبل كده.
  if(remote == null) return null;
  if(typeof remote === 'string'){ try{ return JSON.parse(remote); }catch(e){ return null; } }
  if(typeof remote === 'object') return remote;
  return null;
}

function normalizeDB(){
  if(!DB || typeof DB !== 'object' || Array.isArray(DB)) DB = defaultData();
  const def = defaultData();
  for(const k in def){
    if(!(k in DB) || DB[k] == null) DB[k] = def[k];
    else if(Array.isArray(def[k]) && !Array.isArray(DB[k]) && typeof DB[k] === 'object') DB[k] = Object.values(DB[k]);
  }
  for(const k in def.counters){ if(typeof DB.counters[k] !== 'number') DB.counters[k] = def.counters[k]; }
  migrateWarehouseIds();
}

function loadDB(companyId, onReady){
  flushCloudPush(); // لو فيه تعديلات معلّقة على الشركة السابقة ابعتها قبل التبديل
  window.ACTIVE_COMPANY_ID = companyId;
  STORAGE_KEY = 'acc_system_data_v1__' + companyId;
  DB = defaultData();
  _usersSig = null;
  fbRef = FB_AVAILABLE ? firebase.database().ref('ERP_COMPANIES/' + companyId) : null;

  let finished = false;
  const useLocal = (pushToCloud) => {
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) DB = JSON.parse(raw);
    }catch(e){ console.error('خطأ في تحميل النسخة المحلية الاحتياطية', e); }
    finish(pushToCloud);
  };
  const finish = (pushToCloud) => {
    if(finished) return; finished = true;
    clearTimeout(timer);
    normalizeDB();
    if(pushToCloud && fbRef) scheduleCloudPush(serializeDB());
    if(onReady) onReady();
  };
  // لو النت مقطوع Firebase بيفضل معلّق — بعد 8 ثواني نكمل بآخر نسخة محلية
  const timer = setTimeout(() => { if(!finished){ console.warn('Firebase بطيء/غير متاح — استخدام النسخة المحلية'); useLocal(false); } }, 8000);

  if(!fbRef){ useLocal(false); return; }
  fbRef.once('value').then(snapshot => {
    if(finished) return;
    const remote = parseRemoteDB(snapshot.val());
    if(remote){ DB = remote; finish(false); }
    else useLocal(true); // السحابة فاضية: استخدم أي نسخة محلية وارفعها
  }).catch(err => {
    console.error('تعذر الاتصال بـ Firebase — سيتم استخدام آخر نسخة محلية محفوظة', err);
    useLocal(false);
  });
}

// upgrade: assign the main warehouse to any old records saved before per-line warehouse existed,
// so stock from old purchase/sales invoices shows up correctly when filtering by warehouse
function migrateWarehouseIds(){
 const mainWh = DB.warehouses[0]?.id; if(!mainWh) return;
 let changed=false;
 (DB.stockBatches||[]).forEach(b=>{ if(b.warehouseId===undefined||b.warehouseId===null||b.warehouseId===''){ b.warehouseId=mainWh; changed=true; } });
 (DB.stockOps||[]).forEach(o=>{ if(o.warehouseId===undefined||o.warehouseId===null||o.warehouseId===''){ o.warehouseId=mainWh; changed=true; } });
 (DB.purchaseInvoices||[]).forEach(inv=> (inv.lines||[]).forEach(l=>{ if(l.warehouseId===undefined||l.warehouseId===null||l.warehouseId===''){ l.warehouseId=mainWh; changed=true; } }));
 (DB.salesInvoices||[]).forEach(inv=> (inv.lines||[]).forEach(l=>{ if(l.warehouseId===undefined||l.warehouseId===null||l.warehouseId===''){ l.warehouseId=mainWh; changed=true; } }));
 (DB.purchaseReturns||[]).forEach(r=> (r.lines||[]).forEach(l=>{ if(l.warehouseId===undefined||l.warehouseId===null||l.warehouseId===''){ l.warehouseId=mainWh; changed=true; } }));
 (DB.salesReturns||[]).forEach(r=> (r.lines||[]).forEach(l=>{ if(l.warehouseId===undefined||l.warehouseId===null||l.warehouseId===''){ l.warehouseId=mainWh; changed=true; } }));
 if(changed) saveDB();
}

function serializeDB(){
  // المستخدم الحالي خاص بكل جهاز (بيتحفظ في جلسة المنصة) — منخزنوش في بيانات الشركة المشتركة
  return JSON.stringify(Object.assign({}, DB, { currentUserId: null }));
}

let _cloudTimer = null, _cloudPending = null;
function scheduleCloudPush(json){
  if(!fbRef) return;
  _cloudPending = { ref: fbRef, json };
  clearTimeout(_cloudTimer);
  _cloudTimer = setTimeout(flushCloudPush, 700); // تجميع الحفظات المتتالية في كتابة واحدة
}
function flushCloudPush(){
  clearTimeout(_cloudTimer); _cloudTimer = null;
  if(!_cloudPending) return;
  const { ref, json } = _cloudPending; _cloudPending = null;
  try{
    ref.set(json).catch(err => {
      console.error('فشل حفظ البيانات على Firebase', err);
      toast('تعذّرت المزامنة مع قاعدة البيانات السحابية (تم الحفظ محليًا فقط)');
    });
  }catch(e){ console.error('فشل حفظ البيانات على Firebase', e); }
}
window.addEventListener('pagehide', flushCloudPush);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushCloudPush(); });

function saveDB(){
  if(!window.ACTIVE_COMPANY_ID || !DB) return; // لا يوجد سياق شركة نشطة (قبل تسجيل الدخول)
  let json = null;
  try{
    json = serializeDB();
    localStorage.setItem(STORAGE_KEY, json);
  }catch(e){ console.error('فشل حفظ البيانات في LocalStorage', e); }
  if(json) scheduleCloudPush(json);
  // فهرس أسماء المستخدمين العام (لتوجيه الدخول) — بنحدّثه فقط لما قائمة المستخدمين تتغير
  const sig = DB.users.map(u => u.username + ':' + (u.isAdmin ? 1 : 0)).join('|');
  if(sig !== _usersSig){
    _usersSig = sig;
    if(window.syncUserIndexForCurrentCompany) syncUserIndexForCurrentCompany();
  }
}

function nextCounter(key){ const n = DB.counters[key]++; saveDB(); return n; }
function uid(){ return Date.now()+Math.floor(Math.random()*1000); }

function fmt(n){ n = Number(n||0); return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

function getUser(){ return DB.users.find(u=>u.id===DB.currentUserId); }
function isAdmin(){ const u=getUser(); return u && u.isAdmin; }
function can(moduleId, action){ // action: view/add/edit/delete
 const u=getUser(); if(!u) return false;
 if(u.isAdmin) return true;
 const p = u.perms && u.perms[moduleId];
 return !!(p && p[action]);
}
function requirePerm(moduleId, action){
 if(!can(moduleId,action)){ toast('ليس لديك صلاحية لهذه العملية'); return false; }
 return true;
}
function logAudit(action, moduleId, details){
 const u=getUser();
 DB.auditLog.unshift({date:new Date().toISOString(), user:u?u.username:'-', action, module:moduleId, details});
 saveDB();
}

/* Journal posting: accounts are free-text labels (e.g. "الخزينة الرئيسية","عميل: أحمد") */
function postJournal(date, desc, debitAcc, debitAmt, creditAcc, creditAmt, sourceType, sourceId){
 debitAmt=Number(debitAmt||0); creditAmt=Number(creditAmt||0);
 if(!Number.isFinite(debitAmt)||!Number.isFinite(creditAmt)||debitAmt<0||creditAmt<0) throw new Error('قيمة القيد غير صحيحة');
 if(Math.abs(debitAmt-creditAmt)>0.01) throw new Error('لا يمكن حفظ قيد غير متوازن: المدين '+debitAmt.toFixed(2)+' والدائن '+creditAmt.toFixed(2));
 const num=nextCounter('jrn'); DB.journal.push({id:uid(),number:num,date,desc,debitAcc,debitAmt:Number(debitAmt.toFixed(2)),creditAcc,creditAmt:Number(creditAmt.toFixed(2)),sourceType,sourceId}); saveDB(); return num;
}
function computeDiscount(base, type, value){
 value = Number(value||0);
 if(!value) return 0;
 if(type==='percent') return base*value/100;
 return value;
}

/* ---------- FIFO stock helpers ---------- */
function addStockBatch(itemId, warehouseId, qty, unitCost, date, sourceType, sourceId){
 DB.stockBatches.push({id:uid(), itemId, warehouseId, qty:Number(qty), remaining:Number(qty), unitCost:Number(unitCost), date, sourceType, sourceId});
}
// consume qty FIFO, returns {cost, consumed:[{batchId, qty, unitCost}]} or null if not enough stock
function consumeStockFIFO(itemId, warehouseId, qty, allowNegative){
 qty = Number(qty);
 let batches = DB.stockBatches.filter(b=>b.itemId===itemId && b.warehouseId===warehouseId && b.remaining>0.0001)
   .sort((a,b)=> (a.date>b.date?1:a.date<b.date?-1:a.id-b.id));
 let need = qty, totalCost=0, consumed=[];
 for(const b of batches){
  if(need<=0) break;
  const take = Math.min(b.remaining, need);
  b.remaining -= take; need -= take; totalCost += take*b.unitCost;
  consumed.push({batchId:b.id, qty:take, unitCost:b.unitCost});
 }
 if(need>0.0001){
  if(!allowNegative) return null;
  // negative stock: assume cost = average cost of item across warehouses, else 0
  const avg = getItemAvgCost(itemId);
  totalCost += need*avg;
  consumed.push({batchId:null, qty:need, unitCost:avg});
  need=0;
 }
 return {cost: totalCost, consumed};
}
function restoreStockFIFO(consumed){ // used when deleting/editing a sale
 for(const c of consumed){
  if(!c.batchId) continue;
  const b = DB.stockBatches.find(x=>x.id===c.batchId);
  if(b) b.remaining += c.qty;
 }
}
function getItemAvgCost(itemId){
 const batches = DB.stockBatches.filter(b=>b.itemId===itemId && b.remaining>0.0001);
 const totQty = batches.reduce((s,b)=>s+b.remaining,0);
 if(totQty<=0) return 0;
 const totVal = batches.reduce((s,b)=>s+b.remaining*b.unitCost,0);
 return totVal/totQty;
}
function getItemStock(itemId, warehouseId){
 return DB.stockBatches.filter(b=>b.itemId===itemId && (!warehouseId || b.warehouseId===warehouseId) && b.remaining>0.0001)
   .reduce((s,b)=>s+b.remaining,0);
}
function getItemStockValue(itemId, warehouseId){
 return DB.stockBatches.filter(b=>b.itemId===itemId && (!warehouseId || b.warehouseId===warehouseId) && b.remaining>0.0001)
   .reduce((s,b)=>s+b.remaining*b.unitCost,0);
}

/* ============ LOGIN / SESSION ============
   التحقق من كلمة السر وتوجيه الشركة والاشتراك أصبح في js/auth.js (platformDoLogin).
   هنا فقط: عرض التطبيق بعد نجاح الدخول + تسجيل الخروج. */
function showApp(){
 ['loginScreen','superAdminShell','subExpiredScreen','loadingScreen'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
 document.getElementById('appShell').style.display='flex';
 buildNav();
 state.section='dashboard'; state.sub=null;
 renderAll();
}
function doLogout(){
 logAudit('تسجيل خروج','system','-');
 DB.currentUserId=null; saveDB(); flushCloudPush();
 if(window.platformLogout){ platformLogout(); }
 else {
  document.getElementById('appShell').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
 }
}
function backToSuperAdminPanel(){
 flushCloudPush();
 document.getElementById('appShell').style.display='none';
 if(window.saveSession && window.getPlatformUsers){
  const su=getPlatformUsers().find(x=>x.role==='super_admin');
  if(su) saveSession({role:'super_admin', userId:su.id, loginTime:new Date().toISOString()});
 }
 document.getElementById('superAdminShell').style.display='flex';
 if(window.renderCompaniesPanel) renderCompaniesPanel();
}

/* ============ NAV / ROUTER ============ */
const state = {section:'dashboard', sub:null};
const SUBS = {
 sales:[['invoices','فاتورة المبيعات'],['customers','العملاء'],['returns','مرتجع المبيعات'],['report','تقرير المبيعات']],
 purchases:[['invoices','فاتورة المشتريات'],['suppliers','الموردين'],['returns','مرتجع المشتريات'],['commissions','عمولة الموردين'],['report','تقرير المشتريات']],
 inventory:[['items','كارت الصنف'],['receive','إذن استلام مخزني'],['issue','إذن صرف مخزني'],['transfer','تحويل بين المخازن'],['ops','سجل العمليات'],['import','استيراد / تصدير']],
 treasury:[['overview','الخزائن والبنوك'],['cashReceipt','إذن استلام نقدي'],['cashPayment','إذن صرف نقدي'],['bankReceipt','إذن استلام بنكي'],['bankPayment','إذن صرف بنكي'],['transfer','تحويل خزينة/بنك'],['checks','الشيكات'],['custody','العهد']],
 employees:[['list','الموظفون'],['attendance','الحضور والانصراف'],['advances','السلف'],['closure','تقفيل المرتبات']],
 equity:[['capital','رأس المال'],['current','جاري الشركاء'],['assets','الأصول الثابتة'],['distribution','توزيعات الأرباح']],
 expenses:[['daily','المصاريف اليومية'],['categories','تصنيفات المصروفات'],['report','تقرير المصروفات']],
 journal:[['view','عرض القيود']],
 reports:[['profit','قائمة الدخل / صافي الربح'],['balance','قائمة المركز المالي'],['otherIncome','الإيرادات الأخرى'],['aging','أعمار الديون'],['backup','نسخ احتياطي (استيراد/تصدير)']],
 users:[['list','المستخدمون']],
 settings:[],
 dashboard:[],
};
function buildNav(){
 const nav=document.getElementById('navMain'); nav.innerHTML='';
 ALL_MODULES.forEach(m=>{
  if(m.id!=='dashboard' && m.id!=='users' && m.id!=='journal' && m.id!=='reports' && m.id!=='settings' && !can(m.id,'view')) return;
  if(m.id==='users' && !isAdmin()) return;
  if(m.id==='settings' && !isAdmin()) return;
  const b=document.createElement('button'); b.className='navBtn'; b.textContent=m.label; b.dataset.id=m.id;
  b.onclick=()=>{ state.section=m.id; state.sub = (SUBS[m.id]&&SUBS[m.id][0])? SUBS[m.id][0][0]: null; renderAll(); };
  nav.appendChild(b);
 });
 const ub=document.getElementById('userBox');
 const u=getUser();
 const company = (window.ACTIVE_COMPANY_ID && window.getCompanyById) ? getCompanyById(window.ACTIVE_COMPANY_ID) : null;
 const session = window.getSession ? getSession() : null;
 const backBtn = (session && session.viaSuperAdmin) ? `<button class="btn secondary small" onclick="backToSuperAdminPanel()">↩ رجوع للوحة الإدارة</button>` : '';
 ub.innerHTML = `${backBtn}${company?`<span>🏢 ${escapeHtml(company.name)}</span>`:''}<span>👤 ${escapeHtml(u?u.username:'')} ${u&&u.isAdmin?'(مدير)':''}</span><button class="btn secondary small" onclick="doLogout()">تبديل المستخدم / خروج</button>`;
}
function renderAll(){
 document.querySelectorAll('.navBtn').forEach(b=>b.classList.toggle('active', b.dataset.id===state.section));
 const subbar=document.getElementById('subbar');
 const subs = SUBS[state.section]||[];
 subbar.style.display = subs.length? 'flex':'none';
 subbar.innerHTML='';
 subs.forEach(([id,label])=>{
  const b=document.createElement('button'); b.className='subBtn'+(state.sub===id?' active':''); b.textContent=label;
  b.onclick=()=>{ state.sub=id; renderAll(); };
  subbar.appendChild(b);
 });
 const content=document.getElementById('content');
 content.innerHTML='';
 const renderer = RENDERERS[state.section];
 if(renderer) renderer(content); else content.innerHTML='<div class="empty">قسم قيد الإنشاء</div>';
}
const RENDERERS = {}; // filled by each module

/* ============ MODAL HELPER ============ */
function openModal(title, bodyHtml, onMount, wide){
 const root=document.getElementById('modalRoot');
 root.innerHTML = `<div class="modalBg" id="mbg"><div class="modal${wide?' wide':''}"><h3>${title}</h3><div id="mbody">${bodyHtml}</div></div></div>`;
 root.querySelector('#mbg').addEventListener('click', e=>{ if(e.target.id==='mbg') closeModal(); });
 if(onMount) onMount(root.querySelector('#mbody'));
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }

/* ---------- Searchable item picker (by name or code) for invoice lines ---------- */
function itemPickerHTML(prefix, idx, currentItemId){
 const it = DB.items.find(x=>x.id==currentItemId);
 const displayVal = it? (it.name+' ('+it.code+')') : '';
 return `<div class="itemPickerWrap">
   <input type="text" id="${prefix}ItemSearch_${idx}" value="${displayVal}" placeholder="ابحث بالاسم أو الكود..." autocomplete="off"
     oninput="filterItemDropdown('${prefix}',${idx})" onfocus="filterItemDropdown('${prefix}',${idx})" onblur="setTimeout(()=>hideItemDropdown('${prefix}',${idx}),200)" style="width:100%;">
   <div id="${prefix}ItemDropdown_${idx}" class="itemDropdown hidden"></div>
 </div>`;
}
function filterItemDropdown(prefix, idx){
 const input = document.getElementById(prefix+'ItemSearch_'+idx); if(!input) return;
 const q = input.value.trim();
 const dd = document.getElementById(prefix+'ItemDropdown_'+idx);
 const matches = q? DB.items.filter(it=>it.name.includes(q)||String(it.code).includes(q)).slice(0,10) : DB.items.slice(0,10);
 dd.innerHTML = matches.length? matches.map(it=>`<div class="itemDropdownRow" onmousedown="selectItemFromDropdown('${prefix}',${idx},${it.id})">${it.name} <span style="color:var(--muted);">(${it.code}) — رصيد: ${fmt(getItemStock(it.id))}</span></div>`).join('') : '<div class="itemDropdownRow" style="color:var(--muted);">لا نتائج</div>';
 dd.classList.remove('hidden');
}
function hideItemDropdown(prefix, idx){ const dd=document.getElementById(prefix+'ItemDropdown_'+idx); if(dd) dd.classList.add('hidden'); }
function selectItemFromDropdown(prefix, idx, itemId){
 const input = document.getElementById(prefix+'ItemSearch_'+idx);
 const it = DB.items.find(x=>x.id===itemId);
 input.value = it.name+' ('+it.code+')';
 if(prefix==='inv'){ updLine(idx,'itemId',itemId); } else { updPLine(idx,'itemId',itemId); }
 hideItemDropdown(prefix, idx);
}

/* ============ GENERIC EXCEL HELPERS ============ */
function downloadWorkbook(rows, filename, sheetName){
 const ws = XLSX.utils.json_to_sheet(rows);
 const wb = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb, ws, sheetName||'Sheet1');
 XLSX.writeFile(wb, filename);
}
function readExcelFile(file, cb){
 const reader = new FileReader();
 reader.onload = e=>{
  const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
  cb(rows);
 };
 reader.readAsArrayBuffer(file);
}
function pickExcelAndImport(cb){
 const inp=document.createElement('input'); inp.type='file'; inp.accept='.xlsx,.xls,.csv';
 inp.onchange = ()=>{ if(inp.files[0]) readExcelFile(inp.files[0], cb); };
 inp.click();
}

/* ================= SALES MODULE ================= */
function custBalance(custId){
 // reuse the ledger's cumulative running balance so advance payments (without an invoice) are counted correctly
 const rows = customerLedger(custId);
 return rows.length? rows[rows.length-1].balance : 0;
}
function customerLedger(custId){
 let rows=[];
 const c = DB.customers.find(x=>x.id===custId);
 if(c && Number(c.openingBalance)){
  rows.push({date:c.createdDate||todayStr(), type:'رصيد افتتاحي', debit: c.openingType==='debit'?Number(c.openingBalance):0, credit: c.openingType==='credit'?Number(c.openingBalance):0, ref:'-'});
 }
 DB.salesInvoices.filter(i=>i.customerId===custId && !i.isCash).forEach(i=>{
  rows.push({date:i.date, type:'مبيعات', debit:i.total, credit:0, ref:'فاتورة #'+i.number});
 });
 DB.salesReturns.filter(r=>r.customerId===custId).forEach(r=>{
  rows.push({date:r.date, type:'مرتجع مبيعات', debit:0, credit:r.total, ref:'مرتجع #'+r.number});
 });
 DB.vouchers.filter(v=>v.partyType==='customer' && v.partyId===custId && v.kind==='receipt').forEach(v=>{
  rows.push({date:v.date, type:'تحصيل', debit:0, credit:v.amount, ref:'إذن #'+v.number});
 });
 DB.checks.filter(c=>c.type!=='out' && c.customerId===custId).forEach(c=>{
  rows.push({date:c.date, type:'شيك مستلم', debit:0, credit:c.amount, ref:'شيك #'+c.number});
 });
 rows.sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:0);
 let running=0;
 rows.forEach(r=>{ running += r.debit - r.credit; r.balance=running; });
 return rows;
}
function custOutstandingInvoices(custId){
 return DB.salesInvoices.filter(i=>i.customerId===custId && !i.isCash && i.status!=='paid');
}

function invStatusTag(inv){
 const map={paid:['مسدد','paid'],partial:['مسدد جزئي','partial'],unpaid:['غير مسدد','unpaid']};
 const [label,cls]=map[inv.status]||map.unpaid;
 return `<span class="tag ${cls}">${label}</span>`;
}

RENDERERS.sales = function(root){
 if(state.sub==='invoices') return renderSalesInvoices(root);
 if(state.sub==='customers') return renderCustomers(root);
 if(state.sub==='returns') return renderSalesReturns(root);
 if(state.sub==='report') return renderSalesReport(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};

function renderSalesInvoices(root){
 root.innerHTML = `
 <div class="card">
  <div class="cardHead"><h2>فواتير المبيعات</h2>
    ${can('sales','add')?'<button class="btn" onclick="openSalesInvoiceForm()">+ فاتورة جديدة</button>':''}
  </div>
  <div class="toolbar">
    <input class="searchBox" id="siSearch" placeholder="بحث برقم الفاتورة أو اسم العميل..." oninput="renderSalesInvoicesTable()">
    <input type="date" id="siFrom" onchange="renderSalesInvoicesTable()"><input type="date" id="siTo" onchange="renderSalesInvoicesTable()">
  </div>
  <div class="tableWrap" id="siTableWrap"></div>
 </div>`;
 renderSalesInvoicesTable();
}
function renderSalesInvoicesTable(){
 const wrap=document.getElementById('siTableWrap'); if(!wrap) return;
 const q=(document.getElementById('siSearch').value||'').trim();
 const from=document.getElementById('siFrom').value, to=document.getElementById('siTo').value;
 let list = DB.salesInvoices.slice().sort((a,b)=>b.number-a.number);
 if(q) list = list.filter(i=> String(i.number).includes(q) || (getCustName(i)||'').includes(q));
 if(from) list = list.filter(i=>i.date>=from);
 if(to) list = list.filter(i=>i.date<=to);
 if(!list.length){ wrap.innerHTML='<div class="empty">لا توجد فواتير</div>'; return; }
 wrap.innerHTML = `<table><thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المسدد</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${list.map(i=>`<tr>
    <td>${i.number}</td><td>${i.date}</td><td>${getCustName(i)}</td>
    <td>${fmt(i.total)}</td><td>${fmt(i.paidAmount)}</td><td>${invStatusTag(i)}</td>
    <td>
     <button class="linkBtn" onclick="viewInvoice(${i.id})">عرض</button>
     ${can('sales','edit')?`<button class="linkBtn" onclick="openSalesInvoiceForm(${i.id})">تعديل</button>`:''}
     ${can('sales','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteSalesInvoice(${i.id})">حذف</button>`:''}
    </td>
  </tr>`).join('')}
 </tbody></table>`;
}
function getCustName(inv){ if(inv.isCash) return inv.cashName && inv.cashName.trim() ? inv.cashName.trim() : 'عميل نقدي عادي'; const c=DB.customers.find(x=>x.id===inv.customerId); return c?c.name:'-'; }

function openSalesInvoiceForm(id){
 if(!requirePerm('sales', id?'edit':'add')) return;
 const inv = id? DB.salesInvoices.find(x=>x.id===id) : {number:nextCounterPeek('inv'), date:todayStr(), isCash:false, customerId:'', paymentSource:'cashbox1', lines:[{itemId:'',warehouseId:DB.warehouses[0]?.id||'', qty:1,price:0,discType:'value',discVal:0}], invDiscType:'value', invDiscVal:0};
 const isEdit = !!id;
 openModal(isEdit?'تعديل فاتورة مبيعات':'فاتورة مبيعات جديدة', `
  <div class="grid3">
   <div class="field"><label>رقم الفاتورة</label><input id="fNum" value="${inv.number}" disabled></div>
   <div class="field"><label>التاريخ</label><input type="date" id="fDate" value="${inv.date}"></div>
   <div class="field"><label>العميل</label>
    <select id="fCust" onchange="onCustChange()">
     <option value="cash">عميل غير مسجل (اكتب اسمه بالأسفل)</option>
     ${DB.customers.map(c=>`<option value="${c.id}" ${(!inv.isCash&&inv.customerId===c.id)?'selected':''}>${c.name}</option>`).join('')}
    </select>
   </div>
   <div class="field hidden" id="fPayTypeWrap">
    <label>نوع البيع</label>
    <select id="fPayType" onchange="onPayTypeChange()">
     <option value="credit" ${inv.paymentType!=='cash'?'selected':''}>آجل</option>
     <option value="cash" ${inv.paymentType==='cash'?'selected':''}>نقدي (يُسدد فورًا)</option>
    </select>
   </div>
  </div>
  <div class="field hidden" id="fPlatformNote" style="margin-top:8px;background:var(--panel2);padding:10px;border-radius:6px;border:1px solid var(--accent2);">
   <span style="color:var(--accent2);font-weight:700;">🛒 بيع عبر منصة إلكترونية:</span>
   <span id="fPlatformInfo" style="color:var(--muted);font-size:12px;"></span>
  </div>
  <div class="field hidden" id="fPaySrcWrap" style="margin-top:8px;">
   <label id="fPaySrcLabel">السداد الفوري من</label>
   <select id="fPaySrc">
    ${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}
    ${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}
   </select>
  </div>
  <div class="grid3 hidden" id="fCashInfoWrap" style="margin-top:8px;">
   <div class="field"><label>اسم العميل</label><input id="fCashName" value="${inv.cashName||''}" placeholder="اتركه فارغًا ليظهر (عميل نقدي عادي)"></div>
   <div class="field"><label>رقم الموبايل</label><input id="fCashPhone" value="${inv.cashPhone||''}"></div>
   <div class="field"><label>العنوان</label><input id="fCashAddress" value="${inv.cashAddress||''}"></div>
  </div>
  <hr style="border-color:var(--border);margin:14px 0;">
  <div class="linesScroll">
  <div class="lineRow header"><span>الصنف</span><span>المخزن</span><span>الكمية</span><span>السعر</span><span>خصم</span><span></span></div>
  <div id="linesWrap"></div>
  </div>
  <button class="btn secondary small" onclick="addInvLine()">+ إضافة صنف</button>
  <hr style="border-color:var(--border);margin:14px 0;">
  <div class="grid3">
   <div class="field"><label>خصم على الفاتورة</label><input type="number" id="fInvDiscVal" value="${inv.invDiscVal||0}" oninput="recalcInvTotal()"></div>
   <div class="field"><label>نوع الخصم</label><select id="fInvDiscType" onchange="recalcInvTotal()"><option value="value" ${inv.invDiscType==='value'?'selected':''}>قيمة</option><option value="percent" ${inv.invDiscType==='percent'?'selected':''}>نسبة %</option></select></div>
   <div class="field"><label>الإجمالي</label><input id="fTotal" disabled></div>
  </div>
  <div style="margin-top:16px;text-align:left;">
   <button class="btn secondary" onclick="closeModal()">إلغاء</button>
   <button class="btn" onclick="saveSalesInvoice(${id||'null'})">حفظ الفاتورة</button>
  </div>
 `, ()=>{
   window._invLines = JSON.parse(JSON.stringify(inv.lines));
   renderInvLines();
   onCustChange();
   recalcInvTotal();
 }, true);
}
function nextCounterPeek(key){ return DB.counters[key]; }
function onCustChange(){
 const v=document.getElementById('fCust').value;
 const payTypeWrap=document.getElementById('fPayTypeWrap');
 const platformNote=document.getElementById('fPlatformNote');
 const cashInfoWrap=document.getElementById('fCashInfoWrap');
 if(v==='cash'){
  payTypeWrap.classList.add('hidden');
  platformNote.classList.add('hidden');
  cashInfoWrap.classList.remove('hidden');
  document.getElementById('fPaySrcWrap').classList.remove('hidden');
  document.getElementById('fPaySrcLabel').textContent='السداد الفوري من';
  return;
 }
 cashInfoWrap.classList.add('hidden');
 const cust = DB.customers.find(c=>c.id==v);
 if(cust && cust.isPlatform){
  payTypeWrap.classList.add('hidden');
  platformNote.classList.remove('hidden');
  document.getElementById('fPlatformInfo').textContent = ' عمولة فورية '+cust.immediatePct+'% + عمولة مؤجلة '+cust.deferredPct+'% (تُسوّى '+(cust.settlementPeriod==='monthly'?'شهريًا':'ربع سنوي')+'). الصافي (بعد خصم العمولة الفورية فقط) يدخل الخزينة/البنك تلقائيًا.';
  document.getElementById('fPaySrcWrap').classList.remove('hidden');
  document.getElementById('fPaySrcLabel').textContent='تحويل الصافي إلى';
 } else {
  payTypeWrap.classList.remove('hidden');
  platformNote.classList.add('hidden');
  onPayTypeChange();
 }
}
function onPayTypeChange(){
 const pt=document.getElementById('fPayType').value;
 document.getElementById('fPaySrcWrap').classList.toggle('hidden', pt!=='cash');
}
function addInvLine(){ window._invLines.push({itemId:'',warehouseId:DB.warehouses[0]?.id||'',qty:1,price:0,discType:'value',discVal:0}); renderInvLines(); }
function getNextCost(itemId, warehouseId){
 const batches = DB.stockBatches.filter(b=>b.itemId==itemId && b.warehouseId==warehouseId && b.remaining>0.0001)
  .sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:(a.id-b.id));
 if(batches.length) return batches[0].unitCost;
 return getItemAvgCost(itemId);
}
function lineInfoHTML(ln){
 if(!ln.itemId) return '';
 const cost = getNextCost(ln.itemId, ln.warehouseId);
 const marginPerUnit = Number(ln.price||0) - cost;
 const marginPct = ln.price>0? (marginPerUnit/ln.price*100).toFixed(1) : '0';
 return `تكلفة الوحدة (شراء): <b>${fmt(cost)}</b> — هامش الربح المتوقع للوحدة: <b class="${marginPerUnit>=0?'pos':'neg'}">${fmt(marginPerUnit)}</b> (${marginPct}%)`;
}
function renderInvLines(){
 const wrap=document.getElementById('linesWrap'); wrap.innerHTML='';
 window._invLines.forEach((ln,idx)=>{
  const container=document.createElement('div');
  const row=document.createElement('div'); row.className='lineRow';
  row.innerHTML = `
   ${itemPickerHTML('inv', idx, ln.itemId)}
   <select onchange="updLine(${idx},'warehouseId',this.value)">
    ${DB.warehouses.map(w=>`<option value="${w.id}" ${ln.warehouseId==w.id?'selected':''}>${w.name}</option>`).join('')}
   </select>
   <input type="number" value="${ln.qty}" oninput="updLine(${idx},'qty',this.value)">
   <input type="number" value="${ln.price}" oninput="updLine(${idx},'price',this.value)">
   <input type="number" value="${ln.discVal}" placeholder="خصم" oninput="updLine(${idx},'discVal',this.value)">
   <button class="linkBtn" style="color:var(--danger)" onclick="removeLine(${idx})">حذف</button>
  `;
  container.appendChild(row);
  const info=document.createElement('div');
  info.id='lineInfo_'+idx;
  info.style.cssText='font-size:11px;color:var(--muted);margin:-2px 0 10px;padding-right:4px;';
  info.innerHTML=lineInfoHTML(ln);
  container.appendChild(info);
  wrap.appendChild(container);
 });
 recalcInvTotal();
}
function updLine(idx,field,val){
 window._invLines[idx][field]= Number(val);
 recalcInvTotal();
 const infoEl = document.getElementById('lineInfo_'+idx);
 if(infoEl) infoEl.innerHTML = lineInfoHTML(window._invLines[idx]);
}
function removeLine(idx){ window._invLines.splice(idx,1); renderInvLines(); }
function recalcInvTotal(){
 let sub=0;
 window._invLines.forEach(ln=>{
  const base=ln.qty*ln.price;
  sub += base - computeDiscount(base,'value',ln.discVal||0);
 });
 const dType=document.getElementById('fInvDiscType')?.value||'value';
 const dVal=Number(document.getElementById('fInvDiscVal')?.value||0);
 const disc = computeDiscount(sub,dType,dVal);
 const total = sub-disc;
 if(document.getElementById('fTotal')) document.getElementById('fTotal').value = fmt(total);
 return {sub,disc,total};
}
function effectiveAvailableStock(itemId, warehouseId, excludeInvoiceId){
 let avail = getItemStock(itemId, warehouseId);
 if(excludeInvoiceId){
  const oldInv = DB.salesInvoices.find(x=>x.id===excludeInvoiceId);
  if(oldInv){ oldInv.lines.forEach(l=>{ if(l.itemId==itemId && l.warehouseId==warehouseId) avail += Number(l.qty); }); }
 }
 return avail;
}
function saveSalesInvoice(id){
 const custVal = document.getElementById('fCust').value;
 const isCash = custVal==='cash'; // anonymous walk-in customer (no name)
 const payType = isCash? 'cash' : document.getElementById('fPayType').value; // 'cash' or 'credit' for a named customer
 const date = document.getElementById('fDate').value;
 const lines = window._invLines.filter(l=>l.itemId && l.qty>0);
 if(!lines.length){ toast('أضف صنف واحد على الأقل'); return; }
 // validate stock availability BEFORE making any change
 for(const ln of lines){
  const avail = effectiveAvailableStock(ln.itemId, ln.warehouseId, id);
  if(avail <= 0){
   const it = DB.items.find(x=>x.id==ln.itemId);
   alert('لا يمكن إتمام البيع: الصنف "'+(it?it.name:'')+'" رصيده صفر في هذا المخزن. برجاء توريد الصنف أولًا أو اختيار مخزن آخر.');
   return;
  }
  if(ln.qty > avail){
   const it = DB.items.find(x=>x.id==ln.itemId);
   alert('لا يمكن إتمام البيع: الكمية المطلوبة من صنف "'+(it?it.name:'')+'" ('+ln.qty+') أكبر من الرصيد المتاح ('+avail+'). برجاء تقليل الكمية أو التوريد أولًا.');
   return;
  }
 }
 const {sub,disc,total} = recalcInvTotal();
 // if editing, reverse old effects first
 if(id) reverseSalesInvoice(id, true);
 const number = id? DB.salesInvoices.find(x=>x.id===id).number : nextCounter('inv');
 const invId = id || uid();
 let cogsTotal=0; const consumedMap=[];
 for(const ln of lines){
  const r = consumeStockFIFO(ln.itemId, ln.warehouseId, ln.qty, true);
  cogsTotal += r.cost; consumedMap.push({line:ln, consumed:r.consumed});
  logStockOp(ln.itemId, ln.warehouseId, 'مبيعات', 0, ln.qty, date, 'فاتورة مبيعات #'+number);
 }
 const customerId = isCash? null : Number(custVal);
 const cust = isCash? null : DB.customers.find(c=>c.id===customerId);
 const isPlatformSale = !!(cust && cust.isPlatform);
 const inv = {id:invId, number, date, isCash, customerId, paymentType:payType,
   lines, invDiscType:document.getElementById('fInvDiscType').value, invDiscVal:Number(document.getElementById('fInvDiscVal').value||0),
   sub, disc, total, cogs:cogsTotal, consumedMap, paidAmount:0, status:'unpaid',
   paymentSource: isCash? document.getElementById('fPaySrc').value:null, autoVoucherId:null, isPlatformSale, immediateCommission:0, deferredCommission:0,
   cashName: isCash? document.getElementById('fCashName').value.trim() : null,
   cashPhone: isCash? document.getElementById('fCashPhone').value.trim() : null,
   cashAddress: isCash? document.getElementById('fCashAddress').value.trim() : null};
 if(isCash){ inv.paidAmount = total; inv.status='paid'; }
 const existingIdx = DB.salesInvoices.findIndex(x=>x.id===invId);
 if(existingIdx>=0) DB.salesInvoices[existingIdx]=inv; else DB.salesInvoices.push(inv);
 saveDB();
 // Journal
 const custLabel = isCash? 'عميل نقدي' : ('عميل: '+getCustNameById(inv.customerId));
 if(isCash){
  const [srcType,srcId] = inv.paymentSource.split(':');
  const srcLabel = srcType==='cashbox'? 'الخزينة: '+DB.cashboxes.find(c=>c.id==srcId).name : 'البنك: '+DB.banks.find(b=>b.id==srcId).name;
  postJournal(date,'فاتورة مبيعات نقدية #'+number, srcLabel, total, 'المبيعات', total, 'sales', invId);
  if(srcType==='cashbox'){ const cb=DB.cashboxes.find(c=>c.id==srcId); cb.balance+=total; } else { const bk=DB.banks.find(b=>b.id==srcId); bk.balance+=total; }
 } else if(isPlatformSale){
  const immediateCommission = total * (cust.immediatePct||0)/100;
  const deferredCommission = total * (cust.deferredPct||0)/100;
  const netReceived = total - immediateCommission;
  inv.immediateCommission = immediateCommission; inv.deferredCommission = deferredCommission;
  inv.paidAmount = total; inv.status = 'paid';
  const src = document.getElementById('fPaySrc').value;
  const [srcType,srcId] = src.split(':');
  const srcObj = srcType==='cashbox'? DB.cashboxes.find(c=>c.id==srcId): DB.banks.find(b=>b.id==srcId);
  srcObj.balance += netReceived;
  const srcLabel = (srcType==='cashbox'?'الخزينة: ':'البنك: ')+srcObj.name;
  postJournal(date,'فاتورة مبيعات (منصة) #'+number, srcLabel, total, 'المبيعات', total, 'sales', invId);
  if(immediateCommission>0){
   postJournal(date,'عمولة فورية - منصة '+cust.name+' - فاتورة #'+number, 'مصروف عمولة منصات (فورية)', immediateCommission, srcLabel, immediateCommission, 'platform_commission_immediate', invId);
   DB.expenses.push({id:uid(), number:nextCounter('exp'), date, categoryId: DB.expenseCategories.find(c=>c.name==='عمولة منصات البيع')?.id, description:'عمولة فورية - منصة '+cust.name+' - فاتورة #'+number, amount:immediateCommission, source:null, auto:true, refType:'platform_commission', refId:invId});
  }
  if(deferredCommission>0){
   postJournal(date,'عمولة مؤجلة - منصة '+cust.name+' - فاتورة #'+number, 'مصروف عمولة منصات (مؤجلة)', deferredCommission, 'مستحق لمنصات البيع: '+cust.name, deferredCommission, 'platform_commission_deferred', invId);
   cust.deferredAccrued = Number(cust.deferredAccrued||0) + deferredCommission;
   DB.expenses.push({id:uid(), number:nextCounter('exp'), date, categoryId: DB.expenseCategories.find(c=>c.name==='عمولة منصات البيع')?.id, description:'عمولة مؤجلة (مستحقة) - منصة '+cust.name+' - فاتورة #'+number, amount:deferredCommission, source:null, auto:true, refType:'platform_commission_deferred_exp', refId:invId});
  }
 } else {
  // named customer: always post the normal credit sale entry first
  postJournal(date,'فاتورة مبيعات #'+number, custLabel, total, 'المبيعات', total, 'sales', invId);
  if(payType==='cash'){
   // customer chose to pay immediately: auto-generate a receipt voucher for the full amount
   const src = document.getElementById('fPaySrc').value;
   const [srcType,srcId] = src.split(':');
   const srcObj = srcType==='cashbox'? DB.cashboxes.find(c=>c.id==srcId): DB.banks.find(b=>b.id==srcId);
   srcObj.balance += total;
   const srcLabel = (srcType==='cashbox'?'الخزينة: ':'البنك: ')+srcObj.name;
   const vnum = nextCounter('vch');
   const voucher = {id:uid(), number:vnum, date, sourceType:srcType, sourceId:Number(srcId), kind:'receipt', partyType:'customer', partyId:customerId, partyName:null, amount:total, description:'تحصيل فوري - فاتورة مبيعات #'+number, allocations:[{invoiceId:invId, amount:total}]};
   DB.vouchers.push(voucher);
   postJournal(date, 'تحصيل فوري - فاتورة #'+number, srcLabel, total, custLabel, total, 'voucher', voucher.id);
   inv.paidAmount = total; inv.status='paid'; inv.autoVoucherId = voucher.id;
  }
 }
 if(disc>0){
  postJournal(date,'خصم مسموح به - فاتورة #'+number, 'خصم مسموح به (مصروفات)', disc, custLabel, disc, 'sales_discount', invId);
  DB.expenses.push({id:uid(), number:nextCounter('exp'), date, categoryId: DB.expenseCategories.find(c=>c.name==='خصم مسموح به')?.id, description:'خصم مسموح به - فاتورة مبيعات #'+number, amount:disc, source:null, auto:true, refType:'sales', refId:invId});
 }
 postJournal(date,'تكلفة البضاعة المباعة - فاتورة #'+number, 'تكلفة البضاعة المباعة', cogsTotal, 'المخزون', cogsTotal, 'sales_cogs', invId);
 saveDB();
 logAudit(id?'تعديل':'إضافة','sales','فاتورة مبيعات #'+number);
 closeModal(); renderAll(); toast('تم حفظ الفاتورة');
}
function getCustNameById(id){ const c=DB.customers.find(x=>x.id===id); return c?c.name:'-'; }

function reverseSalesInvoice(id, silent){
 const inv = DB.salesInvoices.find(x=>x.id===id); if(!inv) return;
 (inv.consumedMap||[]).forEach(cm=> restoreStockFIFO(cm.consumed));
 if(inv.isCash && inv.paymentSource){
  const [srcType,srcId]=inv.paymentSource.split(':');
  if(srcType==='cashbox'){ const cb=DB.cashboxes.find(c=>c.id==srcId); if(cb) cb.balance-=inv.total; }
  else { const bk=DB.banks.find(b=>b.id==srcId); if(bk) bk.balance-=inv.total; }
 }
 if(inv.autoVoucherId){
  const v = DB.vouchers.find(x=>x.id===inv.autoVoucherId);
  if(v){
   const srcs = v.sourceType==='cashbox'?DB.cashboxes:DB.banks;
   const s = srcs.find(x=>x.id===v.sourceId);
   if(s) s.balance -= v.amount;
   DB.journal = DB.journal.filter(j=>!(j.sourceType==='voucher'&&j.sourceId===v.id));
   DB.vouchers = DB.vouchers.filter(x=>x.id!==v.id);
  }
 }
 if(inv.isPlatformSale && inv.paymentSource){
  const [srcType,srcId]=inv.paymentSource.split(':');
  const netReceived = inv.total - (inv.immediateCommission||0);
  const srcs = srcType==='cashbox'?DB.cashboxes:DB.banks; const s=srcs.find(x=>x.id==srcId);
  if(s) s.balance -= netReceived;
  const cust = DB.customers.find(c=>c.id===inv.customerId);
  if(cust) cust.deferredAccrued = Math.max(0, Number(cust.deferredAccrued||0) - (inv.deferredCommission||0));
 }
 DB.stockOps = DB.stockOps.filter(o=> !(o.ref==='فاتورة مبيعات #'+inv.number));
 DB.journal = DB.journal.filter(j=> !(j.sourceType==='sales' && j.sourceId===id) && !(j.sourceType==='sales_cogs'&&j.sourceId===id) && !(j.sourceType==='sales_discount'&&j.sourceId===id) && !(j.sourceType==='platform_commission_immediate'&&j.sourceId===id) && !(j.sourceType==='platform_commission_deferred'&&j.sourceId===id));
 DB.expenses = DB.expenses.filter(e=> !(e.refType==='sales' && e.refId===id) && !(e.refType==='platform_commission' && e.refId===id) && !(e.refType==='platform_commission_deferred_exp' && e.refId===id));
 if(!silent){ DB.salesInvoices = DB.salesInvoices.filter(x=>x.id!==id); saveDB(); }
}
function deleteSalesInvoice(id){
 if(!requirePerm('sales','delete')) return;
 if(!confirm('تأكيد حذف الفاتورة؟ سيتم عكس أثرها على المخزون والحسابات.')) return;
 reverseSalesInvoice(id,false);
 logAudit('حذف','sales','فاتورة مبيعات #'+id);
 renderAll(); toast('تم الحذف');
}
function lineSupplierNames(inv, idx){
 const cm = (inv.consumedMap||[])[idx]; if(!cm) return '-';
 const names = new Set();
 cm.consumed.forEach(c=>{ if(c.batchId){ const b=DB.stockBatches.find(x=>x.id===c.batchId); if(b) names.add(getBatchSupplierName(b)); } });
 return names.size? [...names].join('، ') : '-';
}
function viewInvoice(id){
 const inv = DB.salesInvoices.find(x=>x.id===id); if(!inv) return;
 const cashInfo = inv.isCash && (inv.cashName||inv.cashPhone||inv.cashAddress) ?
  `<p>اسم العميل: ${inv.cashName||'-'} | الهاتف: ${inv.cashPhone||'-'} | العنوان: ${inv.cashAddress||'-'}</p>` : '';
 openModal('فاتورة مبيعات #'+inv.number, `
  <p>التاريخ: ${inv.date} | العميل: ${getCustName(inv)} | الحالة: ${invStatusTag(inv)}</p>
  ${cashInfo}
  <table><thead><tr><th>الصنف</th><th>المورد</th><th>الكمية</th><th>السعر</th><th>خصم</th><th>الإجمالي</th></tr></thead><tbody>
  ${inv.lines.map((l,idx)=>{const it=DB.items.find(i=>i.id==l.itemId); const base=l.qty*l.price-computeDiscount(l.qty*l.price,'value',l.discVal||0); return `<tr><td>${it?it.name:'-'}</td><td>${lineSupplierNames(inv,idx)}</td><td>${l.qty}</td><td>${fmt(l.price)}</td><td>${fmt(l.discVal||0)}</td><td>${fmt(base)}</td></tr>`}).join('')}
  </tbody></table>
  <p style="margin-top:10px;">الإجمالي قبل الخصم: ${fmt(inv.sub)} | خصم الفاتورة: ${fmt(inv.disc)} | <b>الصافي: ${fmt(inv.total)}</b></p>
  <p>المسدد: ${fmt(inv.paidAmount)} | المتبقي: ${fmt(inv.total-inv.paidAmount)}</p>
  <p style="color:var(--muted);font-size:12px;">تكلفة البضاعة المباعة (للاستخدام الداخلي فقط - لا تظهر عند الطباعة): ${fmt(inv.cogs)}</p>
  <div style="text-align:left;margin-top:10px;"><button class="btn secondary" onclick="printSalesInvoiceDoc(${inv.id})">🖨 طباعة الفاتورة / PDF</button></div>
 `);
}
function printSalesInvoiceDoc(id){
 const inv = DB.salesInvoices.find(x=>x.id===id); if(!inv) return;
 const s = DB.settings||{};
 const custName = getCustName(inv);
 const custPhone = inv.isCash? (inv.cashPhone||'') : ((DB.customers.find(c=>c.id===inv.customerId)||{}).phone||'');
 const custAddress = inv.isCash? (inv.cashAddress||'') : '';
 const rows = inv.lines.map((l,idx)=>{
  const it = DB.items.find(i=>i.id==l.itemId);
  const base = l.qty*l.price - computeDiscount(l.qty*l.price,'value',l.discVal||0);
  return `<tr><td>${it?it.name:'-'}</td><td>${l.qty}</td><td>${fmt(l.price)}</td><td>${fmt(l.discVal||0)}</td><td>${fmt(base)}</td></tr>`;
 }).join('');
 const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>فاتورة مبيعات #${inv.number}</title>
 <style>
  body{font-family:'Tahoma','Segoe UI',Arial,sans-serif;padding:30px;color:#222;max-width:800px;margin:0 auto;}
  .invHeader{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2f8f6f;padding-bottom:16px;margin-bottom:20px;}
  .invHeader .brand{display:flex;align-items:center;gap:12px;}
  .invHeader img{max-height:64px;}
  .invHeader h1{margin:0;font-size:20px;color:#1a1a1a;}
  .invTitleBox{text-align:left;}
  .invTitleBox h2{margin:0;color:#2f8f6f;font-size:22px;}
  .invTitleBox p{margin:4px 0 0;color:#666;font-size:13px;}
  .infoGrid{display:flex;justify-content:space-between;background:#f6f8f7;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:13px;}
  .infoGrid div{line-height:1.9;}
  table{width:100%;border-collapse:collapse;margin-bottom:18px;}
  th{background:#2f8f6f;color:#fff;padding:9px 8px;font-size:13px;text-align:right;}
  td{padding:8px;border-bottom:1px solid #e4e4e4;font-size:13px;}
  tr:nth-child(even) td{background:#fafafa;}
  .totalsBox{margin-right:auto;width:280px;font-size:13.5px;}
  .totalsBox table td{border:none;padding:5px 0;}
  .totalsBox .grandTotal td{border-top:2px solid #2f8f6f;font-size:16px;font-weight:bold;color:#2f8f6f;padding-top:8px;}
  .footer{margin-top:40px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:14px;}
  @media print{ .noPrint{display:none;} }
 </style></head><body>
  <div class="invHeader">
   <div class="brand">${s.logo?`<img src="${s.logo}">`:''}<h1>${s.companyName||''}</h1></div>
   <div class="invTitleBox"><h2>فاتورة مبيعات</h2><p>رقم: ${inv.number} &nbsp;|&nbsp; التاريخ: ${inv.date}</p></div>
  </div>
  <div class="infoGrid">
   <div><b>بيانات العميل</b><br>الاسم: ${custName}${custPhone?'<br>الهاتف: '+custPhone:''}${custAddress?'<br>العنوان: '+custAddress:''}</div>
   <div><b>حالة السداد</b><br>${inv.status==='paid'?'مسدد بالكامل':inv.status==='partial'?'مسدد جزئيًا':'غير مسدد'}${inv.status!=='paid'?'<br>المتبقي: '+fmt(inv.total-inv.paidAmount):''}</div>
  </div>
  <table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>خصم</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totalsBox"><table>
   <tr><td>الإجمالي قبل الخصم</td><td style="text-align:left;">${fmt(inv.sub)}</td></tr>
   <tr><td>خصم الفاتورة</td><td style="text-align:left;">${fmt(inv.disc)}</td></tr>
   <tr class="grandTotal"><td>الصافي المطلوب</td><td style="text-align:left;">${fmt(inv.total)}</td></tr>
  </table></div>
  <div class="footer">شكرًا لتعاملكم معنا 🌿</div>
  <script>window.onload=()=>window.print();<\/script>
 </body></html>`;
 const w = window.open('','_blank');
 w.document.write(html); w.document.close();
}
function printLetterhead(title){
 const s = DB.settings||{};
 let html = '<div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:16px;">';
 if(s.logo) html += '<img src="'+s.logo+'" style="max-height:70px;">';
 html += '<div><h2 style="margin:0;">'+(s.companyName||'')+'</h2><p style="margin:4px 0 0;color:#555;">'+title+'</p></div></div>';
 return html;
}
function printElement(elId, title){
 const el = document.getElementById(elId); if(!el) return;
 const w = window.open('','_blank');
 w.document.write('<html dir="rtl"><head><title>'+title+'</title><style>body{font-family:Tahoma;padding:20px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #999;padding:6px;} button{display:none;}</style></head><body>'+printLetterhead(title)+el.innerHTML+'</body></html>');
 w.document.close(); w.print();
}
function printSection(title){ printElement('mbody', title); }

/* ---------- Customers ---------- */
function renderCustomers(root){
 root.innerHTML = `
 <div class="card">
  <div class="cardHead"><h2>العملاء</h2>
   ${can('sales','add')?'<button class="btn" onclick="openCustomerForm()">+ عميل جديد</button>':''}
  </div>
  <div class="toolbar"><input class="searchBox" id="custSearch" placeholder="بحث بالاسم..." oninput="renderCustTable()"></div>
  <div class="tableWrap" id="custTableWrap"></div>
 </div>`;
 renderCustTable();
}
function renderCustTable(){
 const wrap=document.getElementById('custTableWrap'); if(!wrap)return;
 const q=(document.getElementById('custSearch').value||'').trim();
 let list = DB.customers.filter(c=>!q || c.name.includes(q));
 if(!list.length){ wrap.innerHTML='<div class="empty">لا يوجد عملاء</div>'; return; }
 wrap.innerHTML=`<table><thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th>عمولة مؤجلة متجمعة</th><th></th></tr></thead><tbody>
 ${list.map(c=>{ const bal=custBalance(c.id); return `<tr>
   <td><button class="linkBtn" onclick="openCustLedger(${c.id})">${c.name}</button> ${c.isPlatform?'<span class="badge">منصة</span>':''}</td>
   <td>${c.phone||'-'}</td>
   <td>${fmt(Math.abs(bal))} <span class="tag ${bal>=0?'debit':'credit'}">${bal>=0?'مدين (له)':'دائن (عليه - دفعة مقدمة)'}</span></td>
   <td>${c.isPlatform? fmt(c.deferredAccrued||0)+(c.deferredAccrued>0 && can('treasury','add')?` <button class="linkBtn" onclick="openPlatformSettlement(${c.id})">تسوية</button>`:'') : '-'}</td>
   <td>${can('sales','edit')?`<button class="linkBtn" onclick="openCustomerForm(${c.id})">تعديل</button>`:''} ${can('sales','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteCustomer(${c.id})">حذف</button>`:''}</td>
 </tr>`}).join('')}
 </tbody></table>`;
}
function openPlatformSettlement(custId){
 if(!requirePerm('treasury','add')) return;
 const cust = DB.customers.find(c=>c.id===custId); if(!cust) return;
 openModal('تسوية عمولة مؤجلة: '+cust.name, `
 <p>المبلغ المستحق للمنصة: <b>${fmt(cust.deferredAccrued||0)}</b></p>
 <div class="grid2">
  <div class="field"><label>الدفع من</label><select id="psSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
  <div class="field"><label>التاريخ</label><input type="date" id="psDate" value="${todayStr()}"></div>
 </div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="confirmPlatformSettlement(${custId})">تأكيد التسوية</button></div>`);
}
function confirmPlatformSettlement(custId){
 const cust = DB.customers.find(c=>c.id===custId);
 const amount = Number(cust.deferredAccrued||0); if(amount<=0){ toast('لا يوجد مبلغ مستحق'); return; }
 const src = document.getElementById('psSrc').value, date = document.getElementById('psDate').value;
 const [sType,sId] = src.split(':'); const sObj = sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
 if(amount>sObj.balance){ if(!confirm('الرصيد قد لا يكفي، متابعة؟')) return; }
 sObj.balance -= amount;
 const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
 postJournal(date,'تسوية عمولة مؤجلة - منصة '+cust.name, 'مستحق لمنصات البيع: '+cust.name, amount, srcLabel, amount, 'platform_settlement', custId);
 DB.platformSettlements = DB.platformSettlements||[];
 DB.platformSettlements.push({id:uid(), customerId:custId, amount, date, source:src});
 cust.deferredAccrued = 0;
 saveDB(); logAudit('إضافة','treasury','تسوية عمولة منصة: '+cust.name); closeModal(); renderAll(); toast('تمت التسوية');
}
function openCustomerForm(id){
 if(!requirePerm('sales', id?'edit':'add')) return;
 const c = id? DB.customers.find(x=>x.id===id) : {name:'',phone:'',openingBalance:0,openingType:'debit',isPlatform:false,immediatePct:0,deferredPct:0,settlementPeriod:'monthly',deferredAccrued:0};
 openModal(id?'تعديل عميل':'عميل جديد', `
  <div class="grid2">
   <div class="field"><label>الاسم</label><input id="cName" value="${c.name}"></div>
   <div class="field"><label>الهاتف</label><input id="cPhone" value="${c.phone||''}"></div>
   <div class="field"><label>رصيد افتتاحي</label><input type="number" id="cBal" value="${c.openingBalance||0}"></div>
   <div class="field"><label>نوع الرصيد</label><select id="cBalType"><option value="debit" ${c.openingType==='debit'?'selected':''}>مدين (له)</option><option value="credit" ${c.openingType==='credit'?'selected':''}>دائن (عليه)</option></select></div>
  </div>
  <div class="field" style="margin-top:10px;"><label><input type="checkbox" id="cIsPlatform" ${c.isPlatform?'checked':''} onchange="onPlatformToggle()"> هذا العميل منصة بيع إلكترونية (زي أمان / جوميا)</label></div>
  <div id="platformFieldsWrap" class="grid3 ${c.isPlatform?'':'hidden'}" style="margin-top:8px;">
   <div class="field"><label>نسبة العمولة الفورية %</label><input type="number" id="cImmediatePct" value="${c.immediatePct||0}"></div>
   <div class="field"><label>نسبة العمولة المؤجلة %</label><input type="number" id="cDeferredPct" value="${c.deferredPct||0}"></div>
   <div class="field"><label>فترة التسوية</label><select id="cSettlementPeriod"><option value="monthly" ${c.settlementPeriod==='monthly'?'selected':''}>شهري</option><option value="quarterly" ${c.settlementPeriod==='quarterly'?'selected':''}>ربع سنوي</option></select></div>
  </div>
  <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveCustomer(${id||'null'})">حفظ</button></div>
 `);
}
function onPlatformToggle(){ document.getElementById('platformFieldsWrap').classList.toggle('hidden', !document.getElementById('cIsPlatform').checked); }
function saveCustomer(id){
 const name=document.getElementById('cName').value.trim(); if(!name){toast('أدخل الاسم');return;}
 const isPlatform = document.getElementById('cIsPlatform').checked;
 const obj={id:id||uid(), name, phone:document.getElementById('cPhone').value, openingBalance:Number(document.getElementById('cBal').value||0), openingType:document.getElementById('cBalType').value, createdDate:todayStr(),
   isPlatform, immediatePct:Number(document.getElementById('cImmediatePct').value||0), deferredPct:Number(document.getElementById('cDeferredPct').value||0), settlementPeriod:document.getElementById('cSettlementPeriod').value};
 const idx=DB.customers.findIndex(x=>x.id===id);
 if(idx>=0) DB.customers[idx]={...DB.customers[idx],...obj}; else { obj.deferredAccrued=0; DB.customers.push(obj); }
 saveDB(); logAudit(id?'تعديل':'إضافة','sales','عميل: '+name); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteCustomer(id){
 if(!requirePerm('sales','delete'))return;
 if(!confirm('تأكيد حذف العميل؟')) return;
 DB.customers=DB.customers.filter(x=>x.id!==id); saveDB(); renderAll();
}
function openCustLedger(id){
 const c=DB.customers.find(x=>x.id===id);
 const rows = customerLedger(id);
 openModal('كشف حساب: '+c.name, `
 <table><thead><tr><th>التاريخ</th><th>طبيعة الحركة</th><th>مرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>
 ${rows.map(r=>`<tr><td>${r.date}</td><td>${r.type}</td><td>${r.ref}</td><td>${r.debit?fmt(r.debit):''}</td><td>${r.credit?fmt(r.credit):''}</td><td>${fmt(r.balance)}</td></tr>`).join('')||'<tr><td colspan=6 class="empty">لا توجد حركات</td></tr>'}
 </tbody></table>
 <div style="text-align:left;margin-top:10px;"><button class="btn secondary" onclick="printSection('كشف حساب ${c.name}')">طباعة / PDF</button></div>
 `);
}

/* ---------- Sales Returns ---------- */
function renderSalesReturns(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>مرتجع المبيعات</h2>${can('sales','add')?'<button class="btn" onclick="openSalesReturnForm()">+ مرتجع جديد</button>':''}</div>
 <div class="tableWrap" id="srWrap"></div></div>`;
 const wrap=document.getElementById('srWrap');
 const list=DB.salesReturns.slice().sort((a,b)=>b.number-a.number);
 wrap.innerHTML = list.length? `<table><thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>الفاتورة الأصلية</th><th>القيمة</th><th></th></tr></thead><tbody>
  ${list.map(r=>`<tr><td>${r.number}</td><td>${r.date}</td><td>${getCustNameById(r.customerId)}</td><td>#${r.invoiceNumber}</td><td>${fmt(r.total)}</td>
  <td>${can('sales','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteSalesReturn(${r.id})">حذف</button>`:''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">لا توجد مرتجعات</div>';
}
function openSalesReturnForm(){
 if(!requirePerm('sales','add')) return;
 const invoices = DB.salesInvoices.filter(i=>!i.isCash);
 openModal('مرتجع مبيعات جديد', `
  <div class="grid2">
   <div class="field"><label>الفاتورة</label><select id="srInv" onchange="onSrInvChange()">
    <option value="">اختر فاتورة</option>${invoices.map(i=>`<option value="${i.id}">#${i.number} - ${getCustNameById(i.customerId)}</option>`).join('')}</select></div>
   <div class="field"><label>التاريخ</label><input type="date" id="srDate" value="${todayStr()}"></div>
  </div>
  <div id="srLinesWrap" style="margin-top:12px;"></div>
  <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveSalesReturn()">حفظ المرتجع</button></div>
 `);
}
function onSrInvChange(){
 const invId=Number(document.getElementById('srInv').value);
 const inv=DB.salesInvoices.find(x=>x.id===invId);
 const wrap=document.getElementById('srLinesWrap');
 if(!inv){ wrap.innerHTML=''; return; }
 wrap.innerHTML = `<div class="lineRow header"><span>الصنف</span><span>الكمية بالفاتورة</span><span>كمية المرتجع</span><span></span><span></span><span></span></div>
 ${inv.lines.map((l,idx)=>{const it=DB.items.find(x=>x.id==l.itemId); return `<div class="lineRow"><span>${it?it.name:'-'}</span><span>${l.qty}</span><input type="number" id="srQty_${idx}" max="${l.qty}" value="0" min="0"><span></span><span></span><span></span></div>`}).join('')}`;
}
function saveSalesReturn(){
 const invId=Number(document.getElementById('srInv').value), inv=DB.salesInvoices.find(x=>x.id===invId); if(!inv){toast('اختر فاتورة');return;}
 const date=document.getElementById('srDate').value; let total=0,returnCogs=0,retLines=[];
 inv.lines.forEach((l,idx)=>{ const q=Number(document.getElementById('srQty_'+idx).value||0); if(q<=0)return;
  const already=DB.salesReturns.filter(r=>r.invoiceId===invId).reduce((sum,r)=>sum+(r.lines||[]).filter(x=>x.itemId==l.itemId&&x.warehouseId==l.warehouseId).reduce((a,x)=>a+Number(x.qty||0),0),0);
  if(q>Number(l.qty||0)-already) throw new Error('كمية المرتجع تتجاوز الكمية المباعة المتبقية للصنف');
  const unitPriceNet=(l.qty*l.price-computeDiscount(l.qty*l.price,'value',l.discVal||0))/l.qty; total+=unitPriceNet*q;
  const cm=(inv.consumedMap||[])[idx]; let need=q,consumed=[];
  if(cm&&cm.consumed) for(const c of cm.consumed){if(need<=0)break;const take=Math.min(need,Number(c.qty));consumed.push({batchId:c.batchId,qty:take,unitCost:Number(c.unitCost||0)});need-=take;}
  if(need>0.0001) throw new Error('تعذر تحديد تكلفة البضاعة المرتجعة من الفاتورة الأصلية');
  const lc=consumed.reduce((a,c)=>a+c.qty*c.unitCost,0); returnCogs+=lc;
  consumed.forEach(c=>{const b=DB.stockBatches.find(x=>x.id===c.batchId);if(b)b.remaining+=c.qty;else addStockBatch(l.itemId,l.warehouseId,c.qty,c.unitCost,date,'sales_return',null);});
  retLines.push({itemId:l.itemId,warehouseId:l.warehouseId,qty:q,unitPrice:unitPriceNet,cogs:lc,restored:consumed});
  logStockOp(l.itemId,l.warehouseId,'مرتجع مبيعات',q,0,date,'مرتجع مبيعات لفاتورة #'+inv.number);
 });
 if(!retLines.length){toast('حدد كمية مرتجعة');return;}
 const number=nextCounter('sret'),retId=uid(),ret={id:retId,number,date,invoiceId:invId,invoiceNumber:inv.number,customerId:inv.customerId,lines:retLines,total,cogs:returnCogs};
 DB.salesReturns.push(ret); postJournal(date,'مرتجع مبيعات #'+number,'المبيعات (مرتجع)',total,'عميل: '+getCustNameById(inv.customerId),total,'sales_return',retId);
 if(returnCogs>0) postJournal(date,'عكس تكلفة بضاعة مرتجع مبيعات #'+number,'المخزون',returnCogs,'تكلفة البضاعة المباعة',returnCogs,'sales_return_cogs',retId);
 saveDB();logAudit('إضافة','sales','مرتجع مبيعات #'+number);closeModal();renderAll();toast('تم حفظ المرتجع');
}
function deleteSalesReturn(id){
 if(!requirePerm('sales','delete'))return;if(!confirm('تأكيد الحذف؟'))return;const r=DB.salesReturns.find(x=>x.id===id);if(!r)return;
 (r.lines||[]).forEach(l=>(l.restored||[]).forEach(c=>{const b=DB.stockBatches.find(x=>x.id===c.batchId);if(b)b.remaining=Math.max(0,b.remaining-c.qty);}));
 DB.journal=DB.journal.filter(j=>!((j.sourceType==='sales_return'||j.sourceType==='sales_return_cogs')&&j.sourceId===id));DB.stockOps=DB.stockOps.filter(o=>o.ref!=='مرتجع مبيعات #'+r.number);DB.salesReturns=DB.salesReturns.filter(x=>x.id!==id);saveDB();renderAll();
}
function renderSalesReport(root){
 root.innerHTML = `<div class="card"><div class="cardHead"><h2>تقرير المبيعات</h2></div>
 <div class="toolbar"><input type="date" id="repFrom"><input type="date" id="repTo"><input class="searchBox" id="repSearch" placeholder="بحث..."><button class="btn secondary" onclick="runSalesReport()">تطبيق</button></div>
 <div id="repOut"></div></div>`;
 runSalesReport();
}
function runSalesReport(){
 const from=document.getElementById('repFrom').value, to=document.getElementById('repTo').value, q=(document.getElementById('repSearch').value||'').trim();
 let list=DB.salesInvoices.slice();
 if(from) list=list.filter(i=>i.date>=from); if(to) list=list.filter(i=>i.date<=to);
 if(q) list=list.filter(i=>String(i.number).includes(q)||getCustName(i).includes(q));
 const totalSales=list.reduce((s,i)=>s+i.total,0), totalCogs=list.reduce((s,i)=>s+i.cogs,0);
 document.getElementById('repOut').innerHTML = `
 <div class="row" style="margin-bottom:14px;">
  <div class="stat"><div class="lbl">عدد الفواتير</div><div class="val">${list.length}</div></div>
  <div class="stat"><div class="lbl">إجمالي المبيعات</div><div class="val pos">${fmt(totalSales)}</div></div>
  <div class="stat"><div class="lbl">تكلفة البضاعة المباعة</div><div class="val">${fmt(totalCogs)}</div></div>
  <div class="stat"><div class="lbl">مجمل الربح</div><div class="val pos">${fmt(totalSales-totalCogs)}</div></div>
 </div>
 <div class="tableWrap"><table><thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th></tr></thead><tbody>
 ${list.map(i=>`<tr><td>${i.number}</td><td>${i.date}</td><td>${getCustName(i)}</td><td>${fmt(i.total)}</td><td>${invStatusTag(i)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا نتائج</td></tr>'}
 </tbody></table></div>`;
}

/* ================= PURCHASES MODULE ================= */
function suppBalance(suppId){
 // reuse the ledger's cumulative running balance so advance payments (without an invoice) are counted correctly
 const rows = supplierLedger(suppId);
 return rows.length? rows[rows.length-1].balance : 0;
}
function supplierLedger(suppId){
 let rows=[];
 const s=DB.suppliers.find(x=>x.id===suppId);
 if(s && Number(s.openingBalance)) rows.push({date:s.createdDate||todayStr(), type:'رصيد افتتاحي', debit:s.openingType==='debit'?Number(s.openingBalance):0, credit:s.openingType==='credit'?Number(s.openingBalance):0, ref:'-'});
 DB.purchaseInvoices.filter(i=>i.supplierId===suppId).forEach(i=> rows.push({date:i.date,type:'مشتريات',debit:0,credit:i.total,ref:'فاتورة #'+i.number}));
 DB.purchaseReturns.filter(r=>r.supplierId===suppId).forEach(r=> rows.push({date:r.date,type:'مرتجع مشتريات',debit:r.total,credit:0,ref:'مرتجع #'+r.number}));
 DB.vouchers.filter(v=>v.partyType==='supplier'&&v.partyId===suppId&&v.kind==='payment').forEach(v=> rows.push({date:v.date,type:'تسديد',debit:v.amount,credit:0,ref:'إذن #'+v.number}));
 DB.checks.filter(c=>c.type==='out' && c.supplierId===suppId).forEach(c=> rows.push({date:c.date,type:'شيك مُسلَّم',debit:c.amount,credit:0,ref:'شيك #'+c.number}));
 DB.supplierCommissions.filter(c=>c.supplierId===suppId).forEach(c=> rows.push({date:c.date,type:'خصم مكتسب / عمولة',debit:c.amount,credit:0,ref:c.note||'-'}));
 rows.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
 let running=0; rows.forEach(r=>{running += r.credit - r.debit; r.balance=running;});
 return rows;
}
function suppOutstandingInvoices(id){ return DB.purchaseInvoices.filter(i=>i.supplierId===id && i.status!=='paid'); }

RENDERERS.purchases = function(root){
 if(state.sub==='invoices') return renderPurchInvoices(root);
 if(state.sub==='suppliers') return renderSuppliers(root);
 if(state.sub==='returns') return renderPurchReturns(root);
 if(state.sub==='commissions') return renderSuppCommissions(root);
 if(state.sub==='report') return renderPurchReport(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function getSuppNameById(id){ const s=DB.suppliers.find(x=>x.id===id); return s?s.name:'-'; }

function renderPurchInvoices(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>فواتير المشتريات</h2>${can('purchases','add')?'<button class="btn" onclick="openPurchInvoiceForm()">+ فاتورة جديدة</button>':''}</div>
 <div class="toolbar"><input class="searchBox" id="piSearch" oninput="renderPiTable()" placeholder="بحث..."><input type="date" id="piFrom" onchange="renderPiTable()"><input type="date" id="piTo" onchange="renderPiTable()"></div>
 <div class="tableWrap" id="piTableWrap"></div></div>`;
 renderPiTable();
}
function renderPiTable(){
 const wrap=document.getElementById('piTableWrap'); if(!wrap)return;
 const q=(document.getElementById('piSearch').value||'').trim(); const from=document.getElementById('piFrom').value, to=document.getElementById('piTo').value;
 let list=DB.purchaseInvoices.slice().sort((a,b)=>b.number-a.number);
 if(q) list=list.filter(i=>String(i.number).includes(q)||getSuppNameById(i.supplierId).includes(q));
 if(from) list=list.filter(i=>i.date>=from); if(to) list=list.filter(i=>i.date<=to);
 wrap.innerHTML = list.length? `<table><thead><tr><th>#</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>المسدد</th><th>الحالة</th><th></th></tr></thead><tbody>
 ${list.map(i=>`<tr><td>${i.number}</td><td>${i.date}</td><td>${getSuppNameById(i.supplierId)}</td><td>${fmt(i.total)}</td><td>${fmt(i.paidAmount)}</td><td>${invStatusTag(i)}</td>
 <td><button class="linkBtn" onclick="viewPurchInvoice(${i.id})">عرض</button> ${can('purchases','edit')?`<button class="linkBtn" onclick="openPurchInvoiceForm(${i.id})">تعديل</button>`:''} ${can('purchases','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deletePurchInvoice(${i.id})">حذف</button>`:''}</td></tr>`).join('')}
 </tbody></table>` : '<div class="empty">لا توجد فواتير</div>';
}
function openPurchInvoiceForm(id){
 if(!requirePerm('purchases', id?'edit':'add')) return;
 const inv = id? DB.purchaseInvoices.find(x=>x.id===id) : {number:nextCounterPeek('pinv'), date:todayStr(), supplierId:DB.suppliers[0]?.id||'', lines:[{itemId:'',warehouseId:DB.warehouses[0]?.id||'',qty:1,cost:0}], discType:'value', discVal:0};
 openModal(id?'تعديل فاتورة مشتريات':'فاتورة مشتريات جديدة', `
  <div class="grid3">
   <div class="field"><label>رقم الفاتورة</label><input type="number" id="pNum" value="${inv.number}"></div>
   <div class="field"><label>التاريخ</label><input type="date" id="pDate" value="${inv.date}"></div>
   <div class="field"><label>المورد</label><select id="pSupp">${DB.suppliers.map(s=>`<option value="${s.id}" ${inv.supplierId==s.id?'selected':''}>${s.name}</option>`).join('')}</select></div>
  </div>
  <hr style="border-color:var(--border);margin:14px 0;">
  <div class="linesScroll">
  <div class="lineRow header"><span>الصنف</span><span>المخزن</span><span>الكمية</span><span>سعر الشراء</span><span></span><span></span></div>
  <div id="pLinesWrap"></div>
  </div>
  <button class="btn secondary small" onclick="addPLine()">+ إضافة صنف</button>
  <hr style="border-color:var(--border);margin:14px 0;">
  <div class="grid3">
   <div class="field"><label>خصم على الفاتورة</label><input type="number" id="pDiscVal" value="${inv.discVal||0}" oninput="recalcPTotal()"></div>
   <div class="field"><label>نوع الخصم</label><select id="pDiscType" onchange="recalcPTotal()"><option value="value" ${inv.discType==='value'?'selected':''}>قيمة</option><option value="percent" ${inv.discType==='percent'?'selected':''}>نسبة %</option></select></div>
   <div class="field"><label>الإجمالي</label><input id="pTotal" disabled></div>
  </div>
  <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="savePurchInvoice(${id||'null'})">حفظ الفاتورة</button></div>
 `, ()=>{ window._pLines=JSON.parse(JSON.stringify(inv.lines)); renderPLines(); }, true);
}
function addPLine(){ window._pLines.push({itemId:'',warehouseId:DB.warehouses[0]?.id||'',qty:1,cost:0}); renderPLines(); }
function renderPLines(){
 const wrap=document.getElementById('pLinesWrap'); wrap.innerHTML='';
 window._pLines.forEach((ln,idx)=>{
  const row=document.createElement('div'); row.className='lineRow';
  row.innerHTML=`
   ${itemPickerHTML('p', idx, ln.itemId)}
   <select onchange="updPLine(${idx},'warehouseId',this.value)">${DB.warehouses.map(w=>`<option value="${w.id}" ${ln.warehouseId==w.id?'selected':''}>${w.name}</option>`).join('')}</select>
   <input type="number" value="${ln.qty}" oninput="updPLine(${idx},'qty',this.value)">
   <input type="number" value="${ln.cost}" oninput="updPLine(${idx},'cost',this.value)">
   <span></span>
   <button class="linkBtn" style="color:var(--danger)" onclick="removePLine(${idx})">حذف</button>`;
  wrap.appendChild(row);
 });
 recalcPTotal();
}
function updPLine(idx,f,v){ window._pLines[idx][f]=Number(v); recalcPTotal(); }
function removePLine(idx){ window._pLines.splice(idx,1); renderPLines(); }
function recalcPTotal(){
 const sub=window._pLines.reduce((s,l)=>s+l.qty*l.cost,0);
 const dType=document.getElementById('pDiscType')?.value||'value', dVal=Number(document.getElementById('pDiscVal')?.value||0);
 const disc=computeDiscount(sub,dType,dVal); const total=sub-disc;
 if(document.getElementById('pTotal')) document.getElementById('pTotal').value=fmt(total);
 return {sub,disc,total};
}
function savePurchInvoice(id){
 const lines=window._pLines.filter(l=>l.itemId && l.qty>0); if(!lines.length){toast('أضف صنف');return;}
 const date=document.getElementById('pDate').value, suppId=Number(document.getElementById('pSupp').value);
 const {sub,disc,total}=recalcPTotal();
 if(id) reversePurchInvoice(id,true);
 const suggested = id? DB.purchaseInvoices.find(x=>x.id===id).number : nextCounter('pinv');
 const enteredNumber = Number(document.getElementById('pNum').value);
 const number = enteredNumber || suggested;
 const invId = id||uid();
 // full cost per line (discount does NOT reduce inventory cost - it's earned income instead)
 lines.forEach(ln=>{
  addStockBatch(ln.itemId, ln.warehouseId, ln.qty, ln.cost, date, 'purchase', invId);
  logStockOp(ln.itemId, ln.warehouseId, 'مشتريات', ln.qty, 0, date, 'فاتورة مشتريات #'+number);
 });
 const inv={id:invId, number, date, supplierId:suppId, lines, discType:document.getElementById('pDiscType').value, discVal:Number(document.getElementById('pDiscVal').value||0), sub, disc, total, paidAmount:0, status:'unpaid'};
 const idx=DB.purchaseInvoices.findIndex(x=>x.id===invId);
 if(idx>=0) DB.purchaseInvoices[idx]=inv; else DB.purchaseInvoices.push(inv);
 saveDB();
 const suppLabel='مورد: '+getSuppNameById(suppId);
 postJournal(date,'فاتورة مشتريات #'+number, 'المشتريات', sub, suppLabel, sub, 'purchase', invId);
 if(disc>0){
  postJournal(date,'خصم مكتسب - فاتورة مشتريات #'+number, suppLabel, disc, 'خصم مكتسب (إيرادات أخرى)', disc, 'purchase_discount', invId);
  DB.otherIncome.push({id:uid(), number:nextCounter('inc'), date, description:'خصم مكتسب - فاتورة مشتريات #'+number, amount:disc, auto:true, refType:'purchase', refId:invId});
 }
 saveDB();
 logAudit(id?'تعديل':'إضافة','purchases','فاتورة مشتريات #'+number);
 closeModal(); renderAll(); toast('تم الحفظ');
}
function reversePurchInvoice(id,silent){
 const inv=DB.purchaseInvoices.find(x=>x.id===id);if(!inv)return;
 const used=DB.salesInvoices.some(si=>(si.consumedMap||[]).some(cm=>(cm.consumed||[]).some(c=>{const b=DB.stockBatches.find(x=>x.id===c.batchId);return b&&b.sourceType==='purchase'&&b.sourceId===id;})))||DB.purchaseReturns.some(r=>r.invoiceId===id);
 if(used){if(!silent)throw new Error('لا يمكن حذف/تعديل فاتورة شراء سبق استخدام مخزونها في بيع أو مرتجع. يجب معالجة العمليات المرتبطة أولاً.');return;}
 DB.stockBatches=DB.stockBatches.filter(b=>!(b.sourceType==='purchase'&&b.sourceId===id));DB.stockOps=DB.stockOps.filter(o=>o.ref!=='فاتورة مشتريات #'+inv.number);DB.journal=DB.journal.filter(j=>!(j.sourceType==='purchase'&&j.sourceId===id)&&!(j.sourceType==='purchase_discount'&&j.sourceId===id));DB.otherIncome=DB.otherIncome.filter(o=>!(o.refType==='purchase'&&o.refId===id));if(!silent){DB.purchaseInvoices=DB.purchaseInvoices.filter(x=>x.id!==id);saveDB();}
}
function deletePurchInvoice(id){
 if(!requirePerm('purchases','delete'))return;
 if(!confirm('تأكيد الحذف؟ سيتم عكس أثر الفاتورة على المخزون.'))return;
 reversePurchInvoice(id,false); logAudit('حذف','purchases','فاتورة مشتريات #'+id); renderAll();
}
function viewPurchInvoice(id){
 const inv=DB.purchaseInvoices.find(x=>x.id===id); if(!inv)return;
 openModal('فاتورة مشتريات #'+inv.number, `
 <p>التاريخ: ${inv.date} | المورد: ${getSuppNameById(inv.supplierId)} | الحالة: ${invStatusTag(inv)}</p>
 <table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
 ${inv.lines.map(l=>{const it=DB.items.find(x=>x.id==l.itemId);return `<tr><td>${it?it.name:'-'}</td><td>${l.qty}</td><td>${fmt(l.cost)}</td><td>${fmt(l.qty*l.cost)}</td></tr>`}).join('')}
 </tbody></table>
 <p style="margin-top:10px;">الإجمالي: ${fmt(inv.sub)} | خصم: ${fmt(inv.disc)} | <b>الصافي: ${fmt(inv.total)}</b></p>
 <p>المسدد: ${fmt(inv.paidAmount)} | المتبقي: ${fmt(inv.total-inv.paidAmount)}</p>
 <div style="text-align:left;margin-top:10px;"><button class="btn secondary" onclick="printSection('فاتورة مشتريات #${inv.number}')">طباعة / PDF</button></div>
 `);
}

/* ---------- Suppliers ---------- */
function renderSuppliers(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>الموردون</h2>${can('purchases','add')?'<button class="btn" onclick="openSupplierForm()">+ مورد جديد</button>':''}</div>
 <div class="toolbar"><input class="searchBox" id="suppSearch" oninput="renderSuppTable()" placeholder="بحث..."></div>
 <div class="tableWrap" id="suppTableWrap"></div></div>`;
 renderSuppTable();
}
function renderSuppTable(){
 const wrap=document.getElementById('suppTableWrap'); if(!wrap)return;
 const q=(document.getElementById('suppSearch').value||'').trim();
 let list=DB.suppliers.filter(s=>!q||s.name.includes(q));
 wrap.innerHTML = list.length? `<table><thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th></th></tr></thead><tbody>
 ${list.map(s=>{const bal=suppBalance(s.id); return `<tr><td><button class="linkBtn" onclick="openSuppLedger(${s.id})">${s.name}</button></td><td>${s.phone||'-'}</td>
 <td>${fmt(Math.abs(bal))} <span class="tag ${bal>=0?'credit':'debit'}">${bal>=0?'دائن (عليّ)':'مدين (له عندي)'}</span></td>
 <td>${can('purchases','edit')?`<button class="linkBtn" onclick="openSupplierForm(${s.id})">تعديل</button>`:''} ${can('purchases','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteSupplier(${s.id})">حذف</button>`:''}</td></tr>`}).join('')}
 </tbody></table>` : '<div class="empty">لا يوجد موردون</div>';
}
function openSupplierForm(id){
 if(!requirePerm('purchases', id?'edit':'add')) return;
 const s=id?DB.suppliers.find(x=>x.id===id):{name:'',phone:'',openingBalance:0,openingType:'credit'};
 openModal(id?'تعديل مورد':'مورد جديد', `
  <div class="grid2">
   <div class="field"><label>الاسم</label><input id="sName" value="${s.name}"></div>
   <div class="field"><label>الهاتف</label><input id="sPhone" value="${s.phone||''}"></div>
   <div class="field"><label>رصيد افتتاحي</label><input type="number" id="sBal" value="${s.openingBalance||0}"></div>
   <div class="field"><label>نوع الرصيد</label><select id="sBalType"><option value="credit" ${s.openingType==='credit'?'selected':''}>دائن (عليّ له)</option><option value="debit" ${s.openingType==='debit'?'selected':''}>مدين (له عندي)</option></select></div>
  </div>
  <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveSupplier(${id||'null'})">حفظ</button></div>
 `);
}
function saveSupplier(id){
 const name=document.getElementById('sName').value.trim(); if(!name){toast('أدخل الاسم');return;}
 const obj={id:id||uid(), name, phone:document.getElementById('sPhone').value, openingBalance:Number(document.getElementById('sBal').value||0), openingType:document.getElementById('sBalType').value, createdDate:todayStr()};
 const idx=DB.suppliers.findIndex(x=>x.id===id);
 if(idx>=0) DB.suppliers[idx]={...DB.suppliers[idx],...obj}; else DB.suppliers.push(obj);
 saveDB(); logAudit(id?'تعديل':'إضافة','purchases','مورد: '+name); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteSupplier(id){ if(!requirePerm('purchases','delete'))return; if(!confirm('تأكيد الحذف؟'))return; DB.suppliers=DB.suppliers.filter(x=>x.id!==id); saveDB(); renderAll(); }
function openSuppLedger(id){
 const s=DB.suppliers.find(x=>x.id===id); const rows=supplierLedger(id);
 openModal('كشف حساب: '+s.name, `<table><thead><tr><th>التاريخ</th><th>طبيعة الحركة</th><th>مرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>
 ${rows.map(r=>`<tr><td>${r.date}</td><td>${r.type}</td><td>${r.ref}</td><td>${r.debit?fmt(r.debit):''}</td><td>${r.credit?fmt(r.credit):''}</td><td>${fmt(r.balance)}</td></tr>`).join('')||'<tr><td colspan=6 class="empty">لا توجد حركات</td></tr>'}
 </tbody></table><div style="text-align:left;margin-top:10px;"><button class="btn secondary" onclick="printSection('كشف حساب ${s.name}')">طباعة / PDF</button></div>`);
}

/* ---------- Purchase Returns ---------- */
function renderPurchReturns(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>مرتجع المشتريات</h2>${can('purchases','add')?'<button class="btn" onclick="openPurchReturnForm()">+ مرتجع جديد</button>':''}</div>
 <div class="tableWrap" id="prWrap"></div></div>`;
 const wrap=document.getElementById('prWrap'); const list=DB.purchaseReturns.slice().sort((a,b)=>b.number-a.number);
 wrap.innerHTML = list.length? `<table><thead><tr><th>#</th><th>التاريخ</th><th>المورد</th><th>الفاتورة الأصلية</th><th>القيمة</th><th></th></tr></thead><tbody>
 ${list.map(r=>`<tr><td>${r.number}</td><td>${r.date}</td><td>${getSuppNameById(r.supplierId)}</td><td>#${r.invoiceNumber}</td><td>${fmt(r.total)}</td>
 <td>${can('purchases','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deletePurchReturn(${r.id})">حذف</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا توجد مرتجعات</div>';
}
function openPurchReturnForm(){
 if(!requirePerm('purchases','add'))return;
 const invoices=DB.purchaseInvoices;
 openModal('مرتجع مشتريات جديد', `
 <div class="grid2">
  <div class="field"><label>الفاتورة</label><select id="prInv" onchange="onPrInvChange()"><option value="">اختر فاتورة</option>${invoices.map(i=>`<option value="${i.id}">#${i.number} - ${getSuppNameById(i.supplierId)}</option>`).join('')}</select></div>
  <div class="field"><label>التاريخ</label><input type="date" id="prDate" value="${todayStr()}"></div>
 </div>
 <div id="prLinesWrap" style="margin-top:12px;"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="savePurchReturn()">حفظ المرتجع</button></div>`);
}
function onPrInvChange(){
 const invId=Number(document.getElementById('prInv').value); const inv=DB.purchaseInvoices.find(x=>x.id===invId);
 const wrap=document.getElementById('prLinesWrap'); if(!inv){wrap.innerHTML='';return;}
 wrap.innerHTML = `<div class="lineRow header"><span>الصنف</span><span>الكمية بالفاتورة</span><span>كمية المرتجع</span><span></span><span></span><span></span></div>
 ${inv.lines.map((l,idx)=>{const it=DB.items.find(x=>x.id==l.itemId); return `<div class="lineRow"><span>${it?it.name:'-'}</span><span>${l.qty}</span><input type="number" id="prQty_${idx}" max="${l.qty}" value="0"><span></span><span></span><span></span></div>`}).join('')}`;
}
function savePurchReturn(){
 const invId=Number(document.getElementById('prInv').value),inv=DB.purchaseInvoices.find(x=>x.id===invId);if(!inv){toast('اختر فاتورة');return;}const date=document.getElementById('prDate').value;let total=0,retLines=[];
 inv.lines.forEach((l,idx)=>{const q=Number(document.getElementById('prQty_'+idx).value||0);if(q<=0)return;const already=DB.purchaseReturns.filter(r=>r.invoiceId===invId).reduce((sum,r)=>sum+(r.lines||[]).filter(x=>x.itemId==l.itemId&&x.warehouseId==l.warehouseId).reduce((a,x)=>a+Number(x.qty||0),0),0);if(q>Number(l.qty||0)-already)throw new Error('كمية مرتجع المشتريات تتجاوز الكمية المتاحة من الفاتورة');const rr=consumeStockFIFO(l.itemId,l.warehouseId,q,false);if(!rr)throw new Error('لا يوجد مخزون كافٍ لإرجاع الكمية');total+=rr.cost;retLines.push({itemId:l.itemId,warehouseId:l.warehouseId,qty:q,consumed:rr.consumed});logStockOp(l.itemId,l.warehouseId,'مرتجع مشتريات',0,q,date,'مرتجع مشتريات لفاتورة #'+inv.number);});
 if(!retLines.length){toast('حدد كمية مرتجعة');return;}const number=nextCounter('pret'),retId=uid(),ret={id:retId,number,date,invoiceId:invId,invoiceNumber:inv.number,supplierId:inv.supplierId,lines:retLines,total};DB.purchaseReturns.push(ret);postJournal(date,'مرتجع مشتريات #'+number,'مورد: '+getSuppNameById(inv.supplierId),total,'المشتريات (مرتجع)',total,'purchase_return',retId);saveDB();logAudit('إضافة','purchases','مرتجع مشتريات #'+number);closeModal();renderAll();toast('تم الحفظ');
}
function deletePurchReturn(id){
 if(!requirePerm('purchases','delete'))return;if(!confirm('تأكيد الحذف؟'))return;const r=DB.purchaseReturns.find(x=>x.id===id);if(!r)return;(r.lines||[]).forEach(l=>(l.consumed||[]).forEach(c=>{const b=DB.stockBatches.find(x=>x.id===c.batchId);if(b)b.remaining+=c.qty;}));DB.journal=DB.journal.filter(j=>!(j.sourceType==='purchase_return'&&j.sourceId===id));DB.stockOps=DB.stockOps.filter(o=>o.ref!=='مرتجع مشتريات لفاتورة #'+r.invoiceNumber);DB.purchaseReturns=DB.purchaseReturns.filter(x=>x.id!==id);saveDB();renderAll();
}
function renderSuppCommissions(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>عمولة الموردين</h2>${can('purchases','add')?'<button class="btn" onclick="openCommForm()">+ إضافة عمولة</button>':''}</div>
 <div class="tableWrap" id="commWrap"></div></div>`;
 const wrap=document.getElementById('commWrap'); const list=DB.supplierCommissions.slice().sort((a,b)=>b.id-a.id);
 wrap.innerHTML = list.length? `<table><thead><tr><th>التاريخ</th><th>المورد</th><th>القيمة</th><th>ملاحظات</th></tr></thead><tbody>
 ${list.map(c=>`<tr><td>${c.date}</td><td>${getSuppNameById(c.supplierId)}</td><td>${fmt(c.amount)}</td><td>${c.note||'-'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا توجد عمولات</div>';
}
function openCommForm(){
 if(!requirePerm('purchases','add'))return;
 openModal('إضافة عمولة مورد', `
 <div class="grid2">
  <div class="field"><label>المورد</label><select id="cmSupp">${DB.suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
  <div class="field"><label>التاريخ</label><input type="date" id="cmDate" value="${todayStr()}"></div>
  <div class="field"><label>القيمة</label><input type="number" id="cmAmount"></div>
  <div class="field"><label>ملاحظات</label><input id="cmNote"></div>
 </div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveComm()">حفظ</button></div>`);
}
function saveComm(){
 const suppId=Number(document.getElementById('cmSupp').value), amount=Number(document.getElementById('cmAmount').value||0), date=document.getElementById('cmDate').value, note=document.getElementById('cmNote').value;
 if(!amount){toast('أدخل القيمة');return;}
 const c={id:uid(),supplierId:suppId,amount,date,note}; DB.supplierCommissions.push(c); saveDB();
 postJournal(date,'عمولة مورد: '+getSuppNameById(suppId),'مورد: '+getSuppNameById(suppId),amount,'عمولة موردين (إيراد)',amount,'supplier_commission',c.id);
 logAudit('إضافة','purchases','عمولة مورد'); closeModal(); renderAll(); toast('تم الحفظ');
}
function renderPurchReport(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>تقرير المشتريات</h2></div>
 <div class="toolbar"><input type="date" id="prepFrom"><input type="date" id="prepTo"><input class="searchBox" id="prepSearch" placeholder="بحث..."><button class="btn secondary" onclick="runPurchReport()">تطبيق</button></div>
 <div id="prepOut"></div></div>`;
 runPurchReport();
}
function runPurchReport(){
 const from=document.getElementById('prepFrom').value, to=document.getElementById('prepTo').value, q=(document.getElementById('prepSearch').value||'').trim();
 let list=DB.purchaseInvoices.slice();
 if(from) list=list.filter(i=>i.date>=from); if(to) list=list.filter(i=>i.date<=to);
 if(q) list=list.filter(i=>String(i.number).includes(q)||getSuppNameById(i.supplierId).includes(q));
 const total=list.reduce((s,i)=>s+i.total,0);
 document.getElementById('prepOut').innerHTML=`<div class="row" style="margin-bottom:14px;"><div class="stat"><div class="lbl">عدد الفواتير</div><div class="val">${list.length}</div></div><div class="stat"><div class="lbl">إجمالي المشتريات</div><div class="val">${fmt(total)}</div></div></div>
 <div class="tableWrap"><table><thead><tr><th>#</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>الحالة</th></tr></thead><tbody>
 ${list.map(i=>`<tr><td>${i.number}</td><td>${i.date}</td><td>${getSuppNameById(i.supplierId)}</td><td>${fmt(i.total)}</td><td>${invStatusTag(i)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا نتائج</td></tr>'}</tbody></table></div>`;
}

/* ================= INVENTORY MODULE ================= */
RENDERERS.inventory = function(root){
 if(state.sub==='items') return renderItems(root);
 if(state.sub==='receive') return renderStockReceive(root);
 if(state.sub==='issue') return renderStockIssue(root);
 if(state.sub==='transfer') return renderStockTransfer(root);
 if(state.sub==='ops') return renderStockOps(root);
 if(state.sub==='import') return renderInvImportExport(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function renderItems(root){
 root.innerHTML=`<div class="card" id="itemsPrintArea"><div class="cardHead"><h2>كارت الصنف</h2>
 <div class="row">${can('inventory','add')?'<button class="btn" onclick="openItemForm()">+ صنف جديد</button>':''}<button class="btn secondary" onclick="printElement('itemsPrintArea','تقرير المخزون')">🖨 طباعة / PDF</button></div></div>
 <div class="toolbar"><input class="searchBox" id="itSearch" oninput="renderItemsTable()" placeholder="بحث بالاسم أو الكود..."><select id="itWh" onchange="renderItemsTable()"><option value="">كل المخازن</option>${DB.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
 <div class="tableWrap" id="itTableWrap"></div></div>
 <div class="card"><div class="cardHead"><h2>المخازن</h2>${isAdmin()?'<button class="btn secondary small" onclick="openWarehouseForm()">+ مخزن جديد</button>':''}</div>
 <div class="tableWrap">${DB.warehouses.map(w=>`<span class="badge" style="margin-left:6px;">${w.name}</span>`).join('')}</div></div>`;
 renderItemsTable();
}
function renderItemsTable(){
 const wrap=document.getElementById('itTableWrap'); if(!wrap)return;
 const q=(document.getElementById('itSearch').value||'').trim(); const whIdRaw=document.getElementById('itWh').value; const whId = whIdRaw? Number(whIdRaw): null;
 let list=DB.items.filter(i=>!q||i.name.includes(q)||String(i.code).includes(q));
 wrap.innerHTML = list.length? `<table><thead><tr><th>الكود</th><th>الاسم</th><th>الرصيد الحالي</th><th>قيمة الرصيد</th><th></th></tr></thead><tbody>
 ${list.map(i=>{ const stock=getItemStock(i.id, whId); const val=getItemStockValue(i.id, whId); return `<tr>
  <td>${i.code}</td><td><button class="linkBtn" onclick="openItemCard(${i.id})">${i.name}</button></td><td>${fmt(stock)} ${i.unit||''}</td><td>${fmt(val)}</td>
  <td>${can('inventory','edit')?`<button class="linkBtn" onclick="openItemForm(${i.id})">تعديل</button>`:''} ${can('inventory','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteItem(${i.id})">حذف</button>`:''}</td>
 </tr>`}).join('')}
 </tbody></table>` : '<div class="empty">لا توجد أصناف</div>';
}
function openWarehouseForm(){
 openModal('مخزن جديد', `<div class="field"><label>اسم المخزن</label><input id="whName"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="(function(){const n=document.getElementById('whName').value.trim(); if(!n){toast('أدخل اسم');return;} DB.warehouses.push({id:uid(),name:n}); saveDB(); closeModal(); renderAll();})()">حفظ</button></div>`);
}
function openItemForm(id){
 if(!requirePerm('inventory', id?'edit':'add')) return;
 const it=id?DB.items.find(x=>x.id===id):{code:'IT'+(DB.items.length+1).toString().padStart(4,'0'),name:'',unit:'قطعة'};
 openModal(id?'تعديل صنف':'صنف جديد', `
 <div class="grid3">
  <div class="field"><label>الكود</label><input id="itCode" value="${it.code}"></div>
  <div class="field"><label>الاسم</label><input id="itName" value="${it.name}"></div>
  <div class="field"><label>الوحدة</label><input id="itUnit" value="${it.unit||'قطعة'}"></div>
 </div>
 ${!id?`<hr style="border-color:var(--border);margin:14px 0;"><p style="color:var(--muted);font-size:12px;">رصيد افتتاحي (اختياري)</p>
 <div class="grid3"><div class="field"><label>المخزن</label><select id="itOpWh">${DB.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
 <div class="field"><label>الكمية</label><input type="number" id="itOpQty" value="0"></div>
 <div class="field"><label>سعر التكلفة</label><input type="number" id="itOpCost" value="0"></div></div>`:''}
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveItem(${id||'null'})">حفظ</button></div>`);
}
function saveItem(id){
 const code=document.getElementById('itCode').value.trim(), name=document.getElementById('itName').value.trim(), unit=document.getElementById('itUnit').value;
 if(!name){toast('أدخل الاسم');return;}
 const obj={id:id||uid(), code, name, unit};
 const idx=DB.items.findIndex(x=>x.id===id);
 if(idx>=0) DB.items[idx]={...DB.items[idx],...obj}; else DB.items.push(obj);
 if(!id){
  const qty=Number(document.getElementById('itOpQty')?.value||0), cost=Number(document.getElementById('itOpCost')?.value||0), whId=Number(document.getElementById('itOpWh')?.value);
  if(qty>0){ addStockBatch(obj.id, whId, qty, cost, todayStr(), 'opening', null); logStockOp(obj.id, whId, 'رصيد افتتاحي', qty, 0, todayStr(), '-'); }
 }
 saveDB(); logAudit(id?'تعديل':'إضافة','inventory','صنف: '+name); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteItem(id){ if(!requirePerm('inventory','delete'))return; if(!confirm('تأكيد الحذف؟'))return; DB.items=DB.items.filter(x=>x.id!==id); saveDB(); renderAll(); }
function getBatchSupplierName(batch){
 if(batch.sourceType==='purchase'){
  const inv = DB.purchaseInvoices.find(x=>x.id===batch.sourceId);
  if(inv) return getSuppNameById(inv.supplierId);
 }
 if(batch.sourceType==='opening') return 'رصيد افتتاحي';
 if(batch.sourceType==='transfer_in') return 'تحويل داخلي';
 if(batch.sourceType==='sales_return') return 'مرتجع مبيعات';
 return '-';
}
function openItemCard(id){
 const it=DB.items.find(x=>x.id===id);
 const batches=DB.stockBatches.filter(b=>b.itemId===id && b.remaining>0.0001);
 const ops=DB.stockOps.filter(o=>o.itemId===id).slice().reverse();
 openModal('كارت الصنف: '+it.name, `
 <p>الكود: ${it.code} | الوحدة: ${it.unit}</p>
 <h4 style="color:var(--muted)">الدفعات الحالية (FIFO)</h4>
 <table><thead><tr><th>المخزن</th><th>الشركة الموردة</th><th>التاريخ</th><th>الكمية المتبقية</th><th>التكلفة</th></tr></thead><tbody>
 ${batches.map(b=>`<tr><td>${DB.warehouses.find(w=>w.id===b.warehouseId)?.name||'-'}</td><td>${getBatchSupplierName(b)}</td><td>${b.date}</td><td>${fmt(b.remaining)}</td><td>${fmt(b.unitCost)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا يوجد رصيد</td></tr>'}
 </tbody></table>
 <h4 style="color:var(--muted);margin-top:14px;">آخر الحركات</h4>
 <table><thead><tr><th>التاريخ</th><th>النوع</th><th>وارد</th><th>منصرف</th></tr></thead><tbody>
 ${ops.slice(0,20).map(o=>`<tr><td>${o.date}</td><td>${o.type}</td><td>${o.in?fmt(o.in):''}</td><td>${o.out?fmt(o.out):''}</td></tr>`).join('')||'<tr><td colspan=4 class="empty">لا توجد حركات</td></tr>'}
 </tbody></table>`, null, true);
}
function logStockOp(itemId, warehouseId, type, qtyIn, qtyOut, date, ref){
 DB.stockOps.push({id:uid(), itemId, warehouseId, type, in:qtyIn||0, out:qtyOut||0, date, ref});
}
/* Receive / Issue shortcuts -> redirect to invoice forms as requested */
function renderStockReceive(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>إذن استلام مخزني</h2></div>
 <p style="color:var(--muted)">إذن الاستلام المخزني مرتبط مباشرة بفاتورة المشتريات — أي فاتورة شراء تُنشئ استلام مخزني تلقائيًا.</p>
 ${can('purchases','add')?'<button class="btn" onclick="state.section=\'purchases\';state.sub=\'invoices\';renderAll();setTimeout(()=>openPurchInvoiceForm(),50);">+ فاتورة مشتريات جديدة (استلام)</button>':''}
 </div>`;
}
function renderStockIssue(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>إذن صرف مخزني</h2></div>
 <p style="color:var(--muted)">إذن الصرف المخزني مرتبط مباشرة بفاتورة المبيعات — أي فاتورة بيع تُنشئ صرف مخزني تلقائيًا.</p>
 ${can('sales','add')?'<button class="btn" onclick="state.section=\'sales\';state.sub=\'invoices\';renderAll();setTimeout(()=>openSalesInvoiceForm(),50);">+ فاتورة مبيعات جديدة (صرف)</button>':''}
 </div>`;
}
function renderStockTransfer(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>تحويل بين المخازن</h2>${can('inventory','add')?'<button class="btn" onclick="openTransferForm()">+ تحويل جديد</button>':''}</div>
 <div class="tableWrap" id="trWrap"></div></div>`;
 const wrap=document.getElementById('trWrap');
 const list=DB.stockOps.filter(o=>o.type==='تحويل مخزني (صادر)').slice().reverse();
 wrap.innerHTML = list.length? `<table><thead><tr><th>التاريخ</th><th>الصنف</th><th>من</th><th>إلى</th><th>الكمية</th></tr></thead><tbody>
 ${list.map(o=>{const it=DB.items.find(i=>i.id===o.itemId); return `<tr><td>${o.date}</td><td>${it?it.name:'-'}</td><td>${DB.warehouses.find(w=>w.id===o.warehouseId)?.name}</td><td>${o.ref}</td><td>${fmt(o.out)}</td></tr>`}).join('')}
 </tbody></table>`:'<div class="empty">لا توجد تحويلات</div>';
}
function openTransferForm(){
 if(!requirePerm('inventory','add'))return;
 openModal('تحويل بين المخازن', `
 <div class="grid4">
  <div class="field"><label>الصنف</label><select id="trItem">${DB.items.map(i=>`<option value="${i.id}">${i.name}</option>`).join('')}</select></div>
  <div class="field"><label>من مخزن</label><select id="trFrom">${DB.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
  <div class="field"><label>إلى مخزن</label><select id="trTo">${DB.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
  <div class="field"><label>الكمية</label><input type="number" id="trQty" value="1"></div>
 </div>
 <div class="field" style="margin-top:8px;"><label>التاريخ</label><input type="date" id="trDate" value="${todayStr()}"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveTransfer()">تنفيذ التحويل</button></div>`);
}
function saveTransfer(){
 const itemId=Number(document.getElementById('trItem').value), from=Number(document.getElementById('trFrom').value), to=Number(document.getElementById('trTo').value), qty=Number(document.getElementById('trQty').value||0), date=document.getElementById('trDate').value;
 if(from===to){toast('اختر مخزنين مختلفين');return;}
 if(qty<=0){toast('أدخل كمية صحيحة');return;}
 const avail = getItemStock(itemId, from);
 if(qty>avail){ toast('الكمية غير متوفرة في المخزن المصدر'); return; }
 const r=consumeStockFIFO(itemId, from, qty, false);
 r.consumed.forEach(c=> addStockBatch(itemId, to, c.qty, c.unitCost, date, 'transfer_in', null));
 logStockOp(itemId, from, 'تحويل مخزني (صادر)', 0, qty, date, DB.warehouses.find(w=>w.id===to)?.name);
 logStockOp(itemId, to, 'تحويل مخزني (وارد)', qty, 0, date, DB.warehouses.find(w=>w.id===from)?.name);
 saveDB(); logAudit('إضافة','inventory','تحويل مخزني'); closeModal(); renderAll(); toast('تم التحويل');
}
function renderStockOps(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>سجل عمليات المخازن</h2></div>
 <div class="toolbar"><input class="searchBox" id="opSearch" oninput="renderOpsTable()" placeholder="بحث..."><input type="date" id="opFrom" onchange="renderOpsTable()"><input type="date" id="opTo" onchange="renderOpsTable()"></div>
 <div class="tableWrap" id="opsTableWrap"></div></div>`;
 renderOpsTable();
}
function renderOpsTable(){
 const wrap=document.getElementById('opsTableWrap'); if(!wrap)return;
 const q=(document.getElementById('opSearch').value||'').trim(); const from=document.getElementById('opFrom').value, to=document.getElementById('opTo').value;
 let list=DB.stockOps.slice().reverse();
 if(from) list=list.filter(o=>o.date>=from); if(to) list=list.filter(o=>o.date<=to);
 if(q) list=list.filter(o=>{const it=DB.items.find(i=>i.id===o.itemId); return it && it.name.includes(q);});
 wrap.innerHTML = list.length? `<table><thead><tr><th>التاريخ</th><th>الصنف</th><th>المخزن</th><th>النوع</th><th>وارد</th><th>منصرف</th></tr></thead><tbody>
 ${list.map(o=>{const it=DB.items.find(i=>i.id===o.itemId); return `<tr><td>${o.date}</td><td>${it?it.name:'-'}</td><td>${DB.warehouses.find(w=>w.id===o.warehouseId)?.name||'-'}</td><td>${o.type}</td><td>${o.in?fmt(o.in):''}</td><td>${o.out?fmt(o.out):''}</td></tr>`}).join('')}
 </tbody></table>`:'<div class="empty">لا توجد عمليات</div>';
}
function renderInvImportExport(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>استيراد / تصدير الأصناف</h2></div>
 <div class="row">
  <button class="btn secondary" onclick="downloadWorkbook([{الكود:'',الاسم:'',الوحدة:'',المخزن:DB.warehouses[0]?.name||'','الكمية الافتتاحية':'','سعر التكلفة':''}],'قالب_الأصناف.xlsx','أصناف')">⬇ تصدير قالب فاضي</button>
  ${can('inventory','add')?'<button class="btn" onclick="importItemsExcel()">⬆ استيراد من ملف</button>':''}
  <button class="btn secondary" onclick="exportCurrentItems()">⬇ تصدير الأصناف الحالية</button>
 </div>
 <p style="color:var(--muted);margin-top:10px;font-size:12px;">الأعمدة المطلوبة: الكود، الاسم، الوحدة، المخزن، الكمية الافتتاحية، سعر التكلفة</p></div>`;
}
function importItemsExcel(){
 pickExcelAndImport(rows=>{
  let count=0;
  rows.forEach(r=>{
   const name=r['الاسم']||r['name']; if(!name) return;
   let item = DB.items.find(i=>i.name===name || (r['الكود'] && i.code===String(r['الكود'])));
   if(!item){ item={id:uid(), code:r['الكود']||('IT'+(DB.items.length+1).toString().padStart(4,'0')), name, unit:r['الوحدة']||'قطعة'}; DB.items.push(item); }
   const whName=r['المخزن'];
   let wh = DB.warehouses.find(w=>w.name===whName) || DB.warehouses[0];
   if(whName && !wh){ wh={id:uid(),name:whName}; DB.warehouses.push(wh); }
   const qty=Number(r['الكمية الافتتاحية']||0), cost=Number(r['سعر التكلفة']||0);
   if(qty>0){ addStockBatch(item.id, wh.id, qty, cost, todayStr(), 'opening', null); logStockOp(item.id, wh.id, 'رصيد افتتاحي (استيراد)', qty, 0, todayStr(), '-'); }
   count++;
  });
  saveDB(); logAudit('استيراد','inventory','استيراد أصناف من إكسيل ('+count+')'); renderAll(); toast('تم استيراد '+count+' صنف');
 });
}
function exportCurrentItems(){
 const rows = DB.items.map(i=>({الكود:i.code, الاسم:i.name, الوحدة:i.unit, 'الرصيد الحالي':getItemStock(i.id), 'قيمة الرصيد':getItemStockValue(i.id).toFixed(2)}));
 downloadWorkbook(rows,'الأصناف_الحالية.xlsx','أصناف');
}

/* ================= TREASURY MODULE ================= */
RENDERERS.treasury = function(root){
 if(state.sub==='overview') return renderTreasuryOverview(root);
 if(state.sub==='cashReceipt') return renderVoucherForm(root,'cashbox','receipt');
 if(state.sub==='cashPayment') return renderVoucherForm(root,'cashbox','payment');
 if(state.sub==='bankReceipt') return renderVoucherForm(root,'bank','receipt');
 if(state.sub==='bankPayment') return renderVoucherForm(root,'bank','payment');
 if(state.sub==='transfer') return renderCashTransfer(root);
 if(state.sub==='checks') return renderChecks(root);
 if(state.sub==='custody') return renderCustody(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function renderTreasuryOverview(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>الخزائن والبنوك</h2>${isAdmin()?'<button class="btn secondary small" onclick="openCashboxForm()">+ خزينة</button> <button class="btn secondary small" onclick="openBankForm()">+ بنك</button>':''}</div>
 <div class="row">
  ${DB.cashboxes.map(c=>`<div class="stat"><div class="lbl">خزينة: ${c.name}</div><div class="val pos">${fmt(c.balance)}</div></div>`).join('')}
  ${DB.banks.map(b=>`<div class="stat"><div class="lbl">بنك: ${b.name}</div><div class="val pos">${fmt(b.balance)}</div></div>`).join('')}
  <div class="stat"><div class="lbl">شيكات تحت التحصيل</div><div class="val">${fmt(DB.checks.filter(c=>c.status==='pending').reduce((s,c)=>s+c.amount,0))}</div></div>
 </div></div>
 <div class="card"><div class="cardHead"><h2>آخر حركات الخزينة/البنوك</h2></div>
 <div class="tableWrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الجهة</th><th>البيان</th><th>القيمة</th></tr></thead><tbody>
 ${DB.vouchers.slice().reverse().slice(0,25).map(v=>`<tr><td>${v.date}</td><td>${v.kind==='receipt'?'استلام':'صرف'} ${v.sourceType==='cashbox'?'نقدي':'بنكي'}</td><td>${voucherPartyName(v)}</td><td>${v.description||'-'}</td><td>${fmt(v.amount)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا توجد حركات</td></tr>'}
 </tbody></table></div></div>`;
}
function openCashboxForm(){ openModal('خزينة جديدة',`<div class="field"><label>الاسم</label><input id="cbName"></div><div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="(function(){const n=document.getElementById('cbName').value.trim(); if(!n)return; DB.cashboxes.push({id:uid(),name:n,balance:0}); saveDB(); closeModal(); renderAll();})()">حفظ</button></div>`); }
function openBankForm(){ openModal('بنك جديد',`<div class="field"><label>الاسم</label><input id="bkName"></div><div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="(function(){const n=document.getElementById('bkName').value.trim(); if(!n)return; DB.banks.push({id:uid(),name:n,balance:0}); saveDB(); closeModal(); renderAll();})()">حفظ</button></div>`); }
function voucherPartyName(v){
 if(v.partyType==='customer') return 'عميل: '+getCustNameById(v.partyId);
 if(v.partyType==='supplier') return 'مورد: '+getSuppNameById(v.partyId);
 return v.partyName||'-';
}

function renderVoucherForm(root, srcType, kind){
 const titleMap={cashbox_receipt:'إذن استلام نقدي',cashbox_payment:'إذن صرف نقدي',bank_receipt:'إذن استلام بنكي',bank_payment:'إذن صرف بنكي'};
 const title=titleMap[srcType+'_'+kind];
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>${title}</h2>${can('treasury','add')?`<button class="btn" onclick="openVoucherModal('${srcType}','${kind}')">+ ${title}</button>`:''}</div>
 <div class="tableWrap" id="vchWrap"></div></div>`;
 const wrap=document.getElementById('vchWrap');
 const list=DB.vouchers.filter(v=>v.sourceType===srcType && v.kind===kind).slice().reverse();
 wrap.innerHTML = list.length? `<table><thead><tr><th>#</th><th>التاريخ</th><th>الجهة</th><th>البيان</th><th>القيمة</th><th></th></tr></thead><tbody>
 ${list.map(v=>`<tr><td>${v.number}</td><td>${v.date}</td><td>${voucherPartyName(v)}</td><td>${v.description||'-'}</td><td>${fmt(v.amount)}</td>
 <td>${can('treasury','edit')?`<button class="linkBtn" onclick="editVoucher(${v.id})">تعديل</button>`:''} ${can('treasury','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteVoucher(${v.id})">حذف</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا توجد عمليات</div>';
}
function openVoucherModal(srcType, kind, prefill){
 if(!requirePerm('treasury','add')) return;
 const sources = srcType==='cashbox'? DB.cashboxes : DB.banks;
 const p = prefill || {};
 const otherSel = (!p.partyType||p.partyType==='other')?'selected':'';
 const partyOptions = kind==='receipt'?
  `<option value="other" ${otherSel}>جهة أخرى</option><option value="customer" ${p.partyType==='customer'?'selected':''}>عميل</option>`:
  `<option value="other" ${otherSel}>جهة أخرى</option><option value="supplier" ${p.partyType==='supplier'?'selected':''}>مورد</option>`;
 const modalTitle = srcType==='cashbox'?(kind==='receipt'?'إذن استلام نقدي':'إذن صرف نقدي'):(kind==='receipt'?'إذن استلام بنكي':'إذن صرف بنكي');
 openModal(modalTitle, `
 <div class="grid3">
  <div class="field"><label>${srcType==='cashbox'?'الخزينة':'البنك'}</label><select id="vSrc">${sources.map(s=>`<option value="${s.id}" ${p.sourceId===s.id?'selected':''}>${s.name}</option>`).join('')}</select></div>
  <div class="field"><label>التاريخ</label><input type="date" id="vDate" value="${p.date||todayStr()}"></div>
  <div class="field"><label>نوع الجهة</label><select id="vPartyType" onchange="onVPartyTypeChange()">${partyOptions}</select></div>
 </div>
 <div class="field hidden" id="vPartyWrap" style="margin-top:8px;"><label>الجهة</label><select id="vParty" onchange="onVPartyChange()"></select></div>
 <div id="vInvoicesWrap" style="margin-top:10px;"></div>
 <div class="grid2" style="margin-top:10px;">
  <div class="field"><label>القيمة (إجمالي)</label><input type="number" id="vAmount" value="${p.amount||''}" oninput="onVAmountManual()"></div>
  <div class="field"><label>البيان</label><input id="vDesc" value="${p.description||''}" placeholder="سبب العملية..."></div>
 </div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveVoucher('${srcType}','${kind}')">حفظ</button></div>
 `, ()=>{
   onVPartyTypeChange();
   if(p.partyType && p.partyType!=='other'){
    document.getElementById('vParty').value = p.partyId;
    onVPartyChange();
   }
 });
}
function onVPartyTypeChange(){
 const pt=document.getElementById('vPartyType').value;
 const wrap=document.getElementById('vPartyWrap'); const sel=document.getElementById('vParty');
 document.getElementById('vInvoicesWrap').innerHTML='';
 if(pt==='other'){ wrap.classList.add('hidden'); return; }
 wrap.classList.remove('hidden');
 const list = pt==='customer'?DB.customers:DB.suppliers;
 sel.innerHTML = list.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
 onVPartyChange();
}
function onVPartyChange(){
 const pt=document.getElementById('vPartyType').value; const id=Number(document.getElementById('vParty').value);
 const wrap=document.getElementById('vInvoicesWrap');
 if(pt==='customer'){
  const invs = custOutstandingInvoices(id);
  wrap.innerHTML = invs.length? `<p style="color:var(--muted);font-size:12px;">الفواتير غير المسددة:</p>
  <table><thead><tr><th>#</th><th>الإجمالي</th><th>المتبقي</th><th>سداد</th></tr></thead><tbody>
  ${invs.map(i=>`<tr><td>${i.number}</td><td>${fmt(i.total)}</td><td>${fmt(i.total-i.paidAmount)}</td><td><input type="number" class="vAllocInput" data-inv="${i.id}" data-max="${i.total-i.paidAmount}" value="0" style="width:90px" oninput="onAllocChange()"></td></tr>`).join('')}
  </tbody></table>` : '<p style="color:var(--muted);font-size:12px;">لا توجد فواتير غير مسددة لهذا العميل</p>';
 } else if(pt==='supplier'){
  const invs = suppOutstandingInvoices(id);
  wrap.innerHTML = invs.length? `<p style="color:var(--muted);font-size:12px;">الفواتير غير المسددة:</p>
  <table><thead><tr><th>#</th><th>الإجمالي</th><th>المتبقي</th><th>سداد</th></tr></thead><tbody>
  ${invs.map(i=>`<tr><td>${i.number}</td><td>${fmt(i.total)}</td><td>${fmt(i.total-i.paidAmount)}</td><td><input type="number" class="vAllocInput" data-inv="${i.id}" data-max="${i.total-i.paidAmount}" value="0" style="width:90px" oninput="onAllocChange()"></td></tr>`).join('')}
  </tbody></table>` : '<p style="color:var(--muted);font-size:12px;">لا توجد فواتير غير مسددة لهذا المورد</p>';
 } else wrap.innerHTML='';
}
function onAllocChange(){
 const inputs=[...document.querySelectorAll('.vAllocInput')];
 let sum=0, invalid=false;
 inputs.forEach(inp=>{ const v=Number(inp.value||0), max=Number(inp.dataset.max); if(v>max+0.001) invalid=true; sum+=v; });
 document.getElementById('vAmount').value = sum.toFixed(2);
 if(invalid) toast('قيمة السداد أكبر من المتبقي على إحدى الفواتير');
}
function onVAmountManual(){ /* manual override allowed when no party/invoices */ }
/* reverse a voucher's effects on balances, invoice allocations and journal (used by edit & delete) */
function reverseVoucherEffects(v){
 const srcs = v.sourceType==='cashbox'?DB.cashboxes:DB.banks;
 const src = srcs.find(s=>s.id===v.sourceId);
 if(src){ if(v.kind==='receipt') src.balance -= v.amount; else src.balance += v.amount; }
 (v.allocations||[]).forEach(a=>{
  if(v.partyType==='customer'){
   const inv=DB.salesInvoices.find(x=>x.id===a.invoiceId);
   if(inv){ inv.paidAmount-=a.amount; inv.status = inv.paidAmount<=0.001?'unpaid':(inv.paidAmount>=inv.total-0.01?'paid':'partial'); }
  } else if(v.partyType==='supplier'){
   const inv=DB.purchaseInvoices.find(x=>x.id===a.invoiceId);
   if(inv){ inv.paidAmount-=a.amount; inv.status = inv.paidAmount<=0.001?'unpaid':(inv.paidAmount>=inv.total-0.01?'paid':'partial'); }
  }
 });
 DB.journal = DB.journal.filter(j=>!(j.sourceType==='voucher'&&j.sourceId===v.id));
}
function deleteVoucher(id){
 if(!requirePerm('treasury','delete')) return;
 if(!confirm('تأكيد حذف الإذن؟ سيتم عكس أثره على الرصيد وحالة الفواتير.')) return;
 const v=DB.vouchers.find(x=>x.id===id); if(!v) return;
 reverseVoucherEffects(v);
 DB.vouchers = DB.vouchers.filter(x=>x.id!==id);
 saveDB(); logAudit('حذف','treasury','إذن #'+v.number); renderAll(); toast('تم الحذف');
}
function editVoucher(id){
 if(!requirePerm('treasury','edit')) return;
 const v=DB.vouchers.find(x=>x.id===id); if(!v) return;
 reverseVoucherEffects(v);
 DB.vouchers = DB.vouchers.filter(x=>x.id!==id);
 saveDB();
 openVoucherModal(v.sourceType, v.kind, v);
}
function saveVoucher(srcType, kind){
 const srcId=Number(document.getElementById('vSrc').value);
 const date=document.getElementById('vDate').value;
 const partyType=document.getElementById('vPartyType').value;
 const amount=Number(document.getElementById('vAmount').value||0);
 const desc=document.getElementById('vDesc').value;
 if(amount<=0){ toast('أدخل قيمة صحيحة'); return; }
 const allocInputs=[...document.querySelectorAll('.vAllocInput')].filter(i=>Number(i.value)>0);
 let partyId=null, partyName=null;
 if(partyType!=='other'){ partyId=Number(document.getElementById('vParty').value); }
 else { partyName = prompt('اسم الجهة الأخرى (اختياري):','') || 'جهة أخرى'; }

 const number=nextCounter('vch');
 const allocations = allocInputs.map(inp=>({invoiceId:Number(inp.dataset.inv), amount:Number(inp.value)}));
 const v={id:uid(), number, date, sourceType:srcType, sourceId:srcId, kind, partyType, partyId, partyName, amount, description:desc, allocations};
 DB.vouchers.push(v);
 const sources = srcType==='cashbox'?DB.cashboxes:DB.banks; const src=sources.find(s=>s.id===srcId);
 if(kind==='receipt') src.balance += amount; else src.balance -= amount;
 const srcLabel=(srcType==='cashbox'?'الخزينة: ':'البنك: ')+src.name;

 // apply invoice allocations
 allocations.forEach(a=>{
  if(partyType==='customer'){
   const inv=DB.salesInvoices.find(x=>x.id===a.invoiceId); inv.paidAmount+=a.amount; inv.status = inv.paidAmount>=inv.total-0.01?'paid':(inv.paidAmount>0?'partial':'unpaid');
  } else if(partyType==='supplier'){
   const inv=DB.purchaseInvoices.find(x=>x.id===a.invoiceId); inv.paidAmount+=a.amount; inv.status = inv.paidAmount>=inv.total-0.01?'paid':(inv.paidAmount>0?'partial':'unpaid');
  }
 });
 // Journal: receipt -> source Debit / party Credit ; payment -> party Debit / source Credit
 const partyLabel = partyType==='customer'?'عميل: '+getCustNameById(partyId): partyType==='supplier'?'مورد: '+getSuppNameById(partyId): (partyName||'جهة أخرى');
 if(kind==='receipt') postJournal(date, (desc||title(kind,srcType))+' #'+number, srcLabel, amount, partyLabel, amount, 'voucher', v.id);
 else postJournal(date, (desc||title(kind,srcType))+' #'+number, partyLabel, amount, srcLabel, amount, 'voucher', v.id);

 saveDB(); logAudit('إضافة','treasury','إذن #'+number); closeModal(); renderAll(); toast('تم الحفظ');
}
function title(kind,srcType){ return (kind==='receipt'?'إذن استلام ':'إذن صرف ')+(srcType==='cashbox'?'نقدي':'بنكي'); }

function renderCashTransfer(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>تحويل بين الخزينة والبنك</h2>${can('treasury','add')?'<button class="btn" onclick="openCashTransferForm()">+ تحويل جديد</button>':''}</div>
 <div class="tableWrap" id="ctWrap"></div></div>`;
 const wrap=document.getElementById('ctWrap'); const list=DB.transfers.slice().reverse();
 wrap.innerHTML = list.length? `<table><thead><tr><th>التاريخ</th><th>من</th><th>إلى</th><th>القيمة</th><th>البيان</th></tr></thead><tbody>
 ${list.map(t=>`<tr><td>${t.date}</td><td>${t.fromLabel}</td><td>${t.toLabel}</td><td>${fmt(t.amount)}</td><td>${t.desc||'-'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا توجد تحويلات</div>';
}
function openCashTransferForm(){
 if(!requirePerm('treasury','add'))return;
 openModal('تحويل بين الخزينة والبنك', `
 <div class="grid2">
  <div class="field"><label>من</label><select id="ctFrom">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
  <div class="field"><label>إلى</label><select id="ctTo">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
  <div class="field"><label>القيمة</label><input type="number" id="ctAmount"></div>
  <div class="field"><label>التاريخ</label><input type="date" id="ctDate" value="${todayStr()}"></div>
 </div>
 <div class="field" style="margin-top:8px;"><label>البيان / سبب التحويل</label><input id="ctDesc"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveCashTransfer()">تنفيذ</button></div>`);
}
function saveCashTransfer(){
 const from=document.getElementById('ctFrom').value, to=document.getElementById('ctTo').value, amount=Number(document.getElementById('ctAmount').value||0), date=document.getElementById('ctDate').value, desc=document.getElementById('ctDesc').value;
 if(from===to){toast('اختر جهتين مختلفتين');return;} if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 const [fType,fId]=from.split(':'), [tType,tId]=to.split(':');
 const fObj = fType==='cashbox'? DB.cashboxes.find(c=>c.id==fId): DB.banks.find(b=>b.id==fId);
 const tObj = tType==='cashbox'? DB.cashboxes.find(c=>c.id==tId): DB.banks.find(b=>b.id==tId);
 if(amount>fObj.balance){ toast('الرصيد غير كافٍ'); return; }
 fObj.balance-=amount; tObj.balance+=amount;
 const fromLabel=(fType==='cashbox'?'خزينة: ':'بنك: ')+fObj.name, toLabel=(tType==='cashbox'?'خزينة: ':'بنك: ')+tObj.name;
 DB.transfers.push({id:uid(), date, from, to, fromLabel, toLabel, amount, desc});
 postJournal(date, (desc||'تحويل')+' من '+fromLabel+' إلى '+toLabel, toLabel, amount, fromLabel, amount, 'transfer', null);
 saveDB(); logAudit('إضافة','treasury','تحويل'); closeModal(); renderAll(); toast('تم التحويل');
}

/* ---------- Checks ---------- */
function renderChecks(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>الشيكات</h2>${can('treasury','add')?'<button class="btn" onclick="openCheckForm()">+ شيك جديد</button>':''}</div>
 <div class="tableWrap" id="chkWrap"></div></div>`;
 const wrap=document.getElementById('chkWrap'); const list=DB.checks.slice().reverse();
 wrap.innerHTML = list.length? `<table><thead><tr><th>النوع</th><th>الجهة</th><th>القيمة</th><th>تاريخ الاستحقاق</th><th>الحالة</th><th></th></tr></thead><tbody>
 ${list.map(c=>{
   const isIn = c.type!=='out';
   const partyName = isIn? getCustNameById(c.customerId) : getSuppNameById(c.supplierId);
   return `<tr><td><span class="tag ${isIn?'paid':'unpaid'}">${isIn?'وارد (من عميل)':'صادر (لمورد)'}</span></td><td>${partyName}</td><td>${fmt(c.amount)}</td><td>${c.dueDate}</td>
   <td><span class="tag ${c.status==='pending'?'partial':'paid'}">${c.status==='pending'?(isIn?'تحت التحصيل':'تحت السداد'):(isIn?'تم التحصيل':'تم الصرف')}</span></td>
   <td>${c.status==='pending' && can('treasury','edit')?`<button class="linkBtn" onclick="collectCheck(${c.id})">${isIn?'تحصيل الآن':'صرف الآن'}</button>`:''}</td></tr>`;
 }).join('')}</tbody></table>`:'<div class="empty">لا توجد شيكات</div>';
}
function openCheckForm(){
 if(!requirePerm('treasury','add'))return;
 openModal('شيك جديد', `
 <div class="grid2">
  <div class="field"><label>نوع الشيك</label><select id="chkType" onchange="onChkTypeChange()">
   <option value="in">وارد - استلمته من عميل</option>
   <option value="out">صادر - سلمته لمورد</option>
  </select></div>
  <div class="field" id="chkPartyWrap"><label id="chkPartyLabel">العميل</label><select id="chkParty"></select></div>
  <div class="field"><label>القيمة</label><input type="number" id="chkAmount"></div>
  <div class="field"><label>تاريخ الاستلام/التسليم</label><input type="date" id="chkDate" value="${todayStr()}"></div>
  <div class="field"><label>تاريخ الاستحقاق</label><input type="date" id="chkDue"></div>
 </div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveCheck()">حفظ</button></div>`,
 ()=>{ onChkTypeChange(); });
}
function onChkTypeChange(){
 const type = document.getElementById('chkType').value;
 const label = document.getElementById('chkPartyLabel'); const sel = document.getElementById('chkParty');
 if(type==='in'){ label.textContent='العميل'; sel.innerHTML = DB.customers.map(c=>`<option value="${c.id}">${c.name}</option>`).join(''); }
 else { label.textContent='المورد'; sel.innerHTML = DB.suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join(''); }
}
function saveCheck(){
 const type=document.getElementById('chkType').value;
 const partyId=Number(document.getElementById('chkParty').value);
 const amount=Number(document.getElementById('chkAmount').value||0), date=document.getElementById('chkDate').value, due=document.getElementById('chkDue').value;
 if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 if(!partyId){toast('اختر الجهة');return;}
 const chk={id:uid(), number:nextCounter('chk'), type, customerId: type==='in'?partyId:null, supplierId: type==='out'?partyId:null, amount, date, dueDate:due, status:'pending'};
 DB.checks.push(chk); saveDB();
 if(type==='in'){
  postJournal(date,'استلام شيك من عميل #'+chk.number, 'شيكات تحت التحصيل', amount, 'عميل: '+getCustNameById(partyId), amount, 'check', chk.id);
 } else {
  postJournal(date,'تسليم شيك لمورد #'+chk.number, 'مورد: '+getSuppNameById(partyId), amount, 'شيكات دفع تحت السداد', amount, 'check', chk.id);
 }
 logAudit('إضافة','treasury','شيك جديد'); closeModal(); renderAll(); toast('تم الحفظ');
}
function collectCheck(id){
 if(!requirePerm('treasury','edit'))return;
 const chk=DB.checks.find(x=>x.id===id); if(!chk)return;
 const isIn = chk.type!=='out';
 openModal(isIn?'تحصيل الشيك':'صرف الشيك (يتم سحبه من البنك)', `
 <div class="field"><label>${isIn?'تحصيل إلى':'الصرف من'}</label><select id="chkTo">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="confirmCollectCheck(${id})">${isIn?'تأكيد التحصيل':'تأكيد الصرف'}</button></div>`);
}
function confirmCollectCheck(id){
 const chk=DB.checks.find(x=>x.id===id);
 const isIn = chk.type!=='out';
 const to=document.getElementById('chkTo').value; const [tType,tId]=to.split(':');
 const tObj = tType==='cashbox'? DB.cashboxes.find(c=>c.id==tId): DB.banks.find(b=>b.id==tId);
 const toLabel=(tType==='cashbox'?'خزينة: ':'بنك: ')+tObj.name;
 if(isIn){
  tObj.balance += chk.amount; chk.status='collected'; chk.collectedTo=to;
  postJournal(todayStr(),'تحصيل شيك #'+chk.number, toLabel, chk.amount, 'شيكات تحت التحصيل', chk.amount, 'check_collect', chk.id);
 } else {
  tObj.balance -= chk.amount; chk.status='paid'; chk.collectedTo=to;
  postJournal(todayStr(),'صرف شيك #'+chk.number, 'شيكات دفع تحت السداد', chk.amount, toLabel, chk.amount, 'check_collect', chk.id);
 }
 saveDB(); logAudit('تعديل','treasury',isIn?'تحصيل شيك':'صرف شيك'); closeModal(); renderAll(); toast(isIn?'تم التحصيل':'تم الصرف');
}

/* ---------- Custody (العهد) ---------- */
function renderCustody(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>العهد</h2>${can('treasury','add')?'<button class="btn" onclick="openCustodyForm()">+ عهدة جديدة</button>':''}</div>
 <div class="tableWrap" id="cusWrap"></div></div>`;
 const wrap=document.getElementById('cusWrap'); const list=DB.custodies.slice().reverse();
 wrap.innerHTML = list.length? `<table><thead><tr><th>الموظف</th><th>القيمة الأصلية</th><th>المصروف</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>
 ${list.map(c=>{const spent=c.expensesList.reduce((s,e)=>s+e.amount,0); const remaining=c.amount-spent; return `<tr><td>${getEmpName(c.employeeId)}</td><td>${fmt(c.amount)}</td><td>${fmt(spent)}</td><td>${fmt(remaining)}</td><td>${c.closed?'مقفلة':'مفتوحة'}</td>
 <td><button class="linkBtn" onclick="openCustodyDetail(${c.id})">التفاصيل</button></td></tr>`}).join('')}</tbody></table>`:'<div class="empty">لا توجد عهد</div>';
}
function getEmpName(id){ const e=DB.employees.find(x=>x.id===id); return e?e.name:'-'; }
function openCustodyForm(){
 if(!requirePerm('treasury','add'))return;
 openModal('عهدة جديدة', `
 <div class="grid2">
  <div class="field"><label>الموظف</label><select id="cusEmp">${DB.employees.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</select></div>
  <div class="field"><label>القيمة</label><input type="number" id="cusAmount"></div>
  <div class="field"><label>الصرف من</label><select id="cusSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
  <div class="field"><label>التاريخ</label><input type="date" id="cusDate" value="${todayStr()}"></div>
 </div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveCustody()">حفظ</button></div>`);
}
function saveCustody(){
 const empId=Number(document.getElementById('cusEmp').value), amount=Number(document.getElementById('cusAmount').value||0), src=document.getElementById('cusSrc').value, date=document.getElementById('cusDate').value;
 if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 const [sType,sId]=src.split(':'); const sObj= sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
 if(amount>sObj.balance){toast('الرصيد غير كافٍ');return;}
 sObj.balance-=amount;
 const cus={id:uid(), employeeId:empId, amount, source:src, date, expensesList:[], closed:false};
 DB.custodies.push(cus); saveDB();
 const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
 postJournal(date,'صرف عهدة لـ '+getEmpName(empId), 'عهدة: '+getEmpName(empId), amount, srcLabel, amount, 'custody', cus.id);
 logAudit('إضافة','treasury','عهدة جديدة'); closeModal(); renderAll(); toast('تم الحفظ');
}
function openCustodyDetail(id){
 const c=DB.custodies.find(x=>x.id===id);
 const spent=c.expensesList.reduce((s,e)=>s+e.amount,0), remaining=c.amount-spent;
 openModal('تفاصيل عهدة: '+getEmpName(c.employeeId), `
 <p>القيمة الأصلية: ${fmt(c.amount)} | المصروف: ${fmt(spent)} | المتبقي: ${fmt(remaining)}</p>
 <table><thead><tr><th>التاريخ</th><th>البيان</th><th>القيمة</th></tr></thead><tbody>
 ${c.expensesList.map(e=>`<tr><td>${e.date}</td><td>${e.description}</td><td>${fmt(e.amount)}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">لا يوجد صرف بعد</td></tr>'}
 </tbody></table>
 ${!c.closed?`
 <hr style="border-color:var(--border);margin:14px 0;">
 <p style="color:var(--muted)">إضافة صرف من العهدة (يترحل كمصروف)</p>
 <div class="grid3"><input type="date" id="cueDate" value="${todayStr()}"><input id="cueDesc" placeholder="البيان"><input type="number" id="cueAmount" placeholder="القيمة"></div>
 <button class="btn secondary small" style="margin-top:8px;" onclick="addCustodyExpense(${id})">إضافة صرف</button>
 <hr style="border-color:var(--border);margin:14px 0;">
 <p style="color:var(--muted)">إقفال العهدة وترحيل الباقي (${fmt(remaining)})</p>
 <select id="cueCloseTo">${DB.cashboxes.map(x=>`<option value="cashbox:${x.id}">خزينة: ${x.name}</option>`).join('')}${DB.banks.map(x=>`<option value="bank:${x.id}">بنك: ${x.name}</option>`).join('')}</select>
 <button class="btn small" style="margin-top:8px;" onclick="closeCustody(${id})">إقفال العهدة</button>`:'<p style="color:var(--accent2)">تم إقفال هذه العهدة</p>'}
 `);
}
function addCustodyExpense(id){
 const c=DB.custodies.find(x=>x.id===id);
 const spent=c.expensesList.reduce((s,e)=>s+e.amount,0), remaining=c.amount-spent;
 const date=document.getElementById('cueDate').value, desc=document.getElementById('cueDesc').value, amount=Number(document.getElementById('cueAmount').value||0);
 if(amount<=0){toast('أدخل قيمة');return;}
 if(amount>remaining){ if(!confirm('القيمة أكبر من المتبقي بالعهدة، سيصبح الموظف مديونًا للشركة بالفرق. متابعة؟')) return; }
 c.expensesList.push({date,description:desc,amount});
 const catId = DB.expenseCategories.find(cc=>cc.name==='مصاريف بنكية')?.id;
 DB.expenses.push({id:uid(), number:nextCounter('exp'), date, categoryId: DB.expenseCategories[0]?.id, description:'صرف من عهدة '+getEmpName(c.employeeId)+': '+desc, amount, source:null, auto:true, refType:'custody', refId:id});
 postJournal(date,'صرف من عهدة: '+desc, 'مصروفات', amount, 'عهدة: '+getEmpName(c.employeeId), amount, 'custody_expense', id);
 saveDB(); closeModal(); renderAll(); toast('تم الإضافة');
}
function closeCustody(id){
 const c=DB.custodies.find(x=>x.id===id);
 const spent=c.expensesList.reduce((s,e)=>s+e.amount,0), remaining=c.amount-spent;
 const to=document.getElementById('cueCloseTo').value; const [tType,tId]=to.split(':');
 const tObj= tType==='cashbox'?DB.cashboxes.find(x=>x.id==tId):DB.banks.find(x=>x.id==tId);
 if(remaining>0){
  tObj.balance+=remaining;
  const toLabel=(tType==='cashbox'?'الخزينة: ':'البنك: ')+tObj.name;
  postJournal(todayStr(),'ترحيل باقي عهدة '+getEmpName(c.employeeId), toLabel, remaining, 'عهدة: '+getEmpName(c.employeeId), remaining, 'custody_close', id);
 }
 c.closed=true; saveDB(); logAudit('تعديل','treasury','إقفال عهدة'); closeModal(); renderAll(); toast('تم إقفال العهدة');
}

/* ================= EXPENSES MODULE ================= */
RENDERERS.expenses = function(root){
 if(state.sub==='daily') return renderExpensesDaily(root);
 if(state.sub==='categories') return renderExpenseCategories(root);
 if(state.sub==='report') return renderExpensesReport(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function renderExpensesDaily(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>المصاريف اليومية</h2>${can('expenses','add')?'<button class="btn" onclick="openExpenseForm()">+ مصروف جديد</button>':''}</div>
 <div class="toolbar"><input class="searchBox" id="expSearch" oninput="renderExpTable()" placeholder="بحث..."></div>
 <div class="tableWrap" id="expTableWrap"></div></div>`;
 renderExpTable();
}
function renderExpTable(){
 const wrap=document.getElementById('expTableWrap'); if(!wrap)return;
 const q=(document.getElementById('expSearch').value||'').trim();
 let list=DB.expenses.slice().sort((a,b)=>b.number-a.number);
 if(q) list=list.filter(e=>e.description.includes(q)||String(e.number).includes(q));
 wrap.innerHTML = list.length? `<table><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>القيمة</th><th>المصدر</th><th></th></tr></thead><tbody>
 ${list.map(e=>`<tr><td>${e.number}</td><td>${e.date}</td><td>${DB.expenseCategories.find(c=>c.id===e.categoryId)?.name||'-'}</td><td>${e.description}</td><td>${fmt(e.amount)}</td><td>${e.auto?'<span class="badge">تلقائي</span>':sourceLabel(e.source)}</td>
 <td>${!e.auto && can('expenses','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteExpense(${e.id})">حذف</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا توجد مصروفات</div>';
}
function sourceLabel(src){ if(!src) return '-'; const [t,id]=src.split(':'); if(t==='cashbox') return 'خزينة: '+DB.cashboxes.find(c=>c.id==id)?.name; return 'بنك: '+DB.banks.find(b=>b.id==id)?.name; }
function openExpenseForm(){
 if(!requirePerm('expenses','add'))return;
 openModal('مصروف جديد', `
 <div class="grid3">
  <div class="field"><label>التاريخ</label><input type="date" id="exDate" value="${todayStr()}"></div>
  <div class="field"><label>التصنيف</label><select id="exCat">${DB.expenseCategories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
  <div class="field"><label>القيمة</label><input type="number" id="exAmount"></div>
 </div>
 <div class="field" style="margin-top:8px;"><label>البيان</label><textarea id="exDesc" rows="2"></textarea></div>
 <div class="field" style="margin-top:8px;"><label>السداد من</label><select id="exSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveExpense()">حفظ</button></div>`);
}
function saveExpense(){
 const date=document.getElementById('exDate').value, catId=Number(document.getElementById('exCat').value), amount=Number(document.getElementById('exAmount').value||0), desc=document.getElementById('exDesc').value, src=document.getElementById('exSrc').value;
 if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 const [sType,sId]=src.split(':'); const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
 if(amount>sObj.balance){ if(!confirm('الرصيد قد لا يكفي، هل تريد المتابعة؟')) return; }
 sObj.balance-=amount;
 const number=nextCounter('exp');
 const exp={id:uid(), number, date, categoryId:catId, description:desc, amount, source:src, auto:false};
 DB.expenses.push(exp); saveDB();
 const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
 postJournal(date,'مصروف: '+(desc||DB.expenseCategories.find(c=>c.id===catId)?.name)+' #'+number, 'المصروفات', amount, srcLabel, amount, 'expense', exp.id);
 logAudit('إضافة','expenses','مصروف #'+number); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteExpense(id){
 if(!requirePerm('expenses','delete'))return; if(!confirm('تأكيد الحذف؟'))return;
 const e=DB.expenses.find(x=>x.id===id);
 if(e.source){ const [t,sid]=e.source.split(':'); const obj=t==='cashbox'?DB.cashboxes.find(c=>c.id==sid):DB.banks.find(b=>b.id==sid); if(obj) obj.balance+=e.amount; }
 DB.journal=DB.journal.filter(j=>!(j.sourceType==='expense'&&j.sourceId===id));
 DB.expenses=DB.expenses.filter(x=>x.id!==id); saveDB(); renderAll();
}
function renderExpenseCategories(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>تصنيفات المصروفات</h2>
 <div class="row"><input id="newCatName" placeholder="تصنيف جديد" style="width:180px"><button class="btn secondary small" onclick="addExpCat()">+ إضافة</button></div></div>
 <div>${DB.expenseCategories.map(c=>`<span class="badge" style="margin-left:6px;font-size:12.5px;padding:5px 12px;">${c.name}</span>`).join('')}</div></div>`;
}
function addExpCat(){
 const n=document.getElementById('newCatName').value.trim(); if(!n)return;
 DB.expenseCategories.push({id:uid(),name:n}); saveDB(); renderAll(); toast('تمت الإضافة');
}
function renderExpensesReport(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>تقرير المصروفات</h2></div>
 <div class="toolbar"><input type="date" id="erFrom"><input type="date" id="erTo"><input class="searchBox" id="erSearch" placeholder="بحث..."><button class="btn secondary" onclick="runExpReport()">تطبيق</button></div>
 <div id="erOut"></div></div>`;
 runExpReport();
}
function runExpReport(){
 const from=document.getElementById('erFrom').value, to=document.getElementById('erTo').value, q=(document.getElementById('erSearch').value||'').trim();
 let list=DB.expenses.slice();
 if(from) list=list.filter(e=>e.date>=from); if(to) list=list.filter(e=>e.date<=to);
 if(q) list=list.filter(e=>e.description.includes(q));
 const total=list.reduce((s,e)=>s+e.amount,0);
 document.getElementById('erOut').innerHTML=`<div class="row" style="margin-bottom:14px;"><div class="stat"><div class="lbl">عدد العمليات</div><div class="val">${list.length}</div></div><div class="stat"><div class="lbl">إجمالي المصروفات</div><div class="val neg">${fmt(total)}</div></div></div>
 <div class="tableWrap"><table><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>القيمة</th></tr></thead><tbody>
 ${list.map(e=>`<tr><td>${e.number}</td><td>${e.date}</td><td>${DB.expenseCategories.find(c=>c.id===e.categoryId)?.name||'-'}</td><td>${e.description}</td><td>${fmt(e.amount)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا نتائج</td></tr>'}</tbody></table></div>`;
}

/* ================= EMPLOYEES MODULE ================= */
RENDERERS.employees = function(root){
 if(state.sub==='list') return renderEmpList(root);
 if(state.sub==='attendance') return renderAttendance(root);
 if(state.sub==='advances') return renderAdvances(root);
 if(state.sub==='closure') return renderSalaryClosure(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function empAdvancesTotal(empId){ return DB.advances.filter(a=>a.employeeId===empId && !a.settled).reduce((s,a)=>s+a.amount,0); }
function renderEmpList(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>الموظفون</h2>${can('employees','add')?'<button class="btn" onclick="openEmpForm()">+ موظف جديد</button>':''}</div>
 <p style="color:var(--muted);font-size:12px;">دورة الراتب: من يوم 25 إلى 24 من الشهر التالي</p>
 <div class="tableWrap" id="empTableWrap"></div></div>`;
 renderEmpTable();
}
function renderEmpTable(){
 const wrap=document.getElementById('empTableWrap'); if(!wrap)return;
 wrap.innerHTML = DB.employees.length? `<table><thead><tr><th>الاسم</th><th>الوظيفة</th><th>الراتب الشهري</th><th>حافز</th><th>السلف الحالية</th><th></th></tr></thead><tbody>
 ${DB.employees.map(e=>`<tr><td><button class="linkBtn" onclick="openEmpDetail(${e.id})">${e.name}</button></td><td>${e.job}</td><td>${fmt(e.salary)}</td><td>${fmt(e.bonus||0)}</td><td>${fmt(empAdvancesTotal(e.id))}</td>
 <td>${can('employees','edit')?`<button class="linkBtn" onclick="openEmpForm(${e.id})">تعديل</button>`:''} ${can('employees','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteEmp(${e.id})">حذف</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا يوجد موظفون</div>';
}
function openEmpForm(id){
 if(!requirePerm('employees', id?'edit':'add'))return;
 const e=id?DB.employees.find(x=>x.id===id):{name:'',job:'',salary:0,bonus:0};
 openModal(id?'تعديل موظف':'موظف جديد', `
 <div class="grid2">
  <div class="field"><label>الاسم</label><input id="eName" value="${e.name}"></div>
  <div class="field"><label>الوظيفة</label><input id="eJob" value="${e.job}"></div>
  <div class="field"><label>الراتب الشهري</label><input type="number" id="eSalary" value="${e.salary}"></div>
  <div class="field"><label>حافز (اختياري)</label><input type="number" id="eBonus" value="${e.bonus||0}"></div>
 </div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveEmp(${id||'null'})">حفظ</button></div>`);
}
function saveEmp(id){
 const name=document.getElementById('eName').value.trim(); if(!name){toast('أدخل الاسم');return;}
 const obj={id:id||uid(), name, job:document.getElementById('eJob').value, salary:Number(document.getElementById('eSalary').value||0), bonus:Number(document.getElementById('eBonus').value||0)};
 const idx=DB.employees.findIndex(x=>x.id===id);
 if(idx>=0) DB.employees[idx]={...DB.employees[idx],...obj}; else DB.employees.push(obj);
 saveDB(); logAudit(id?'تعديل':'إضافة','employees','موظف: '+name); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteEmp(id){ if(!requirePerm('employees','delete'))return; if(!confirm('تأكيد الحذف؟'))return; DB.employees=DB.employees.filter(x=>x.id!==id); saveDB(); renderAll(); }
function openEmpDetail(id){
 const e=DB.employees.find(x=>x.id===id);
 const adv=DB.advances.filter(a=>a.employeeId===id);
 const att=DB.attendance.filter(a=>a.employeeId===id);
 const absentCount = att.filter(a=>!a.present).length, presentCount=att.filter(a=>a.present).length;
 openModal('تفاصيل: '+e.name, `
 <p>الوظيفة: ${e.job} | الراتب: ${fmt(e.salary)} | الحافز: ${fmt(e.bonus||0)}</p>
 <p>أيام الحضور المسجلة: ${presentCount} | أيام الغياب: ${absentCount}</p>
 <h4 style="color:var(--muted)">السلف</h4>
 <table><thead><tr><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>
 ${adv.map(a=>`<tr><td>${a.date}</td><td>${fmt(a.amount)}</td><td>${a.settled?'مخصومة':'قائمة'}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">لا يوجد سلف</td></tr>'}
 </tbody></table>`);
}

/* ---------- Attendance ---------- */
function renderAttendance(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>الحضور والانصراف</h2></div>
 <div class="field" style="max-width:220px;"><label>التاريخ</label><input type="date" id="attDate" value="${todayStr()}" onchange="renderAttTable()"></div>
 <div class="tableWrap" id="attTableWrap" style="margin-top:12px;"></div></div>`;
 renderAttTable();
}
function renderAttTable(){
 const wrap=document.getElementById('attTableWrap'); if(!wrap)return;
 const date=document.getElementById('attDate').value;
 wrap.innerHTML = DB.employees.length? `<table><thead><tr><th>الموظف</th><th>الحالة</th></tr></thead><tbody>
 ${DB.employees.map(e=>{ const rec=DB.attendance.find(a=>a.employeeId===e.id && a.date===date); const present = rec?rec.present:null;
 return `<tr><td>${e.name}</td><td>
 <button class="btn small ${present===true?'':'secondary'}" onclick="setAttendance(${e.id},'${date}',true)">حاضر</button>
 <button class="btn small danger ${present===false?'':'secondary'}" onclick="setAttendance(${e.id},'${date}',false)">غائب</button>
 </td></tr>`}).join('')}</tbody></table>`:'<div class="empty">أضف موظفين أولًا</div>';
}
function setAttendance(empId,date,present){
 if(!requirePerm('employees','add'))return;
 let rec=DB.attendance.find(a=>a.employeeId===empId&&a.date===date);
 if(rec) rec.present=present; else DB.attendance.push({employeeId:empId,date,present});
 saveDB(); renderAttTable();
}

/* ---------- Advances ---------- */
function renderAdvances(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>السلف</h2>${can('employees','add')?'<button class="btn" onclick="openAdvanceForm()">+ سلفة جديدة</button>':''}</div>
 <div class="tableWrap" id="advWrap"></div></div>`;
 const wrap=document.getElementById('advWrap'); const list=DB.advances.slice().reverse();
 wrap.innerHTML = list.length? `<table><thead><tr><th>الموظف</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>
 ${list.map(a=>`<tr><td>${getEmpName(a.employeeId)}</td><td>${a.date}</td><td>${fmt(a.amount)}</td><td>${a.settled?'مخصومة من الراتب':'قائمة'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا يوجد سلف</div>';
}
function openAdvanceForm(){
 if(!requirePerm('employees','add'))return;
 openModal('سلفة جديدة', `
 <div class="grid3">
  <div class="field"><label>الموظف</label><select id="advEmp">${DB.employees.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</select></div>
  <div class="field"><label>القيمة</label><input type="number" id="advAmount"></div>
  <div class="field"><label>الصرف من</label><select id="advSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
 </div>
 <div class="field" style="margin-top:8px;"><label>التاريخ</label><input type="date" id="advDate" value="${todayStr()}"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveAdvance()">حفظ</button></div>`);
}
function saveAdvance(){
 const empId=Number(document.getElementById('advEmp').value), amount=Number(document.getElementById('advAmount').value||0), src=document.getElementById('advSrc').value, date=document.getElementById('advDate').value;
 if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 const [sType,sId]=src.split(':'); const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
 if(amount>sObj.balance){ if(!confirm('الرصيد قد لا يكفي، متابعة؟')) return; }
 sObj.balance-=amount;
 const adv={id:uid(), employeeId:empId, amount, date, settled:false};
 DB.advances.push(adv); saveDB();
 const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
 postJournal(date,'سلفة لموظف: '+getEmpName(empId),'سلف موظفين: '+getEmpName(empId), amount, srcLabel, amount, 'advance', adv.id);
 logAudit('إضافة','employees','سلفة'); closeModal(); renderAll(); toast('تم الحفظ');
}

/* ---------- Salary Closure ---------- */
function currentPeriodLabel(){
 const d=new Date();
 const day=d.getDate();
 let start,end;
 if(day>=25){ start=new Date(d.getFullYear(),d.getMonth(),25); end=new Date(d.getFullYear(),d.getMonth()+1,24); }
 else { start=new Date(d.getFullYear(),d.getMonth()-1,25); end=new Date(d.getFullYear(),d.getMonth(),24); }
 return start.toISOString().slice(0,10)+' إلى '+end.toISOString().slice(0,10);
}
function renderSalaryClosure(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>تقفيل المرتبات</h2><span class="badge">الفترة الحالية: ${currentPeriodLabel()}</span></div>
 <div class="tableWrap" id="closureWrap"></div></div>`;
 const wrap=document.getElementById('closureWrap');
 wrap.innerHTML = DB.employees.length? `<table><thead><tr><th>الموظف</th><th>الراتب الأساسي</th><th>الحافز</th><th>السلف</th><th>الصافي</th><th>الحالة</th><th></th></tr></thead><tbody>
 ${DB.employees.map(e=>{
   const period=currentPeriodLabel();
   const closure = DB.salaryClosures.find(c=>c.employeeId===e.id && c.period===period);
   const advTotal = empAdvancesTotal(e.id);
   const net = e.salary + (e.bonus||0) - advTotal;
   return `<tr><td>${e.name}</td><td>${fmt(e.salary)}</td><td>${fmt(e.bonus||0)}</td><td>${fmt(advTotal)}</td><td>${fmt(net)}</td>
   <td>${closure&&closure.approved?'<span class="tag paid">معتمد</span>':'<span class="tag unpaid">غير معتمد</span>'}</td>
   <td>${!closure||!closure.approved?(can('employees','edit')?`<button class="linkBtn" onclick="approveSalary(${e.id})">اعتماد</button>`:''):`<button class="linkBtn" onclick="viewSalaryDetail(${e.id})">تفاصيل</button>`}</td></tr>`;
 }).join('')}</tbody></table>` : '<div class="empty">أضف موظفين أولًا</div>';
}
function approveSalary(empId){
 if(!requirePerm('employees','edit'))return;
 const e=DB.employees.find(x=>x.id===empId);
 openModal('اعتماد راتب: '+e.name, `
 <div class="field"><label>الصرف من</label><select id="salSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="confirmApproveSalary(${empId})">اعتماد وصرف</button></div>`);
}
function confirmApproveSalary(empId){
 const e=DB.employees.find(x=>x.id===empId);
 const period=currentPeriodLabel();
 const advList = DB.advances.filter(a=>a.employeeId===empId && !a.settled);
 const advTotal = advList.reduce((s,a)=>s+a.amount,0);
 const att=DB.attendance.filter(a=>a.employeeId===empId);
 const presentDays=att.filter(a=>a.present).length, absentDays=att.filter(a=>!a.present).length;
 const net = e.salary + (e.bonus||0) - advTotal;
 const src=document.getElementById('salSrc').value; const [sType,sId]=src.split(':');
 const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
 if(net>sObj.balance){ if(!confirm('الرصيد قد لا يكفي، متابعة؟')) return; }
 sObj.balance-=net;
 advList.forEach(a=>a.settled=true);
 const closure={id:uid(), employeeId:empId, period, salary:e.salary, bonus:e.bonus||0, advances:advTotal, presentDays, absentDays, net, approved:true, date:todayStr()};
 DB.salaryClosures.push(closure); saveDB();
 const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
 postJournal(todayStr(),'صرف راتب معتمد: '+e.name, 'مصروفات الرواتب', net, srcLabel, net, 'salary', closure.id);
 DB.expenses.push({id:uid(), number:nextCounter('exp'), date:todayStr(), categoryId:DB.expenseCategories[0]?.id, description:'راتب معتمد: '+e.name+' - فترة '+period, amount:net, source:null, auto:true, refType:'salary', refId:closure.id});
 saveDB(); logAudit('إضافة','employees','اعتماد راتب: '+e.name); closeModal(); renderAll(); toast('تم اعتماد الراتب وصرفه');
}
function viewSalaryDetail(empId){
 const period=currentPeriodLabel();
 const closure=DB.salaryClosures.find(c=>c.employeeId===empId&&c.period===period);
 const e=DB.employees.find(x=>x.id===empId);
 if(!closure) return;
 openModal('تفاصيل راتب: '+e.name, `
 <p>الفترة: ${closure.period}</p>
 <p>الراتب الأساسي: ${fmt(closure.salary)}</p>
 <p>الحافز: ${fmt(closure.bonus)}</p>
 <p>السلف المخصومة: ${fmt(closure.advances)}</p>
 <p>أيام الحضور: ${closure.presentDays} | أيام الغياب: ${closure.absentDays}</p>
 <p><b>الصافي المصروف: ${fmt(closure.net)}</b></p>`);
}

/* ================= EQUITY MODULE ================= */
RENDERERS.equity = function(root){
 if(state.sub==='capital') return renderCapital(root);
 if(state.sub==='current') return renderPartnersCurrent(root);
 if(state.sub==='assets') return renderFixedAssets(root);
 if(state.sub==='distribution') return renderProfitDistribution(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function partnerCapital(id){
 const p=DB.partners.find(x=>x.id===id); if(!p) return 0;
 let cap=p.initialCapital||0;
 DB.capitalTx.filter(t=>t.partnerId===id).forEach(t=> cap += t.type==='increase'? t.amount : -t.amount);
 return cap;
}
function partnerCurrentBalance(id){
 // positive = company owes partner
 let bal=0;
 DB.partnersCurrent.filter(t=>t.partnerId===id).forEach(t=> bal += t.type==='deposit'? t.amount : -t.amount);
 return bal;
}
function renderCapital(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>رأس المال</h2>${isAdmin()?'<button class="btn secondary small" onclick="openPartnerForm()">+ إضافة شريك</button>':''}</div>
 <div class="tableWrap">${DB.partners.length? `<table><thead><tr><th>الشريك</th><th>رأس المال الحالي</th><th></th></tr></thead><tbody>
 ${DB.partners.map(p=>`<tr><td>${p.name}</td><td>${fmt(partnerCapital(p.id))}</td><td>${can('equity','add')?`<button class="linkBtn" onclick="openCapitalTxForm(${p.id})">زيادة/نقصان</button>`:''}</td></tr>`).join('')}
 </tbody></table>`:'<div class="empty">لا يوجد شركاء</div>'}</div></div>`;
}
function openPartnerForm(){
 openModal('إضافة شريك', `
 <div class="grid2"><div class="field"><label>الاسم</label><input id="ptName"></div><div class="field"><label>رأس المال الابتدائي</label><input type="number" id="ptCap" value="0"></div></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="savePartner()">حفظ</button></div>`);
}
function savePartner(){
 const name=document.getElementById('ptName').value.trim(); if(!name){toast('أدخل الاسم');return;}
 const cap=Number(document.getElementById('ptCap').value||0);
 DB.partners.push({id:uid(), name, initialCapital:cap}); saveDB(); logAudit('إضافة','equity','شريك: '+name); closeModal(); renderAll(); toast('تم الحفظ');
}
function openCapitalTxForm(partnerId){
 if(!requirePerm('equity','add'))return;
 openModal('زيادة / نقصان رأس المال', `
 <div class="grid2">
  <div class="field"><label>النوع</label><select id="ctxType"><option value="increase">زيادة</option><option value="decrease">نقصان</option></select></div>
  <div class="field"><label>القيمة</label><input type="number" id="ctxAmount"></div>
 </div>
 <div class="field" style="margin-top:8px;"><label>هل تؤثر فعليًا على الخزينة/البنك؟</label><select id="ctxAffects" onchange="onCtxAffectsChange()"><option value="no">لا - تعديل رقمي فقط</option><option value="yes">نعم</option></select></div>
 <div class="field hidden" id="ctxSrcWrap" style="margin-top:8px;"><label>الخزينة/البنك</label><select id="ctxSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
 <div class="field" style="margin-top:8px;"><label>التاريخ</label><input type="date" id="ctxDate" value="${todayStr()}"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveCapitalTx(${partnerId})">حفظ</button></div>`);
}
function onCtxAffectsChange(){ document.getElementById('ctxSrcWrap').classList.toggle('hidden', document.getElementById('ctxAffects').value!=='yes'); }
function saveCapitalTx(partnerId){
 const type=document.getElementById('ctxType').value, amount=Number(document.getElementById('ctxAmount').value||0), affects=document.getElementById('ctxAffects').value==='yes', date=document.getElementById('ctxDate').value;
 if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 const p=DB.partners.find(x=>x.id===partnerId);
 const tx={id:uid(), partnerId, type, amount, affectsCash:affects, date};
 DB.capitalTx.push(tx);
 if(affects){
  const src=document.getElementById('ctxSrc').value; const [sType,sId]=src.split(':');
  const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
  const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
  if(type==='increase'){ sObj.balance+=amount; postJournal(date,'زيادة رأس مال '+p.name, srcLabel, amount, 'رأس المال: '+p.name, amount, 'capital', tx.id); }
  else { sObj.balance-=amount; postJournal(date,'نقصان رأس مال '+p.name, 'رأس المال: '+p.name, amount, srcLabel, amount, 'capital', tx.id); }
 }
 saveDB(); logAudit('إضافة','equity','حركة رأس مال'); closeModal(); renderAll(); toast('تم الحفظ');
}
function renderPartnersCurrent(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>جاري الشركاء</h2>${can('equity','add')?'<button class="btn" onclick="openPartnerCurrentForm()">+ حركة جديدة</button>':''}</div>
 <div class="tableWrap">${DB.partners.length? `<table><thead><tr><th>الشريك</th><th>رصيد الجاري</th></tr></thead><tbody>
 ${DB.partners.map(p=>`<tr><td>${p.name}</td><td>${fmt(Math.abs(partnerCurrentBalance(p.id)))} <span class="tag ${partnerCurrentBalance(p.id)>=0?'credit':'debit'}">${partnerCurrentBalance(p.id)>=0?'الشركة مديونة له':'هو مديون للشركة'}</span></td></tr>`).join('')}
 </tbody></table>`:'<div class="empty">لا يوجد شركاء</div>'}</div></div>`;
}
function openPartnerCurrentForm(){
 if(!requirePerm('equity','add'))return;
 openModal('حركة جاري شريك', `
 <div class="grid2">
  <div class="field"><label>الشريك</label><select id="pcPartner">${DB.partners.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
  <div class="field"><label>النوع</label><select id="pcType"><option value="deposit">إيداع (الشريك يحط فلوس)</option><option value="withdraw">سحب (الشريك يسحب فلوس)</option></select></div>
  <div class="field"><label>القيمة</label><input type="number" id="pcAmount"></div>
  <div class="field"><label>من/إلى</label><select id="pcSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}">خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}">بنك: ${b.name}</option>`).join('')}</select></div>
 </div>
 <div class="field" style="margin-top:8px;"><label>التاريخ</label><input type="date" id="pcDate" value="${todayStr()}"></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="savePartnerCurrent()">حفظ</button></div>`);
}
function savePartnerCurrent(){
 const partnerId=Number(document.getElementById('pcPartner').value), type=document.getElementById('pcType').value, amount=Number(document.getElementById('pcAmount').value||0), src=document.getElementById('pcSrc').value, date=document.getElementById('pcDate').value;
 if(amount<=0){toast('أدخل قيمة صحيحة');return;}
 const p=DB.partners.find(x=>x.id===partnerId);
 const [sType,sId]=src.split(':'); const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
 const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
 const tx={id:uid(), partnerId, type, amount, source:src, date};
 DB.partnersCurrent.push(tx);
 if(type==='deposit'){ sObj.balance+=amount; postJournal(date,'إيداع جاري شريك: '+p.name, srcLabel, amount, 'جاري الشريك: '+p.name, amount, 'partner_current', tx.id); }
 else { if(amount>sObj.balance){ if(!confirm('الرصيد قد لا يكفي، متابعة؟')) return; } sObj.balance-=amount; postJournal(date,'سحب جاري شريك: '+p.name, 'جاري الشريك: '+p.name, amount, srcLabel, amount, 'partner_current', tx.id); }
 saveDB(); logAudit('إضافة','equity','حركة جاري شريك'); closeModal(); renderAll(); toast('تم الحفظ');
}

/* ---------- Fixed Assets (الأصول الثابتة) ---------- */
function totalFixedAssets(){ return DB.fixedAssets.reduce((s,a)=>s+Number(a.value||0),0); }
function renderFixedAssets(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>الأصول الثابتة</h2>${can('equity','add')?'<button class="btn" onclick="openAssetForm()">+ أصل جديد</button>':''}</div>
 <div class="row" style="margin-bottom:14px;"><div class="stat"><div class="lbl">إجمالي قيمة الأصول الثابتة</div><div class="val pos">${fmt(totalFixedAssets())}</div></div></div>
 <div class="tableWrap">${DB.fixedAssets.length? `<table><thead><tr><th>الاسم</th><th>التاريخ</th><th>القيمة</th><th></th></tr></thead><tbody>
 ${DB.fixedAssets.map(a=>`<tr><td>${a.name}</td><td>${a.date}</td><td>${fmt(a.value)}</td>
 <td>${can('equity','edit')?`<button class="linkBtn" onclick="openAssetForm(${a.id})">تعديل</button>`:''} ${can('equity','delete')?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteAsset(${a.id})">حذف</button>`:''}</td></tr>`).join('')}
 </tbody></table>`:'<div class="empty">لا توجد أصول مسجلة</div>'}</div></div>`;
}
function openAssetForm(id){
 if(!requirePerm('equity', id?'edit':'add')) return;
 const a=id?DB.fixedAssets.find(x=>x.id===id):{name:'',value:0,date:todayStr(),affectsCash:false,source:null};
 openModal(id?'تعديل أصل':'أصل ثابت جديد', `
 <div class="grid2">
  <div class="field"><label>اسم الأصل</label><input id="asName" value="${a.name}" placeholder="مثال: سيارة، معدات، أثاث..."></div>
  <div class="field"><label>القيمة</label><input type="number" id="asValue" value="${a.value}"></div>
  <div class="field"><label>التاريخ</label><input type="date" id="asDate" value="${a.date}"></div>
  <div class="field"><label>هل تم شراؤه نقدًا من الخزينة/البنك؟</label><select id="asAffects" onchange="onAsAffectsChange()"><option value="no" ${!a.affectsCash?'selected':''}>لا - تسجيل قيمة فقط (أصل موجود بالفعل)</option><option value="yes" ${a.affectsCash?'selected':''}>نعم</option></select></div>
 </div>
 <div class="field hidden" id="asSrcWrap" style="margin-top:8px;"><label>الشراء من</label><select id="asSrc">${DB.cashboxes.map(c=>`<option value="cashbox:${c.id}" ${a.source==='cashbox:'+c.id?'selected':''}>خزينة: ${c.name}</option>`).join('')}${DB.banks.map(b=>`<option value="bank:${b.id}" ${a.source==='bank:'+b.id?'selected':''}>بنك: ${b.name}</option>`).join('')}</select></div>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveAsset(${id||'null'})">حفظ</button></div>`,
 ()=>{ onAsAffectsChange(); });
}
function onAsAffectsChange(){ document.getElementById('asSrcWrap').classList.toggle('hidden', document.getElementById('asAffects').value!=='yes'); }
function reverseAssetEffects(a){
 if(a.affectsCash && a.source){
  const [sType,sId]=a.source.split(':'); const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
  if(sObj) sObj.balance += Number(a.value);
 }
 DB.journal = DB.journal.filter(j=>!(j.sourceType==='fixed_asset'&&j.sourceId===a.id));
}
function saveAsset(id){
 const name=document.getElementById('asName').value.trim(); if(!name){toast('أدخل اسم الأصل');return;}
 const value=Number(document.getElementById('asValue').value||0);
 const date=document.getElementById('asDate').value;
 const affectsCash=document.getElementById('asAffects').value==='yes';
 const source=affectsCash?document.getElementById('asSrc').value:null;
 if(id){ const old=DB.fixedAssets.find(x=>x.id===id); reverseAssetEffects(old); }
 const asset={id:id||uid(), name, value, date, affectsCash, source};
 const idx=DB.fixedAssets.findIndex(x=>x.id===id);
 if(idx>=0) DB.fixedAssets[idx]=asset; else DB.fixedAssets.push(asset);
 if(affectsCash){
  const [sType,sId]=source.split(':'); const sObj=sType==='cashbox'?DB.cashboxes.find(c=>c.id==sId):DB.banks.find(b=>b.id==sId);
  if(value>sObj.balance){ confirm('الرصيد قد لا يكفي، متابعة؟'); }
  sObj.balance -= value;
  const srcLabel=(sType==='cashbox'?'الخزينة: ':'البنك: ')+sObj.name;
  postJournal(date,'شراء أصل ثابت: '+name, 'الأصول الثابتة: '+name, value, srcLabel, value, 'fixed_asset', asset.id);
 }
 saveDB(); logAudit(id?'تعديل':'إضافة','equity','أصل ثابت: '+name); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteAsset(id){
 if(!requirePerm('equity','delete'))return; if(!confirm('تأكيد حذف الأصل؟'))return;
 const a=DB.fixedAssets.find(x=>x.id===id); if(!a)return;
 reverseAssetEffects(a);
 DB.fixedAssets=DB.fixedAssets.filter(x=>x.id!==id); saveDB(); logAudit('حذف','equity','أصل ثابت'); renderAll(); toast('تم الحذف');
}

/* ---------- Profit Distribution (توزيعات الأرباح) ---------- */
function computeProfitDistribution(){
 const netProfit = computeNetProfit(null,null).netProfit;
 const n = DB.partners.length || 1;
 return DB.partners.map(p=>{
  const entitlement = netProfit / n;
  const alreadyTransferred = (DB.profitDistributions||[]).filter(d=>d.partnerId===p.id).reduce((s,d)=>s+d.amount,0);
  const remaining = entitlement - alreadyTransferred;
  return {partner:p, entitlement, alreadyTransferred, remaining};
 });
}
function renderProfitDistribution(root){
 if(!DB.partners.length){ root.innerHTML='<div class="card"><div class="empty">أضف شركاء أولًا من صفحة "رأس المال"</div></div>'; return; }
 const netProfit = computeNetProfit(null,null).netProfit;
 const dist = computeProfitDistribution();
 root.innerHTML = `<div class="card"><div class="cardHead"><h2>توزيعات الأرباح</h2></div>
 <div class="row" style="margin-bottom:14px;">
  <div class="stat"><div class="lbl">صافي الربح (كل الوقت - لحظي)</div><div class="val ${netProfit>=0?'pos':'neg'}">${fmt(netProfit)}</div></div>
  <div class="stat"><div class="lbl">نصيب كل شريك (بالتساوي على ${DB.partners.length})</div><div class="val pos">${fmt(netProfit/DB.partners.length)}</div></div>
 </div>
 <div class="tableWrap"><table><thead><tr><th>الشريك</th><th>نصيبه من الأرباح (لحظي)</th><th>تم ترحيله لرأس المال بالفعل</th><th>المتبقي لم يُرحّل</th><th></th></tr></thead><tbody>
 ${dist.map(d=>`<tr><td>${d.partner.name}</td><td>${fmt(d.entitlement)}</td><td>${fmt(d.alreadyTransferred)}</td><td class="${d.remaining>0.01?'pos':''}">${fmt(d.remaining)}</td>
 <td>${d.remaining>0.01 && can('equity','add')?`<button class="btn small" onclick="transferProfitShare(${d.partner.id})">ترحيل النصيب لرأس المال</button>`:''}</td></tr>`).join('')}
 </tbody></table></div>
 <p style="color:var(--muted);font-size:12px;margin-top:10px;">الترحيل بيحوّل نصيب الشريك من الأرباح المحتجزة إلى رأس ماله مباشرة (تعديل داخلي، بدون أي تأثير على الخزينة أو البنك).</p>
 </div>`;
}
function transferProfitShare(partnerId){
 if(!requirePerm('equity','add')) return;
 const dist = computeProfitDistribution().find(d=>d.partner.id===partnerId);
 if(!dist || dist.remaining<=0.01){ toast('لا يوجد نصيب متبقي للترحيل'); return; }
 const amount = dist.remaining;
 if(!confirm('ترحيل مبلغ '+fmt(amount)+' من أرباح "'+dist.partner.name+'" إلى رأس ماله؟')) return;
 DB.profitDistributions.push({id:uid(), partnerId, amount, date:todayStr()});
 DB.capitalTx.push({id:uid(), partnerId, type:'increase', amount, affectsCash:false, date:todayStr()});
 postJournal(todayStr(),'ترحيل نصيب من الأرباح لرأس مال: '+dist.partner.name, 'الأرباح المحتجزة', amount, 'رأس المال: '+dist.partner.name, amount, 'profit_distribution', partnerId);
 saveDB(); logAudit('إضافة','equity','ترحيل أرباح لرأس مال: '+dist.partner.name); renderAll(); toast('تم الترحيل بنجاح');
}

/* ================= JOURNAL MODULE ================= */
RENDERERS.journal = function(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>اليومية الأمريكية</h2></div>
 <div class="toolbar"><input type="date" id="jFrom"><input type="date" id="jTo"><input class="searchBox" id="jSearch" placeholder="بحث بالبيان أو رقم القيد أو الحساب..."><button class="btn secondary" onclick="runJournal()">تطبيق</button>
 <button class="btn secondary" onclick="exportJournalExcel()">⬇ تصدير Excel</button></div>
 <div id="jOut"></div></div>`;
 runJournal();
};
function runJournal(){
 const from=document.getElementById('jFrom').value, to=document.getElementById('jTo').value, q=(document.getElementById('jSearch').value||'').trim();
 let list=DB.journal.slice().sort((a,b)=>a.number-b.number);
 if(from) list=list.filter(j=>j.date>=from); if(to) list=list.filter(j=>j.date<=to);
 if(q) list=list.filter(j=> String(j.number).includes(q) || j.desc.includes(q) || j.debitAcc.includes(q) || j.creditAcc.includes(q));
 const totalDebit=list.reduce((s,j)=>s+j.debitAmt,0);
 document.getElementById('jOut').innerHTML = `
 <div class="row" style="margin-bottom:14px;"><div class="stat"><div class="lbl">عدد القيود</div><div class="val">${list.length}</div></div><div class="stat"><div class="lbl">إجمالي الحركة</div><div class="val">${fmt(totalDebit)}</div></div></div>
 <div class="tableWrap"><table><thead><tr><th>#</th><th>التاريخ</th><th>البيان</th><th>حساب مدين</th><th>مدين</th><th>حساب دائن</th><th>دائن</th></tr></thead><tbody>
 ${list.map(j=>`<tr><td>${j.number}</td><td>${j.date}</td><td>${j.desc}</td><td>${j.debitAcc}</td><td>${fmt(j.debitAmt)}</td><td>${j.creditAcc}</td><td>${fmt(j.creditAmt)}</td></tr>`).join('')||'<tr><td colspan=7 class="empty">لا توجد قيود</td></tr>'}
 </tbody></table></div>`;
 window._journalFiltered = list;
}
function exportJournalExcel(){
 const rows=(window._journalFiltered||DB.journal).map(j=>({'رقم القيد':j.number,'التاريخ':j.date,'البيان':j.desc,'حساب مدين':j.debitAcc,'مدين':j.debitAmt,'حساب دائن':j.creditAcc,'دائن':j.creditAmt}));
 downloadWorkbook(rows,'اليومية_الأمريكية.xlsx','اليومية');
}

/* ================= REPORTS MODULE ================= */
RENDERERS.reports = function(root){
 if(state.sub==='profit') return renderProfitReport(root);
 if(state.sub==='balance') return renderBalanceSheet(root);
 if(state.sub==='otherIncome') return renderOtherIncomeReport(root);
 if(state.sub==='aging') return renderAgingReport(root);
 if(state.sub==='backup') return renderBackup(root);
 root.innerHTML='<div class="empty">اختر قسم فرعي</div>';
};
function renderProfitReport(root){
 root.innerHTML=`<div class="card" id="pnlPrintArea"><div class="cardHead"><h2>قائمة الدخل - صافي الربح</h2></div>
 <div class="toolbar"><input type="date" id="pnlFrom"><input type="date" id="pnlTo"><button class="btn secondary" onclick="runPnl()">تطبيق</button><button class="btn secondary" onclick="printElement('pnlPrintArea','قائمة الدخل')">🖨 طباعة / PDF</button></div>
 <div id="pnlOut"></div></div>`;
 runPnl();
}
/* ---------- Balance Sheet (قائمة المركز المالي) ---------- */
function computeBalanceSheet(){
 const cashTotal = DB.cashboxes.reduce((s,c)=>s+c.balance,0) + DB.banks.reduce((s,b)=>s+b.balance,0);
 const checksTotal = DB.checks.filter(c=>c.status==='pending' && c.type!=='out').reduce((s,c)=>s+c.amount,0);
 const checksPayable = DB.checks.filter(c=>c.status==='pending' && c.type==='out').reduce((s,c)=>s+c.amount,0);
 const custReceivable = DB.customers.reduce((s,c)=>s+Math.max(0,custBalance(c.id)),0);
 const customerAdvances = DB.customers.reduce((s,c)=>s+Math.max(0,-custBalance(c.id)),0); // customer overpaid us (they have credit)
 const stockValue = DB.items.reduce((s,i)=>s+getItemStockValue(i.id),0);
 const custodyOpen = DB.custodies.filter(c=>!c.closed).reduce((s,c)=>{const spent=c.expensesList.reduce((x,e)=>x+e.amount,0); return s+(c.amount-spent);},0);
 const advancesOpen = DB.advances.filter(a=>!a.settled).reduce((s,a)=>s+a.amount,0);
 const supplierAdvances = DB.suppliers.reduce((s,s2)=>s+Math.max(0,-suppBalance(s2.id)),0); // we prepaid supplier (asset)
 const currentAssets = cashTotal + checksTotal + custReceivable + stockValue + custodyOpen + advancesOpen + supplierAdvances;
 const fixedAssetsTotal = totalFixedAssets();
 const totalAssets = currentAssets + fixedAssetsTotal;

 const suppPayable = DB.suppliers.reduce((s,s2)=>s+Math.max(0,suppBalance(s2.id)),0);
 const partnersCurrentNet = DB.partners.reduce((s,p)=>s+partnerCurrentBalance(p.id),0);
 const platformPayable = DB.customers.filter(c=>c.isPlatform).reduce((s,c)=>s+Number(c.deferredAccrued||0),0);
 const currentLiabilities = suppPayable + Math.max(0,partnersCurrentNet) + customerAdvances + platformPayable + checksPayable;
 const totalLiabilities = currentLiabilities;

 const capitalTotal = DB.partners.reduce((s,p)=>s+partnerCapital(p.id),0);
 const totalDistributedAll = (DB.profitDistributions||[]).reduce((s,d)=>s+d.amount,0);
 const retainedEarnings = computeNetProfit(null,null).netProfit - totalDistributedAll;
 const partnersCurrentAsset = Math.max(0,-partnersCurrentNet); // if partners owe the company
 const totalEquity = capitalTotal + retainedEarnings;

 return {cashTotal, checksTotal, custReceivable, customerAdvances, stockValue, custodyOpen, advancesOpen, supplierAdvances, currentAssets, fixedAssetsTotal, totalAssets,
  suppPayable, partnersCurrentNet, platformPayable, checksPayable, currentLiabilities, totalLiabilities,
  capitalTotal, retainedEarnings, totalEquity, partnersCurrentAsset,
  balanceCheck: totalAssets - (totalLiabilities + totalEquity)};
}
function renderBalanceSheet(root){
 const b = computeBalanceSheet();
 root.innerHTML = `<div class="card" id="bsPrintArea"><div class="cardHead"><h2>قائمة المركز المالي</h2><span class="badge">حتى تاريخ اليوم: ${todayStr()}</span></div>
 <div class="grid2">
  <div class="card" style="background:var(--panel2);">
   <h3 style="color:var(--accent2);font-size:14px;">الأصول</h3>
   <table>
    <tr><td colspan="2" style="color:var(--muted);"><b>الأصول المتداولة</b></td></tr>
    <tr><td>النقدية (الخزائن + البنوك)</td><td style="text-align:left;">${fmt(b.cashTotal)}</td></tr>
    <tr><td>شيكات تحت التحصيل</td><td style="text-align:left;">${fmt(b.checksTotal)}</td></tr>
    <tr><td>أرصدة العملاء المدينة</td><td style="text-align:left;">${fmt(b.custReceivable)}</td></tr>
    <tr><td>دفعات مقدمة لموردين (رصيد لنا عندهم)</td><td style="text-align:left;">${fmt(b.supplierAdvances)}</td></tr>
    <tr><td>قيمة المخزون</td><td style="text-align:left;">${fmt(b.stockValue)}</td></tr>
    <tr><td>عهد مفتوحة (غير مقفلة)</td><td style="text-align:left;">${fmt(b.custodyOpen)}</td></tr>
    <tr><td>سلف موظفين غير مسددة</td><td style="text-align:left;">${fmt(b.advancesOpen)}</td></tr>
    ${b.partnersCurrentAsset>0?`<tr><td>مستحق من الشركاء (جاري)</td><td style="text-align:left;">${fmt(b.partnersCurrentAsset)}</td></tr>`:''}
    <tr style="border-top:1px solid var(--border);"><td><b>إجمالي الأصول المتداولة</b></td><td style="text-align:left;"><b>${fmt(b.currentAssets+ (b.partnersCurrentAsset>0?b.partnersCurrentAsset:0))}</b></td></tr>
    <tr><td colspan="2" style="color:var(--muted);padding-top:10px;"><b>الأصول الثابتة</b></td></tr>
    <tr><td>إجمالي الأصول الثابتة</td><td style="text-align:left;">${fmt(b.fixedAssetsTotal)}</td></tr>
    <tr style="border-top:2px solid var(--accent2);"><td style="font-size:15px;"><b>إجمالي الأصول</b></td><td style="text-align:left;font-size:15px;"><b class="pos">${fmt(b.totalAssets)}</b></td></tr>
   </table>
  </div>
  <div class="card" style="background:var(--panel2);">
   <h3 style="color:var(--accent2);font-size:14px;">الخصوم وحقوق الملكية</h3>
   <table>
    <tr><td colspan="2" style="color:var(--muted);"><b>الخصوم المتداولة</b></td></tr>
    <tr><td>أرصدة الموردين الدائنة</td><td style="text-align:left;">${fmt(b.suppPayable)}</td></tr>
    <tr><td>دفعات مقدمة من عملاء</td><td style="text-align:left;">${fmt(b.customerAdvances)}</td></tr>
    <tr><td>مستحق لمنصات البيع (عمولات مؤجلة)</td><td style="text-align:left;">${fmt(b.platformPayable)}</td></tr>
    <tr><td>شيكات دفع تحت السداد</td><td style="text-align:left;">${fmt(b.checksPayable)}</td></tr>
    ${b.partnersCurrentNet>0?`<tr><td>جاري الشركاء (مستحق للشركاء)</td><td style="text-align:left;">${fmt(b.partnersCurrentNet)}</td></tr>`:''}
    <tr style="border-top:1px solid var(--border);"><td><b>إجمالي الخصوم</b></td><td style="text-align:left;"><b>${fmt(b.totalLiabilities)}</b></td></tr>
    <tr><td colspan="2" style="color:var(--muted);padding-top:10px;"><b>حقوق الملكية</b></td></tr>
    <tr><td>رأس المال</td><td style="text-align:left;">${fmt(b.capitalTotal)}</td></tr>
    <tr><td>الأرباح المحتجزة (صافي الربح المتراكم)</td><td style="text-align:left;">${fmt(b.retainedEarnings)}</td></tr>
    <tr style="border-top:1px solid var(--border);"><td><b>إجمالي حقوق الملكية</b></td><td style="text-align:left;"><b>${fmt(b.totalEquity)}</b></td></tr>
    <tr style="border-top:2px solid var(--accent2);"><td style="font-size:15px;"><b>إجمالي الخصوم وحقوق الملكية</b></td><td style="text-align:left;font-size:15px;"><b>${fmt(b.totalLiabilities+b.totalEquity)}</b></td></tr>
   </table>
  </div>
 </div>
 <div class="stat" style="margin-top:14px;max-width:320px;"><div class="lbl">فرق التوازن (المفروض يكون صفر تقريبًا)</div><div class="val ${Math.abs(b.balanceCheck)<1?'pos':'neg'}">${fmt(b.balanceCheck)}</div></div>
 </div>
 <div style="text-align:left;"><button class="btn secondary" onclick="printElement('bsPrintArea','قائمة المركز المالي')">🖨 طباعة / PDF</button></div>`;
}

/* ---------- Other Income Report (الإيرادات الأخرى) ---------- */
function renderOtherIncomeReport(root){
 root.innerHTML=`<div class="card" id="oiPrintArea"><div class="cardHead"><h2>الإيرادات الأخرى (خصم مكتسب + عمولات موردين)</h2></div>
 <div class="toolbar"><input type="date" id="oiFrom"><input type="date" id="oiTo"><button class="btn secondary" onclick="runOtherIncome()">تطبيق</button><button class="btn secondary" onclick="printElement('oiPrintArea','الإيرادات الأخرى')">🖨 طباعة / PDF</button></div>
 <div id="oiOut"></div></div>`;
 runOtherIncome();
}
function runOtherIncome(){
 const from=document.getElementById('oiFrom').value, to=document.getElementById('oiTo').value;
 const inRange = d => (!from||d>=from) && (!to||d<=to);
 const discounts = DB.otherIncome.filter(o=>inRange(o.date)).map(o=>({date:o.date, type:'خصم مكتسب', desc:o.description, amount:o.amount}));
 const comms = DB.supplierCommissions.filter(c=>inRange(c.date)).map(c=>({date:c.date, type:'عمولة مورد', desc:getSuppNameById(c.supplierId)+(c.note?(' - '+c.note):''), amount:c.amount}));
 const list = discounts.concat(comms).sort((a,b)=>a.date<b.date?1:-1);
 const total = list.reduce((s,x)=>s+x.amount,0);
 document.getElementById('oiOut').innerHTML = `
 <div class="row" style="margin-bottom:14px;"><div class="stat"><div class="lbl">إجمالي الإيرادات الأخرى</div><div class="val pos">${fmt(total)}</div></div></div>
 <div class="tableWrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>القيمة</th></tr></thead><tbody>
 ${list.map(x=>`<tr><td>${x.date}</td><td>${x.type}</td><td>${x.desc}</td><td>${fmt(x.amount)}</td></tr>`).join('')||'<tr><td colspan=4 class="empty">لا توجد نتائج</td></tr>'}
 </tbody></table></div>`;
}

/* ---------- Debt Aging (أعمار الديون) ---------- */
function daysSince(dateStr){ return Math.floor((new Date(todayStr())-new Date(dateStr))/(1000*60*60*24)); }
function computeAging(minDays){
 minDays = minDays||0;
 const custDebts = DB.salesInvoices.filter(i=>!i.isCash && i.status!=='paid' && daysSince(i.date)>=minDays)
  .map(i=>({name:getCustNameById(i.customerId), number:i.number, date:i.date, days:daysSince(i.date), amount:i.total-i.paidAmount}));
 const suppDebts = DB.purchaseInvoices.filter(i=>i.status!=='paid' && daysSince(i.date)>=minDays)
  .map(i=>({name:getSuppNameById(i.supplierId), number:i.number, date:i.date, days:daysSince(i.date), amount:i.total-i.paidAmount}));
 return {custDebts, suppDebts};
}
function renderAgingReport(root){
 const {custDebts, suppDebts} = computeAging(0);
 root.innerHTML=`<div class="card" id="agingPrintArea"><div class="cardHead"><h2>أعمار الديون</h2><button class="btn secondary" onclick="printElement(\'agingPrintArea\',\'أعمار الديون\')">🖨 طباعة / PDF</button></div>
 <div class="grid2">
  <div>
   <h3 style="color:var(--accent2);font-size:14px;">مستحق لنا من العملاء</h3>
   <table><thead><tr><th>العميل</th><th>الفاتورة</th><th>التاريخ</th><th>عدد الأيام</th><th>المبلغ</th></tr></thead><tbody>
   ${custDebts.sort((a,b)=>b.days-a.days).map(d=>`<tr><td>${d.name}</td><td>#${d.number}</td><td>${d.date}</td><td class="${d.days>40?'neg':''}">${d.days}</td><td>${fmt(d.amount)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا توجد ديون</td></tr>'}
   </tbody></table>
  </div>
  <div>
   <h3 style="color:var(--accent2);font-size:14px;">مستحق علينا للموردين</h3>
   <table><thead><tr><th>المورد</th><th>الفاتورة</th><th>التاريخ</th><th>عدد الأيام</th><th>المبلغ</th></tr></thead><tbody>
   ${suppDebts.sort((a,b)=>b.days-a.days).map(d=>`<tr><td>${d.name}</td><td>#${d.number}</td><td>${d.date}</td><td class="${d.days>40?'neg':''}">${d.days}</td><td>${fmt(d.amount)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">لا توجد ديون</td></tr>'}
   </tbody></table>
  </div>
 </div></div>`;
}

function computeNetProfit(from, to){
 const inRange = d => (!from||d>=from) && (!to||d<=to);
 const sales = DB.salesInvoices.filter(i=>inRange(i.date));
 const totalSales = sales.reduce((s,i)=>s+i.total,0);
 const totalCogs = sales.reduce((s,i)=>s+i.cogs,0);
 const salesReturns = DB.salesReturns.filter(r=>inRange(r.date)).reduce((s,r)=>s+r.total,0);
 const netSales = totalSales - salesReturns;
 const grossProfit = netSales - totalCogs;
 const commissions = DB.supplierCommissions.filter(c=>inRange(c.date)).reduce((s,c)=>s+c.amount,0);
 const purchDiscounts = DB.otherIncome.filter(o=>inRange(o.date)).reduce((s,o)=>s+o.amount,0);
 const otherIncome = commissions + purchDiscounts;
 const expenses = DB.expenses.filter(e=>inRange(e.date)).reduce((s,e)=>s+e.amount,0);
 const netProfit = grossProfit + otherIncome - expenses;
 return {totalSales, totalCogs, salesReturns, netSales, grossProfit, commissions, purchDiscounts, otherIncome, expenses, netProfit};
}
function runPnl(){
 const from=document.getElementById('pnlFrom').value, to=document.getElementById('pnlTo').value;
 const r = computeNetProfit(from, to);
 document.getElementById('pnlOut').innerHTML = `
 <div class="card" style="background:var(--panel2);">
  <table>
   <tr><td>إجمالي المبيعات</td><td style="text-align:left;">${fmt(r.totalSales)}</td></tr>
   <tr><td>(-) مرتجعات المبيعات</td><td style="text-align:left;">${fmt(r.salesReturns)}</td></tr>
   <tr><td><b>صافي المبيعات</b></td><td style="text-align:left;"><b>${fmt(r.netSales)}</b></td></tr>
   <tr><td>(-) تكلفة البضاعة المباعة</td><td style="text-align:left;">${fmt(r.totalCogs)}</td></tr>
   <tr style="border-top:2px solid var(--border);"><td><b>مجمل الربح</b></td><td style="text-align:left;"><b class="pos">${fmt(r.grossProfit)}</b></td></tr>
   <tr><td>(+) إيرادات أخرى (خصم مكتسب: ${fmt(r.purchDiscounts)} + عمولات موردين: ${fmt(r.commissions)})</td><td style="text-align:left;">${fmt(r.otherIncome)}</td></tr>
   <tr><td>(-) إجمالي المصروفات (شامل خصم مسموح به والرواتب المعتمدة)</td><td style="text-align:left;">${fmt(r.expenses)}</td></tr>
   <tr style="border-top:2px solid var(--accent2);"><td style="font-size:16px;"><b>صافي الربح</b></td><td style="text-align:left;font-size:16px;"><b class="${r.netProfit>=0?'pos':'neg'}">${fmt(r.netProfit)}</b></td></tr>
  </table>
 </div>`;
}
function renderBackup(root){
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>النسخ الاحتياطي (استيراد / تصدير)</h2></div>
 <p style="color:var(--muted);font-size:12.5px;">بما أن البرنامج يعمل بالكامل داخل المتصفح، يُنصح بأخذ نسخة احتياطية بشكل دوري.</p>
 <div class="row">
  <button class="btn" onclick="exportBackup()">⬇ تصدير نسخة احتياطية كاملة (JSON)</button>
  ${isAdmin()?'<button class="btn secondary" onclick="importBackup()">⬆ استيراد نسخة احتياطية</button>':''}
 </div>
 <hr style="border-color:var(--border);margin:16px 0;">
 <h3 style="color:var(--accent2);font-size:14px;">قوالب استيراد/تصدير Excel لكل قسم</h3>
 <div class="row" style="margin-top:8px;">
  <button class="btn secondary small" onclick="downloadWorkbook([{الاسم:'',الهاتف:'','رصيد افتتاحي':'','نوع الرصيد (مدين/دائن)':''}],'قالب_العملاء.xlsx','عملاء')">⬇ قالب العملاء</button>
  ${can('sales','add')?'<button class="btn secondary small" onclick="importCustomersExcel()">⬆ استيراد عملاء</button>':''}
 </div>
 <div class="row" style="margin-top:8px;">
  <button class="btn secondary small" onclick="downloadWorkbook([{الاسم:'',الهاتف:'','رصيد افتتاحي':'','نوع الرصيد (مدين/دائن)':''}],'قالب_الموردين.xlsx','موردين')">⬇ قالب الموردين</button>
  ${can('purchases','add')?'<button class="btn secondary small" onclick="importSuppliersExcel()">⬆ استيراد موردين</button>':''}
 </div>
 <div class="row" style="margin-top:8px;">
  <button class="btn secondary small" onclick="downloadWorkbook([{الكود:'',الاسم:'',الوحدة:'',المخزن:DB.warehouses[0]?.name||'','الكمية الافتتاحية':'','سعر التكلفة':''}],'قالب_الأصناف.xlsx','أصناف')">⬇ قالب الأصناف</button>
  ${can('inventory','add')?'<button class="btn secondary small" onclick="importItemsExcel()">⬆ استيراد أصناف</button>':''}
 </div>
 <div class="row" style="margin-top:8px;">
  <button class="btn secondary small" onclick="exportAllPdfPrint()">🖨 طباعة تقرير شامل / PDF</button>
 </div>
 </div>`;
}
function exportBackup(){
 const blob=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a'); a.href=url; a.download='نسخة_احتياطية_'+todayStr()+'.json'; a.click();
 logAudit('تصدير','system','نسخة احتياطية كاملة');
}
function importBackup(){
 const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
 inp.onchange=()=>{
  if(!inp.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{
   if(!confirm('سيتم استبدال كل بيانات الشركة بالنسخة الاحتياطية (باستثناء المستخدمين وصلاحياتهم — تبقى كما هي). متابعة؟')) return;
   try{
    const parsed=JSON.parse(e.target.result);
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('bad');
    const keepUsers=DB.users, keepUserId=DB.currentUserId;
    DB=parsed; normalizeDB();
    DB.users=keepUsers; DB.currentUserId=keepUserId;
    saveDB(); logAudit('استيراد','system','استعادة نسخة احتياطية'); toast('تم الاستيراد بنجاح'); showApp();
   }
   catch(err){ toast('ملف غير صالح'); }
  };
  reader.readAsText(inp.files[0]);
 };
 inp.click();
}
function importCustomersExcel(){
 pickExcelAndImport(rows=>{
  let count=0;
  rows.forEach(r=>{
   const name=r['الاسم']; if(!name) return;
   if(DB.customers.find(c=>c.name===name)) return;
   DB.customers.push({id:uid(), name, phone:r['الهاتف']||'', openingBalance:Number(r['رصيد افتتاحي']||0), openingType: (r['نوع الرصيد (مدين/دائن)']||'مدين').includes('دائن')?'credit':'debit', createdDate:todayStr()});
   count++;
  });
  saveDB(); logAudit('استيراد','sales','استيراد عملاء ('+count+')'); renderAll(); toast('تم استيراد '+count+' عميل');
 });
}
function importSuppliersExcel(){
 pickExcelAndImport(rows=>{
  let count=0;
  rows.forEach(r=>{
   const name=r['الاسم']; if(!name) return;
   if(DB.suppliers.find(s=>s.name===name)) return;
   DB.suppliers.push({id:uid(), name, phone:r['الهاتف']||'', openingBalance:Number(r['رصيد افتتاحي']||0), openingType:(r['نوع الرصيد (مدين/دائن)']||'دائن').includes('مدين')?'debit':'credit', createdDate:todayStr()});
   count++;
  });
  saveDB(); logAudit('استيراد','purchases','استيراد موردين ('+count+')'); renderAll(); toast('تم استيراد '+count+' مورد');
 });
}
function exportAllPdfPrint(){
 const w=window.open('','_blank');
 const pnl = document.getElementById('pnlOut')? document.getElementById('pnlOut').innerHTML : '';
 w.document.write('<html dir="rtl"><head><title>تقرير شامل</title><style>body{font-family:Tahoma;padding:20px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #999;padding:6px;}</style></head><body>'+printLetterhead('تقرير النظام - '+todayStr())+pnl+'</body></html>');
 w.document.close(); w.print();
}

/* ================= USERS MODULE ================= */
RENDERERS.users = function(root){
 if(!isAdmin()){ root.innerHTML='<div class="empty">هذا القسم للمدير فقط</div>'; return; }
 root.innerHTML=`<div class="card"><div class="cardHead"><h2>المستخدمون والصلاحيات</h2><button class="btn" onclick="openUserForm()">+ مستخدم جديد</button></div>
 <div class="tableWrap"><table><thead><tr><th>اسم المستخدم</th><th>النوع</th><th></th></tr></thead><tbody>
 ${DB.users.map(u=>`<tr><td>${u.username}</td><td>${u.isAdmin?'مدير (كل الصلاحيات)':'مستخدم محدد الصلاحيات'}</td>
 <td>${!u.isAdmin?`<button class="linkBtn" onclick="openUserForm(${u.id})">تعديل الصلاحيات</button>`:''} ${u.id!==1?`<button class="linkBtn" style="color:var(--danger)" onclick="deleteUser(${u.id})">حذف</button>`:''}</td></tr>`).join('')}
 </tbody></table></div></div>
 <div class="card"><div class="cardHead"><h2>سجل التدقيق (Audit Log)</h2></div>
 <div class="tableWrap">${DB.auditLog.length? `<table><thead><tr><th>التاريخ والوقت</th><th>المستخدم</th><th>العملية</th><th>القسم</th><th>التفاصيل</th></tr></thead><tbody>
 ${DB.auditLog.slice(0,60).map(l=>`<tr><td>${new Date(l.date).toLocaleString('ar-EG')}</td><td>${l.user}</td><td>${l.action}</td><td>${l.module}</td><td>${l.details}</td></tr>`).join('')}
 </tbody></table>`:'<div class="empty">لا توجد سجلات</div>'}</div></div>`;
};
const MODULE_PERM_LIST = ['sales','purchases','inventory','treasury','employees','equity','expenses'];
function openUserForm(id){
 const u=id?DB.users.find(x=>x.id===id):{username:'',password:'',perms:{}};
 openModal(id?'تعديل صلاحيات: '+u.username:'مستخدم جديد', `
 ${!id?`<div class="grid2"><div class="field"><label>اسم المستخدم</label><input id="uUsername"></div><div class="field"><label>كلمة السر</label><input id="uPassword" type="text"></div></div>`:''}
 <h4 style="color:var(--muted);margin-top:14px;">الصلاحيات لكل قسم</h4>
 <table><thead><tr><th>القسم</th><th>عرض</th><th>إضافة</th><th>تعديل</th><th>حذف</th></tr></thead><tbody>
 ${MODULE_PERM_LIST.map(m=>{ const p=(u.perms&&u.perms[m])||{}; const label=ALL_MODULES.find(x=>x.id===m).label;
 return `<tr><td>${label}</td>
 <td><input type="checkbox" id="perm_${m}_view" ${p.view?'checked':''}></td>
 <td><input type="checkbox" id="perm_${m}_add" ${p.add?'checked':''}></td>
 <td><input type="checkbox" id="perm_${m}_edit" ${p.edit?'checked':''}></td>
 <td><input type="checkbox" id="perm_${m}_delete" ${p.delete?'checked':''}></td></tr>`;}).join('')}
 </tbody></table>
 <div style="text-align:left;margin-top:16px;"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="saveUser(${id||'null'})">حفظ</button></div>`);
}
function saveUser(id){
 const perms={};
 MODULE_PERM_LIST.forEach(m=>{ perms[m]={view:document.getElementById('perm_'+m+'_view').checked, add:document.getElementById('perm_'+m+'_add').checked, edit:document.getElementById('perm_'+m+'_edit').checked, delete:document.getElementById('perm_'+m+'_delete').checked}; });
 if(id){
  const u=DB.users.find(x=>x.id===id); u.perms=perms;
 } else {
  const username=document.getElementById('uUsername').value.trim(), password=document.getElementById('uPassword').value;
  if(!username||!password){toast('أدخل اسم المستخدم وكلمة السر');return;}
  if(DB.users.find(x=>x.username===username)){toast('اسم المستخدم مستخدم بالفعل');return;}
  if(window.isUsernameTakenGlobally && isUsernameTakenGlobally(username, window.ACTIVE_COMPANY_ID)){toast('اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر');return;}
  DB.users.push({id:uid(), username, password, isAdmin:false, perms});
 }
 saveDB(); logAudit('إضافة/تعديل','users','مستخدم'); closeModal(); renderAll(); toast('تم الحفظ');
}
function deleteUser(id){ if(id===DB.currentUserId){toast('لا يمكنك حذف المستخدم الحالي');return;} if(!confirm('تأكيد حذف المستخدم؟'))return; DB.users=DB.users.filter(x=>x.id!==id); saveDB(); renderAll(); }

/* ================= DASHBOARD ================= */
/* ---------- Analytics helpers (per-item profitability, monthly trend) ---------- */
function computeItemProfitability(){
 const map = {};
 DB.salesInvoices.forEach(inv=>{
  inv.lines.forEach((l,idx)=>{
   const base = l.qty*l.price - computeDiscount(l.qty*l.price,'value',l.discVal||0);
   const cm = (inv.consumedMap||[])[idx];
   const cogs = cm? cm.consumed.reduce((s,c)=>s+c.qty*c.unitCost,0) : 0;
   if(!map[l.itemId]) map[l.itemId] = {qty:0, revenue:0, cogs:0};
   map[l.itemId].qty += Number(l.qty);
   map[l.itemId].revenue += base;
   map[l.itemId].cogs += cogs;
  });
 });
 return Object.entries(map).map(([itemId,v])=>{
  const it = DB.items.find(i=>i.id==itemId);
  return {itemId:Number(itemId), name: it?it.name:'صنف محذوف', qty:v.qty, revenue:v.revenue, cogs:v.cogs, profit:v.revenue-v.cogs};
 });
}
function computeMonthlySeries(monthsBack){
 monthsBack = monthsBack||6;
 const months = [];
 const now = new Date();
 for(let i=monthsBack-1;i>=0;i--){
  const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
  months.push({key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), label: d.toLocaleDateString('en-US',{month:'short'})+' '+d.getFullYear()});
 }
 return months.map(m=>{
  const sales = DB.salesInvoices.filter(i=>i.date.startsWith(m.key)).reduce((s,i)=>s+i.total,0);
  const expenses = DB.expenses.filter(e=>e.date.startsWith(m.key)).reduce((s,e)=>s+e.amount,0);
  return {label:m.label, sales, expenses};
 });
}
function renderMiniBarChart(series){
 const w=560, h=180, pad=30;
 const maxVal = Math.max(1, ...series.map(s=>Math.max(s.sales,s.expenses)));
 const barW = (w-pad*2)/(series.length*2.4);
 let bars='';
 series.forEach((s,i)=>{
  const groupX = pad + i*((w-pad*2)/series.length);
  const salesH = (s.sales/maxVal)*(h-pad*2);
  const expH = (s.expenses/maxVal)*(h-pad*2);
  bars += `<rect x="${groupX}" y="${h-pad-salesH}" width="${barW}" height="${salesH}" fill="#3fae86"></rect>`;
  bars += `<rect x="${groupX+barW+3}" y="${h-pad-expH}" width="${barW}" height="${expH}" fill="#c9564f"></rect>`;
  bars += `<text x="${groupX+barW}" y="${h-8}" font-size="10" fill="#8ea3b5" text-anchor="middle">${s.label}</text>`;
 });
 return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;height:auto;">
  <line x1="${pad}" y1="${h-pad}" x2="${w-5}" y2="${h-pad}" stroke="#28394a"></line>
  ${bars}
  <rect x="${w-140}" y="8" width="10" height="10" fill="#3fae86"></rect><text x="${w-125}" y="17" font-size="11" fill="#8ea3b5">مبيعات</text>
  <rect x="${w-70}" y="8" width="10" height="10" fill="#c9564f"></rect><text x="${w-55}" y="17" font-size="11" fill="#8ea3b5">مصروفات</text>
 </svg>`;
}
RENDERERS.dashboard = function(root){
 const totalCash = DB.cashboxes.reduce((s,c)=>s+c.balance,0) + DB.banks.reduce((s,b)=>s+b.balance,0);
 const custDebt = DB.customers.reduce((s,c)=>s+Math.max(0,custBalance(c.id)),0);
 const suppDebt = DB.suppliers.reduce((s,s2)=>s+Math.max(0,suppBalance(s2.id)),0);
 const stockValue = DB.items.reduce((s,i)=>s+getItemStockValue(i.id),0);
 const pnl = computeNetProfit(null,null);
 const {custDebts, suppDebts} = computeAging(40);
 const companyName = DB.settings && DB.settings.companyName;
 root.innerHTML = `
 <div class="card"><div class="cardHead"><h2>أهلًا بك، ${getUser()?.username}${companyName?' — '+companyName:''}</h2></div>
 <p style="color:var(--muted)">استخدم القائمة العلوية للتنقل بين الأقسام. يمكنك أخذ نسخة احتياطية من قسم "التقارير ← نسخ احتياطي".</p>
 </div>
 <div class="row" style="margin-bottom:16px;">
  <div class="stat"><div class="lbl">إجمالي السيولة (خزينة+بنوك)</div><div class="val pos">${fmt(totalCash)}</div></div>
  <div class="stat"><div class="lbl">مستحق من العملاء</div><div class="val">${fmt(custDebt)}</div></div>
  <div class="stat"><div class="lbl">مستحق للموردين</div><div class="val neg">${fmt(suppDebt)}</div></div>
  <div class="stat"><div class="lbl">قيمة المخزون</div><div class="val">${fmt(stockValue)}</div></div>
 </div>
 <div class="row" style="margin-bottom:16px;">
  <div class="stat"><div class="lbl">مجمل الربح (كل الوقت - لحظي)</div><div class="val pos">${fmt(pnl.grossProfit)}</div></div>
  <div class="stat"><div class="lbl">صافي الربح (كل الوقت - لحظي)</div><div class="val ${pnl.netProfit>=0?'pos':'neg'}">${fmt(pnl.netProfit)}</div></div>
 </div>
 ${(custDebts.length||suppDebts.length)? `
 <div class="card" style="border-color:var(--warn);">
  <div class="cardHead"><h2 style="color:var(--warn);">⚠ ديون تجاوزت 40 يومًا</h2></div>
  <div class="grid2">
   <div><h4 style="color:var(--muted);">مستحق من عملاء</h4>${custDebts.length? `<table><thead><tr><th>العميل</th><th>الفاتورة</th><th>الأيام</th><th>المبلغ</th></tr></thead><tbody>
   ${custDebts.map(d=>`<tr><td>${d.name}</td><td>#${d.number}</td><td class="neg">${d.days}</td><td>${fmt(d.amount)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">لا يوجد</p>'}</div>
   <div><h4 style="color:var(--muted);">مستحق لموردين</h4>${suppDebts.length? `<table><thead><tr><th>المورد</th><th>الفاتورة</th><th>الأيام</th><th>المبلغ</th></tr></thead><tbody>
   ${suppDebts.map(d=>`<tr><td>${d.name}</td><td>#${d.number}</td><td class="neg">${d.days}</td><td>${fmt(d.amount)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">لا يوجد</p>'}</div>
  </div>
 </div>`:''}
 <div class="card"><div class="cardHead"><h2>📈 حركة المبيعات والمصروفات (آخر 6 أشهر)</h2></div>
 ${renderMiniBarChart(computeMonthlySeries(6))}
 </div>
 <div class="grid2">
  <div class="card"><div class="cardHead"><h2>🏆 الأصناف الأكثر مبيعًا</h2></div>
  ${(()=>{ const list=computeItemProfitability().sort((a,b)=>b.qty-a.qty).slice(0,5);
   return list.length? `<table><thead><tr><th>الصنف</th><th>الكمية المباعة</th><th>الإيراد</th></tr></thead><tbody>
   ${list.map(i=>`<tr><td>${i.name}</td><td>${fmt(i.qty)}</td><td>${fmt(i.revenue)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">لا توجد مبيعات بعد</p>'; })()}
  </div>
  <div class="card"><div class="cardHead"><h2>💹 الأصناف الأكثر ربحية</h2></div>
  ${(()=>{ const list=computeItemProfitability().sort((a,b)=>b.profit-a.profit).slice(0,5);
   return list.length? `<table><thead><tr><th>الصنف</th><th>الربح</th><th>هامش الربح</th></tr></thead><tbody>
   ${list.map(i=>`<tr><td>${i.name}</td><td class="pos">${fmt(i.profit)}</td><td>${i.revenue>0?((i.profit/i.revenue)*100).toFixed(1):'0'}%</td></tr>`).join('')}</tbody></table>` : '<p class="empty">لا توجد مبيعات بعد</p>'; })()}
  </div>
 </div>
 `;
};

/* ================= SETTINGS MODULE ================= */
RENDERERS.settings = function(root){
 if(!isAdmin()){ root.innerHTML='<div class="empty">هذا القسم للمدير فقط</div>'; return; }
 const s = DB.settings||{companyName:'',logo:''};
 root.innerHTML = `<div class="card"><div class="cardHead"><h2>إعدادات الشركة (تظهر عند الطباعة)</h2></div>
 <div class="grid2">
  <div class="field"><label>اسم الشركة / المحل</label><input id="stCompanyName" value="${s.companyName||''}"></div>
  <div class="field"><label>شعار الشركة (اللوجو)</label><input type="file" id="stLogoFile" accept="image/*" onchange="onLogoFileChange()"></div>
 </div>
 <div style="margin-top:12px;">${s.logo?`<img id="stLogoPreview" src="${s.logo}" style="max-height:80px;border-radius:6px;border:1px solid var(--border);">`:`<img id="stLogoPreview" style="max-height:80px;display:none;border-radius:6px;">`}</div>
 <div style="text-align:left;margin-top:16px;"><button class="btn" onclick="saveSettings()">حفظ الإعدادات</button></div>
 </div>
 <div class="card"><div class="cardHead"><h2>تعديل أسماء الخزائن والبنوك والمخازن</h2></div>
 <div class="grid3">
  <div><h4 style="color:var(--muted);">المخازن</h4>${DB.warehouses.map(w=>`<div class="row" style="margin-bottom:6px;"><span class="badge">${w.name}</span><button class="linkBtn" onclick="renameEntity('warehouses',${w.id})">تعديل</button></div>`).join('')}</div>
  <div><h4 style="color:var(--muted);">الخزائن</h4>${DB.cashboxes.map(c=>`<div class="row" style="margin-bottom:6px;"><span class="badge">${c.name}</span><button class="linkBtn" onclick="renameEntity('cashboxes',${c.id})">تعديل</button></div>`).join('')}</div>
  <div><h4 style="color:var(--muted);">البنوك</h4>${DB.banks.map(b=>`<div class="row" style="margin-bottom:6px;"><span class="badge">${b.name}</span><button class="linkBtn" onclick="renameEntity('banks',${b.id})">تعديل</button></div>`).join('')}</div>
 </div></div>`;
};
function onLogoFileChange(){
 const file = document.getElementById('stLogoFile').files[0]; if(!file) return;
 const reader = new FileReader();
 reader.onload = e=>{
  const img = document.getElementById('stLogoPreview');
  img.src = e.target.result; img.style.display='inline-block';
  window._pendingLogo = e.target.result;
 };
 reader.readAsDataURL(file);
}
function saveSettings(){
 DB.settings = DB.settings||{};
 DB.settings.companyName = document.getElementById('stCompanyName').value.trim();
 if(window._pendingLogo) DB.settings.logo = window._pendingLogo;
 saveDB(); window._pendingLogo=null; logAudit('تعديل','settings','إعدادات الشركة'); renderAll(); toast('تم حفظ الإعدادات');
}
function renameEntity(collection, id){
 const list = DB[collection]; const obj = list.find(x=>x.id===id); if(!obj) return;
 const newName = prompt('الاسم الجديد:', obj.name);
 if(newName && newName.trim()){ obj.name = newName.trim(); saveDB(); logAudit('تعديل','settings','إعادة تسمية'); renderAll(); toast('تم التعديل'); }
}

/* ================= INIT =================
   التشغيل الأول للتطبيق كله (تحميل بيانات المنصة، الجلسة، تسجيل الدخول)
   أصبح في js/auth.js — مستمع DOMContentLoaded هناك هو نقطة الدخول الوحيدة. */

