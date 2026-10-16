import { connect } from '../src/store.js';
import { backupArchive, restoreArchive } from '../src/backup.js';

const [mode, first, second] = process.argv.slice(2);
if (mode === 'create' && first && !second) {
  const db = connect();
  try { await backupArchive(db, first); } finally { db.close(); }
  console.log('Created consistent archive snapshot');
} else if (mode === 'restore' && first && second) {
  restoreArchive(first, second);
  console.log('Restored archive to new database path; stop Flea before switching FLEA_DB');
} else throw new Error('Usage: npm run backup -- create <snapshot> | restore <snapshot> <new-database>');
