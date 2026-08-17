const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['server.js', 'src', 'scripts', path.join('public', 'js'), path.join('public', 'conta', 'js'), path.join('public', 'backoffice', 'js')];
const files = [];

function walk(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith('.js') && !target.endsWith(path.join('scripts', 'check-js.js'))) files.push(target);
    return;
  }
  for (const name of fs.readdirSync(target)) walk(path.join(target, name));
}

for (const root of roots) walk(root);
files.sort();
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    console.error(`\n[ERRO] ${file}`);
    console.error(result.stderr || result.stdout);
  }
}
if (failures) {
  console.error(`\n${failures} ficheiro(s) JavaScript com erro de sintaxe.`);
  process.exit(1);
}
console.log(`OK - sintaxe validada em ${files.length} ficheiros JavaScript`);
