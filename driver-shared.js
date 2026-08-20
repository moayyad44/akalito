// ══════════════════════════════════════════════════════════
// driver-shared.js — أدوات مشتركة بين كل صفحات تطبيق السائق
// (akleto-driver.html, akleto-driver-home.html, akleto-driver-orders.html,
//  akleto-driver-deliveries.html, akleto-driver-account.html)
// ══════════════════════════════════════════════════════════
import {
  db, doc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  serverTimestamp, withTimeout, addDoc, getDoc, getDocs, runTransaction,
  auth, onAuthStateChanged, signInAnonymously
} from "./firebase-init.js";

/* ══════════════════════════════════════════════════════════
   نغمة تنبيه "طلب جديد" — 15 أغسطس 2026 (مهمة #1 بالbacklog)
   → طُوّرت لاحقاً بنفس اليوم لتصير "بصمة صوتية" مميّزة خاصة بأكليتو
     بدل نمط "دينغ-دونغ" عام، بناءً على طلب مؤيد.
   بنولّد الصوت بالكامل من الصفر عبر Web Audio API — بدون أي ملف mp3
   أو عيّنة (sample) خارجية، فما فيها أي حقوق ملكية لأي طرف تالت.
   لهيك سريعة (بدون طلب شبكة) وما بتحتاج نستضيف أي أصل صوتي بالريبو
   ولا نعدّل إعدادات Capacitor.

   البصمة الصوتية (Akalito Sound Signature):
   عبارة لحنية صاعدة من 4 نغمات قصيرة تنتهي بنغمة رابعة أطول وأبرز
   ("تن-تن-تن-تِـن!") — إحساس إيجابي/متفائل (فرصة ربح جديدة وصلت)،
   بطبقة صوت جرسية (bell-like) عبر دمج موجة مثلثية (triangle) كأساس
   + توافقي (harmonic) موجة جيبية أعلى بأوكتاف بحجم أخف، بدل نغمة
   جيبية بسيطة — هاد اللي يعطيها طابع مميّز وليس صوت تنبيه عام.
   تتكرر العبارة كل 1.4 ثانية تقريباً (~7 مرات) لتغطي 10 ثواني كاملة.
   ملاحظة متصفحات الموبايل: AudioContext ما بيشتغل قبل أول تفاعل مستخدم
   حقيقي (autoplay policy) — لهيك لازم نستدعي unlockNewOrderAlertAudio()
   مرة وحدة داخل معالج ضغطة زر حقيقي (استُدعيت من toggleAvailability
   بصفحة الخريطة) قبل ما نحاول نشغّل الصوت لاحقاً بدون تفاعل مباشر
   (لما يوصل عرض طلب عبر Firestore listener). ══════════════════════ */
let _noaCtx = null;
let _noaActiveTimers = [];

export function unlockNewOrderAlertAudio() {
  try {
    if (!_noaCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _noaCtx = new AC();
    }
    if (_noaCtx.state === 'suspended') _noaCtx.resume();
  } catch (e) { console.error('unlockNewOrderAlertAudio error', e); }
}

/* نغمة جرسية (bell-like) واحدة: أساس مثلثي + توافقي جيبي بأوكتاف أعلى
   بحجم أخف — هاد المزيج هو اللي يعطي طابع "أكليتو" المميّز بدل نغمة
   جيبية عادية مسطّحة. peakGain يتحكم بمدى بروز النغمة (نستخدمه لجعل
   آخر نغمة بالعبارة أعلى صوت شوي من الثلاث اللي قبلها). */
function _noaNote(ctx, startAt, freq, durationSec, peakGain = 0.32) {
  const fundamental = ctx.createOscillator();
  const harmonic = ctx.createOscillator();
  const fundGain = ctx.createGain();
  const harmGain = ctx.createGain();
  const master = ctx.createGain();

  fundamental.type = 'triangle';
  fundamental.frequency.value = freq;
  harmonic.type = 'sine';
  harmonic.frequency.value = freq * 2; // أوكتاف أعلى — يعطي لمعان جرسي خفيف

  fundGain.gain.value = 1;
  harmGain.gain.value = 0.28;

  // انطلاقة سريعة (attack) وخبوّ طبيعي (decay) — إحساس "نقرة جرس" مش نغمة مسطّحة
  master.gain.setValueAtTime(0, startAt);
  master.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
  master.gain.exponentialRampToValueAtTime(Math.max(peakGain * 0.15, 0.001), startAt + durationSec * 0.7);
  master.gain.linearRampToValueAtTime(0, startAt + durationSec);

  fundamental.connect(fundGain); fundGain.connect(master);
  harmonic.connect(harmGain); harmGain.connect(master);
  master.connect(ctx.destination);

  fundamental.start(startAt); fundamental.stop(startAt + durationSec);
  harmonic.start(startAt); harmonic.stop(startAt + durationSec);
}

/* العبارة اللحنية الصاعدة الموحّدة — "تن-تن-تن-تِـن!" */
const AKALITO_ALERT_MOTIF = [
  { freq: 659.25, offset: 0.00, duration: 0.16, peakGain: 0.28 }, // E5
  { freq: 783.99, offset: 0.13, duration: 0.16, peakGain: 0.28 }, // G5
  { freq: 987.77, offset: 0.26, duration: 0.16, peakGain: 0.30 }, // B5
  { freq: 1318.51, offset: 0.40, duration: 0.38, peakGain: 0.38 }, // E6 — النغمة الختامية البارزة
];
const AKALITO_ALERT_MOTIF_CYCLE_SEC = 1.4; // مدة العبارة + فترة صمت قبل التكرار

function _noaPlayMotifAt(ctx, motifStartAt) {
  AKALITO_ALERT_MOTIF.forEach(note => {
    _noaNote(ctx, motifStartAt + note.offset, note.freq, note.duration, note.peakGain);
  });
}

/* بتشغّل البصمة الصوتية متكررة لمدة 10 ثواني بالضبط، وبترجع دالة توقيف
   فورية (نستخدمها لو قُبل الطلب أو اختفى العرض قبل ما تخلص العشر ثواني). */
