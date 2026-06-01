/* ===== STATE ===== */
let map = null;
let radiusCircle = null;
let markers = [];
let allResults = [];
let filteredResults = [];
let sortState = { key: null, dir: 1 };
let geocodeTimer = null;
let selectedLocation = null;
let lastSearchParams = null;
let isFirstSearch = true;
let three = null;

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('state-initial');
  initMap();
  bindEvents();
  initThreeLogo();
  if (window.gsap && window.Flip) gsap.registerPlugin(Flip);
  playIntro();
});

/* ===== THREE.JS LOGO — Iridescent orb ===== */
function initThreeLogo() {
  const mount = document.getElementById('logoMount');
  if (!mount || !window.THREE) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.z = 3.2;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 2.5, 4));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  mount.appendChild(renderer.domElement);

  // ENV MAP — gradient saturé via canvas, continu, sans panneaux
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 1024;
  envCanvas.height = 512;
  const ctx = envCanvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0,    '#fbbf24'); // amber vif
  grad.addColorStop(0.3,  '#ec4899'); // pink vif
  grad.addColorStop(0.55, '#f97316'); // orange
  grad.addColorStop(0.8,  '#06b6d4'); // cyan vif
  grad.addColorStop(1,    '#fbbf24'); // amber (seam)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);
  // Ajout de "halos" radiaux pour casser la linéarité et enrichir les reflets
  const halos = [
    { x: 200, y: 150, r: 220, color: 'rgba(236, 72, 153, 0.65)' },  // pink
    { x: 760, y: 320, r: 250, color: 'rgba(6, 182, 212, 0.6)' },    // cyan
    { x: 500, y: 100, r: 180, color: 'rgba(251, 191, 36, 0.55)' },  // amber
  ];
  halos.forEach(h => {
    const rg = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
    rg.addColorStop(0, h.color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 1024, 512);
  });

  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose();
  pmrem.dispose();

  // Iridescent chrome orb — env saturé bien visible
  const orbGeom = new THREE.IcosahedronGeometry(1, 7);
  const matOptions = {
    color: 0xffffff,
    metalness: 1,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
  };
  if ('iridescence' in new THREE.MeshPhysicalMaterial({})) {
    matOptions.iridescence = 0.7;
    matOptions.iridescenceIOR = 1.6;
    matOptions.iridescenceThicknessRange = [300, 700];
  }
  const orb = new THREE.Mesh(orbGeom, new THREE.MeshPhysicalMaterial(matOptions));
  scene.add(orb);

  // Lumières colorées qui tournent (pink / cyan / amber — sans bleu)
  const lightA = new THREE.PointLight(0xf472b6, 14, 8); // pink
  const lightB = new THREE.PointLight(0x22d3ee, 14, 8); // cyan
  const lightC = new THREE.PointLight(0xfcd34d, 10, 8); // amber
  scene.add(lightA, lightB, lightC);

  // Rim light (derrière l'orbe) — illumine la silhouette, supprime le bord sombre
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
  rimLight.position.set(0, 0, -4);
  scene.add(rimLight);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  let maxSize = 0;
  function resize() {
    const w = mount.clientWidth || 40;
    const h = mount.clientHeight || 40;
    const size = Math.max(w, h, maxSize);
    if (size > maxSize) {
      maxSize = size;
      renderer.setSize(size, size, false);
    }
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  resize();

  function animate() {
    const t = performance.now() * 0.0009;

    orb.rotation.y = t * 0.55;
    orb.rotation.x = Math.sin(t * 0.35) * 0.18;
    orb.scale.setScalar(1 + Math.sin(t * 0.9) * 0.035);

    const r = 2.3;
    lightA.position.set(Math.cos(t * 0.8) * r,     Math.sin(t * 0.6) * 1.6, 2);
    lightB.position.set(Math.cos(t * 0.8 + 2.1) * r, Math.sin(t * 0.6 + 2.1) * 1.6, 1.8);
    lightC.position.set(Math.cos(t * 0.8 + 4.2) * r, Math.sin(t * 0.6 + 4.2) * 1.6, 2.2);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  if (window.ResizeObserver) new ResizeObserver(resize).observe(mount);

  three = { resize, scene, camera, renderer };
}

/* ===== INTRO ANIMATION ===== */
function playIntro() {
  if (!window.gsap) return;
  gsap.from('.logo-mark', { scale: 0.4, opacity: 0, duration: 0.9, ease: 'back.out(1.5)' });
  gsap.from('.logo-text', { y: 22, opacity: 0, duration: 0.7, delay: 0.25, ease: 'power3.out' });
  gsap.from('.logo-tagline', { y: 16, opacity: 0, duration: 0.6, delay: 0.4, ease: 'power3.out' });
  gsap.from('.search-form', { y: 30, opacity: 0, duration: 0.8, delay: 0.55, ease: 'power3.out' });
}

/* ===== HERO → COMPACT TRANSITION ===== */
function transitionToCompact() {
  if (!document.body.classList.contains('state-initial')) return;

  if (!window.Flip) {
    document.body.classList.remove('state-initial');
    return;
  }

  const targets = '.header, .header-inner, .logo, .logo-mark, .logo-content, .logo-text, .logo-tagline, .search-panel, .search-form';
  // background/boxShadow exclus : ils basculent instantanément au moment du class-swap
  // pour éviter les artefacts visuels (transparence partielle laissant voir le grid de points)
  const state = Flip.getState(targets, {
    props: 'borderRadius,padding,fontSize,maxWidth,margin,gap,letterSpacing',
    nested: true,
  });

  document.body.classList.remove('state-initial');

  Flip.from(state, {
    duration: 0.85,
    ease: 'power3.inOut',
    nested: true,
    absolute: false,
    onComplete: () => { if (three) three.resize(); },
  });
}

function initMap() {
  map = L.map('map', { preferCanvas: true }).setView([46.6, 2.3], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
}

function bindEvents() {
  document.getElementById('searchForm').addEventListener('submit', handleSearch);

  document.getElementById('radiusRange').addEventListener('input', e => {
    document.getElementById('radiusLabel').textContent = e.target.value + ' km';
  });

  const cityInput = document.getElementById('cityInput');
  cityInput.addEventListener('input', () => {
    selectedLocation = null;
    clearTimeout(geocodeTimer);
    geocodeTimer = setTimeout(() => geocodeSuggestions(cityInput.value), 350);
  });
  cityInput.addEventListener('blur', () => setTimeout(hideDropdown, 200));

  document.getElementById('filterInput').addEventListener('input', () => applyFilter());

  document.getElementById('selectAll').addEventListener('change', e => {
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
  });

  document.getElementById('resultsTable').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    sortState.dir = sortState.key === key ? sortState.dir * -1 : 1;
    sortState.key = key;
    renderTable(filteredResults);
  });

  document.getElementById('tableBody').addEventListener('click', e => {
    const mgrBtn = e.target.closest('.load-manager-btn');
    if (mgrBtn) {
      e.stopPropagation();
      loadManager(mgrBtn);
    }
  });
}

