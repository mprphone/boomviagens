const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');

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

// `node --check` valida cada ficheiro isoladamente, mas nao deteta imports
// de nomes que o modulo de destino nao exporta. Foi precisamente isso que
// desativou todo o login da area de cliente no browser. O bundle das tres
// aplicacoes valida agora o grafo real de imports/exports em cada teste.
const browserEntries = [
  path.join('public', 'js', 'main.js'),
  path.join('public', 'conta', 'js', 'main.js'),
  path.join('public', 'backoffice', 'js', 'main.js')
];
try {
  esbuild.buildSync({ entryPoints: browserEntries, bundle: true, platform: 'browser', format: 'esm', outdir: 'dist-check', write: false, logLevel: 'silent' });
} catch (error) {
  console.error('\n[ERRO] Grafo de modulos do browser invalido');
  console.error(error.message || error);
  process.exit(1);
}

console.log(`OK - sintaxe validada em ${files.length} ficheiros JavaScript e imports do browser verificados`);
