// ══════════════════════════════════════════════════════════
// driver-shared.js — أدوات مشتركة بين كل صفحات تطبيق السائق
// (akleto-driver.html, akleto-driver-home.html, akleto-driver-orders.html,
//  akleto-driver-deliveries.html, akleto-driver-account.html)
// ══════════════════════════════════════════════════════════
import {
  db, doc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  serverTimestamp, withTimeout, addDoc
} from "./firebase-init.js";

export const DRIVER_STORAGE_KEY = 'akleto_driver_id';
export const DRIVER_NAME_KEY = 'akleto_driver_name';
export const DRIVER_PHONE_KEY = 'akleto_driver_phone';
export const DRIVER_AVAIL_KEY = 'akleto_driver_available';
export const DRIVER_SHIFT_ID_KEY = 'akleto_driver_shift_id';
export const DRIVER_NOTIF_SEEN_KEY = 'akleto_driver_notif_seen';

// ⚠️ قيمة عمولة افتراضية احتياطية (تُستخدم فقط لحد ما توصل إعدادات الأدمن الفعلية من Firestore،
// أو لو الأدمن لسا ما حفظ أي إعداد). القيمة الحقيقية تُدار الآن من لوحة الأدمن
// (akleto-admin-settings.html → مستند app_settings/commissions) وتنعكس تلقائياً هون عبر watchCommissionSettings().
let _commissionConfig = { type: 'percentage', value: 0.10 };
let _commissionUnsub = null;

// يبدأ الاستماع الحي لإعدادات العمولة من Firestore — يُستدعى مرة وحدة بأي صفحة بتحسب أرباح/عمولة
export function watchCommissionSettings(cb) {
  if (_commissionUnsub) { if (cb) cb(_commissionConfig); return _commissionUnsub; }
  const ref = doc(db, 'app_settings', 'commissions');
  _commissionUnsub = onSnapshot(ref, snap => {
    if (snap.exists()) {
      const d = snap.data();
      _commissionConfig = {
        type: d.driver_commission_type === 'fixed' ? 'fixed' : 'percentage',
        value: typeof d.driver_commission_value === 'number' ? d.driver_commission_value : 0.10
      };
    }
    if (cb) cb(_commissionConfig);
  }, err => { console.error('commission settings watch error', err); if (cb) cb(_commissionConfig); });
  return _commissionUnsub;
}

export function getCommissionConfig() { return _commissionConfig; }

/* ═══ الجلسة ═══ */
export function getDriverSession() {
  const id = localStorage.getItem(DRIVER_STORAGE_KEY);
  if (!id) return null;
  return {
    id,
    name: localStorage.getItem(DRIVER_NAME_KEY) || '',
    phone: localStorage.getItem(DRIVER_PHONE_KEY) || ''
  };
}

// يتأكد إنه في جلسة سائق محفوظة، وإلا يرجّع لصفحة الدخول
export function requireDriverSession() {
  const s = getDriverSession();
  if (!s) { window.location.href = 'akleto-driver.html'; return null; }
  return s;
}

export function saveDriverSession(id, name, phone) {
  localStorage.setItem(DRIVER_STORAGE_KEY, id);
  localStorage.setItem(DRIVER_NAME_KEY, name);
  localStorage.setItem(DRIVER_PHONE_KEY, phone);
}

export function logoutDriver() {
  localStorage.removeItem(DRIVER_STORAGE_KEY);
  localStorage.removeItem(DRIVER_NAME_KEY);
  localStorage.removeItem(DRIVER_PHONE_KEY);
  localStorage.removeItem(DRIVER_AVAIL_KEY);
  window.location.href = 'akleto-driver.html';
}

export async function deleteDriverAccountById(driverId) {
  await withTimeout(deleteDoc(doc(db, 'drivers', driverId)), 15000, 'انتهت مهلة الحذف — تأكد من الإنترنت');
  localStorage.removeItem(DRIVER_STORAGE_KEY);
  localStorage.removeItem(DRIVER_NAME_KEY);
  localStorage.removeItem(DRIVER_PHONE_KEY);
  localStorage.removeItem(DRIVER_AVAIL_KEY);
  window.location.href = 'akleto-driver.html';
}

/* ═══ عرض ═══ */
export function ticketCode(id) { return '#' + (id || '----').slice(-4).toUpperCase(); }