export function playNewOrderAlertSound() {
  try {
    stopNewOrderAlertSound(); // نضمن ما في نغمة سابقة لسا شغالة فوق بعضها (بيقفل أي context قديم)
    unlockNewOrderAlertAudio(); // بيفتح context جديد بما إنه القديم انقفل بالسطر فوق
    if (!_noaCtx) return () => {};
    const ctx = _noaCtx;
    const totalSec = 10;
    const cycles = Math.ceil(totalSec / AKALITO_ALERT_MOTIF_CYCLE_SEC);
    for (let i = 0; i < cycles; i++) {
      const motifStartAt = ctx.currentTime + i * AKALITO_ALERT_MOTIF_CYCLE_SEC;
      if (i * AKALITO_ALERT_MOTIF_CYCLE_SEC < totalSec) _noaPlayMotifAt(ctx, motifStartAt);
    }
    const timer = setTimeout(() => { _noaActiveTimers = _noaActiveTimers.filter(t => t !== timer); }, totalSec * 1000 + 100);
    _noaActiveTimers.push(timer);
    return stopNewOrderAlertSound;
  } catch (e) { console.error('playNewOrderAlertSound error', e); return () => {}; }
}

export function stopNewOrderAlertSound() {
  _noaActiveTimers.forEach(t => clearTimeout(t));
  _noaActiveTimers = [];
  // ما نقدر نلغي oscillators مجدولة مسبقاً بمنتصف تشغيلها بسهولة بـWeb Audio API،
  // فبنقفل ونفتح الـcontext نفسه لقطع أي صوت شغال فوراً (طريقة موثوقة ومباشرة).
  if (_noaCtx) {
    try { _noaCtx.close(); } catch (e) {}
    _noaCtx = null;
  }
}

export const DRIVER_STORAGE_KEY = 'akleto_driver_id';
export const DRIVER_NAME_KEY = 'akleto_driver_name';
export const DRIVER_PHONE_KEY = 'akleto_driver_phone';
export const DRIVER_AVAIL_KEY = 'akleto_driver_available';
export const DRIVER_SHIFT_ID_KEY = 'akleto_driver_shift_id';
export const DRIVER_NOTIF_SEEN_KEY = 'akleto_driver_notif_seen';

/* ══════════════════════════════════════════════════════════
   Auth حقيقي (Firebase Anonymous Auth) — 11 أغسطس 2026
   كل جهاز سائق ياخد uid ثابت من Firebase نفسه (مجاني، بدون SMS)،
   يُربط بحقل auth_uid على مستند السائق. هالـuid هو أساس قواعد
   أمان Firestore الجديدة لمجموعة drivers (بدل الاعتماد الكامل
   على رقم الهاتف المُدخل بالتطبيق بدون أي تحقق فعلي).
   ══════════════════════════════════════════════════════════ */
let _driverAuthPromise = null;

/* يضمن وجود جلسة Firebase Auth (تسجّل دخول مجهول تلقائياً لو ما في)، ويرجع الـuid */
export function ensureDriverAuth() {
  if (_driverAuthPromise) return _driverAuthPromise;
  _driverAuthPromise = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(user.uid); }
    }, (e) => { console.error('driver auth state error', e); reject(e); });
    if (!auth.currentUser) {
      signInAnonymously(auth).catch((e) => { console.error('anonymous sign-in error', e); reject(e); });
    }
  });
  return _driverAuthPromise;
}

/* يربط جلسة Auth الحالية بمستند سائق موجود — يُستدعى بعد نجاح تسجيل الدخول.
   لو السائق قديم (auth_uid لسا فاضي)، هاي أول مرة بتتربط فيها هويته فعلياً. */
export async function linkDriverAuthUid(driverId) {
  try {
    const uid = await ensureDriverAuth();
    await updateDoc(doc(db, 'drivers', driverId), { auth_uid: uid });
  } catch (e) {
    console.error('link driver auth uid error', e);
  }
}

/* ══════════════════════════════════════════════════════════
   نظام تسجيل حساب السائق + الدخول برقم الهاتف
   حالات المراجعة: pending (قيد المراجعة) / approved (مقبول) / rejected (مرفوض)
   ══════════════════════════════════════════════════════════ */
export const APPROVAL_PENDING = 'pending';
export const APPROVAL_APPROVED = 'approved';
export const APPROVAL_REJECTED = 'rejected';

