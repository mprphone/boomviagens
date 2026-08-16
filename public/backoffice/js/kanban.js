// Mecanica de arrasto partilhada entre os quadros por arrasto do
// backoffice (Pipeline comercial, Pipeline Operacional) - so o "como se
// arrasta" (drag nativo do browser); cada quadro decide o que acontece
// quando um cartao e largado numa coluna (onDrop).

export function attachDragHandlers(card) {
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
}

// root: elemento que contem as colunas, cada uma marcada com
// data-col-value="<valor da coluna>" (fase/estado). onDrop(itemId,
// colValue) e chamado quando um cartao e largado numa coluna diferente.
export function attachDropHandlers(root, onDrop) {
  root.querySelectorAll('[data-col-value]').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const itemId = e.dataTransfer.getData('text/plain');
      onDrop(itemId, zone.dataset.colValue);
    });
  });
}
