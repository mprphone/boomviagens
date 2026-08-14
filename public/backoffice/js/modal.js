// Modal generico do backoffice: a ficha de um cliente/reserva abre numa
// caixa separada por cima da lista, em vez de expandir na propria pagina.
// Um so elemento de overlay, criado uma vez e reutilizado (so uma ficha
// aberta de cada vez faz sentido nesta app).

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'bo-modal-overlay';
  overlay.className = 'bo-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="bo-modal-box">
      <div class="bo-modal-head">
        <h3 class="bo-modal-title"></h3>
        <button type="button" class="bo-modal-close" aria-label="Fechar">&times;</button>
      </div>
      <div class="bo-modal-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.bo-modal-close').onclick = closeModal;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeModal(); });
  return overlay;
}

// Devolve o elemento onde o chamador deve renderizar o conteudo da ficha.
export function openModal(title) {
  const el = ensureOverlay();
  el.querySelector('.bo-modal-title').textContent = title;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  return el.querySelector('.bo-modal-body');
}

export function closeModal() {
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = '';
}