async function loadManager(btn) {
  const { name, cp, city, key } = btn.dataset;
  const cell = btn.closest('td');
  cell.innerHTML = '<span class="manager-loading">Recherche…</span>';
  try {
    const params = new URLSearchParams({ nom: name });
    if (cp) params.set('codePostal', cp);
    if (city) params.set('ville', city);
    const data = await fetch('/api/sirene?' + params).then(r => r.json());

    const biz = allResults.find(b => String(b.osmId) === key);
    if (data.manager && biz) {
      biz.manager = data.manager;
      if (data.siren) biz.siren = data.siren;
      cell.className = 'manager-cell';
      cell.textContent = data.manager;
    } else {
      cell.innerHTML = '<span class="no-data">Non trouvé</span>';
    }
  } catch {
    cell.innerHTML = '<span class="no-data">Erreur</span>';
  }
}

/* ===== WEBSITE CHECK (recherche web en un clic) ===== */
// Les moteurs de recherche bloquent l'accès automatisé côté serveur. On délègue
// donc la vérif au navigateur de l'utilisateur : un clic ouvre la recherche du
// commerce, il voit en un coup d'œil s'il a un site.
function renderVerifyCell(biz) {
  const q = encodeURIComponent(`${biz.name} ${biz.city || biz.codePostal || ''}`.trim());
  const url = `https://www.google.com/search?q=${q}`;
  return `<td><a class="verify-btn" href="${url}" target="_blank" rel="noopener" title="Ouvrir la recherche Google pour ce commerce">Chercher ↗</a></td>`;
}

