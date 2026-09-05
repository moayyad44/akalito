const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('stores').doc('ovy53wKj9o1QyNVk4dhM').get();
  if (!snap.exists) { console.log('store not found'); return; }
  const d = snap.data();
  console.log('name:', d.name);
  console.log('authorized_uids:', JSON.stringify(d.authorized_uids));
  console.log('pin:', d.pin);
  console.log('employees list (store_employees) — checking separately below...');

  const empSnap = await db.collection('store_employees').where('store_id', '==', 'ovy53wKj9o1QyNVk4dhM').get();
  empSnap.forEach(e => console.log('  employee:', JSON.stringify(e.data())));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
