// إصلاح مباشر ومحدّد لحساب واحد بالذات — يربط auth_uid يدوياً بالهوية الصحيحة الحالية
// (استخدمناها بعد ما طلع إنه السكربت العام ما غطّى هالحساب تحديداً)
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const CUSTOMER_ID = 'puaqrxnkLsHm7GOcx8Fo';
const CORRECT_UID = '0wAS4WWh7uU6irbFzzaAvKlIkKk1'; // uid الحقيقي الحالي (من رسالة التشخيص)

async function main() {
  const ref = db.collection('customers').doc(CUSTOMER_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log('❌ ما لقيت هالحساب أصلاً — تأكد من CUSTOMER_ID');
    return;
  }
  const before = snap.data();
  console.log('📋 قبل الإصلاح:');
  console.log('   الاسم:', before.name);
  console.log('   الهاتف:', before.phone);
  console.log('   auth_uid القديم:', before.auth_uid);
  console.log('   phone_verified:', before.phone_verified);

  await ref.update({ auth_uid: CORRECT_UID, phone_verified: true });

  console.log('\n✅ تم الربط بنجاح!');
  console.log('   auth_uid الجديد:', CORRECT_UID);
  console.log('\n🎉 جرّب هلق تضيف عنوان من التطبيق — لازم يشتغل مباشرة.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
