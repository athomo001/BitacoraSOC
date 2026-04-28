/**
 * @typedef {'High' | 'Medium' | 'Low' | 'Info' | 'Variable'} Impact
 */

/**
 * @typedef {{
 *   tag: string,
 *   meaning: string,
 *   values: string[],
 *   impact: Impact
 * }} SecurityTag
 */

/**
 * @typedef {{
 *   title: string,
 *   tags: SecurityTag[],
 *   logExample: string
 * }} VendorDictionary
 */

/** @type {Record<string, VendorDictionary>} */
const dictionaries = {
  huawei_hisec_insight: {
    title: '1. HUAWEI HISEC INSIGHT (Estructura de Seguridad)',
    tags: [
      { tag: 'ThreatEventStatus', meaning: 'Ciclo de vida de la amenaza detectada.', values: ['1: Detectado (Activo)', '2: Procesando (Sandbox)', '3: Confirmado', '4: Manejado/Cerrado (Finalizado)', '5: Lista Blanca'], impact: 'High' },
      { tag: 'EventLevel', meaning: 'Nivel de criticidad del evento.', values: ['4: Critico', '3: Alto', '2: Medio', '1: Bajo'], impact: 'High' },
      { tag: 'EventCategory', meaning: 'Motor de seguridad que genero el log.', values: ['11: Antivirus', '13: IPS (Intrusion)', '14: Sandbox', '15: Botnet/C2', '999: Cambio de estado'], impact: 'Medium' },
      { tag: 'SrcArea', meaning: 'Segmento de red de origen.', values: ['Ej: DPP_Visitas', 'Zona_Servidores', 'User_VLAN'], impact: 'Info' },
      { tag: 'EventClass', meaning: 'ID unico del tipo de ataque segun Huawei.', values: ['Ej: 1514037 (firma especifica de backdoor)'], impact: 'Medium' },
      { tag: 'SrcIP', meaning: 'IP origen asociada al evento.', values: ['Permite identificar host comprometido o escaneo de origen'], impact: 'High' },
      { tag: 'DstIP', meaning: 'IP destino afectada por el evento.', values: ['Clave para priorizar activos criticos impactados'], impact: 'High' },
      { tag: 'EventName', meaning: 'Nombre del evento correlacionado.', values: ['Ej: brute_force, malware_activity, abnormal_behavior'], impact: 'Medium' }
    ],
    logExample: [
      'Time=2026-04-27T10:11:25Z Device=HiSecInsight',
      'ThreatEventStatus=1 EventLevel=4 EventCategory=13 EventClass=1514037',
      'SrcIP=10.20.10.15 DstIP=172.16.20.9 SrcArea=Zona_Servidores EventName=abnormal_behavior',
      'Action=Block Detail="IPS matched known backdoor signature"'
    ].join('\n')
  },
  fortinet_fortios: {
    title: '2. FORTINET (FortiOS Log Tags)',
    tags: [
      { tag: 'action', meaning: 'Que hizo el firewall con el paquete.', values: ['deny/drop: Bloqueado', 'accept/pass: Permitido', 'reset: Conexion cortada por TCP RST', 'blocked: Detenido por UTM'], impact: 'High' },
      { tag: 'type', meaning: 'Tipo de log general.', values: ['traffic: Flujo de red', 'utm: Seguridad (IPS, AV)', 'event: Sistema/Admin'], impact: 'Info' },
      { tag: 'subtype', meaning: 'Funcion especifica del motor de seguridad.', values: ['ips: Sistema de prevencion', 'webfilter: Filtro de URL', 'app-ctrl: Control de aplicaciones', 'virus: Antimalware'], impact: 'Medium' },
      { tag: 'level', meaning: 'Gravedad segun estandar Syslog.', values: ['critical', 'alert', 'warning', 'notice', 'information'], impact: 'Medium' },
      { tag: 'app', meaning: 'Aplicacion de capa 7 identificada.', values: ['Ej: SMB', 'SSL', 'DNS', 'Web.Browsing'], impact: 'Low' },
      { tag: 'srcip', meaning: 'IP origen del trafico.', values: ['Campo base para trazar el origen de la comunicacion'], impact: 'High' },
      { tag: 'dstip', meaning: 'IP destino del trafico.', values: ['Permite mapear servicio/activo afectado'], impact: 'High' },
      { tag: 'policyid', meaning: 'ID de politica aplicada al flujo.', values: ['Ej: policyid=1'], impact: 'Medium' },
      { tag: 'service', meaning: 'Servicio detectado por el firewall.', values: ['Ej: HTTPS, DNS, SMB'], impact: 'Low' }
    ],
    logExample: [
      'date=2026-04-27 time=11:02:17 devname=FGT-SOC type=utm subtype=ips level=critical',
      'srcip=192.168.22.34 dstip=10.100.2.15 srcport=53214 dstport=445 policyid=32 service=SMB',
      'action=blocked app=SMB attack="MS17-010 Attempt" severity=high',
      'msg="IPS signature matched and packet denied"'
    ].join('\n')
  },
  huawei_router_vrp: {
    title: '3. HUAWEI ROUTER (VRP / Info-Center)',
    tags: [
      { tag: 'SequenceNumber', meaning: 'Correlativo del mensaje para detectar perdida de logs.', values: ['Ej: #12345 o [124]'], impact: 'High' },
      { tag: 'Timestamp', meaning: 'Fecha/hora del evento en el equipo.', values: ['Ej: 2014 18:09:48+08:00'], impact: 'Info' },
      { tag: 'Module', meaning: 'Modulo de software que genero el log VRP.', values: ['SECE (Security)', 'DEFF (Attack Defense)', 'IFNET (Interface Network)'], impact: 'Medium' },
      { tag: 'Severity', meaning: 'Nivel de urgencia VRP expresado en la cabecera.', values: ['1: Alert', '2: Critical', '3: Error', '4: Warning', '5: Notice'], impact: 'Variable' },
      { tag: 'EventID / QID', meaning: 'Nombre corto de evento/firma detectada.', values: ['Ej: ARPMISS', 'CPCAR_DROP_LPU'], impact: 'High' },
      { tag: 'AttackType', meaning: 'Tipo de ataque de red detectado por CPU.', values: ['Arp Miss', 'Flood', 'Smurf', 'Fraggle'], impact: 'High' },
      { tag: 'SourceInterface', meaning: 'Interfaz donde se detecto el evento.', values: ['Ej: GigabitEthernet0/0/1'], impact: 'Medium' },
      { tag: 'SourceIP', meaning: 'IP de origen asociada al evento/ataque.', values: ['Ej: 10.0.0.250'], impact: 'High' },
      { tag: 'Source MAC', meaning: 'Direccion MAC de origen asociada al evento.', values: ['Formato XXXX-XXXX-XXXX'], impact: 'High' },
      { tag: 'AttackPackets', meaning: 'Tasa de paquetes reportados por el motor.', values: ['Ej: 19 packets per second'], impact: 'Medium' }
      ,
      { tag: 'User Group / User Name', meaning: 'Usuario o grupo reportado en eventos de acceso.', values: ['Ej: sshuser=admin', 'telnet user group=ops'], impact: 'Medium' },
      { tag: 'FilterID', meaning: 'ACL/politica que bloqueo o filtro el trafico.', values: ['Nombre o ID de ACL aplicada'], impact: 'Medium' }
    ],
    logExample: [
      '#12345 2014 18:09:48+08:00 HUAWEI %%01SECE/4/ARPMISS(l)[0]:Attack occurred.',
      '(AttackType=Arp Miss Attack, SourceInterface=GigabitEthernet0/0/1,',
      'SourceIP=10.0.0.250, SourceMAC=0025-9e89-7f21, AttackPackets=19 packets per second, FilterID=ACL-EDGE-IN)',
      '#12346 2014 18:10:12+08:00 HUAWEI %%01SECE/3/SSH_AUTH_FAIL(l)[1]:Login failed.',
      '(UserName=admin, UserGroup=ops, SourceIP=10.0.0.51)'
    ].join('\n')
  },
  cisco_router_ios_xe: {
    title: '4. CISCO ROUTER (IOS XE / ACL Syslog)',
    tags: [
      { tag: 'SeqNo', meaning: 'Numero de secuencia opcional del syslog.', values: ['Habilitado con service sequence-numbers'], impact: 'Low' },
      { tag: 'Timestamp', meaning: 'Fecha/hora del evento en el router.', values: ['Ej: Jun 5 12:55:44.359'], impact: 'Info' },
      { tag: 'Facility', meaning: 'Subsistema que reporta el evento.', values: ['Ej: SEC, LINK, SYS, FMANFP'], impact: 'Medium' },
      { tag: 'Severity', meaning: 'Nivel 0-7 (0 mas critico, 7 debugging).', values: ['0 emergency, 1 alert, 2 critical, 3 error, 4 warning, 5 notification, 6 informational, 7 debugging'], impact: 'High' },
      { tag: 'Mnemonic', meaning: 'Codigo corto del tipo de mensaje.', values: ['Ej: IPACCESSLOGP, UPDOWN, CONFIG_I'], impact: 'Medium' },
      { tag: 'Header', meaning: 'Cabecera estandar del mensaje Cisco.', values: ['Formato: %FACILITY-SEVERITY-MNEMONIC'], impact: 'Info' },
      { tag: 'ACL List', meaning: 'Nombre o numero de ACL que hizo match.', values: ['Ej: list logacl, list 101'], impact: 'High' },
      { tag: 'Action', meaning: 'Resultado sobre el trafico evaluado.', values: ['permitted, denied'], impact: 'High' },
      { tag: 'Protocol', meaning: 'Protocolo de red del flujo.', values: ['tcp, udp, icmp'], impact: 'Medium' },
      { tag: 'SrcIP', meaning: 'IP origen del trafico.', values: ['Ej: 192.168.16.1'], impact: 'High' },
      { tag: 'SrcPort', meaning: 'Puerto de origen (si aplica).', values: ['Ej: (38402)'], impact: 'Low' },
      { tag: 'DstIP', meaning: 'IP destino del trafico.', values: ['Ej: 192.168.16.2'], impact: 'High' },
      { tag: 'DstPort', meaning: 'Puerto destino (si aplica).', values: ['Ej: (23), (443)'], impact: 'Low' },
      { tag: 'PacketCount', meaning: 'Conteo agregado de paquetes por evento.', values: ['Ej: 1 packet'], impact: 'Medium' },
      { tag: 'Tag/Hash', meaning: 'Correlacion ACL opcional con cookie o hash.', values: ['Ej: [User_permitted_ACE], [0x723E6E12]'], impact: 'Info' },
      { tag: 'SrcMAC', meaning: 'MAC origen (disponible en formatos nuevos IOS XE).', values: ['Ej: f000.02b0.a78d'], impact: 'Medium' },
      { tag: 'Message', meaning: 'Texto descriptivo final con contexto tecnico.', values: ['Ej: changed state to up', 'Configured from console by console'], impact: 'Info' },
      { tag: 'CONFIG_I', meaning: 'Mnemonic de cambio de configuracion en equipo.', values: ['Revisar usuario, origen y ventana de cambio'], impact: 'High' }
    ],
    logExample: [
      '000046: Jun 5 12:55:44.359: %SEC-6-IPACCESSLOGP: list logacl permitted tcp',
      '192.168.16.1(38402) -> 192.168.16.2(23), 1 packet [0x723E6E12]',
      '000047: Jun 5 12:56:01.002: %SYS-5-CONFIG_I: Configured from console by admin',
      '*Sep 16 20:07:59.869: %FMANFP-6-IPACCESSLOGP: F0/0: list test-acl-log3 permitted tcp',
      'f000.02b0.a78d 40.0.1.2(1024) -> 50.0.1.2(1024), 1 packet'
    ].join('\n')
  }
};