/* ===== GEOCODE AUTOCOMPLETE ===== */
async function geocodeSuggestions(query) {
  if (query.length < 3) { hideDropdown(); return; }
  try {
    const data = await fetch('/api/geocode?' + new URLSearchParams({ q: query })).then(r => r.json());
    showDropdown(data);
  } catch { hideDropdown(); }
}

function showDropdown(items) {
  const list = document.getElementById('cityDropdown');
  list.innerHTML = '';
  if (!items.length) { list.classList.add('hidden'); return; }
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.display_name;
    li.addEventListener('mousedown', () => selectCity(item));
    list.appendChild(li);
  });
  list.classList.remove('hidden');
}

function hideDropdown() {
  document.getElementById('cityDropdown').classList.add('hidden');
}

function selectCity(item) {
  selectedLocation = item;
  document.getElementById('cityInput').value = item.display_name.split(',')[0].trim();
  document.getElementById('lat').value = item.lat;
  document.getElementById('lon').value = item.lon;
  hideDropdown();
  if (map) map.setView([item.lat, item.lon], 13);
}

/* ===== SEARCH ===== */
async function handleSearch(e) {
  e.preventDefault();

  if (!selectedLocation) {
    const cityVal = document.getElementById('cityInput').value.trim();
    if (!cityVal) return;
    try {
      const data = await fetch('/api/geocode?' + new URLSearchParams({ q: cityVal })).then(r => r.json());
      if (!data.length) { showError('Ville introuvable. Vérifiez le nom saisi.'); return; }
      selectCity(data[0]);
    } catch {
      showError('Impossible de géocoder la ville.');
      return;
    }
  }

  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  const radius = parseFloat(document.getElementById('radiusRange').value);
  const type = document.getElementById('typeSelect').value;
  const includeSirene = document.getElementById('includeSirene').checked;
  const googleApiKey = document.getElementById('googleKey').value.trim();

  lastSearchParams = { lat, lon, radius };
  setLoading(true);
  hideAll();

  // Première recherche → animation hero → compact
  if (isFirstSearch) {
    isFirstSearch = false;
    transitionToCompact();
  }

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon, radius, type, includeSirene, googleApiKey }),
      signal: controller.signal,
    });

    clearTimeout(fetchTimeout);

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erreur serveur');
    }

    const { count, results, overpassFailed, sireneFailed, sireneFallback } = await res.json();
    allResults = results;

    if (!count) {
      if (overpassFailed && sireneFailed) {
        showError('Les APIs publiques (OpenStreetMap + recherche-entreprises) sont injoignables. Réessaie dans quelques minutes.');
      } else if (overpassFailed) {
        showError('OpenStreetMap est injoignable et le registre SIRENE n\'a rien trouvé non plus. Réessaie ou élargis le rayon.');
      } else if (sireneFailed) {
        showError('OpenStreetMap n\'a rien trouvé et le registre SIRENE est injoignable. Réessaie ou élargis le rayon.');
      } else {
        document.getElementById('emptyState').classList.remove('hidden');
      }
    } else {
      filteredResults = [...allResults];
      renderAll();
      if (sireneFallback) {
        showError('OpenStreetMap est temporairement injoignable — résultats issus du registre SIRENE (noms approximatifs, site non vérifié). Réessaie plus tard pour la liste OSM complète.');
      } else if (overpassFailed || sireneFailed) {
        const which = overpassFailed && sireneFailed ? 'OpenStreetMap et SIRENE' : overpassFailed ? 'OpenStreetMap' : 'SIRENE';
        showError(`${which} injoignable — résultats incomplets. Réessaie pour récupérer le reste.`);
      }
    }
  } catch (err) {
    clearTimeout(fetchTimeout);
    if (err.name === 'AbortError') {
      showError('La recherche a pris trop de temps. Essayez un rayon plus petit.');
    } else {
      showError(err.message);
    }
  } finally {
    setLoading(false);
  }
}

