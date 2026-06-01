const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Exécute des tâches avec une concurrence max (évite de saturer les APIs)
async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array(Math.min(concurrency, items.length)).fill(0).map(worker));
  return results;
}

// Codes NAF par type de commerce (SIRENE)
const NAF_BY_TYPE = {
  restaurant:  ['56.10A', '56.10B', '56.10C', '56.21Z', '56.29A', '56.29B'],
  cafe:        ['56.30Z', '56.10B'],
  coiffeur:    ['96.02A'],
  beaute:      ['96.02B', '96.02A'],
  pharmacie:   ['47.73Z'],
  medecin:     ['86.21Z', '86.22C', '86.23Z', '86.22A'],
  hotel:       ['55.10Z', '55.20Z'],
  garage:      ['45.20A', '45.20B'],
  boulangerie: ['10.71C', '47.24Z'],
  epicerie:    ['47.11A', '47.11B', '47.11C', '47.11D', '47.11F'],
  boutique:    ['47.71Z', '47.72Z', '47.77Z'],
  artisan:     ['43.21A', '43.22A', '43.29A', '43.11Z'],
  tous: [
    '56.10A', '56.10B', '56.10C', '56.21Z', '56.30Z', // restau (trad/libre-service/rapide), traiteur, débit boissons
    '96.02A', '96.02B',                                // coiffure, beauté
    '47.11A', '47.11B', '47.11C', '47.11D', '47.11F', // alimentation
    '47.24Z', '10.71C',                                // boulangerie
    '47.71Z', '47.72Z', '47.73Z', '47.74Z',           // habillement, chaussures, pharma, médical
    '47.75Z', '47.76Z', '47.77Z', '47.78A', '47.78C', // parfumerie, fleuriste, bijouterie, optique, divers
    '55.10Z', '55.20Z',                                // hôtels
    '45.20A', '45.20B',                                // garage auto
    '86.21Z', '86.22A', '86.22C', '86.23Z',           // médecin, dentiste
    '93.13Z', '96.04Z',                                // sport, bien-être
  ],
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Domaines considérés comme "pas un vrai site web"
const SOCIAL_DOMAINS = [
  'instagram.com', 'facebook.com', 'fb.com', 'fb.me',
  'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com',
  'youtube.com', 'youtu.be', 'snapchat.com', 'pinterest.com',
  'linktr.ee', 'linkinbio', 'bento.me',
];

function isSocialMedia(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return SOCIAL_DOMAINS.some(d => url.includes(d));
  }
}

// Normalise un nom pour comparaison SIRENE (retire accents, sigles légaux, mots vides)
function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(sarl|sas|sasu|eurl|sci|snc|sa|le|la|les|de|du|des|et|au|aux|restaurant|hotel|cafe|bar|brasserie|pizzeria|boulangerie|salon)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameScore(search, candidate) {
  const s = normName(search);
  const c = normName(candidate);
  const words = s.split(' ').filter(w => w.length > 2);
  if (!words.length) return 0;
  return words.filter(w => c.includes(w)).length / words.length;
}

function cap(str) {
  return (str || '').charAt(0).toUpperCase() + (str || '').slice(1).toLowerCase();
}

