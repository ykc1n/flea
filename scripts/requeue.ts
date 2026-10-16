import { connect, requeue } from '../src/store.js';

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error('Usage: npm run requeue -- <battle-id>');
const db = connect();
const changed = requeue(db, id);
db.close();
console.log(`Requeued ${changed} blocked replay(s).`);
