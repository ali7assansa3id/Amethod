/* ============================================================
   AHMETHOD — js/storage.js
   Namespaced localStorage access for PLATFORM-level data:
   companies, the super-admin account, and the platform-wide
   username index. These are ALSO synced to Firebase
   (path: ERP_PLATFORM) so registering a company, or the super
   admin account, is visible from any device/browser — not just
   the one that created it. localStorage stays as the instant
   local copy (works even if the network request hasn't landed
   yet), exactly the same pattern js/app.js uses for each
   company's own accounting data.

   The current login session (NS.session) is NOT synced to the
   cloud — a session is meant to be per-device/per-browser, like
   any normal login.

   Company accounting data itself is NOT stored here — it keeps
   using the key from js/app.js ('acc_system_data_v1__<companyId>'
   locally, 'ERP_COMPANIES/<companyId>' on Firebase). See
   migrateLegacyDataIfNeeded() in js/auth.js for how data from
   the original single-tenant version (before this multi-tenant
   layer existed) gets picked up automatically.
   ============================================================ */

const NS = {
  companies: 'ahmethod_companies',
  platformUsers: 'ahmethod_platform_users', // the super_admin account
  userIndex: 'ahmethod_user_index',         // { username: {companyId, role} } — login router
  session: 'ahmethod_session',              // persisted current login (local only, not synced)
  legacyMigrated: 'ahmethod_legacy_migrated_v1',
};

function psGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function psSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------- Firebase sync for platform-level data ---------------- */
function fbPlatformRef() {
  return firebase.database().ref('ERP_PLATFORM');
}

// كل جزء بيتخزن على Firebase كنص JSON: عشان Firebase بيرفض المفاتيح اللي فيها
// . $ # [ ] / (مثلًا اسم مستخدم زي a@b.com) وبيمسح المصفوفات/الكائنات الفاضية.
// القراءة بتقبل كمان الشكل القديم (كائن/مصفوفة) عشان أي بيانات اتسجلت قبل كده.
function cloudDecode(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return undefined; } }
  return v;
}

function pushPlatformToCloud() {
  try {
    fbPlatformRef().set({
      companies: JSON.stringify(getCompanies()),
      platformUsers: JSON.stringify(getPlatformUsers()),
      userIndex: JSON.stringify(getUserIndex()),
    }).catch(err => {
      console.error('فشلت مزامنة بيانات المنصة (الشركات/المستخدمين) مع Firebase', err);
    });
  } catch (e) {
    // Firebase قد لا يكون جاهزًا بعد لحظة أول استدعاء — يتجاهل بأمان
  }
}

// يُستدعى مرة واحدة عند فتح الصفحة، قبل أي شيء آخر، عشان نضمن إن أي
// شركة أو مستخدم اتسجل من جهاز تاني يظهر هنا كمان.
function loadPlatformFromCloud(onReady) {
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(timer); if (onReady) onReady(); };
  // لو النت مقطوع Firebase بيفضل معلّق — بعد 6 ثواني نكمل بآخر نسخة محلية
  const timer = setTimeout(finish, 6000);
  try {
    fbPlatformRef().once('value').then(snap => {
      if (done) return;
      const remote = snap.val();
      if (remote) {
        const companies = cloudDecode(remote.companies);
        const platformUsers = cloudDecode(remote.platformUsers);
        const userIndex = cloudDecode(remote.userIndex);
        if (companies) psSet(NS.companies, Array.isArray(companies) ? companies : Object.values(companies));
        if (platformUsers) psSet(NS.platformUsers, Array.isArray(platformUsers) ? platformUsers : Object.values(platformUsers));
        if (userIndex) psSet(NS.userIndex, userIndex);
      }
      finish();
    }).catch(err => {
      console.error('تعذر تحميل بيانات المنصة من Firebase — سيتم استخدام آخر نسخة محلية', err);
      finish();
    });
  } catch (e) {
    finish();
  }
}

function getCompanies() { return psGet(NS.companies, []); }
function saveCompanies(list) { psSet(NS.companies, list); pushPlatformToCloud(); }
function getCompanyById(id) { return getCompanies().find(c => c.id === id) || null; }

function getPlatformUsers() { return psGet(NS.platformUsers, []); }
function savePlatformUsers(list) { psSet(NS.platformUsers, list); pushPlatformToCloud(); }

function getUserIndex() { return psGet(NS.userIndex, {}); }
function saveUserIndex(idx) { psSet(NS.userIndex, idx); pushPlatformToCloud(); }

function getSession() { return psGet(NS.session, null); }
function saveSession(s) { psSet(NS.session, s); }
function clearSessionStorage() { localStorage.removeItem(NS.session); }
