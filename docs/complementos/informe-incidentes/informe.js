/*
 * Incidentes por cliente: complemento de ejemplo de una página en Reportes
 * (spec/11 §12.5). Lee con Bitacora.api (API_REQUEST) las entradas de
 * incidente, los tickets de incidente y los clientes, como la persona que
 * lo tiene abierto, y arma la tabla del mes elegido. No guarda nada.
 */
(function () {
  'use strict';
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var $ = function (id) { return document.getElementById(id); };
  var cargado = false;

  // Los últimos 12 meses en el selector, el actual primero.
  var hoy = new Date();
  for (var i = 0; i < 12; i++) {
    var d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    var op = document.createElement('option');
    op.value = d.getFullYear() + '-' + (d.getMonth() + 1);
    op.textContent = MESES[d.getMonth()] + ' de ' + d.getFullYear();
    $('mes').appendChild(op);
  }
  $('mes').addEventListener('change', cargar);

  // Se carga al recibir el contexto: recién ahí la app atiende los pedidos.
  Bitacora.onContext(function () {
    if (!cargado) {
      cargado = true;
      cargar();
    }
  });

  function rango() {
    var partes = $('mes').value.split('-');
    var desde = new Date(Number(partes[0]), Number(partes[1]) - 1, 1);
    var hasta = new Date(Number(partes[0]), Number(partes[1]), 1);
    return { desde: desde, hasta: hasta };
  }

  function dentro(fecha, r) {
    var t = new Date(fecha);
    return t >= r.desde && t < r.hasta;
  }

  function duracion(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') + ' min' : '');
  }

  function cargar() {
    var r = rango();
    var desde = encodeURIComponent(r.desde.toISOString());
    $('estado').textContent = 'Cargando…';
    $('estado').hidden = false;
    $('tabla').hidden = true;
    $('titulo').textContent = 'Incidentes por cliente en ' + $('mes').selectedOptions[0].textContent;
    Promise.all([
      Bitacora.apiAll('/entries?since=' + desde),
      // since filtra por última actualización: alcanza para los creados en el mes.
      Bitacora.apiAll('/tickets?since=' + desde).catch(function (e) {
        // Sin la Ticketera (o sin permiso) el informe sigue solo con la Bitácora.
        if (e.status === 403) return [];
        throw e;
      }),
      Bitacora.api('/clients').then(function (b) { return b.data || []; }),
    ]).then(function (res) {
      pintar(res[0], res[1], res[2], r);
    }).catch(function (e) {
      $('estado').textContent = 'No se pudo armar el informe: ' + e.message;
    });
  }

  function pintar(entradas, tickets, clientes, r) {
    var porCliente = {};
    function fila(ref) {
      if (!porCliente[ref.id]) porCliente[ref.id] = { nombre: ref.name, bitacora: 0, tickets: 0, abiertos: 0, cierres: [], sla: 0 };
      return porCliente[ref.id];
    }
    clientes.forEach(fila);
    var sinCliente = 0;
    entradas.forEach(function (e) {
      if (e.entryType !== 'incidente' || !dentro(e.createdAt, r)) return;
      if (e.client) fila(e.client).bitacora++;
      else sinCliente++;
    });
    var ahora = new Date();
    tickets.forEach(function (t) {
      if (t.type !== 'incident' || !dentro(t.createdAt, r)) return;
      var f = fila(t.client);
      f.tickets++;
      var cerrado = t.resolvedAt || t.closedAt;
      if (!cerrado && t.status !== 'cancelled') f.abiertos++;
      if (cerrado) f.cierres.push(new Date(cerrado) - new Date(t.createdAt));
      var vence = t.slaResolutionDue && new Date(t.slaResolutionDue);
      if (vence && (cerrado ? new Date(cerrado) > vence : ahora > vence)) f.sla++;
    });

    var filas = Object.keys(porCliente).map(function (k) { return porCliente[k]; })
      .filter(function (f) { return f.bitacora + f.tickets > 0; })
      .sort(function (a, b) { return (b.bitacora + b.tickets) - (a.bitacora + a.tickets) || a.nombre.localeCompare(b.nombre); });
    var max = filas.reduce(function (m, f) { return Math.max(m, f.bitacora + f.tickets); }, 0);

    var tbody = $('filas');
    tbody.textContent = '';
    filas.forEach(function (f) {
      var total = f.bitacora + f.tickets;
      var tr = document.createElement('tr');
      tr.appendChild(celda(f.nombre, 'cliente'));
      var barra = document.createElement('td');
      barra.innerHTML = '<span class="barra"><span class="barra__pista"><span class="barra__relleno"></span></span><span class="num"></span></span>';
      barra.querySelector('.barra__relleno').style.width = Math.round((total / max) * 100) + '%';
      barra.querySelector('.num').textContent = total;
      tr.appendChild(barra);
      tr.appendChild(celda(f.bitacora, 'num'));
      tr.appendChild(celda(f.tickets, 'num'));
      tr.appendChild(celda(f.abiertos, 'num'));
      var prom = f.cierres.length ? duracion(f.cierres.reduce(function (a, b) { return a + b; }, 0) / f.cierres.length) : '—';
      tr.appendChild(celda(prom, 'num' + (f.cierres.length ? '' : ' tenue')));
      tr.appendChild(celda(f.sla ? (f.sla === 1 ? '1 ticket' : f.sla + ' tickets') : 'Ninguno', 'num ' + (f.sla ? 'alerta' : 'tenue')));
      tbody.appendChild(tr);
    });

    $('estado').hidden = filas.length > 0;
    $('estado').textContent = filas.length ? '' : 'No hubo incidentes este mes en los clientes que ves.';
    $('tabla').hidden = filas.length === 0;
    $('pie').textContent = sinCliente
      ? (sinCliente === 1 ? '1 entrada de incidente no tiene cliente y no se cuenta.' : sinCliente + ' entradas de incidente no tienen cliente y no se cuentan.')
      : '';
  }

  function celda(texto, clase) {
    var td = document.createElement('td');
    td.textContent = texto;
    if (clase) td.className = clase;
    return td;
  }
})();
