/* ============================================================
   AHMETHOD — js/auth.js
   Owns: super-admin seeding, legacy single-tenant data migration
   (from BOTH the old localStorage key and the old shared Firebase
   path used before multi-tenant existed), the login button's
   actual behavior, session persistence (so a refresh keeps you
   logged in), the subscription gate, and the one-and-only
   DOMContentLoaded bootstrap for the whole app (js/app.js has no
   bootstrap of its own — see the note at the bottom of js/app.js).
   ============================================================ */

window.ACTIVE_COMPANY_ID = null;

/* ---------------- boot ---------------- */
function bootstrapPlatform(onDone) {
  const platformUsers = getPlatformUsers();
  if (!platformUsers.find(x => x.role === PLATFORM_ROLES.SUPER_ADMIN)) {
    platformUsers.push({ id: 1, username: 'admin', password: 'admin123', role: PLATFORM_ROLES.SUPER_ADMIN, createdAt: new Date().toISOString() });
    savePlatformUsers(platformUsers);
  }
  migrateLegacyDataIfNeeded(onDone);
}

/* If a browser already has data saved under the ORIGINAL single-tenant
   localStorage key ('acc_system_data_v1'), or if the Firebase project
   still has data under the ORIGINAL shared path ('ERP_FULL_DB') from
   before this multi-tenant version existed, wrap that data into a proper
   company ("الشركة الافتراضية") instead of losing it. Original sources
   are left in place untouched (never deleted) — only copied. */
function migrateLegacyDataIfNeeded(onDone) {
  const done = () => { if (onDone) onDone(); };
  if (localStorage.getItem(NS.legacyMigrated)) { done(); return; }

  const legacyRaw = localStorage.getItem('acc_system_data_v1');
  if (legacyRaw && getCompanies().length === 0) {
    try {
      wrapLegacyIntoCompany(JSON.parse(legacyRaw), 'legacy-local');
    } catch (e) { /* بيانات محلية قديمة تالفة — تجاهلها بأمان */ }
    localStorage.setItem(NS.legacyMigrated, '1');
    done();
    return;
  }

  // لا توجد بيانات محلية قديمة — جرّب المسار السحابي القديم المشترك
  // (اللي كان النظام بيستخدمه قبل تعدد الشركات)
  if (getCompanies().length === 0) {
    try {
      // لو النت مقطوع Firebase بيفضل معلّق — بعد 6 ثواني نكمل (ونعيد المحاولة في الفتحة الجاية)
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; done(); } }, 6000);
      firebase.database().ref('ERP_FULL_DB').once('value').then(snap => {
        if (settled) return; settled = true; clearTimeout(timer);
        const remote = snap.val();
        if (remote && getCompanies().length === 0) {
          wrapLegacyIntoCompany(remote, 'legacy-cloud');
        }
        localStorage.setItem(NS.legacyMigrated, '1');
        done();
      }).catch(() => {
        if (settled) return; settled = true; clearTimeout(timer);
        localStorage.setItem(NS.legacyMigrated, '1');
        done();
      });
      return;
    } catch (e) { /* يكمل عادي تحت */ }
  }

  localStorage.setItem(NS.legacyMigrated, '1');
  done();
}

function wrapLegacyIntoCompany(legacyData, companyId) {
  const companyName = (legacyData.settings && legacyData.settings.companyName) ? legacyData.settings.companyName : 'الشركة الافتراضية';
  const company = {
    id: companyId, name: companyName, adminName: '-', phone: '', email: '',
    subscriptionType: 'pro', subscriptionStart: todayISO(), subscriptionEnd: addDaysToDate(todayISO(), 3650),
    status: 'active', createdAt: new Date().toISOString(),
  };
  const companies = getCompanies();
  companies.push(company);
  saveCompanies(companies);
  localStorage.setItem('acc_system_data_v1__' + companyId, JSON.stringify(legacyData));
  try { firebase.database().ref('ERP_COMPANIES/' + companyId).set(JSON.stringify(legacyData)); } catch (e) {}
  const idx = getUserIndex();
  (legacyData.users || []).forEach(u => {
    const uname = u.username || u.user; // النسخة القديمة جدًا كانت بتستخدم "user" بدل "username"
    if (!uname) return;
    idx[uname] = { companyId, role: (u.isAdmin || u.role === 'admin') ? PLATFORM_ROLES.COMPANY_ADMIN : PLATFORM_ROLES.EMPLOYEE };
  });
  saveUserIndex(idx);
}

