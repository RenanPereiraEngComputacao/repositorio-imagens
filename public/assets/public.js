/* MÁLAGAH — galeria pública. Navegação, visualização ampliada, gestos e downloads. */
(function () {
  'use strict';

  var toastRegion = document.querySelector('[data-toasts]');
  function toast(message) {
    if (!toastRegion) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    toastRegion.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 300);
    }, 2800);
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-toast]');
    if (link) toast(link.dataset.toast);
  });

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.dataset.copy;
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        navigator.share({ title: document.title, url: text }).catch(function () {});
        return;
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { toast('Link copiado'); }, function () { window.prompt('Copie o link:', text); });
      } else {
        window.prompt('Copie o link:', text);
      }
    });
  });

  var gallery = document.querySelector('[data-gallery]');
  var dataEl = document.querySelector('[data-gallery-data]');
  if (!gallery || !dataEl) return;

  var images = [];
  try { images = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!images.length) return;

  var index = 0;
  var stageImg = gallery.querySelector('[data-stage-image]');
  var counter = gallery.querySelector('[data-counter]');
  var thumbs = gallery.querySelectorAll('[data-thumb]');
  var downloadCurrent = document.querySelector('[data-download-current]');

  // Pré-carrega vizinhas para navegação instantânea
  var cache = {};
  function preload(i) {
    var item = images[(i + images.length) % images.length];
    if (cache[item.display]) return;
    var img = new Image();
    img.src = item.display;
    cache[item.display] = img;
  }

  function swapImage(img, src, alt) {
    if (img.getAttribute('src') === src) return;
    img.classList.add('is-loading');
    var loader = new Image();
    loader.onload = loader.onerror = function () {
      img.src = src;
      img.alt = alt;
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.classList.remove('is-loading');
    };
    loader.src = src;
  }

  function show(i) {
    index = (i + images.length) % images.length;
    var item = images[index];
    swapImage(stageImg, item.display, item.alt);
    if (counter) counter.textContent = (index + 1) + ' / ' + images.length;
    thumbs.forEach(function (thumb, n) {
      thumb.setAttribute('aria-current', String(n === index));
      if (n === index) thumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
    if (downloadCurrent) downloadCurrent.href = item.download;
    preload(index + 1);
    preload(index - 1);
    if (!lightbox.hidden) renderLightbox();
  }

  gallery.addEventListener('click', function (event) {
    var step = event.target.closest('[data-step]');
    if (step) { show(index + Number(step.dataset.step)); return; }
    var thumb = event.target.closest('[data-thumb]');
    if (thumb) { show(Number(thumb.dataset.thumb)); return; }
    if (event.target.closest('[data-open-lightbox]')) openLightbox();
  });

  document.querySelectorAll('[data-open-index]').forEach(function (button) {
    button.addEventListener('click', function () {
      show(Number(button.dataset.openIndex));
      openLightbox();
    });
  });

  addSwipe(gallery.querySelector('.stage'), function (dir) { show(index + dir); });

  /* ---------------- Lightbox ---------------- */
  var lightbox = document.querySelector('[data-lightbox]');
  var lbImg = lightbox.querySelector('[data-lb-image]');
  var lbCounter = lightbox.querySelector('[data-lb-counter]');
  var lbDownload = lightbox.querySelector('[data-lb-download]');
  var lastFocus = null;

  function renderLightbox() {
    var item = images[index];
    swapImage(lbImg, item.display, item.alt);
    lbCounter.textContent = (index + 1) + ' / ' + images.length;
    lbDownload.href = item.download;
  }

  function openLightbox() {
    lastFocus = document.activeElement;
    lightbox.hidden = false;
    document.body.classList.add('no-scroll');
    renderLightbox();
    lightbox.querySelector('[data-lb-close]').focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.classList.remove('no-scroll');
    if (lastFocus) lastFocus.focus();
  }

  lightbox.addEventListener('click', function (event) {
    if (event.target.closest('[data-lb-close]')) return closeLightbox();
    var step = event.target.closest('[data-lb-step]');
    if (step) return show(index + Number(step.dataset.lbStep));
    if (event.target === lightbox.querySelector('[data-lb-stage]')) closeLightbox();
  });

  document.addEventListener('keydown', function (event) {
    if (lightbox.hidden) {
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-gallery]')) {
        if (event.key === 'ArrowRight') show(index + 1);
        if (event.key === 'ArrowLeft') show(index - 1);
      }
      return;
    }
    if (event.key === 'Escape') closeLightbox();
    else if (event.key === 'ArrowRight') show(index + 1);
    else if (event.key === 'ArrowLeft') show(index - 1);
    else if (event.key === 'Tab') {
      var focusables = lightbox.querySelectorAll('button, a[href]');
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  addSwipe(lightbox.querySelector('[data-lb-stage]'), function (dir) { show(index + dir); }, function () { closeLightbox(); });

  function addSwipe(el, onHorizontal, onDown) {
    if (!el || images.length < 1) return;
    var startX = 0;
    var startY = 0;
    var tracking = false;
    el.addEventListener('touchstart', function (event) {
      if (event.touches.length !== 1) return;
      tracking = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', function (event) {
      if (!tracking) return;
      tracking = false;
      var dx = event.changedTouches[0].clientX - startX;
      var dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && images.length > 1) onHorizontal(dx < 0 ? 1 : -1);
      else if (onDown && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onDown();
    }, { passive: true });
  }

  preload(1);
})();