// Retire les formes juridiques d'une dénomination légale pour l'affichage
// (ex: "OLD WILD WEST SAS" → "OLD WILD WEST"). Préserve la casse.
function stripLegalForm(name) {
  return (name || '')
    .replace(/\b(SARLU|SARL|SASU|SAS|EURL|SCEA|SELARL|SELAS|EARL|SNC|SCI|SCM|SA)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Mots typiques des sociétés d'exploitation / holdings (ex: "JFPM GLOBAL",
// "ADC RESEAU") : quand SIRENE n'a pas d'enseigne et qu'on tombe sur ce genre de
// raison sociale, ce n'est pas un commerce prospectable → on l'écarte.
const HOLDING_NAME_RE = /\b(HOLDING|GLOBAL|RESEAU|GROUPE|INVEST|INVESTISSEMENT|PARTICIPATION|PARTICIPATIONS|GESTION|FINANCE|FINANCIERE|PATRIMOINE|IMMOBILIER|IMMOBILIERE|CONSULTING|DEVELOPPEMENT)\b/i;

// Filtres OSM par type de commerce (plus larges qu'avant)
const OSM_TYPE_FILTERS = {
  restaurant:  '["amenity"~"restaurant|fast_food|food_court|biergarten"]',
  cafe:        '["amenity"~"cafe|bar|pub|nightclub"]',
  coiffeur:    '["shop"~"hairdresser|barber"]',
  beaute:      '["shop"~"hairdresser|barber|beauty|cosmetics|nail_salon|massage|tattoo"]',
  pharmacie:   '["amenity"="pharmacy"]',
  medecin:     '["amenity"~"doctors|clinic|dentist|optician|veterinary"]',
  hotel:       '["tourism"~"hotel|hostel|guest_house|motel|chalet"]',
  garage:      '["shop"~"car_repair|tyres|car_parts|car"]',
  boulangerie: '["shop"~"bakery|pastry"]',
  epicerie:    '["shop"~"convenience|supermarket|greengrocer|butcher|fishmonger|deli|grocery"]',
  boutique:    '["shop"~"clothes|shoes|jewelry|gift|sports|toys|books|electronics|mobile_phone|optician"]',
  artisan:     null, // handled in buildOverpassQuery
  tous:        null,
};

function buildOverpassQuery(lat, lon, radiusM, type) {
  const filter = OSM_TYPE_FILTERS[type];

  if (type === 'artisan') {
    return `[out:json][timeout:25];
(
  node["craft"](around:${radiusM},${lat},${lon});
  way["craft"](around:${radiusM},${lat},${lon});
);
out center;`;
  }

  if (!filter) {
    // "tous" — liste exhaustive
    return `[out:json][timeout:25];
(
  node["shop"](around:${radiusM},${lat},${lon});
  way["shop"](around:${radiusM},${lat},${lon});
  node["amenity"~"restaurant|cafe|bar|pub|fast_food|pharmacy|doctors|dentist|clinic|hairdresser|barber|veterinary|optician|tattoo|nightclub|casino|cinema|theatre|arts_centre"](around:${radiusM},${lat},${lon});
  way["amenity"~"restaurant|cafe|bar|pub|fast_food|pharmacy|doctors|dentist|clinic|hairdresser|barber|veterinary|optician|tattoo|nightclub|casino|cinema|theatre|arts_centre"](around:${radiusM},${lat},${lon});
  node["craft"](around:${radiusM},${lat},${lon});
  way["craft"](around:${radiusM},${lat},${lon});
  node["tourism"~"hotel|hostel|guest_house|motel|chalet"](around:${radiusM},${lat},${lon});
  way["tourism"~"hotel|hostel|guest_house|motel|chalet"](around:${radiusM},${lat},${lon});
  node["leisure"~"fitness_centre|sports_centre|dance|bowling_alley|swimming_pool"](around:${radiusM},${lat},${lon});
  way["leisure"~"fitness_centre|sports_centre|dance|bowling_alley|swimming_pool"](around:${radiusM},${lat},${lon});
);
out center;`;
  }

  return `[out:json][timeout:25];
(
  node${filter}(around:${radiusM},${lat},${lon});
  way${filter}(around:${radiusM},${lat},${lon});
);
out center;`;
}

async function queryOverpass(overpassQuery) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
  ];
  // On interroge les 3 endpoints EN PARALLÈLE et on garde la 1ère réponse valide.
  // Évite qu'un endpoint lent (overpass-api.de est souvent surchargé) n'affame les
  // autres. Timeout généreux : overpass-api.de répond en ~1s quand il va bien mais
  // peut traîner 10-13s en charge ; couper trop tôt le fait échouer pour rien.
  const timeout = 13000;
  const body = `data=${encodeURIComponent(overpassQuery)}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Trace/1.0' };

  try {
    return await Promise.any(
      endpoints.map(ep =>
        axios.post(ep, body, { headers, timeout }).then(r => r.data).catch(err => {
          console.warn(`Overpass (${ep}): ${err.response?.status || err.message}`);
          throw err;
        })
      )
    );
  } catch (err) {
    // Promise.any rejette avec une AggregateError quand TOUS les endpoints échouent
    const rejections = err?.errors || [];
    const has429 = rejections.some(e => e?.response?.status === 429);
    throw new Error(
      has429
        ? 'Serveur Overpass surchargé. Réessayez dans 1 minute.'
        : 'Impossible de joindre l\'API de cartographie (Overpass). Réessayez dans quelques instants.'
    );
  }
}

function extractBusinesses(elements) {
  const seen = new Set();
  return elements.map(el => {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon || !tags.name) return null;

    const key = normName(tags.name) + '_' + lat.toFixed(4) + '_' + lon.toFixed(4);
    if (seen.has(key)) return null;
    seen.add(key);

    // Détecter les réseaux sociaux dans les champs website/contact
    const rawWebsite = tags.website || tags['contact:website'] || tags.url || null;
    const hasSocialOnly = rawWebsite && isSocialMedia(rawWebsite);

    // Si site web réel → exclure ce commerce
    if (rawWebsite && !hasSocialOnly) return null;

    // Commerce explicitement fermé dans OSM (opening_hours=closed/off) → écarter :
    // ce sont des fiches d'établissements disparus, inutiles pour la prospection.
    const openingHours = tags.opening_hours || null;
    if (openingHours && /^(closed|off)$/i.test(openingHours.trim())) return null;

    return {
      osmId: el.id,
      osmType: el.type, // 'node' ou 'way' — utile pour Nominatim lookup
      name: tags.name.trim(),
      lat, lon,
      phone: normalizePhone(
        tags.phone ||
        tags['contact:phone'] ||
        tags['contact:mobile'] ||
        tags['phone:mobile'] ||
        tags['contact:phone_1'] ||
        tags.telephone ||
        null
      ),
      website: null,
      email: tags.email || tags['contact:email'] || null,
      address: buildAddress(tags),
      codePostal: tags['addr:postcode'] || null,
      city: tags['addr:city'] || null,
      category: tags.amenity || tags.shop || tags.craft || tags.tourism || tags.leisure || 'commerce',
      manager: null,
      source: 'OSM',
      socialMedia: hasSocialOnly ? rawWebsite : null,
      openingHours,
    };
  }).filter(Boolean);
}

function normalizePhone(p) {
  if (!p) return null;
  p = p.trim().replace(/[\s\-\.\(\)]/g, '');
  if (p.startsWith('+33') && p.length === 12) p = '0' + p.slice(3);
  if (p.startsWith('0') && p.length === 10) {
    return p.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
  }
  return p;
}

function buildAddress(tags) {
  return [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:postcode'],
    tags['addr:city'],
  ].filter(Boolean).join(' ') || null;
}

// Recherche Google Places Nearby Search — trouve des commerces NON présents dans OSM
const GOOGLE_TYPE_MAP = {
  restaurant: 'restaurant',
  cafe: 'bar',
  coiffeur: 'hair_care',
  beaute: 'beauty_salon',
  pharmacie: 'pharmacy',
  medecin: 'doctor',
  hotel: 'lodging',
  garage: 'car_repair',
  boulangerie: 'bakery',
  epicerie: 'grocery_or_supermarket',
  boutique: 'clothing_store',
  artisan: 'general_contractor',
  tous: null,
};

async function searchWithGoogle(lat, lon, radiusM, type, apiKey) {
  const placeType = GOOGLE_TYPE_MAP[type] ?? null;
  const places = [];
  let pageToken = null;
  let pages = 0;

  do {
    const params = {
      location: `${lat},${lon}`,
      radius: Math.min(radiusM, 50000),
      key: apiKey,
    };
    if (placeType) params.type = placeType;
    if (pageToken) { params.pagetoken = pageToken; await sleep(2000); }

    try {
      const { data } = await axios.get(
        'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        { params, timeout: 12000 }
      );

      if (data.status === 'REQUEST_DENIED') {
        throw new Error('Clé API Google invalide ou l\'API Places n\'est pas activée dans Google Cloud Console.');
      }
      if (data.status === 'OVER_QUERY_LIMIT') {
        throw new Error('Quota Google Places dépassé pour aujourd\'hui.');
      }

      places.push(...(data.results || []));
      pageToken = data.next_page_token;
      pages++;
    } catch (err) {
      if (err.message.startsWith('Clé API') || err.message.startsWith('Quota')) throw err;
      console.warn('Google Nearby Search error:', err.message);
      break;
    }
  } while (pageToken && pages < 3 && places.length < 180);

  // Place Details en parallèle (website + téléphone)
  const CONCURRENCY = 10;
  const results = [];

  for (let i = 0; i < places.length; i += CONCURRENCY) {
    const batch = places.slice(i, i + CONCURRENCY);
    const details = await Promise.all(batch.map(p => getPlaceDetails(p.place_id, apiKey)));

    for (let j = 0; j < batch.length; j++) {
      const place = batch[j];
      const d = details[j];
      const website = d?.website || null;

      // Exclure les commerces avec un vrai site web
      if (website && !isSocialMedia(website)) continue;

      results.push({
        osmId: place.place_id,
        osmType: 'google',
        name: place.name,
        lat: place.geometry.location.lat,
        lon: place.geometry.location.lng,
        phone: normalizePhone(d?.formatted_phone_number || null),
        website: null,
        email: null,
        address: place.vicinity || null,
        codePostal: null,
        city: null,
        category: placeType || (place.types?.[0]?.replace(/_/g, ' ') ?? 'commerce'),
        manager: null,
        source: 'Google',
        socialMedia: website && isSocialMedia(website) ? website : null,
      });
    }
  }

  return results;
}

async function getPlaceDetails(placeId, apiKey) {
  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/place/details/json',
      {
        params: { place_id: placeId, fields: 'website,formatted_phone_number', key: apiKey },
        timeout: 6000,
      }
    );
    return data.result || null;
  } catch {
    return null;
  }
}

// Extrait le gérant depuis un résultat SIRENE (entité de l'API recherche-entreprises)
function extractManagerInfo(r) {
  const dirigeants = r.dirigeants || [];
  const gerant = dirigeants.find(d => /g[ée]rant|directeur|pr[ée]sident|associ[ée]/i.test(d.qualite || ''))
    || dirigeants[0];
  if (!gerant) return null;
  const prenom = gerant.prenoms || gerant.prenom || null;
  const manager = prenom
    ? `${cap(prenom.split(' ')[0])} ${(gerant.nom || '').toUpperCase()}` +
      (gerant.qualite ? ` (${gerant.qualite})` : '')
    : gerant.denomination || null;
  return manager?.trim() || null;
}

// Recherche le gérant d'un commerce par nom + plusieurs stratégies
async function fetchGerant(name, codePostal, city) {
  const strategies = [];
  if (codePostal) strategies.push({ q: name, code_postal: codePostal, limite: 5 });
  if (city && city.toLowerCase() !== name.toLowerCase()) strategies.push({ q: `${name} ${city}`, limite: 5 });
  strategies.push({ q: name, limite: 5 });

  for (const params of strategies) {
    try {
      const { data } = await axios.get('https://recherche-entreprises.api.gouv.fr/search', {
        params, timeout: 3000,
      });

      const results = data.results || [];
      if (!results.length) continue;

      const scored = results
        .map(r => ({ r, score: nameScore(name, r.nom_complet) }))
        .filter(x => x.score >= 0.25)
        .sort((a, b) => b.score - a.score);

      if (!scored.length) continue;
      const best = scored[0].r;
      const manager = extractManagerInfo(best);
      if (manager) return { manager, siren: best.siren };
    } catch (err) {
      console.warn('SIRENE error:', err.message);
    }
  }

  return { manager: null };
}

// Pagine un endpoint SIRENE (search ou near_point) jusqu'à 3 pages de 25.
// Retourne { items, ok } : ok = true si la 1ère page a répondu (même vide).
async function fetchSirenePages(url, baseParams, label, deadline) {
  const items = [];
  let totalPages = 99;
  let ok = false;
  for (let page = 1; page <= Math.min(totalPages, 3); page++) {
    if (deadline && Date.now() > deadline) break;
    try {
      const { data } = await axios.get(url, {
        params: { ...baseParams, per_page: 25, page },
        timeout: 6000,
      });
      if (page === 1) ok = true;
      totalPages = data.total_pages || 1;
      const results = data.results || [];
      if (!results.length) break;
      items.push(...results);
    } catch (err) {
      console.warn(`SIRENE ${label} page ${page}:`, err.message);
      break;
    }
  }
  return { items, ok };
}

// Recherche SIRENE par lat/long/rayon via near_point.
// - type précis : un appel par code NAF (en parallèle)
// - "tous" : UN seul appel sans filtre NAF (sinon 44 codes = storm de requêtes → 429)
async function searchFromSIRENE(lat, lon, radiusKm, type, deadline) {
  const radius = Math.min(radiusKm, 50);
  let perNaf;

  if (type === 'tous') {
    const res = await fetchSirenePages(
      'https://recherche-entreprises.api.gouv.fr/near_point',
      { lat, long: lon, radius },
      'near_point tous', deadline
    );
    perNaf = [res];
  } else {
    const nafCodes = NAF_BY_TYPE[type] || NAF_BY_TYPE['tous'];
    perNaf = await runWithConcurrency(
      nafCodes,
      naf => fetchSirenePages(
        'https://recherche-entreprises.api.gouv.fr/near_point',
        { activite_principale: naf, lat, long: lon, radius },
        `near_point ${naf}`, deadline
      ),
      6
    );
  }

  if (!perNaf.some(r => r.ok)) {
    throw new Error('SIRENE injoignable');
  }

  const allItems = perNaf.flatMap(r => r.items);
  const seen = new Set();
  const results = [];

  for (const r of allItems) {
    // Société fermée / cessée au niveau de l'unité légale → exclure
    if (r.etat_administratif !== 'A') continue;
    if (seen.has(r.siren)) continue;

    // Grandes entreprises et ETI : groupes de restauration collective, chaînes,
    // sièges de cantines (ex: Sodexo déclaré en 56.10A) — jamais des prospects
    // locaux, et tous équipés d'un site web. On les écarte.
    if (r.categorie_entreprise === 'GE' || r.categorie_entreprise === 'ETI') continue;

    // Localisation : on privilégie un ÉTABLISSEMENT (le commerce réel) ACTIF dans
    // le rayon, et on ne retombe sur le siège qu'en dernier recours. On exclut les
    // établissements fermés (etat F OU date_fermeture renseignée) pour ne pas
    // remonter d'anciens points de vente disparus.
    const candidates = [...(r.matching_etablissements || []), r.siege]
      .filter(c => c && c.etat_administratif === 'A' && !c.date_fermeture);
    let loc = null;
    for (const c of candidates) {
      const la = parseFloat(c.latitude), lo = parseFloat(c.longitude);
      if (la && lo && haversineKm(lat, lon, la, lo) <= radiusKm) { loc = c; break; }
    }
    // Aucun établissement actif géolocalisé dans le rayon → pas un commerce réel
    // implanté sur place (siège ailleurs, activité sans point de vente…) → exclure
    if (!loc) continue;

    const lat2 = parseFloat(loc.latitude);
    const lon2 = parseFloat(loc.longitude);

    // Nom : enseigne puis nom commercial de l'établissement retenu en priorité ;
    // dénomination légale (sans forme juridique) seulement faute de mieux.
    let tradeName = (loc.liste_enseignes?.[0] || loc.nom_commercial || '').trim();
    if (!tradeName) {
      // Pas d'enseigne : on retombe sur la raison sociale. Si elle ressemble à une
      // société d'exploitation/holding, ce n'est pas un commerce réel → on écarte.
      if (HOLDING_NAME_RE.test(r.nom_complet || '')) continue;
      tradeName = stripLegalForm(r.nom_complet);
    }
    if (!tradeName) continue;

    seen.add(r.siren);
    results.push({
      osmId: r.siren,
      osmType: 'sirene',
      name: tradeName,
      lat: lat2 || null,
      lon: lon2 || null,
      phone: null,
      website: null,
      email: null,
      address: loc.adresse || null,
      codePostal: loc.code_postal || null,
      city: loc.libelle_commune || null,
      category: type === 'tous' ? (loc.activite_principale || r.activite_principale || 'commerce') : type,
      manager: extractManagerInfo(r),
      siren: r.siren,
      source: 'SIRENE',
      websiteUnknown: true,
    });
  }

  return results;
}

// Classe les prospects du + pertinent au - pertinent pour de la prospection
// terrain (porte-à-porte). Critères, par ordre d'importance :
//  - proximité du point de recherche (on démarche d'abord ce qui est à côté) ;
//  - fiche "vivante" : un commerce fermé/fantôme n'a en général ni téléphone,
//    ni horaires, ni adresse complète → il retombe naturellement en bas ;
//  - source : OSM (présence réelle + absence de site vérifiée) prime sur SIRENE
//    (noms approximatifs, site non vérifié).
// Attache aussi distanceKm à chaque résultat (utile au front).
function rankByRelevance(businesses, centerLat, centerLon) {
  for (const b of businesses) {
    const d = (b.lat && b.lon)
      ? haversineKm(centerLat, centerLon, b.lat, b.lon)
      : 99;
    b.distanceKm = Math.round(d * 100) / 100;

    let score = -d * 10;          // chaque km d'éloignement coûte 10 pts
    if (b.phone) score += 25;     // joignable = exploitable tout de suite
    if (b.openingHours) score += 15; // horaires renseignés = fiche entretenue
    if (b.address) score += 8;
    if (b.manager) score += 6;
    if (b.socialMedia) score += 5;
    if (b.source === 'OSM') score += 10;
    if (b.websiteUnknown) score -= 8; // SIRENE : site non vérifié → moins sûr
    b._score = score;
  }
  return businesses.sort((a, b) => b._score - a._score);
}

/* ===== ROUTES ===== */

app.get('/api/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q, format: 'json', limit: 5, addressdetails: 1 },
      headers: { 'User-Agent': 'Trace/1.0' },
      timeout: 8000,
    });
    res.json(data.map(d => ({
      display_name: d.display_name,
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache mémoire des recherches RÉUSSIES (les APIs publiques Overpass sont lentes
// et instables ; une zone déjà chargée reste ainsi instantanée et cohérente).
const searchCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1h

function cacheKey(lat, lon, radius, type, includeSirene) {
  return `${(+lat).toFixed(3)}_${(+lon).toFixed(3)}_${radius}_${type || 'tous'}_${includeSirene ? 's1' : 's0'}`;
}

app.post('/api/search', async (req, res) => {
  const { lat, lon, radius, type, includeSirene, googleApiKey } = req.body;
  if (!lat || !lon || !radius) {
    return res.status(400).json({ error: 'lat, lon et radius sont requis' });
  }

  // Rayon plafonné à 3 km : au-delà, les requêtes Overpass deviennent lourdes/instables.
  const radiusM = Math.min(Math.max(radius * 1000, 500), 3000);
  const useGoogle = !!(googleApiKey && googleApiKey.trim().length > 10);
  const wantSirene = !!includeSirene;
  const startTime = Date.now();
  const DEADLINE = startTime + 23000;

  // Cache hit (uniquement pour les recherches sans clé Google)
  const key = cacheKey(lat, lon, radius, type, wantSirene);
  if (!useGoogle) {
    const cached = searchCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      console.log(`Cache hit — ${cached.businesses.length} results`);
      return res.json({
        count: cached.businesses.length,
        results: cached.businesses.slice(0, 500),
        overpassFailed: false,
        sireneFailed: false,
        sireneFallback: false,
        cached: true,
      });
    }
  }

  try {
    let businesses;
    let overpassFailed = false;
    let sireneFailed = false;
    let sireneFallback = false;

    if (useGoogle) {
      businesses = await searchWithGoogle(lat, lon, radiusM, type || 'tous', googleApiKey.trim());
    } else {
      // OSM est la source principale (vrais noms de façade, lieux réels, tag
      // `website` fiable). SIRENE n'est interrogé qu'à la demande car ses noms
      // sont approximatifs et il n'a aucune info de site web.
      const overpassQuery = buildOverpassQuery(lat, lon, radiusM, type || 'tous');

      const tasks = [queryOverpass(overpassQuery).then(data => extractBusinesses(data.elements || []))];
      if (wantSirene) {
        tasks.push(searchFromSIRENE(lat, lon, radiusM / 1000, type || 'tous', DEADLINE));
      }
      const [osmResult, sireneResult] = await Promise.allSettled(tasks);

      const osmBusinesses = osmResult.status === 'fulfilled' ? osmResult.value : [];
      overpassFailed = osmResult.status === 'rejected';
      if (overpassFailed) console.warn('Overpass:', osmResult.reason?.message);

      if (!wantSirene) {
        // Filet de sécurité : Overpass est instable. S'il tombe (ou ne renvoie
        // rien), on interroge SIRENE pour ne jamais laisser l'utilisateur à 0,
        // même si ses noms sont approximatifs. Signalé via sireneFallback.
        if (overpassFailed || osmBusinesses.length === 0) {
          try {
            businesses = await searchFromSIRENE(lat, lon, radiusM / 1000, type || 'tous', DEADLINE);
            sireneFallback = true;
          } catch (err) {
            console.warn('SIRENE fallback:', err.message);
            sireneFailed = true;
            businesses = osmBusinesses;
          }
        } else {
          businesses = osmBusinesses;
        }
      } else {
        const sireneBusinesses = sireneResult.status === 'fulfilled' ? sireneResult.value : [];
        sireneFailed = sireneResult.status === 'rejected';
        if (sireneFailed) console.warn('SIRENE:', sireneResult.reason?.message);

        // Déduplication OSM↔SIRENE : même nom normalisé ET à moins de 200m.
        // La vérification de distance évite d'éliminer un commerce SIRENE à cause
        // d'un homonyme OSM situé ailleurs dans la commune.
        const osmByName = new Map();
        for (const b of osmBusinesses) {
          const n = normName(b.name);
          if (!osmByName.has(n)) osmByName.set(n, []);
          osmByName.get(n).push(b);
        }
        const sireneSupplement = sireneBusinesses.filter(b => {
          const n = normName(b.name);
          if (n.length <= 1) return false;
          const osmMatches = osmByName.get(n);
          if (!osmMatches) return true;
          return !osmMatches.some(o =>
            b.lat && b.lon && o.lat && o.lon &&
            haversineKm(b.lat, b.lon, o.lat, o.lon) < 0.2
          );
        });

        businesses = [...osmBusinesses, ...sireneSupplement];
      }
    }

    // Tri par pertinence : les prospects les plus exploitables (proches, fiche
    // vivante) d'abord. Indispensable AVANT la coupe à 500 pour ne pas écarter de
    // bons prospects au profit de fiches vides/fermées.
    businesses = rankByRelevance(businesses, lat, lon);

    // On ne cache que les recherches complètes — sinon on figerait un résultat
    // dégradé (Overpass tombé, ou repli SIRENE) pendant 1h.
    if (!useGoogle && !overpassFailed && !sireneFailed && !sireneFallback) {
      searchCache.set(key, { businesses, ts: Date.now() });
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Search done in ${elapsed}s — ${businesses.length} results${sireneFallback ? ' (repli SIRENE)' : ''}`);
    res.json({
      count: businesses.length,
      results: businesses.slice(0, 500),
      overpassFailed,
      sireneFailed,
      sireneFallback,
    });
  } catch (err) {
    console.error(err.message);
    res.status(503).json({ error: err.message });
  }
});

// Enrichissement manuel d'un gérant depuis le frontend
app.get('/api/sirene', async (req, res) => {
  const { nom, codePostal, ville } = req.query;
  if (!nom) return res.status(400).json({ error: 'nom requis' });
  const result = await fetchGerant(nom, codePostal, ville);
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n🚀 Trace → http://localhost:${PORT}\n`));