const vendorSelect = document.getElementById('vendorSelect');
const searchInput = document.getElementById('searchInput');
const impactSelect = document.getElementById('impactSelect');
const tablesContainer = document.getElementById('tablesContainer');
const resultsMeta = document.getElementById('resultsMeta');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const expandAllBtn = document.getElementById('expandAllBtn');
const statusText = document.getElementById('statusText');

function normalize(text) {
  return text.toLowerCase().trim();
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function impactClass(impact) {
  switch (impact) {
    case 'High': return 'impact-high';
    case 'Medium': return 'impact-medium';
    case 'Low': return 'impact-low';
    case 'Variable': return 'impact-variable';
    default: return 'impact-info';
  }
}

function impactPriority(impact) {
  switch (impact) {
    case 'High': return 0;
    case 'Medium': return 1;
    case 'Low': return 2;
    case 'Variable': return 3;
    default: return 4;
  }
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function getFilteredTags(tags, term, impactValue) {
  return [...tags]
    .filter((item) => impactValue === 'all' || item.impact === impactValue)
    .filter((item) => {
      if (!term) return true;
      return [item.tag, item.meaning, item.values.join(' ')]
        .map((field) => normalize(field))
        .some((field) => field.includes(term));
    })
    .sort((a, b) => {
      const byImpact = impactPriority(a.impact) - impactPriority(b.impact);
      return byImpact !== 0 ? byImpact : a.tag.localeCompare(b.tag);
    });
}

function renderValueList(values) {
  return `<ul class="valueList">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function renderVendorBlock(vendorKey, vendorData, filteredTags) {
  const body = filteredTags.length === 0
    ? '<div class="empty">Sin resultados para este fabricante con el filtro actual.</div>'
    : `
      <table class="vendorTable">
        <thead>
          <tr>
            <th>Tag / Etiqueta</th>
            <th>Significado Tecnico</th>
            <th>Valores Comunes</th>
            <th>Impacto</th>
          </tr>
        </thead>
        <tbody>
          ${filteredTags.map((tagItem) => `
            <tr>
              <td><span class="tagCode">${escapeHtml(tagItem.tag)}</span></td>
              <td>${escapeHtml(tagItem.meaning)}</td>
              <td>${renderValueList(tagItem.values)}</td>
              <td><span class="impactBadge ${impactClass(tagItem.impact)}">${escapeHtml(tagItem.impact)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

  return `
    <article class="vendorBlock">
      <header class="vendorHead">
        <h3>${escapeHtml(vendorData.title)}</h3>
        <div class="vendorTools">
          <button type="button" class="smallBtn" data-action="export" data-vendor="${escapeHtml(vendorKey)}">
            Exportar a CSV
          </button>
          <span class="meta">${filteredTags.length} tags</span>
        </div>
      </header>
      ${body}
      <pre class="logBox">${escapeHtml(vendorData.logExample)}</pre>
    </article>
  `;
}

function setStatus(message) {
  statusText.textContent = message;
}

function getVisibleVendorKeys() {
  if (vendorSelect.value === 'all') {
    return Object.keys(dictionaries);
  }
  return [vendorSelect.value];
}

function render() {
  const term = normalize(searchInput.value);
  const impactValue = impactSelect.value;
  const visibleKeys = getVisibleVendorKeys();
  let totalVisible = 0;
  let totalBase = 0;

  const blocks = visibleKeys.map((vendorKey) => {
    const vendorData = dictionaries[vendorKey];
    totalBase += vendorData.tags.length;
    const filteredTags = getFilteredTags(vendorData.tags, term, impactValue);
    totalVisible += filteredTags.length;
    return renderVendorBlock(vendorKey, vendorData, filteredTags);
  });

  tablesContainer.innerHTML = blocks.join('');
  resultsMeta.textContent = `${totalVisible} de ${totalBase} tags visibles`;
  setStatus(`Vista ${visibleKeys.length === 1 ? 'individual' : 'general'}: ${totalVisible} resultados.`);
}

function clearFilters() {
  vendorSelect.value = 'all';
  searchInput.value = '';
  impactSelect.value = 'all';
  render();
  searchInput.focus();
}

function exportVendorCsv(vendorKey) {
  const vendorData = dictionaries[vendorKey];
  const term = normalize(searchInput.value);
  const impactValue = impactSelect.value;
  const rows = getFilteredTags(vendorData.tags, term, impactValue);

  const csv = [
    ['tag', 'meaning', 'values', 'impact'],
    ...rows.map((row) => [row.tag, row.meaning, row.values.join(' | '), row.impact])
  ]
    .map((line) => line.map(csvCell).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${vendorKey}-diccionario.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`CSV exportado para ${vendorData.title}.`);
}

function init() {
  const options = [
    '<option value="all">Todos los fabricantes</option>',
    ...Object.entries(dictionaries).map(([key, value]) => (
      `<option value="${escapeHtml(key)}">${escapeHtml(value.title)}</option>`
    ))
  ];
  vendorSelect.innerHTML = options.join('');

  vendorSelect.addEventListener('change', render);
  searchInput.addEventListener('input', render);
  impactSelect.addEventListener('change', render);
  clearFiltersBtn.addEventListener('click', clearFilters);
  expandAllBtn.addEventListener('click', () => {
    vendorSelect.value = 'all';
    render();
  });

  tablesContainer.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.action === 'export' && target.dataset.vendor) {
      exportVendorCsv(target.dataset.vendor);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== searchInput) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  render();
}

init();