/* ---------------- login ---------------- */
function platformDoLogin() {
  const u = document.getElementById('liUser').value.trim();
  const p = document.getElementById('liPass').value;
  const errEl = document.getElementById('liErr');
  errEl.textContent = '';
  if (!u || !p) { errEl.textContent = 'أدخل اسم المستخدم وكلمة السر'; return; }

  // 1) super admin
  const superUser = getPlatformUsers().find(x => x.username === u && x.password === p && x.role === PLATFORM_ROLES.SUPER_ADMIN);
  if (superUser) {
    saveSession({ role: 'super_admin', userId: superUser.id, loginTime: new Date().toISOString() });
    enterSuperAdminPanel();
    return;
  }

  // 2) company user (company_admin or employee) — routed via the platform-wide index
  const entry = getUserIndex()[u];
  if (!entry) { errEl.textContent = 'بيانات الدخول غير صحيحة'; return; }
  const company = getCompanyById(entry.companyId);
  if (!company) { errEl.textContent = 'بيانات الدخول غير صحيحة'; return; }

  const live = computeLiveStatus(company);
  if (live !== 'active') { showSubscriptionExpiredScreen(company); return; }

  loadDB(company.id, function () {
    const user = DB.users.find(x => x.username === u && x.password === p);
    if (!user) { errEl.textContent = 'بيانات الدخول غير صحيحة'; return; }

    DB.currentUserId = user.id; saveDB();
    logAudit('تسجيل دخول', 'system', '-');
    saveSession({ role: user.isAdmin ? 'company_admin' : 'employee', companyId: company.id, userId: user.id, loginTime: new Date().toISOString() });
    showApp();
  });
}

function platformLogout() {
  clearSessionStorage();
  document.getElementById('superAdminShell').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('subExpiredScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('liUser').value = ''; document.getElementById('liPass').value = '';
}
// used by js/app.js's own doLogout() so a company user's normal logout also
// clears the platform session (guarded call — see js/app.js).
window.clearPlatformSession = function () { clearSessionStorage(); };

/* ---------------- screens ---------------- */
function enterSuperAdminPanel() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('subExpiredScreen').style.display = 'none';
  document.getElementById('superAdminShell').style.display = 'flex';
  renderCompaniesPanel();
}
function showSubscriptionExpiredScreen(company) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('superAdminShell').style.display = 'none';
  document.getElementById('subExpiredCompanyName').textContent = company.name;
  document.getElementById('subExpiredEnd').textContent = company.subscriptionEnd;
  document.getElementById('subExpiredMsg').textContent =
    company.status === 'suspended' ? 'تم إيقاف اشتراك هذه الشركة من قبل الإدارة.' : 'انتهى اشتراكك';
  document.getElementById('subExpiredScreen').style.display = 'flex';
}
function backToLoginFromExpired() {
  document.getElementById('subExpiredScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}

/* ---------------- session restore (page load + back-button) ---------------- */
function restoreSessionOnLoad() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('superAdminShell').style.display = 'none';
  document.getElementById('subExpiredScreen').style.display = 'none';

  const s = getSession();
  if (!s) return;

  if (s.role === 'super_admin') { enterSuperAdminPanel(); return; }

  if (s.companyId) {
    const company = getCompanyById(s.companyId);
    if (!company) { clearSessionStorage(); return; }
    const live = computeLiveStatus(company);
    if (live !== 'active') { showSubscriptionExpiredScreen(company); return; }
    loadDB(company.id, function () {
      // المستخدم الحالي بيتحدد من جلسة هذا الجهاز (مش من بيانات الشركة المشتركة)
      // عشان دخول مستخدم آخر من جهاز تاني ما يغيّرش هويتك بعد إعادة تحميل الصفحة.
      if (s.userId && DB.users.find(x => x.id === s.userId)) {
        DB.currentUserId = s.userId;
        showApp();
      } else {
        clearSessionStorage();
        document.getElementById('loginScreen').style.display = 'flex';
      }
    });
  }
}

// Browser back/forward (bfcache) should never re-show a stale authenticated
// page without re-checking the session.
window.addEventListener('pageshow', function (e) {
  if (e.persisted) restoreSessionOnLoad();
});

// Light periodic re-check in case a subscription expires mid-session.
setInterval(function () {
  const s = getSession();
  if (s && s.companyId) {
    const company = getCompanyById(s.companyId);
    if (!company || computeLiveStatus(company) !== 'active') {
      toast('انتهت صلاحية الاشتراك، سيتم تسجيل الخروج');
      setTimeout(function () { doLogout(); restoreSessionOnLoad(); }, 1200);
    }
  }
}, 5 * 60 * 1000);

/* ---------------- init: the one-and-only bootstrap for the whole app ---------------- */
document.addEventListener('DOMContentLoaded', function () {
  const loadingEl = document.getElementById('loadingScreen');

  // 1) جيب بيانات المنصة (الشركات/فهرس المستخدمين) من Firebase أولاً
  loadPlatformFromCloud(function () {
    // 2) جهّز حساب المدير العام لو أول مرة، ورحّل أي بيانات قديمة
    bootstrapPlatform(function () {
      document.getElementById('liPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') platformDoLogin(); });
      document.getElementById('liUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') platformDoLogin(); });
      // 3) اخفِ شاشة التحميل واستعد الجلسة المحفوظة (أو اعرض شاشة الدخول)
      if (loadingEl) loadingEl.style.display = 'none';
      restoreSessionOnLoad();
    });
  });
});
