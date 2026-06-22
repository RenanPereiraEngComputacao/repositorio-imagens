(function () {
  const sortable = document.querySelector('[data-sortable-images]');
  const orderInput = document.querySelector('[data-order-input]');

  if (sortable && orderInput) {
    let dragged = null;

    sortable.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-image-id]');
      if (!card) return;
      dragged = card;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });

    sortable.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      dragged = null;
      updateOrder();
    });

    sortable.addEventListener('dragover', (event) => {
      event.preventDefault();
      const card = event.target.closest('[data-image-id]');
      if (!card || !dragged || card === dragged) return;

      const bounds = card.getBoundingClientRect();
      const after = event.clientY > bounds.top + bounds.height / 2;
      sortable.insertBefore(dragged, after ? card.nextSibling : card);
    });

    function updateOrder() {
      const ids = Array.from(sortable.querySelectorAll('[data-image-id]'))
        .map((card) => card.dataset.imageId);
      orderInput.value = ids.join(',');
    }
  }

  document.querySelectorAll('[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) {
        event.preventDefault();
      }
    });
  });
})();