/* يبحث عن سائق برقم هاتفه — يرجع أول نتيجة أو null. يُستخدم بالتسجيل (منع تكرار) وبالدخول. */
export async function findDriverByPhone(phone) {
  const q = query(collection(db, 'drivers'), where('phone', '==', phone));
  const snap = await withTimeout(getDocs(q), 15000, 'انتهت مهلة الاتصال — تأكد من الإنترنت');
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/* ينشئ حساب سائق جديد بحالة "قيد المراجعة" */
export async function createDriverAccount(data) {
  const authUid = await ensureDriverAuth();
  const payload = {
    name: data.name,
    phone: data.phone,
    vehicle_type: data.vehicle_type,
    vehicle_make_model: data.vehicle_make_model || '',
    plate_number: data.plate_number,
    photo_url: data.photo_url,
    id_front_url: data.id_front_url,
    id_back_url: data.id_back_url,
    license_url: data.license_url,
    vehicle_license_front_url: data.vehicle_license_front_url,
    vehicle_license_back_url: data.vehicle_license_back_url,
    clearance_certificate_url: data.clearance_certificate_url,
    iban: data.iban || '',
    approval_status: APPROVAL_PENDING,
    is_active: true,
    is_available: false,
    deliveries_count: 0,
    auth_uid: authUid,
    created_at: serverTimestamp()
  };
  const ref = await withTimeout(addDoc(collection(db, 'drivers'), payload), 20000, 'انتهت مهلة الحفظ — تأكد من الإنترنت');

  addDoc(collection(db, 'admin_notifications'), {
    type: 'driver_signup',
    title: `طلب تسجيل سائق جديد`,
    message: `${data.name || 'سائق جديد'} قدّم طلب انضمام (${data.phone || ''}) — بانتظار المراجعة`,
    related_id: ref.id,
    created_at: serverTimestamp(),
    read: false
  }).catch(e => console.error('admin_notifications write error', e));

  return ref.id;
}

/* يحدّث طلب سائق مرفوض سابقاً ببيانات جديدة ويرجّعه لحالة "قيد المراجعة" — بدل ما ينشئ سجل مكرر */
export async function resubmitDriverAccount(driverId, data) {
  const payload = {
    name: data.name,
    phone: data.phone,
    vehicle_type: data.vehicle_type,
    vehicle_make_model: data.vehicle_make_model || '',
    plate_number: data.plate_number,
    photo_url: data.photo_url,
    id_front_url: data.id_front_url,
    id_back_url: data.id_back_url,
    license_url: data.license_url,
    vehicle_license_front_url: data.vehicle_license_front_url,
    vehicle_license_back_url: data.vehicle_license_back_url,
    clearance_certificate_url: data.clearance_certificate_url,
    iban: data.iban || '',
    approval_status: APPROVAL_PENDING,
    rejection_reason: '',
    resubmitted_at: serverTimestamp()
  };
  await withTimeout(updateDoc(doc(db, 'drivers', driverId), payload), 20000, 'انتهت مهلة الحفظ — تأكد من الإنترنت');

  addDoc(collection(db, 'admin_notifications'), {
    type: 'driver_signup',
    title: `إعادة تقديم طلب سائق`,
    message: `${data.name || 'سائق'} عدّل طلبه وأعاد إرساله للمراجعة (${data.phone || ''})`,
    related_id: driverId,
    created_at: serverTimestamp(),
    read: false
  }).catch(e => console.error('admin_notifications write error', e));

  return driverId;
}

/* يضيف/يحدّث الآيبان لسائق موجود أصلاً (يُستخدم لو تخطى مرحلة الآيبان بالتسجيل وحبّ يضيفه لاحقاً) */
export function updateDriverIban(driverId, iban) {
  return withTimeout(updateDoc(doc(db, 'drivers', driverId), { iban }), 15000, 'انتهت مهلة الحفظ — تأكد من الإنترنت');
}

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
  stopAvailabilityForegroundNotification(); // احتياط: تفادي إشعار "متاح" عالق لو سجّل خروج بدون ما يوقف التوفر يدوياً أول
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

/* ══════════════════════════════════════════════════════════
   إشعارات الدفع (Push Notifications) — تعمل فقط داخل تطبيق
   أندرويد (APK عبر Capacitor) لتطبيق السائق، ولا تعمل ولا
   تُستدعى أبداً عند فتح الموقع من متصفح عادي (PWA)، لأن
   window.Capacitor غير موجود بهذه الحالة. نفس النمط المستخدم
   بتطبيق الزبون (akleto-customer.html → initPushNotifications).
   ══════════════════════════════════════════════════════════ */
let _driverPushInitDone = false;
export async function initDriverPushNotifications(driverId) {
  if (_driverPushInitDone) return;
  if (!driverId) return;
  const Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return; // مش جوا التطبيق، اطلع بهدوء
  const Push = Capacitor.Plugins && Capacitor.Plugins.PushNotifications;
  if (!Push) return;
  _driverPushInitDone = true;
  try {
    const perm = await Push.requestPermissions();
    if (perm.receive !== 'granted') return;
    await Push.register();

    Push.addListener('registration', async (tokenResult) => {
      try {
        await updateDoc(doc(db, 'drivers', driverId), {
          fcm_token: tokenResult.value,
          fcm_platform: 'android',
          fcm_updated_at: serverTimestamp()
        });
      } catch (e) { console.error('تعذر حفظ توكن إشعارات السائق', e); }
    });

    Push.addListener('registrationError', (err) => {
      console.error('فشل تسجيل إشعارات الدفع للسائق', err);
    });

    // لما السائق يضغط على إشعار وصل (طلب جديد متاح مثلاً)، وديه لصفحة الطلبات المتاحة
    Push.addListener('pushNotificationActionPerformed', () => {
      try { window.location.href = 'akleto-driver-orders.html'; } catch (e) {}
    });
  } catch (e) {
    console.error('خطأ بتهيئة إشعارات الدفع للسائق', e);
  }
}

/* ══════════════════════════════════════════════════════════
   الإشعار الثابت لحالة "متاح للطلبات" (مهمة #4 بالbacklog، 15 أغسطس 2026)
   يشتغل فقط داخل تطبيق أندرويد (نفس شرط إشعارات الدفع فوق) — عبر
   Foreground Service حقيقي بمستوى نظام التشغيل (AvailabilityService.java +
   DriverAvailabilityPlugin.java)، مش مجرد إشعار محلي عادي، عشان يضل
   "ثابت" (Ongoing) وما ينمسح بالسحب لحد ما الكابتن يحوّل حالته يدوياً.
   الـplugin المخصص بيظهر تلقائياً بـwindow.Capacitor.Plugins.DriverAvailability
   بمجرد ما يتسجّل بـMainActivity.java — نفس نمط الوصول لباقي الـplugins.
   ══════════════════════════════════════════════════════════ */
let _availTokenRefreshTimer = null;

export async function startAvailabilityForegroundNotification(driverId) {
  const Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;
  const plugin = Capacitor.Plugins && Capacitor.Plugins.DriverAvailability;
  if (!plugin) return; // نسخة APK قديمة قبل إضافة الـplugin — نتجاهل بهدوء بدون ما نكسر شي
  try {
    let idToken = '';
    // 16 أغسطس 2026 (مهمة #4 — تتبّع موقع أصلي حقيقي): نمرر Firebase ID Token
    // للخدمة الأصلية عشان تقدر تكتب موقع السائق مباشرة لـFirestore بدون
    // الاعتماد على جافاسكربت شغّال (اللي بيتوقف أصلاً لما التطبيق بالخلفية).
    if (auth.currentUser) { try { idToken = await auth.currentUser.getIdToken(); } catch (e) { console.error('getIdToken error', e); } }
    await plugin.start({ driverId: driverId || '', idToken });
  } catch (e) { console.error('startAvailabilityForegroundNotification error', e); }

  // نجدّد التوكن دورياً (صلاحيته ساعة وحدة) طول ما التطبيق بالمقدمة — لو راح
  // للخلفية أكتر من ساعة بدون ما يرجع يفتح، تحديثات الموقع الأصلية بتتوقف
  // بصمت لحد ما يرجع يفتح التطبيق (قيد معروف، موثّق بـcontext.md).
  clearInterval(_availTokenRefreshTimer);
  _availTokenRefreshTimer = setInterval(async () => {
    try {
      if (!auth.currentUser) return;
      const fresh = await auth.currentUser.getIdToken(true);
      const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DriverAvailability;
      if (p && p.refreshToken) await p.refreshToken({ idToken: fresh });
    } catch (e) { console.error('refresh availability token error', e); }
  }, 45 * 60 * 1000); // كل 45 دقيقة
}

export function stopAvailabilityForegroundNotification() {
  clearInterval(_availTokenRefreshTimer);
  _availTokenRefreshTimer = null;
  const Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;
  const plugin = Capacitor.Plugins && Capacitor.Plugins.DriverAvailability;
  if (!plugin) return;
  try { plugin.stop(); } catch (e) { console.error('stopAvailabilityForegroundNotification error', e); }
}

/* ═══ عرض ═══ */
export function ticketCode(id) { return '#' + (id || '----').slice(-4).toUpperCase(); }

/* رقم الطلب المعروض — يفضّل الرقم التسلسلي الحقيقي order_number (5 خانات، #00014) لو موجود بالطلب،
   وإلا يرجع للطريقة القديمة (مشتقة من معرّف الطلب) للطلبات القديمة اللي اتسجلت قبل إضافة العداد التسلسلي. */
export function orderDisplayCode(order) {
  if (order && order.order_number) return '#' + String(order.order_number).padStart(5, '0');
  return ticketCode(order && order.id);
}

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

/* ═══ الطلبات — توزيع بالدور ═══
   كل طلب "جاهز" (ready) بيتعرض بالدور على أقرب سائق متاح (عبر Cloud Functions)
   عن طريق حقلين على مستند الطلب: offered_driver_id (مين معروض عليه حالياً)
   و offer_expires_at (وقت انتهاء مهلة العرض (OFFER_WINDOW_SECONDS بالسيرفر)). لو ما قبِل خلال المهلة،
   السيرفر بيدوّره تلقائياً لسائق تاني. لو خلصت قائمة السائقين المتاحين
   بدون قبول، الطلب يصير "مفتوح للجميع" (offer_broadcast: true) كخط أمان. */

/* الطلب المعروض شخصياً على هالسائق حالياً (لو في) — يُستخدم بحاوية "طلب جديد" بشاشة الخريطة */
export function watchMyOrderOffer(driverId, cb) {
  const q = query(collection(db, 'orders'), where('offered_driver_id', '==', driverId), where('status', '==', 'ready'));
  return onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.offer_expires_at?.toMillis?.() || 0) - (b.offer_expires_at?.toMillis?.() || 0));
    cb(list[0] || null);
  }, err => { console.error('my order offer error', err); cb(null); });
}

