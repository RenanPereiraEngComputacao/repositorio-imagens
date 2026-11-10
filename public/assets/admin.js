/* MÁLAGAH — painel administrativo. Sem dependências; melhora progressiva sobre formulários HTML. */
(function () {
  'use strict';

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  /* ---------------- Toasts ---------------- */
  var toastRegion = document.querySelector('[data-toasts]');
  function toast(message, type) {
    if (!toastRegion) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    toastRegion.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 300);
    }, type === 'error' ? 6000 : 3200);
  }

  /* ---------------- Menu lateral (mobile) ---------------- */
  var sidebar = document.querySelector('[data-sidebar]');
  var openNav = document.querySelector('[data-nav-open]');
  var scrim = null;
  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('is-open');
    if (openNav) openNav.setAttribute('aria-expanded', 'false');
    if (scrim) { scrim.remove(); scrim = null; }
  }
  if (sidebar && openNav) {
    openNav.addEventListener('click', function () {
      sidebar.classList.add('is-open');
      openNav.setAttribute('aria-expanded', 'true');
      scrim = document.createElement('div');
      scrim.className = 'sidebar-scrim';
      scrim.addEventListener('click', closeSidebar);
      document.body.appendChild(scrim);
      var first = sidebar.querySelector('a');
      if (first) first.focus();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSidebar();
    });
  }

  /* ---------------- Diálogo de confirmação ---------------- */
  var dialog = document.querySelector('[data-confirm-dialog]');
  function confirmAction(options) {
    return new Promise(function (resolve) {
      if (!dialog || typeof dialog.showModal !== 'function') {
        resolve(window.confirm(options.message));
        return;
      }
      dialog.querySelector('[data-confirm-title]').textContent = options.title || 'Confirmar';
      dialog.querySelector('[data-confirm-message]').textContent = options.message || '';
      var ok = dialog.querySelector('[data-confirm-ok]');
      ok.textContent = options.okLabel || 'Confirmar';
      ok.className = 'btn ' + (options.tone === 'neutral' ? 'btn-primary' : 'btn-danger');
      dialog.returnValue = '';
      dialog.showModal();
      dialog.addEventListener('close', function handler() {
        dialog.removeEventListener('close', handler);
        resolve(dialog.returnValue === 'ok');
      });
    });
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-confirm]');
    if (!trigger || trigger.dataset.confirmed === '1') return;
    event.preventDefault();
    confirmAction({
      title: trigger.dataset.confirmTitle || 'Confirmar ação',
      message: trigger.dataset.confirm,
      tone: trigger.dataset.confirmTone,
      okLabel: trigger.dataset.confirmTone === 'neutral' ? 'Confirmar' : 'Excluir'
    }).then(function (accepted) {
      if (!accepted) return;
      var form = trigger.form || trigger.closest('form');
      if (form) {
        if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
        trigger.dataset.confirmed = '1';
        trigger.setAttribute('aria-busy', 'true');
        if (form.requestSubmit) form.requestSubmit(trigger); else form.submit();
      } else if (trigger.href) {
        window.location.href = trigger.href;
      }
    });
  });

  /* ---------------- Utilidades de formulário ---------------- */
  document.querySelectorAll('[data-autosubmit]').forEach(function (select) {
    select.addEventListener('change', function () {
      var form = select.form;
      var page = form && form.querySelector('input[name="page"]');
      if (page) page.remove();
      if (form) form.submit();
    });
  });

  var slugSource = document.querySelector('[data-slug-source]');
  var slugTarget = document.querySelector('[data-slug-target]');
  if (slugSource && slugTarget) {
    var touched = slugTarget.value.trim() !== '';
    slugTarget.addEventListener('input', function () { touched = slugTarget.value.trim() !== ''; });
    slugSource.addEventListener('input', function () {
      if (touched) return;
      slugTarget.value = slugSource.value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    });
  }

  document.querySelectorAll('[data-meter]').forEach(function (bar) {
    requestAnimationFrame(function () { bar.style.width = Math.max(0, Math.min(100, Number(bar.dataset.meter))) + '%'; });
  });

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.dataset.copy;
      var done = function () { toast('Link copiado'); };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copie o link:', text); });
      } else {
        window.prompt('Copie o link:', text);
      }
    });
  });

  document.querySelectorAll('[data-file-label]').forEach(function (input) {
    var label = input.closest('label').querySelector('[data-file-name]');
    input.addEventListener('change', function () {
      if (label && input.files[0]) label.textContent = input.files[0].name;
    });
  });

  var phraseForm = document.querySelector('[data-phrase-form]');
  if (phraseForm) {
    var expected = phraseForm.querySelector('[data-phrase]').textContent.trim();
    var input = phraseForm.querySelector('[data-phrase-input]');
    var submit = phraseForm.querySelector('[data-phrase-submit]');
    var sync = function () { submit.disabled = input.value.trim().replace(/\s+/g, ' ') !== expected; };
    input.addEventListener('input', sync);
    input.addEventListener('paste', function () { setTimeout(sync, 0); });
    sync();
    phraseForm.addEventListener('submit', function () {
      submit.disabled = true;
      submit.textContent = 'Excluindo…';
    });
  }

  document.querySelectorAll('[data-dropzone]').forEach(function (zone) {
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function () { zone.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function () { zone.classList.remove('is-dragover'); });
    });
  });

  /* ---------------- Ordenação da galeria ---------------- */
  var sortable = document.querySelector('[data-sortable]');
  var orderForm = document.querySelector('[data-order-form]');
  if (sortable && orderForm) {
    var orderInput = orderForm.querySelector('[data-order-input]');
    var saveTimer = null;
    var dragged = null;

    var currentOrder = function () {
      return Array.prototype.map.call(sortable.querySelectorAll('[data-image-id]'), function (card) { return card.dataset.imageId; });
    };

    var save = function () {
      orderInput.value = currentOrder().join(',');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        fetch(orderForm.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ order: currentOrder() }),
          credentials: 'same-origin'
        }).then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok || !data.ok) throw new Error(data.error || 'Falha ao salvar a ordem.');
            toast('Ordem salva');
          });
        }).catch(function (error) {
          toast(error.message, 'error');
          orderForm.querySelector('[data-order-save]').hidden = false;
        });
      }, 500);
    };

    sortable.addEventListener('dragstart', function (event) {
      dragged = event.target.closest('[data-image-id]');
      if (!dragged) return;
      dragged.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragged.dataset.imageId);
    });
    sortable.addEventListener('dragend', function () {
      if (!dragged) return;
      dragged.classList.remove('is-dragging');
      sortable.querySelectorAll('.is-drop-target').forEach(function (el) { el.classList.remove('is-drop-target'); });
      dragged = null;
      save();
    });
    sortable.addEventListener('dragover', function (event) {
      event.preventDefault();
      var card = event.target.closest('[data-image-id]');
      if (!card || !dragged || card === dragged) return;
      var bounds = card.getBoundingClientRect();
      var after = (event.clientX - bounds.left) > bounds.width / 2;
      sortable.insertBefore(dragged, after ? card.nextSibling : card);
    });
    sortable.addEventListener('click', function (event) {
      var button = event.target.closest('[data-move]');
      if (!button) return;
      var card = button.closest('[data-image-id]');
      var step = Number(button.dataset.move);
      if (step < 0 && card.previousElementSibling) sortable.insertBefore(card, card.previousElementSibling);
      else if (step > 0 && card.nextElementSibling) sortable.insertBefore(card.nextElementSibling, card);
      else return;
      button.focus();
      save();
    });
  }

  /* ---------------- Envio de imagens com progresso ---------------- */
  var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  var ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  document.querySelectorAll('[data-uploader]').forEach(function (form) {
    var input = form.querySelector('[data-file-input]');
    var queueEl = form.querySelector('[data-queue]');
    var summary = form.querySelector('[data-summary]');
    var summaryText = form.querySelector('[data-summary-text]');
    var retryBtn = form.querySelector('[data-retry]');
    var reloadBtn = form.querySelector('[data-reload]');
    var maxBytes = Number(form.dataset.maxMb || 12) * 1024 * 1024;
    var endpoint = form.dataset.endpoint;
    var bulk = form.hasAttribute('data-bulk');
    var separator = form.querySelector('[data-separator]');
    var items = [];
    var active = 0;
    var CONCURRENCY = 2;

    function render(item) {
      item.el.className = 'upload-item' + (item.state === 'error' ? ' is-error' : '') + (item.state === 'done' ? ' is-done' : '');
      item.status.textContent = item.message;
      item.bar.style.width = item.progress + '%';
    }

    function updateSummary() {
      var done = items.filter(function (i) { return i.state === 'done'; }).length;
      var failed = items.filter(function (i) { return i.state === 'error'; }).length;
      var pending = items.length - done - failed;
      summary.hidden = items.length === 0;
      summaryText.textContent = pending
        ? 'Enviando… ' + done + ' de ' + items.length + ' concluída(s)'
        : done + ' enviada(s)' + (failed ? ', ' + failed + ' com falha' : '') + '.';
      if (retryBtn) retryBtn.hidden = pending > 0 || failed === 0;
      if (reloadBtn) reloadBtn.hidden = pending > 0 || done === 0;
      if (!pending && items.length) {
        if (failed) toast(failed + ' arquivo(s) não foram enviados. Veja os detalhes na lista.', 'error');
        else toast(done + ' imagem(ns) enviada(s)');
        if (!bulk && done && !failed) setTimeout(function () { window.location.reload(); }, 1200);
      }
    }

    function next() {
      while (active < CONCURRENCY) {
        var item = items.find(function (i) { return i.state === 'queued'; });
        if (!item) break;
        upload(item);
      }
      if (active === 0) updateSummary();
    }

    function upload(item) {
      active += 1;
      item.state = 'uploading';
      item.message = 'Enviando…';
      item.progress = 2;
      render(item);
      updateSummary();

      var data = new FormData();
      if (separator) data.append('separator', separator.value);
      data.append('images', item.file, item.file.name);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-CSRF-Token', csrf);
      xhr.upload.addEventListener('progress', function (event) {
        if (!event.lengthComputable) return;
        item.progress = Math.min(95, Math.round((event.loaded / event.total) * 95));
        item.message = event.loaded >= event.total ? 'Processando…' : 'Enviando… ' + item.progress + '%';
        render(item);
      });
      xhr.addEventListener('load', function () {
        var body = {};
        try { body = JSON.parse(xhr.responseText); } catch (e) { body = {}; }
        var result = (body.results || [])[0];
        if (xhr.status >= 200 && xhr.status < 300 && result && result.ok) {
          item.state = 'done';
          item.progress = 100;
          item.message = bulk && result.reference ? 'Vinculada a ' + result.reference : 'Concluída';
        } else {
          item.state = 'error';
          item.progress = 100;
          item.message = (result && result.error) || body.error || (xhr.status === 401 ? 'Sessão expirada — entre novamente.' : 'Falha no envio (' + xhr.status + ').');
        }
        finish(item);
      });
      xhr.addEventListener('error', function () {
        item.state = 'error';
        item.progress = 100;
        item.message = 'Sem conexão. Tente novamente.';
        finish(item);
      });
      xhr.send(data);
    }

    function finish(item) {
      active -= 1;
      render(item);
      next();
    }

    function add(files) {
      Array.prototype.forEach.call(files, function (file) {
        var el = document.createElement('div');
        var thumb = document.createElement('img');
        thumb.alt = '';
        var info = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'upload-item-name';
        name.textContent = file.name;
        var status = document.createElement('div');
        status.className = 'upload-item-status';
        var progress = document.createElement('div');
        progress.className = 'progress';
        var bar = document.createElement('span');
        progress.appendChild(bar);
        info.appendChild(name);
        info.appendChild(status);
        info.appendChild(progress);
        var size = document.createElement('span');
        size.className = 'small muted';
        size.textContent = formatSize(file.size);
        el.appendChild(thumb);
        el.appendChild(info);
        el.appendChild(size);
        queueEl.appendChild(el);

        var item = { file: file, el: el, status: status, bar: bar, progress: 0, state: 'queued', message: 'Na fila' };
        if (ALLOWED.indexOf(file.type) === -1 || !ALLOWED_EXT.test(file.name)) {
          item.state = 'error';
          item.message = 'Formato inválido. Use JPG, PNG ou WEBP.';
          item.invalid = true;
        } else if (file.size > maxBytes) {
          item.state = 'error';
          item.message = 'Acima do limite de ' + form.dataset.maxMb + ' MB.';
          item.invalid = true;
        } else {
          thumb.src = URL.createObjectURL(file);
          thumb.addEventListener('load', function () { URL.revokeObjectURL(thumb.src); }, { once: true });
        }
        items.push(item);
        render(item);
      });
      updateSummary();
      next();
    }

    if (input) {
      input.addEventListener('change', function () {
        if (input.files && input.files.length) add(input.files);
        input.value = '';
      });
    }
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        items.forEach(function (item) {
          if (item.state === 'error' && !item.invalid) {
            item.state = 'queued';
            item.message = 'Na fila';
            item.progress = 0;
            render(item);
          }
        });
        next();
      });
    }
    if (reloadBtn) reloadBtn.addEventListener('click', function () { window.location.reload(); });

    form.addEventListener('submit', function (event) {
      // Com JavaScript ativo, o envio acontece arquivo a arquivo (com progresso).
      event.preventDefault();
    });

    window.addEventListener('beforeunload', function (event) {
      if (items.some(function (i) { return i.state === 'uploading' || i.state === 'queued'; })) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  });
})();
