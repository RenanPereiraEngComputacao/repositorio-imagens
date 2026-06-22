(function () {
  const panel = document.querySelector('[data-lightbox-panel]');
  if (!panel) return;

  const image = panel.querySelector('img');
  const close = panel.querySelector('[data-lightbox-close]');

  document.querySelectorAll('[data-lightbox]').forEach((button) => {
    button.addEventListener('click', () => {
      image.src = button.dataset.lightbox;
      panel.hidden = false;
      document.body.classList.add('no-scroll');
    });
  });

  function closePanel() {
    panel.hidden = true;
    image.removeAttribute('src');
    document.body.classList.remove('no-scroll');
  }

  close.addEventListener('click', closePanel);
  panel.addEventListener('click', (event) => {
    if (event.target === panel) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });
})();