/* قائمة الطلبات المتاحة لهالسائق: المعروضة عليه شخصياً بالدور + المفتوحة للجميع (Broadcast) — لصفحة "الطلبات المتاحة" وشارة العداد */
export function watchAvailableOrders(driverId, cb) {
  const buckets = { mine: [], broadcast: [] };
  const merge = () => {
    const seen = new Set();
    const combined = [...buckets.mine, ...buckets.broadcast].filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)));
    combined.sort((a, b) => (a.created_at?.toMillis?.() || 0) - (b.created_at?.toMillis?.() || 0));
    cb(combined);
  };
  const qMine = query(collection(db, 'orders'), where('offered_driver_id', '==', driverId), where('status', '==', 'ready'));
  const qBroadcast = query(collection(db, 'orders'), where('offer_broadcast', '==', true), where('status', '==', 'ready'));
  const u1 = onSnapshot(qMine, snap => { buckets.mine = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); }, err => console.error('available orders (offered) error', err));
  const u2 = onSnapshot(qBroadcast, snap => { buckets.broadcast = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); }, err => console.error('available orders (broadcast) error', err));
  return () => { u1(); u2(); };
}

/* استلام طلب (سواء معروض شخصياً بالدور أو مفتوح للجميع) — عملية ذرية، أول سائق يعمل commit ياخد الطلب */
export async function claimOrderTransaction(orderId, session) {
  await runTransaction(db, async (tx) => {
    const orderRef = doc(db, 'orders', orderId);
    const snap = await tx.get(orderRef);
    if (!snap.exists() || snap.data().status !== 'ready') throw new Error('TAKEN');
    tx.update(orderRef, {
      status: 'delivering', driver_id: session.id, driver_name: session.name,
      driver_phone: session.phone, picked_up_at: serverTimestamp(),
      driver_flow_stage: 'to_store'
    });
  });
  addDoc(collection(db, 'admin_notifications'), {
    type: 'order_claimed',
    title: `طلب استلمه سائق ${orderDisplayCode({ id: orderId })}`,
    message: `${session.name || 'سائق'} استلم طلب وبده يوصّله`,
    related_id: orderId, created_at: serverTimestamp(), read: false
  }).catch(e => console.error('admin_notifications write error', e));
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
  const totals = { count: orders.length, collected: 0, commission: 0, netProfit: 0, owed: 0, owedToDriver: 0 };
  orders.forEach(o => {
    const f = computeOrderFinancials(o);
    // "الكاش بالجيب" ما بيشمل إلا الطلبات اللي فعلاً الكابتن قبض كاشها (COD) —
    // الطلبات المدفوعة أونلاين ما مرّ كاشها بإيد الكابتن أصلاً
    if (!f.isOnlinePaid) totals.collected += f.collected;
    totals.commission += f.commission;
    totals.netProfit += f.netProfit;
    totals.owed += f.owed;
    // لو الطلب مدفوع أونلاين، الكابتن أدّى شغل التوصيل بس ما قبض كاش —
    // فأكليتو أصبحت مدينة له بصافي ربحه (رسوم توصيل + إكرامية بعد العمولة)
    if (f.isOnlinePaid) totals.owedToDriver += f.netProfit;
  });
  totals.collected = Math.round(totals.collected * 100) / 100;
  totals.commission = Math.round(totals.commission * 100) / 100;
  totals.netProfit = Math.round(totals.netProfit * 100) / 100;
  totals.owed = Math.round(totals.owed * 100) / 100;
  totals.owedToDriver = Math.round(totals.owedToDriver * 100) / 100;
  return totals;
}

/* ═══ الرصيد الصافي (تسديدات/تحويلات فعلية) — Collection جديد driver_balance_transactions ═══ */
// كل معاملة: { driver_id, driver_name, type: 'settlement'|'payout', amount, status: 'pending'|'completed'|'rejected', created_at, resolved_at }
// 'settlement' = الكابتن سدّد مبلغ لأكليتو (يقلل owedByDriver). 'payout' = أكليتو حوّلت مبلغ للكابتن (يقلل owedToDriver).
// ⚠️ فقط المعاملات status:'completed' تُحتسب بالرصيد — 'pending' لسا ما تأكدت من الإدارة (لأنه ما في بوابة دفع فعلية حالياً).
export function watchDriverBalanceTransactions(driverId, cb) {
  const q = query(collection(db, 'driver_balance_transactions'), where('driver_id', '==', driverId));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('balance tx watch error', err));
}

