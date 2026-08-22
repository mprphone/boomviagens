const browserGlobals = {
  window: 'readonly', document: 'readonly', location: 'readonly', history: 'readonly',
  navigator: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', FormData: 'readonly',
  FileReader: 'readonly', Blob: 'readonly', CSS: 'readonly', HTMLElement: 'readonly', Option: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', BroadcastChannel: 'readonly', Node: 'readonly',
  AbortController: 'readonly', requestAnimationFrame: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  confirm: 'readonly', alert: 'readonly', prompt: 'readonly', console: 'readonly'
};

export default [{
  files: ['public/js/**/*.js', 'public/conta/js/**/*.js', 'public/backoffice/js/**/*.js', 'public/shared/**/*.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: browserGlobals },
  rules: { 'no-undef': 'error' }
}];