/* ===== RENDER ===== */
function renderAll() {
  // Afficher le container AVANT de faire quoi que ce soit avec la carte
  document.getElementById('mainContent').style.display = 'block';
  document.getElementById('statusBar').classList.remove('hidden');

  renderStatusBar();
  renderTable(filteredResults);

  // invalidateSize() APRÈS que le container soit visible
  setTimeout(() => {
    map.invalidateSize();
    renderMap(filteredResults);
    if (lastSearchParams) {
      drawSearchCircle(lastSearchParams.lat, lastSearchParams.lon, lastSearchParams.radius);
    }
  }, 60);

  // Animation d'apparition des résultats (GSAP)
  if (window.gsap) {
    gsap.from('#statusBar', { y: -10, opacity: 0, duration: 0.5, ease: 'power2.out' });
    gsap.from('.map-pane', { y: 20, opacity: 0, duration: 0.6, delay: 0.05, ease: 'power3.out' });
    gsap.from('.table-pane', { y: 20, opacity: 0, duration: 0.6, delay: 0.1, ease: 'power3.out' });
    gsap.from('#tableBody tr', { y: 8, opacity: 0, duration: 0.35, stagger: 0.015, delay: 0.25, ease: 'power2.out' });
  }
}

function renderStatusBar() {
  const withPhone = allResults.filter(r => r.phone).length;
  const withManager = allResults.filter(r => r.manager).length;
  const withSocial = allResults.filter(r => r.socialMedia).length;
  let txt = `${allResults.length} prospect${allResults.length > 1 ? 's' : ''} · ${withPhone} avec tél. · ${withManager} gérants trouvés`;
  if (withSocial) txt += ` · ${withSocial} avec réseaux sociaux seulement`;
  document.getElementById('statusText').textContent = txt;
}

function renderTable(rows) {
  const body = document.getElementById('tableBody');
  body.innerHTML = '';

  if (sortState.key) {
    rows = [...rows].sort((a, b) => {
      const va = (a[sortState.key] || '').toString().toLowerCase();
      const vb = (b[sortState.key] || '').toString().toLowerCase();
      return va < vb ? -sortState.dir : va > vb ? sortState.dir : 0;
    });
  }

  document.getElementById('countBadge').textContent = rows.length + ' résultat' + (rows.length !== 1 ? 's' : '');

  rows.forEach(biz => {
    const tr = document.createElement('tr');

    const socialBadge = biz.socialMedia
      ? `<a href="${esc(biz.socialMedia)}" target="_blank" title="Réseau social uniquement : ${esc(biz.socialMedia)}" class="social-badge">📱</a>`
      : '';

    // Badge source : SIRENE = "à vérifier", OSM/Google = confirmé sans site
    const sourceBadge = biz.websiteUnknown
      ? `<span class="badge-unverified" title="Issu du registre SIRENE — site web non vérifié">?</span>`
      : '';

    const managerCell = biz.manager
      ? `<td class="manager-cell">${esc(biz.manager)}</td>`
      : `<td><button class="load-manager-btn" data-name="${esc(biz.name)}" data-cp="${esc(biz.codePostal || '')}" data-city="${esc(biz.city || '')}" data-key="${esc(String(biz.osmId || ''))}">Charger</button></td>`;

    const verifyCell = renderVerifyCell(biz);

    tr.innerHTML = `
      <td><input type="checkbox" class="row-check" /></td>
      <td title="${esc(biz.name)}">${esc(biz.name)} ${socialBadge}${sourceBadge}</td>
      <td><span class="tag-category">${esc(biz.category)}</span></td>
      <td title="${esc(biz.address)}">${esc(biz.address || '—')}</td>
      <td>${biz.phone
        ? `<a class="phone-link" href="tel:${esc(biz.phone)}">${esc(biz.phone)}</a>`
        : '<span class="no-data">—</span>'}</td>
      ${managerCell}
      ${verifyCell}
    `;

    tr.addEventListener('click', e => {
      if (e.target.type === 'checkbox' || e.target.tagName === 'A' || e.target.classList.contains('load-manager-btn')) return;
      flyToMarker(biz);
      tr.classList.toggle('selected');
    });

    body.appendChild(tr);
  });
}

function drawSearchCircle(lat, lon, radiusKm) {
  if (radiusCircle) map.removeLayer(radiusCircle);
  radiusCircle = L.circle([lat, lon], {
    radius: radiusKm * 1000,
    color: '#0f172a',
    fillColor: '#0f172a',
    fillOpacity: 0.04,
    weight: 2,
    dashArray: '6 4',
  }).addTo(map);
}