export function createSettlementRequest(driverId, driverName, amount) {
  const amt = Math.round(amount * 100) / 100;
  addDoc(collection(db, 'admin_notifications'), {
    type: 'driver_settlement_request',
    title: `سائق سدّد عمولة أكليتو`,
    message: `${driverName || 'سائق'} سدّد ${amt.toFixed(2)} د.أ من المستحق عليه — بانتظار التأكيد`,
    related_id: driverId,
    created_at: serverTimestamp(),
    read: false
  }).catch(e => console.error('admin_notifications write error', e));
  return addDoc(collection(db, 'driver_balance_transactions'), {
    driver_id: driverId, driver_name: driverName || '', type: 'settlement',
    amount: amt, status: 'pending', created_at: serverTimestamp()
  });
}

export function createPayoutRequest(driverId, driverName, amount) {
  const amt = Math.round(amount * 100) / 100;
  addDoc(collection(db, 'admin_notifications'), {
    type: 'driver_payout_request',
    title: `سائق طالب بتحويل مستحقاته`,
    message: `${driverName || 'سائق'} طلب تحويل ${amt.toFixed(2)} د.أ من أكليتو`,
    related_id: driverId,
    created_at: serverTimestamp(),
    read: false
  }).catch(e => console.error('admin_notifications write error', e));
  return addDoc(collection(db, 'driver_balance_transactions'), {
    driver_id: driverId, driver_name: driverName || '', type: 'payout',
    amount: amt, status: 'pending', created_at: serverTimestamp()
  });
}

