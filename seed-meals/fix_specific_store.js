// إصلاح مباشر لمتجر واحد بالذات — يضيف هوية الموظف الحالية لمصفوفة
// authorized_uids يدوياً (بصلاحية أدمن، بيتجاوز قاعدة الأمان المتناقضة دائرياً)
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const STORE_ID = 'ovy53wKj9o1QyNVk4dhM';
const EMPLOYEE_UID = 'lukxwtMdr8eSUU7NIQMK0eld8Pg2'; // من رسالة التشخيص

async function main() {
  const ref = db.collection('stores').doc(STORE_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log('❌ ما لقيت هالمتجر أصلاً — تأكد من STORE_ID');
    return;
  }
  const before = snap.data();
  console.log('📋 قبل الإصلاح:');
  console.log('   اسم المتجر:', before.name);
  console.log('   authorized_uids الحالية:', before.authorized_uids || []);

  await ref.update({
    authorized_uids: admin.firestore.FieldValue.arrayUnion(EMPLOYEE_UID)
  });

  console.log('\n✅ تم إضافة الهوية بنجاح!');
  console.log('\n🎉 جرّب هلق تدوس زر "جهّزنا المكونات — جاهز للسائق" — لازم يشتغل مباشرة.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
