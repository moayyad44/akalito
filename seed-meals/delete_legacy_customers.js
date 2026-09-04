// سكربت حذف نهائي لحسابات الزبائن التجريبية القديمة (من قبل نظام الـOTP)
// ⚠️ عملية نهائية ما فيها رجوع — بيحذف مستند الزبون بالكامل + كل عناوينه المحفوظة.
// ما بيلمس أي طلبات (orders) — هاي تضل موجودة بسجلات الأدمن حتى لو الزبون انحذف.
//
// فيه تأكيد أمان داخل السكربت نفسه: لازم تكتب DELETE بالضبط لما يسألك، وإلا ما رح يحذف شي.

const admin = require('firebase-admin');
const path = require('path');
const readline = require('readline');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  console.log('🔎 البحث عن حسابات زبائن قديمة (من قبل نظام الـOTP)...\n');
  const snap = await db.collection('customers').get();

  const legacy = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (d.phone_verified !== true) {
      legacy.push({ id: doc.id, name: d.name || '(بدون اسم)', phone: d.phone || '(بدون رقم)' });
    }
  });

  if (legacy.length === 0) {
    console.log('✅ ما في أي حساب قديم متبقي — ما في شي يُحذف.');
    return;
  }

  console.log(`⚠️  رح يتحذف ${legacy.length} حساب نهائياً (المستند + كل عناوينه المحفوظة):\n`);
  legacy.forEach((c, i) => console.log(`   ${i + 1}. ${c.name} - ${c.phone}`));

  console.log('\n⛔ هاي عملية نهائية ما فيها تراجع.');
  const answer = await ask('اكتب DELETE بالضبط (بحروف كبيرة) وبعدها Enter للتأكيد، أو أي شي تاني للإلغاء: ');

  if (answer.trim() !== 'DELETE') {
    console.log('\n🚫 تم الإلغاء — ما انحذف ولا شي.');
    return;
  }

  console.log('\n🗑️  جاري الحذف...');
  let done = 0;
  for (const c of legacy) {
    // احذف كل العناوين المحفوظة تحت هالزبون أولاً
    const addrSnap = await db.collection('customers').doc(c.id).collection('addresses').get();
    const batch = db.batch();
    addrSnap.forEach(a => batch.delete(a.ref));
    batch.delete(db.collection('customers').doc(c.id));
    await batch.commit();
    done++;
    console.log(`   ✅ انحذف: ${c.name} - ${c.phone} (${addrSnap.size} عنوان محفوظ معه)`);
  }

  console.log(`\n🎉 انتهى! تم حذف ${done} حساب نهائياً.`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