export function timeAgo(ts) {
  if (!ts || !ts.toDate) return '—';
  const diffMs = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} س`;
  return `قبل ${Math.floor(hrs / 24)} يوم`;
}

export function timeAgoNotif(ts) {
  if (!ts || !ts.toDate) return '—';
  const d = ts.toDate();
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'الآن';
  if (diffSec < 3600) return `منذ ${Math.floor(diffSec / 60)} دقيقة`;
  if (diffSec < 86400) return `منذ ${Math.floor(diffSec / 3600)} ساعة`;
  if (diffSec < 2592000) return `منذ ${Math.floor(diffSec / 86400)} يوم`;
  return d.toLocaleDateString('ar-JO');
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ═══ التوفر (متاح/غير متاح) + الموقع الحي ═══ */
export function setDriverAvailability(driverId, isAvailable, coords) {
  const payload = { is_available: isAvailable, availability_updated_at: serverTimestamp() };
  if (coords) {
    payload.lat = coords.lat;
    payload.lng = coords.lng;
    payload.location_updated_at = serverTimestamp();
  }
  return updateDoc(doc(db, 'drivers', driverId), payload);
}

export function updateDriverLocation(driverId, lat, lng) {
  return updateDoc(doc(db, 'drivers', driverId), { lat, lng, location_updated_at: serverTimestamp() })
    .catch(e => console.error('update driver location error', e));
}

/* ═══ الإشعارات (بث عام + رسائل موجهة للسائق) ═══ */
export function watchDriverNotifs(driverId, cb) {
  const buckets = { all: [], mine: [] };
  const merge = () => {
    const combined = [...buckets.all, ...buckets.mine].sort(
      (a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0)
    );
    cb(combined);
  };
  const qAll = query(collection(db, 'user_notifications'), where('audience', '==', 'all_drivers'));
  const qMine = query(collection(db, 'user_notifications'), where('audience', '==', 'driver'), where('target_id', '==', driverId));
  const u1 = onSnapshot(qAll, snap => { buckets.all = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); }, e => console.error('notif all_drivers error', e));
  const u2 = onSnapshot(qMine, snap => { buckets.mine = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); }, e => console.error('notif driver error', e));
  return () => { u1(); u2(); };
}

export function updateNotifBadge(notifItems) {
  const seen = parseInt(localStorage.getItem(DRIVER_NOTIF_SEEN_KEY) || '0', 10);
  const unread = (notifItems || []).filter(n => (n.created_at?.toMillis?.() || 0) > seen).length;
  document.querySelectorAll('.bell-dot').forEach(d => d.classList.toggle('hidden', unread === 0));
}

export function renderNotifList(wrapId, notifItems) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  if (!notifItems.length) {
    wrap.innerHTML = `<div class="empty-state-c" style="padding:30px 0;">ولا إشعار لسا 🔕</div>`;
    return;
  }
  wrap.innerHTML = notifItems.map(n => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:10px;">
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;">${n.title || ''}</div>
      <div style="font-size:13px;color:var(--text30);line-height:1.5;">${n.message || ''}</div>
      <div style="font-size:11px;color:var(--text30);margin-top:6px;">${timeAgoNotif(n.created_at)}</div>
    </div>`).join('');
}

/* ═══ الطلبات ═══ */
export function watchAvailableOrders(cb) {
  const q = query(collection(db, 'orders'), where('status', '==', 'ready'));
  return onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.created_at?.toMillis?.() || 0) - (b.created_at?.toMillis?.() || 0));
    cb(list);
  }, err => { console.error('available orders error', err); cb([]); });
}

export function watchMyOrders(driverId, cb) {
  const q = query(collection(db, 'orders'), where('driver_id', '==', driverId));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('my orders error', err));
}

/* ═══ خريطة السائق: طلبات نشطة تجمّعت عند متاجر (نقاط تكاثر) ═══ */
export function watchHotspotOrders(cb) {
  const q = query(collection(db, 'orders'), where('status', 'in', ['pending', 'preparing', 'ready']));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('hotspot orders error', err));
}

/* ═══ خريطة السائق: بقية السائقين المتاحين حالياً (حركة لايف) ═══ */
export function watchActiveDrivers(cb) {
  const q = query(collection(db, 'drivers'), where('is_available', '==', true));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('active drivers error', err));
}