// يجمع أثر المعاملات المكتملة فقط على الرصيد الصافي، ويرجّع الرصيد النهائي بعد طرحها
// net > 0 → الكابتن مدين لأكليتو. net < 0 → أكليتو مدينة للكابتن. net = 0 → متوازن.
export function computeNetBalance(orderTotals, transactions) {
  let settledByDriver = 0, paidToDriver = 0;
  (transactions || []).forEach(t => {
    if (t.status !== 'completed') return;
    if (t.type === 'settlement') settledByDriver += (t.amount || 0);
    else if (t.type === 'payout') paidToDriver += (t.amount || 0);
  });
  const owedByDriver = Math.max(0, Math.round((orderTotals.owed - settledByDriver) * 100) / 100);
  const owedToDriver = Math.max(0, Math.round((orderTotals.owedToDriver - paidToDriver) * 100) / 100);
  const net = Math.round((owedByDriver - owedToDriver) * 100) / 100;
  return { owedByDriver, owedToDriver, net };
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

/* ══════════════════════════════════════════════════════════
   شاشة الطلب النشط الكاملة (Active Order Guard)
   تُركّب بكل صفحات السائق بعد الدخول (mountActiveOrderGuard(session))
   وتظهر تلقائياً وتغطي كل الشاشة لما يكون عند السائق طلب "delivering"
   أو طلب "done" لسا ما قيّمه — وتضل موجودة لحد ما يخلص كل المراحل،
   حتى لو سكّر التطبيق وفتحه من جديد (الحالة محفوظة بـ Firestore مش بذاكرة الجهاز).
   المراحل: 1) توجه للمتجر 2) استلام من المتجر 3) توجه للعميل
            4) تسليم الطلب 5) إيصال/ملخص مالي 6) تقييم التجربة
   ══════════════════════════════════════════════════════════ */

// ⚠️ رقم دعم مؤقت للتواصل عند "الإبلاغ عن مشكلة" — لازم يتحدث برقم دعم أكليتو الحقيقي
export const SUPPORT_PHONE = '+962790000000';

const AOG_PROBLEMS = [
  'المتجر لسا ما جهز الطلب',
  'العميل مش راضي يرد على الاتصال',
  'العنوان غير صحيح أو ما قدرت ألاقيه',
  'صار عندي عطل بالمركبة',
  'مشكلة ثانية'
];

let _aogMounted = false;
let _aogStoreCache = {};
let _aogCurrentOrderId = null;
let _aogLastOrder = null;
let _aogPrevOrderId = null;
let _aogShowRatingFor = null;
let _aogSelectedRating = 0;

function aogInjectStyles() {
  if (document.getElementById('aogStyles')) return;
  const style = document.createElement('style');
  style.id = 'aogStyles';
  style.textContent = `
    #activeOrderGuard { position:fixed; inset:0; z-index:999999; background:var(--bg,#FDF8F3);
      display:flex; flex-direction:column; direction:rtl; font-family:'Cairo',sans-serif; color:var(--text,#3A2A28); }
    #activeOrderGuard.hidden { display:none !important; }
    #activeOrderGuard .mono { font-family:'JetBrains Mono',monospace; }
    .aog-header { padding:calc(env(safe-area-inset-top) + 14px) 20px 12px; display:flex; align-items:center;
      justify-content:space-between; gap:10px; border-bottom:1px solid var(--border,#EBE0D3); background:var(--surface,#FFFFFE); flex-shrink:0; }
    .aog-header-code-group { display:flex; align-items:center; gap:10px; }
    .aog-code { font-size:13px; color:var(--text30,#9C8C82); }
    .aog-body { flex:1; overflow-y:auto; padding:20px; -webkit-overflow-scrolling:touch; }
    .aog-title { font-family:'Tajawal',sans-serif; font-weight:800; font-size:20px; margin-bottom:6px; }
    .aog-sub { color:var(--text30,#9C8C82); font-size:13px; margin-bottom:18px; }
    .aog-card { background:var(--surface,#FFFFFE); border:1px solid var(--border,#EBE0D3); border-radius:16px; padding:6px 18px; margin-bottom:14px; }
    .aog-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; border-bottom:1px solid var(--border,#EBE0D3); font-size:14px; }
    .aog-row:last-child { border-bottom:none; }
    .aog-row span:first-child { color:var(--text30,#9C8C82); flex-shrink:0; }
    .aog-item-row { display:flex; justify-content:space-between; padding:9px 0; font-size:14px; border-bottom:1px solid var(--border,#EBE0D3); }
    .aog-item-row:last-child { border-bottom:none; }
    a.aog-btn-secondary, button.aog-btn-secondary { width:100%; padding:13px; background:var(--surface,#FFFFFE);
      color:var(--text,#3A2A28); border:1.5px solid var(--border,#EBE0D3); border-radius:14px; font-weight:700;
      font-size:14px; margin-bottom:10px; display:flex; align-items:center; justify-content:center; gap:8px;
      text-decoration:none; box-sizing:border-box; font-family:inherit; cursor:pointer; }
    .aog-btn-map { background:#4285F4 !important; color:#fff !important; border-color:#4285F4 !important; }
    .aog-btn-call { background:var(--olive,#65743A) !important; color:#fff !important; border-color:var(--olive,#65743A) !important; }
    .aog-footer { padding:14px 20px calc(env(safe-area-inset-bottom) + 16px); background:var(--surface,#FFFFFE);
      border-top:1px solid var(--border,#EBE0D3); flex-shrink:0; }
    .aog-btn-main { width:100%; padding:16px; background:var(--primary,#A23E48); color:#fff; border:none;
      border-radius:14px; font-weight:800; font-size:15.5px; display:flex; align-items:center; justify-content:center;
      gap:8px; font-family:inherit; cursor:pointer; }
    .aog-amount-label { text-align:center; color:var(--text30,#9C8C82); font-size:13px; margin-bottom:6px; }
    .aog-amount { font-size:36px; font-weight:900; font-family:'JetBrains Mono',monospace; color:var(--primary,#A23E48); text-align:center; margin:0 0 8px; }
    .aog-amount.paid-online { font-size:20px; color:var(--olive,#65743A); font-family:'Tajawal',sans-serif; }
    .aog-breakdown { font-size:12px; color:var(--text30,#9C8C82); margin-top:20px; border-top:1px dashed var(--border,#EBE0D3); padding-top:14px; }
    .aog-breakdown div { display:flex; justify-content:space-between; padding:4px 0; }
    .aog-stars { display:flex; justify-content:center; gap:12px; margin:36px 0; }
    .aog-star { font-size:40px; color:var(--border,#EBE0D3); cursor:pointer; transition:color .15s; }
    .aog-star.active { color:#F5A65B; }
    #aogProblemPanel.hidden { display:none !important; }
    .aog-problem-inline { background:none; border:none; padding:2px; margin:0; font-size:19px;
      line-height:1; cursor:pointer; color:#D9534F; flex-shrink:0; }
    .aog-problem-panel { position:absolute; left:14px; top:calc(env(safe-area-inset-top) + 56px);
      width:250px; max-width:calc(100vw - 32px); background:var(--surface,#FFFFFE); border:1px solid var(--border,#EBE0D3);
      border-radius:14px; padding:12px; box-shadow:0 6px 20px rgba(0,0,0,.2); z-index:21; }
    .aog-problem-panel-title { font-weight:800; font-size:13px; margin-bottom:8px; color:var(--text,#3A2A28); }
    .aog-problem-panel button { width:100%; padding:11px; margin-bottom:8px; background:var(--bg,#FDF8F3);
      border:1px solid var(--border,#EBE0D3); border-radius:10px; font-size:13px; font-family:inherit;
      cursor:pointer; color:var(--text,#3A2A28); text-align:center; }
    .aog-problem-panel button:last-child { margin-bottom:0; }
    .aog-stage-badge { background:#F5A65B; color:#fff; font-weight:800; font-size:12px;
      padding:5px 12px; border-radius:20px; flex-shrink:0; font-family:'Tajawal',sans-serif; }
  `;
  document.head.appendChild(style);
}

function aogEnsureContainer() {
  let el = document.getElementById('activeOrderGuard');
  if (!el) {
    el = document.createElement('div');
    el.id = 'activeOrderGuard';
    el.className = 'aog-overlay hidden';
    el.innerHTML = `
      <div class="aog-header">
        <button class="aog-problem-inline" onclick="window.__aogToggleProblem()" title="الإبلاغ عن مشكلة">⚠️</button>
        <div class="aog-header-code-group">
          <span class="aog-code mono" id="aogCode"></span>
          <span class="aog-stage-badge" id="aogStageBadge"></span>
        </div>
      </div>
      <div class="aog-body" id="aogBody"></div>
      <div class="aog-footer" id="aogFooter"></div>
      <div id="aogProblemPanel" class="aog-problem-panel hidden">
        <div class="aog-problem-panel-title">الإبلاغ عن مشكلة</div>
        ${AOG_PROBLEMS.map(p => `<button onclick="window.__aogReportProblem('${p.replace(/'/g, "\\'")}')">${p}</button>`).join('')}
      </div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

function aogShow() {
  aogEnsureContainer().classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function aogHide() {
  const el = document.getElementById('activeOrderGuard');
  if (el) el.classList.add('hidden');
  document.body.style.overflow = '';
}

async function aogGetStore(storeId) {
  if (!storeId) return null;
  if (_aogStoreCache[storeId]) return _aogStoreCache[storeId];
  try {
    const snap = await getDoc(doc(db, 'stores', storeId));
    const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    _aogStoreCache[storeId] = data;
    return data;
  } catch (e) { console.error('aog store fetch error', e); return null; }
}

function aogMapLink(lat, lng, fallbackQuery) {
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (fallbackQuery) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
  return null;
}

function aogSetStage(n) {
  const b = document.getElementById('aogStageBadge');
  if (b) b.textContent = `${n} من 6`;
}

async function aogRenderStage1(order) {
  aogSetStage(1);
  const store = await aogGetStore(order.store_id);
  if (_aogCurrentOrderId !== order.id) return; // تغيّر الطلب أثناء الجلب
  const mapUrl = aogMapLink(store?.lat, store?.lng, store?.address || order.store_name);
  document.getElementById('aogBody').innerHTML = `
    <div class="aog-title">📦 طلب جديد — توجه للمتجر</div>
    <div class="aog-sub">روح على المتجر عشان تستلم الطلب</div>
    <div class="aog-card">
      <div class="aog-row"><span>المتجر</span><span>${order.store_name || 'غير محدد'}</span></div>
      ${store?.address ? `<div class="aog-row"><span>العنوان</span><span style="text-align:left;max-width:60%;">${store.address}</span></div>` : ''}
      ${store?.phone ? `<div class="aog-row"><span>هاتف المتجر</span><span class="mono">${store.phone}</span></div>` : ''}
    </div>
    ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="aog-btn-secondary aog-btn-map">🧭 فتح الموقع بخرائط جوجل</a>` : ''}
  `;
  document.getElementById('aogFooter').innerHTML = `
    <button class="aog-btn-main" onclick="window.__aogArrivedStore()">✅ وصلت للمتجر</button>
  `;
}

function aogIngredientsHtml(order) {
  return (order.merged_ingredients || []).map(ing => {
    const note = (ing.base_qty_needed != null)
      ? `<div style="font-size:11px;color:var(--text30,#9C8C82);padding-bottom:6px;">(الوصفة تحتاج تقريباً ${ing.base_qty_needed} ${ing.base_unit_label || ''})</div>`
      : '';
    return `<div class="aog-item-row"><span>${ing.name}</span><span class="mono">${ing.purchase_quantity} ${ing.package_label || ''}</span></div>${note}`;
  }).join('') || `<div class="aog-item-row">لا توجد مكونات</div>`;
}

async function aogRenderStage2(order) {
  aogSetStage(2);
  const itemsHtml = aogIngredientsHtml(order);
  document.getElementById('aogBody').innerHTML = `
    <div class="aog-title">🏪 استلم المكونات من المتجر</div>
    <div class="aog-sub">تأكد من كل المكونات قبل ما تتحرك</div>
    <div class="aog-card"><div class="aog-row"><span>المتجر</span><span>${order.store_name || 'غير محدد'}</span></div></div>
    <div class="aog-card">${itemsHtml}</div>
  `;
  document.getElementById('aogFooter').innerHTML = `
    <button class="aog-btn-main" onclick="window.__aogPickedUp()">📦 استلمت المكونات. توجه للعميل</button>
  `;
}

function aogRenderStage3(order) {
  aogSetStage(3);
  const isOnline = order.payment_method === 'card' || order.payment_method === 'online';
  const payLabel = isOnline ? '💳 بطاقة ائتمانية (مدفوع مسبقاً)' : '💵 نقداً عند الاستلام';
  const amountRow = isOnline
    ? `<div class="aog-row"><span>المبلغ</span><span>مدفوع إلكترونياً ✅</span></div>`
    : `<div class="aog-row"><span>المبلغ المطلوب تحصيله</span><span class="mono">${(order.total_estimated_price || 0).toFixed(2)} د.أ</span></div>`;
  const mapUrl = aogMapLink(order.delivery_lat, order.delivery_lng, order.delivery_address);
  document.getElementById('aogBody').innerHTML = `
    <div class="aog-title">🧭 توجه للعميل</div>
    <div class="aog-sub">الطلب معك — روح عالعنوان</div>
    <div class="aog-card">
      <div class="aog-row"><span>الزبون</span><span>${order.customer_name || 'زبون'}</span></div>
      <div class="aog-row"><span>الهاتف</span><span class="mono">${order.customer_phone || '—'}</span></div>
      <div class="aog-row"><span>طريقة الدفع</span><span>${payLabel}</span></div>
      ${amountRow}
      <div class="aog-row" style="align-items:flex-start;"><span>العنوان</span><span style="text-align:left;max-width:60%;">${order.delivery_address || '—'}</span></div>
      ${order.customer_notes ? `<div class="aog-row" style="align-items:flex-start;"><span>ملاحظات</span><span style="text-align:left;max-width:60%;">${order.customer_notes}</span></div>` : ''}
    </div>
    ${order.customer_phone ? `<a href="tel:${order.customer_phone}" class="aog-btn-secondary aog-btn-call">📞 اتصال بالزبون</a>` : ''}
    ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="aog-btn-secondary aog-btn-map">🧭 فتح الموقع بخرائط جوجل</a>` : ''}
  `;
  document.getElementById('aogFooter').innerHTML = `
    <button class="aog-btn-main" onclick="window.__aogArrivedCustomer()">✅ لقد وصلت</button>
  `;
}

async function aogRenderStage4(order) {
  aogSetStage(4);
  const store = await aogGetStore(order.store_id);
  if (_aogCurrentOrderId !== order.id) return;
  const isOnline = order.payment_method === 'card' || order.payment_method === 'online';
  const ingredientsCount = (order.merged_ingredients || []).length;
  document.getElementById('aogBody').innerHTML = `
    <div class="aog-title">🤝 تسليم الطلب</div>
    <div class="aog-card">
      <div class="aog-row"><span>المتجر</span><span>${order.store_name || 'غير محدد'}${store?.address ? ' — ' + store.address : ''}</span></div>
      <div class="aog-row"><span>الزبون</span><span>${order.customer_name || 'زبون'}</span></div>
      <div class="aog-row" style="cursor:pointer;" onclick="window.__aogToggleIngredients()"><span>عدد المكونات ▾</span><span class="mono">${ingredientsCount}</span></div>
    </div>
    <div id="aogIngredientsList" class="hidden aog-card">${aogIngredientsHtml(order)}</div>
    ${order.customer_phone ? `<a href="tel:${order.customer_phone}" class="aog-btn-secondary aog-btn-call">📞 اتصال بالزبون</a>` : ''}
    <div style="margin-top:22px;">
      ${isOnline
        ? `<div class="aog-amount paid-online">✅ تم الدفع إلكترونياً</div>`
        : `<div class="aog-amount-label">المبلغ اللي بتستلمه من الزبون</div><div class="aog-amount">${(order.total_estimated_price || 0).toFixed(2)} د.أ</div>`
      }
    </div>
  `;
  document.getElementById('aogFooter').innerHTML = `
    <button class="aog-btn-main" onclick="window.__aogMarkDelivered()">✅ تم التسليم بنجاح</button>
  `;
}

function aogRenderStage5(order) {
  aogSetStage(5);
  const isOnline = order.payment_method === 'card' || order.payment_method === 'online';
  const f = computeOrderFinancials(order);
  document.getElementById('aogBody').innerHTML = `
    <div class="aog-title" style="text-align:center;">🎉 تم التسليم بنجاح</div>
    <div style="margin-top:26px;">
      ${isOnline
        ? `<div class="aog-amount paid-online">✅ تم الدفع إلكترونياً</div>`
        : `<div class="aog-amount-label">استلمت من الزبون</div><div class="aog-amount">${f.collected.toFixed(2)} د.أ</div>`
      }
    </div>
    <div class="aog-breakdown">
      <div><span>رسوم التوصيل + الإكرامية</span><span class="mono">${f.grossEarning.toFixed(2)} د.أ</span></div>
      <div><span>عمولة أكليتو</span><span class="mono">${f.commission.toFixed(2)} د.أ</span></div>
      <div><span>صافي ربحك من الطلب</span><span class="mono">${f.netProfit.toFixed(2)} د.أ</span></div>
      <div><span>${f.owed > 0 ? 'المستحق منك لأكليتو' : 'ما في مستحق عليك من هاد الطلب'}</span><span class="mono">${f.owed.toFixed(2)} د.أ</span></div>
    </div>
  `;
  document.getElementById('aogFooter').innerHTML = `
    <button class="aog-btn-main" onclick="window.__aogGoToRating()">متابعة</button>
  `;
}

function aogRenderStage6(order) {
  aogSetStage(6);
  _aogSelectedRating = 0;
  document.getElementById('aogBody').innerHTML = `
    <div class="aog-title" style="text-align:center;">قيّم تجربة التوصيل</div>
    <div class="aog-sub" style="text-align:center;">شو رأيك بتجربة توصيل هاد الطلب؟</div>
    <div class="aog-stars" id="aogStars">
      ${[1,2,3,4,5].map(n => `<span class="aog-star" data-n="${n}" onclick="window.__aogSetRating(${n})">★</span>`).join('')}
    </div>
  `;
  document.getElementById('aogFooter').innerHTML = `
    <button class="aog-btn-main" onclick="window.__aogSubmitRating('${order.id}')">شكراً لك</button>
  `;
}

function aogRenderOrder(order) {
  _aogCurrentOrderId = order.id;
  document.getElementById('aogCode').textContent = orderDisplayCode(order);
  if (order.status === 'done') {
    if (_aogShowRatingFor === order.id) aogRenderStage6(order);
    else aogRenderStage5(order);
    return;
  }
  const stage = order.driver_flow_stage || 'to_store';
  if (stage === 'to_store') aogRenderStage1(order);
  else if (stage === 'at_store') aogRenderStage2(order);
  else if (stage === 'to_customer') aogRenderStage3(order);
  else aogRenderStage4(order);
}

window.__aogArrivedStore = async () => {
  if (!_aogCurrentOrderId) return;
  try { await updateDoc(doc(db, 'orders', _aogCurrentOrderId), { driver_flow_stage: 'at_store' }); }
  catch (e) { console.error('aog arrived store error', e); showToast('صار خطأ — جرب مرة ثانية'); }
};
window.__aogPickedUp = async () => {
  if (!_aogCurrentOrderId) return;
  try { await updateDoc(doc(db, 'orders', _aogCurrentOrderId), { driver_flow_stage: 'to_customer' }); }
  catch (e) { console.error('aog picked up error', e); showToast('صار خطأ — جرب مرة ثانية'); }
};
window.__aogArrivedCustomer = async () => {
  if (!_aogCurrentOrderId) return;
  try { await updateDoc(doc(db, 'orders', _aogCurrentOrderId), { driver_flow_stage: 'at_customer' }); }
  catch (e) { console.error('aog arrived customer error', e); showToast('صار خطأ — جرب مرة ثانية'); }
};
window.__aogMarkDelivered = async () => {
  if (!_aogCurrentOrderId) return;
  try { await updateDoc(doc(db, 'orders', _aogCurrentOrderId), { status: 'done', delivered_at: serverTimestamp() }); }
  catch (e) { console.error('aog mark delivered error', e); showToast('صار خطأ — جرب مرة ثانية'); }
};
window.__aogToggleIngredients = () => { document.getElementById('aogIngredientsList')?.classList.toggle('hidden'); };
window.__aogToggleProblem = () => { document.getElementById('aogProblemPanel')?.classList.toggle('hidden'); };
window.__aogReportProblem = (problemText) => {
  if (_aogCurrentOrderId) {
    addDoc(collection(db, 'admin_notifications'), {
      type: 'driver_issue_report',
      title: `مشكلة أثناء التوصيل — ${orderDisplayCode(_aogLastOrder)}`,
      message: problemText,
      related_id: _aogCurrentOrderId, created_at: serverTimestamp(), read: false
    }).catch(e => console.error('report problem log error', e));
  }
  window.location.href = `tel:${SUPPORT_PHONE}`;
};
window.__aogGoToRating = () => {
  _aogShowRatingFor = _aogCurrentOrderId;
  if (_aogLastOrder) aogRenderOrder(_aogLastOrder);
};
window.__aogSetRating = (n) => {
  _aogSelectedRating = n;
  document.querySelectorAll('#aogStars .aog-star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.n, 10) <= n);
  });
};
window.__aogSubmitRating = async (orderId) => {
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      driver_rating: _aogSelectedRating || null, driver_rating_at: serverTimestamp()
    });
    aogHide();
  } catch (e) { console.error('aog submit rating error', e); showToast('صار خطأ — جرب مرة ثانية'); }
};

