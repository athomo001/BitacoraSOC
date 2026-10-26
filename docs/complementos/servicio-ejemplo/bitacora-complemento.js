/*
 * Bitácora Ops: ayudante para complementos (spec/11 §12, 10i).
 *
 * Copia este archivo dentro de tu complemento e inclúyelo con
 * <script src="bitacora-complemento.js"></script>. Envuelve el puente
 * postMessage (version 1) con la app:
 *
 *   Bitacora.onContext((ctx) => …)   usuario, tema, idioma, ficha abierta, configuración
 *   await Bitacora.api('/tickets?status=new')   lee /api/v1 como la persona (API_REQUEST)
 *   await Bitacora.addNote('texto')  seguimiento en la ficha abierta (ADD_NOTE)
 *   await Bitacora.createEntry({ content, entryType })   entrada nueva (CREATE_ENTRY)
 *   Bitacora.close()                 cierra el diálogo de una acción
 *
 * «Descargar PDF» de la app manda PRINT: por defecto se abre la impresión
 * del navegador (Guardar como PDF). Cambia Bitacora.onPrint si necesitas otra cosa.
 * Sin dependencias; funciona en cualquier navegador moderno.
 */
(function () {
  'use strict';
  var parentOrigin = null; // se fija con el primer mensaje que llega de la app
  var pending = {};
  var seq = 0;
  var context = null;
  var contextListeners = [];

  function post(type, payload) {
    if (window.parent === window) return;
    window.parent.postMessage({ type: type, version: 1, timestamp: Date.now(), payload: payload || {} }, parentOrigin || '*');
  }

  function request(type, payload, replyType) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject, replyType: replyType };
      payload.id = id;
      post(type, payload);
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(new Error('La app no respondió'));
        }
      }, 30000);
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.version !== 1 || typeof data.type !== 'string') return;
    if (parentOrigin === null) parentOrigin = event.origin;
    if (event.origin !== parentOrigin) return;
    var p = data.payload || {};
    switch (data.type) {
      case 'CONTEXT_UPDATE':
        context = p;
        applyTheme(p);
        contextListeners.forEach(function (fn) { fn(p); });
        break;
      case 'THEME_CHANGE':
        if (context) Object.assign(context, p);
        applyTheme(p);
        contextListeners.forEach(function (fn) { fn(context || p); });
        break;
      case 'PRINT':
        Bitacora.onPrint();
        break;
      case 'API_RESPONSE':
      case 'NOTE_ADDED': {
        var waiting = pending[p.id];
        if (!waiting || waiting.replyType !== data.type) return;
        delete pending[p.id];
        if (p.ok) waiting.resolve(p.body);
        else waiting.reject(Object.assign(new Error(p.error || 'Error'), { status: p.status }));
        break;
      }
    }
  });

  /** data-theme (oscuro, claro, rosa) y la fuente para dislexia, para que el CSS se adapte. */
  function applyTheme(p) {
    var root = document.documentElement;
    if (p.theme) root.setAttribute('data-theme', p.theme);
    if (p.language) root.setAttribute('lang', p.language);
    root.classList.toggle('dyslexia', !!p.dyslexiaFont);
  }

  var Bitacora = {
    /** Lo último que mandó la app (null hasta el primer CONTEXT_UPDATE). */
    get context() { return context; },
    onContext: function (fn) {
      contextListeners.push(fn);
      if (context) fn(context);
    },
    /** GET a la API de integraciones (/api/v1), como la persona que tiene abierto el complemento. */
    api: function (path) { return request('API_REQUEST', { path: path }, 'API_RESPONSE'); },
    /** Lee todas las páginas de una lista (sigue meta.nextCursor), hasta max elementos. */
    apiAll: function (path, max) {
      max = max || 2000;
      var out = [];
      function next(cursor) {
        var sep = path.indexOf('?') >= 0 ? '&' : '?';
        var url = path + sep + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
        return Bitacora.api(url).then(function (body) {
          out = out.concat(body.data || []);
          var c = body.meta && body.meta.nextCursor;
          return c && out.length < max ? next(c) : out;
        });
      }
      return next(null);
    },
    addNote: function (content) { return request('ADD_NOTE', { content: content }, 'NOTE_ADDED'); },
    createEntry: function (entry) { post('CREATE_ENTRY', entry); },
    close: function () { post('CLOSE'); },
    onPrint: function () { window.print(); },
  };
  window.Bitacora = Bitacora;
  post('REQUEST_CONTEXT');
})();