/* ═══ حساب أرباح/عمولة/مستحقات طلب واحد ═══ */
// الكابتن ياخذ كامل مبلغ الطلب كاش (COD) وقت التسليم، وبيحتفظ برسوم التوصيل + الإكرامية،
// وبيسدد الباقي لأكليتو، بعد ما تُخصم عمولة أكليتو (من إعدادات الأدمن) من (رسوم التوصيل + الإكرامية).
// ⚠️ استثناء: لو الطلب مدفوع أونلاين (بطاقة) بدل الكاش، الزبون دفع لأكليتو مباشرة —
// فالكابتن أصلاً ما استلم أي كاش بيده، فـ"المستحق منه" = صفر لهاد الطلب (العمولة والأرباح بتنحسب عادي لأنها متعلقة بشغل التوصيل نفسه).
export function computeOrderFinancials(order) {
  const collected = order.total_estimated_price || 0;      // الكاش اللي أخذه الكابتن من الزبون (لو COD)
  const deliveryFee = order.delivery_fee || 0;
  const tip = order.driver_tip || 0;
  const grossEarning = deliveryFee + tip;                   // نصيب الكابتن قبل العمولة
  const cfg = _commissionConfig;
  const commission = cfg.type === 'fixed'
    ? Math.round(Math.min(cfg.value, grossEarning) * 100) / 100   // ما تتجاوز العمولة نصيب الكابتن نفسه
    : Math.round(grossEarning * cfg.value * 100) / 100;
  const netProfit = Math.round((grossEarning - commission) * 100) / 100; // صافي ربح الكابتن
  const isOnlinePaid = order.payment_method === 'card' || order.payment_method === 'online';
  const owed = isOnlinePaid ? 0 : Math.round((collected - netProfit) * 100) / 100; // المستحق لأكليتو
  return { collected, deliveryFee, tip, grossEarning, commission, netProfit, owed, isOnlinePaid };
}

// تجميع الحسابات المالية لمجموعة طلبات (لتقارير العمل)
export function aggregateOrderFinancials(orders) {
  const totals = { count: orders.length, collected: 0, commission: 0, netProfit: 0, owed: 0 };
  orders.forEach(o => {
    const f = computeOrderFinancials(o);
    // "الكاش بالجيب" ما بيشمل إلا الطلبات اللي فعلاً الكابتن قبض كاشها (COD) —
    // الطلبات المدفوعة أونلاين ما مرّ كاشها بإيد الكابتن أصلاً
    if (!f.isOnlinePaid) totals.collected += f.collected;
    totals.commission += f.commission;
    totals.netProfit += f.netProfit;
    totals.owed += f.owed;
  });
  totals.collected = Math.round(totals.collected * 100) / 100;
  totals.commission = Math.round(totals.commission * 100) / 100;
  totals.netProfit = Math.round(totals.netProfit * 100) / 100;
  totals.owed = Math.round(totals.owed * 100) / 100;
  return totals;
}

/* ═══ ورديات العمل (لحساب ساعات العمل والمسافة المقطوعة) ═══ */
// تُنشأ وردية جديدة كل ما يفعّل الكابتن "متاح"، وتُقفل لما يوقف التوفر.
// ⚠️ لو سكّر المتصفح فجأة بدون ما يضغط "غير متاح"، الوردية بتضل مفتوحة (end_at فاضي) —
// نفس القيد الموثّق سابقاً بمشكلة is_available. تقارير الساعات بتحسب بس الورديات المقفولة.
export async function startShift(driverId) {
  try {
    const ref = await addDoc(collection(db, 'driver_shifts'), {
      driver_id: driverId, start_at: serverTimestamp(), end_at: null, distance_km: 0
    });
    return ref.id;
  } catch (e) { console.error('start shift error', e); return null; }
}

export async function endShift(shiftId, distanceKm) {
  if (!shiftId) return;
  try {
    await updateDoc(doc(db, 'driver_shifts', shiftId), {
      end_at: serverTimestamp(), distance_km: Math.round((distanceKm || 0) * 100) / 100
    });
  } catch (e) { console.error('end shift error', e); }
}

export function watchDriverShifts(driverId, cb) {
  const q = query(collection(db, 'driver_shifts'), where('driver_id', '==', driverId));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('shifts watch error', err));
}

// المسافة بالكيلومتر بين نقطتين (صيغة Haversine) — تُستخدم لحساب المسافة المقطوعة أثناء الوردية
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function setNavBadge(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
  else { el.classList.add('hidden'); }
}