// نقطة الدخول — تُستدعى مرة وحدة بكل صفحة سائق بعد التأكد من وجود جلسة
export function mountActiveOrderGuard(session) {
  if (!session || _aogMounted) return;
  _aogMounted = true;
  linkDriverAuthUid(session.id); // يضمن ربط Auth حتى لجلسات مسجّلة دخول من قبل هالتحديث (بدون ما يحتاجوا يعيدوا تسجيل الدخول)
  aogInjectStyles();
  aogEnsureContainer();
  watchCommissionSettings(); // نضمن توفر إعدادات العمولة لحساب ملخص المرحلة الخامسة
  watchMyOrders(session.id, list => {
    const active = (list || [])
      .filter(o => o.status === 'delivering' || (o.status === 'done' && !o.driver_rating))
      .sort((a, b) => (a.created_at?.toMillis?.() || 0) - (b.created_at?.toMillis?.() || 0))[0];
    if (!active) { aogHide(); _aogLastOrder = null; _aogPrevOrderId = null; return; }
    if (active.id !== _aogPrevOrderId) { _aogShowRatingFor = null; _aogPrevOrderId = active.id; }
    _aogLastOrder = active;
    aogShow();
    aogRenderOrder(active);
  });
}

/* ══════════════════════════════════════════════════════════
   زر الرجوع الفيزيائي (Android hardware back button) — تطبيق
   السائق مبني من صفحات منفصلة حقيقية (location.href)، فأصلاً
   السلوك الافتراضي لـ Capacitor بيتنقّل صح بينهم. الإضافة هون
   بس لحالة الصفحة الرئيسية (akleto-driver-home.html) — لأنها
   "الجذر"، لازم الرجوع منها يطلع من التطبيق مباشرة بدل ما يحاول
   يرجع لصفحة تسجيل الدخول. يشتغل تلقائياً بمجرد استيراد هالملف،
   بدون حاجة لاستدعاء أي دالة من الصفحة نفسها.
   ══════════════════════════════════════════════════════════ */
(function setupDriverHardwareBackButton() {
  const Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;
  const AppPlugin = Capacitor.Plugins && Capacitor.Plugins.App;
  if (!AppPlugin) return;

  const isHomePage = /akleto-driver-home\.html/.test(window.location.pathname);

  AppPlugin.addListener('backButton', () => {
    if (isHomePage) { AppPlugin.exitApp(); return; }
    window.location.href = 'akleto-driver-home.html';
  });
})();
