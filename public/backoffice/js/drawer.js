// Gaveta lateral (desliza da direita) - usada para o detalhe de uma
// reserva individual (voo/hotel/seguro...) sem encher o ecra principal
// com um formulario permanente. Componente separado do modal.js (overlay
// proprio) porque pode ficar aberta em cima de uma pagina inteira, nao so
// de uma caixa modal.

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'bo-drawer-overlay';
  overlay.className = 'bo-drawer-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="bo-drawer-box">
      <div class="bo-drawer-head">
        <h3 class="bo-drawer-title"></h3>
        <button type="button" class="bo-drawer-close" aria-label="Fechar">&times;</button>
      </div>
      <div class="bo-drawer-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.bo-drawer-close').onclick = closeDrawer;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeDrawer(); });
  return overlay;
}

export function openDrawer(title) {
  const el = ensureOverlay();
  el.querySelector('.bo-drawer-title').textContent = title;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  return el.querySelector('.bo-drawer-body');
}

export function closeDrawer() {
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = '';
}
