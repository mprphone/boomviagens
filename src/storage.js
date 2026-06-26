const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function readDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`DB não encontrada: ${DB_PATH}`);
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
  return db;
}

function updateDb(mutator) {
  const db = readDb();
  const result = mutator(db) || db;
  writeDb(db);
  return result;
}

module.exports = { readDb, writeDb, updateDb, DB_PATH };
