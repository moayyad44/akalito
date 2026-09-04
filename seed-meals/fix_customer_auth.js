// سكربت إصلاح: يفكّ ربط auth_uid القديم عن حسابات الزبائن يلي انسجّلوا قبل نظام الـOTP
// (كانت هويتهم مربوطة بجلسة "مؤقتة" Anonymous قديمة ما رح تتطابق أبداً مع تسجيل دخولهم
//  الحقيقي الجديد برقم الهاتف، فتضل حساباتهم "معلّقة" لحد ما ينفك الربط القديم).
//
// آمن 100%: ما بيلمس ولا بيحذف أي بيانات زبون (الاسم، الهاتف، الطلبات، العناوين كلها
// تضل زي ما هي) — بس بيصفّر حقل auth_uid لحسابات قديمة تحديداً (يلي ما فيها
// phone_verified:true)، وبعدين أول تسجيل دخول جديد للزبون بيربطه من جديد تلقائياً
// (نفس آلية "النافذة الانتقالية" الموجودة أصلاً بقواعد الأمان).
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  console.log('🔎 البحث عن حسابات زبائن قديمة (من قبل نظام الـOTP)...');
  const snap = await db.collection('customers').get();

  let legacyCount = 0;
  const batch = db.batch();
  const affectedNames = [];

  snap.forEach(doc => {
    const d = doc.data();
    if (d.phone_verified !== true) {
      batch.update(doc.ref, { auth_uid: null });
      legacyCount++;
      affectedNames.push(`${d.name || '(بدون اسم)'} - ${d.phone || '(بدون رقم)'}`);
    }
  });

  if (legacyCount === 0) {
    console.log('✅ ما في أي حساب قديم متأثر — كل الحسابات أصلاً مرتبطة بنظام الـOTP الحديث.');
    return;
  }

  await batch.commit();
  console.log(`\n✅ تم فكّ الربط القديم عن ${legacyCount} حساب:`);
  affectedNames.forEach(n => console.log('   - ' + n));
  console.log('\n🎉 كل هالحسابات هلق تقدر تسجّل دخول من جديد برقم هاتفها وتشتغل عادي.');
  console.log('   (لا حاجة لأي إجراء إضافي — الربط الجديد بيصير تلقائياً أول ما الزبون يسجّل دخول)');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