function renderMap(rows) {
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  if (!rows.length) return;

  const bounds = [];

  rows.forEach(biz => {
    if (!biz.lat || !biz.lon) return;

    const color = biz.phone ? '#16a34a' : '#ea580c';
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:11px;height:11px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 1px 5px rgba(0,0,0,.4)"></div>`,
      iconSize: [11, 11],
      iconAnchor: [5, 5],
    });

    const socialLine = biz.socialMedia
      ? `<div style="margin-top:4px;font-size:11px;color:#0891b2">📱 <a href="${esc(biz.socialMedia)}" target="_blank" style="color:#0891b2">Réseau social</a></div>`
      : '';

    const popup = `
      <div style="min-width:190px;font-family:system-ui,sans-serif;line-height:1.5">
        <strong style="font-size:14px">${esc(biz.name)}</strong>
        <div style="color:#64748b;font-size:12px">${esc(biz.category)}</div>
        ${biz.address ? `<div style="margin-top:4px;font-size:12px">📍 ${esc(biz.address)}</div>` : ''}
        ${biz.phone ? `<div style="font-size:13px">📞 <a href="tel:${esc(biz.phone)}" style="color:#0f172a;font-weight:600">${esc(biz.phone)}</a></div>` : '<div style="font-size:12px;color:#94a3b8">Pas de téléphone</div>'}
        ${biz.manager ? `<div style="font-size:12px;color:#16a34a">👤 ${esc(biz.manager)}</div>` : ''}
        ${socialLine}
      </div>
    `;

    const marker = L.marker([biz.lat, biz.lon], { icon })
      .addTo(map)
      .bindPopup(popup);

    markers.push(marker);
    bounds.push([biz.lat, biz.lon]);
  });

  if (bounds.length) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 15 });
  }
}

function flyToMarker(biz) {
  if (!biz.lat || !biz.lon) return;
  map.flyTo([biz.lat, biz.lon], 17, { duration: 0.7 });
  const m = markers.find(mk => {
    const ll = mk.getLatLng();
    return Math.abs(ll.lat - biz.lat) < 0.00001 && Math.abs(ll.lng - biz.lon) < 0.00001;
  });
  if (m) setTimeout(() => m.openPopup(), 750);
}

/* ===== FILTER ===== */
function applyFilter() {
  const q = (document.getElementById('filterInput').value || '').toLowerCase().trim();
  filteredResults = q
    ? allResults.filter(b =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.address || '').toLowerCase().includes(q) ||
        (b.category || '').toLowerCase().includes(q) ||
        (b.manager || '').toLowerCase().includes(q)
      )
    : [...allResults];
  renderTable(filteredResults);
  renderMap(filteredResults);
  if (lastSearchParams) drawSearchCircle(lastSearchParams.lat, lastSearchParams.lon, lastSearchParams.radius);
}

/* ===== EXPORT CSV ===== */
function exportCSV() {
  const checked = document.querySelectorAll('.row-check:checked');
  const rows = checked.length
    ? filteredResults.filter((_, i) => document.querySelectorAll('.row-check')[i]?.checked)
    : filteredResults;

  if (!rows.length) { alert('Aucun résultat à exporter.'); return; }

  const headers = ['Nom', 'Type', 'Adresse', 'Téléphone', 'Email', 'Gérant', 'SIREN', 'Réseaux sociaux', 'Source'];
  const csv = [
    headers.join(';'),
    ...rows.map(r => [
      csvCell(r.name), csvCell(r.category), csvCell(r.address),
      csvCell(r.phone), csvCell(r.email), csvCell(r.manager),
      csvCell(r.siren), csvCell(r.socialMedia), csvCell(r.source),
    ].join(';')),
  ].join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `prospects_${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===== UTILS ===== */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvCell(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return /[;"\n]/.test(s) ? `"${s}"` : s;
}

function setLoading(on) {
  const btn = document.getElementById('searchBtn');
  document.getElementById('searchBtnText').textContent = on ? 'Recherche en cours…' : '🔍 Rechercher';
  document.getElementById('searchBtnLoader').classList.toggle('hidden', !on);
  btn.disabled = on;
}

function hideAll() {
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('statusBar').classList.add('hidden');
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
}

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('errorState').classList.remove('hidden');
}
