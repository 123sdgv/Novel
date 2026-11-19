// A gesture moves the row cover. Only a separate button click can change a story.
export function enableStorySwipes(root) {
  let drag = null;
  let suppressClick = null;

  function reveal(row, open) {
    const previous = root.querySelector('.book-row.revealed');
    if (previous && previous !== row) previous.classList.remove('revealed');
    row?.classList.toggle('revealed', open);
  }

  document.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = null;
    const row = event.target.closest('.book-row');
    if (!row || !row.classList.contains('revealed')) reveal(null, false);
    const face = event.target.closest('button');
    if (!row || !face || !root.contains(row)) return;
    drag = {
      id: event.pointerId, row, face, x: event.clientX, y: event.clientY,
      width: row.querySelector('.row-actions').offsetWidth,
      open: row.classList.contains('revealed'), horizontal: false
    };
  });
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.horizontal) {
      if (Math.max(Math.abs(dx),Math.abs(dy)) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) { suppressClick = drag.row; drag = null; return; }
      drag.horizontal = true;
      drag.row.classList.add('dragging');
      if (event.isTrusted) drag.face.setPointerCapture(event.pointerId);
    }
    const shift = Math.min(0, Math.max(-drag.width, dx - (drag.open ? drag.width : 0)));
    drag.row.style.setProperty('--drag-x', shift + 'px');
  });
  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const { row, x, open, horizontal } = drag;
    drag = null;
    if (!horizontal) return;
    if (event.type === 'pointerup') {
      const dx = event.clientX - x;
      reveal(row, Math.abs(dx) >= 32 ? dx < 0 : open);
      suppressClick = row;
    }
    row.classList.remove('dragging');
    row.style.removeProperty('--drag-x');
  }
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  root.addEventListener('click', event => {
    const row = event.target.closest('.book-row');
    if (!row) return;
    if (suppressClick === row && event.detail > 0) {
      suppressClick = null;
    } else if (row.classList.contains('revealed') && event.target.closest('.book-open')) {
      reveal(row, false);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });
  root.addEventListener('focusin', event => {
    if (event.target.closest('.row-actions')) reveal(event.target.closest('.book-row'), true);
  });
  root.addEventListener('keydown', event => {
    const row = event.target.closest('.book-row');
    if (!row) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      reveal(row, true);
      row.querySelector('.rename').focus();
    } else if (event.key === 'Escape' || event.key === 'ArrowRight') {
      event.preventDefault();
      row.querySelector('.book-open').focus();
      reveal(row, false);
    }
  });
}
