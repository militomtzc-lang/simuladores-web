/* ISAC GAMES · progreso compartido: "jugado hoy" (hub) y racha global (Supabase, tabla isac_racha).
   hub.yml lo publica en la raíz del sitio. Cada juego lo carga en su <head> con
   <script src="../isac-progreso.js"></script> (lo inserta JuegosISAC/patch_progreso.py) y el hub con
   <script src="isac-progreso.js"></script>. Todo vive en el mismo origen, así que comparten localStorage.

   Cómo sabe que terminaste el reto de HOY sin tocar la lógica de cada juego: escucha cada vez que el juego
   guarda su partida en localStorage; si la clave es del día vigente (CDMX) y el juego ya terminó (gane o
   pierda), anota {juego: puntos} en isac_progreso_v1 y avisa una vez al día a isac_racha. El modo archivo
   (días pasados) no cuenta. Si algo falla, nunca rompe el juego (todo va en try/catch). */
(function () {
  if (window.ISAC_PROGRESO) return;
  var SB_URL = 'https://jssdaxtpmonhilbyugsw.supabase.co';
  var SB_KEY = 'sb_publishable_jqW3J8NzJH7rEGRht4L49Q_V9oTDcRo';
  var KEY = 'isac_progreso_v1';
  var store = window.localStorage;
  var rawGet = Storage.prototype.getItem, rawSet = Storage.prototype.setItem;

  /* Arreglo (2026-11-26): Missing XI creaba ids "dev_xxxxxxxxx" y game_scores.device_id es uuid, así que esos
     scores fallaban (400). Antes de que cargue el juego, un id que no sea UUID se cambia por uno nuevo. */
  try {
    var viejo = rawGet.call(store, 'isac_device_id');
    if (viejo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(viejo)) {
      store.removeItem('isac_device_id');
      deviceId();
    }
  } catch (e) {}

  function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); }
  function leer() { try { return JSON.parse(rawGet.call(store, KEY) || '{}') || {}; } catch (e) { return {}; } }
  function escribir(p) {
    try {
      var dias = Object.keys(p).sort();
      while (dias.length > 60) delete p[dias.shift()];
      rawSet.call(store, KEY, JSON.stringify(p));
    } catch (e) { /* sin espacio o bloqueado: no pasa nada */ }
  }
  function deviceId() {
    var id = rawGet.call(store, 'isac_device_id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
      try { rawSet.call(store, 'isac_device_id', id); } catch (e) {}
    }
    return id;
  }
  function hoyDe(d) { try { return typeof puzzle !== 'undefined' && puzzle && puzzle.date === d; } catch (e) { return false; } }

  /* [prefijo de la clave del juego, id del juego, f(valor guardado, fecha) -> puntos si terminó, o null].
     Las que leen variables del juego (isGameOver, calcScore...) solo funcionan dentro del juego; el hub usa
     las que leen el valor guardado y, para lo demás, lo que ya quedó anotado en isac_progreso_v1. */
  var DET = [
    ['isac_weddle_v2_', 'franchise-guesser', function (v, d) { return hoyDe(d) && isGameOver() ? (isSolved() ? Math.max(100, (9 - guesses.length) * 100) : 0) : null; }],
    ['isac_prev_', 'isactrivia', function (v) { return v && v.answered && Object.keys(v.answered).length >= 12 ? Object.keys(v.answered).reduce(function (a, k) { return a + (v.answered[k].earned || 0); }, 0) : null; }],
    ['isac_strands_v1_', 'strands', function (v, d) { return hoyDe(d) && isSolved() ? calcFinalScore() : null; }],
    ['isac_connections_v1_', 'connections', function (v, d) { return hoyDe(d) && isGameOver() ? calcScore() : null; }],
    ['isac_missing_xi_v1_', 'missing-xi', function (v) { return v && v.finished ? (v.score || 0) : null; }],
    ['isac_krillion_v1_', 'krillion', function (v, d) { return hoyDe(d) && isDone() ? calcScore() : null; }],
    ['isac_adivina_v1_', 'adivina', function (v, d) { return v && v.done ? (v.won ? (hoyDe(d) ? dailyScore() : (v.score || 0)) : 0) : null; }],
    ['isac_grid_v1_', 'grid', function (v) { return v && v.done ? (v.score || 0) : null; }]
  ];

  function detectar(key, raw) {
    for (var i = 0; i < DET.length; i++) {
      var pre = DET[i][0];
      if (key.indexOf(pre) !== 0) continue;
      var d = key.slice(pre.length);
      if (d !== hoy()) return null;
      var v = null;
      try { v = JSON.parse(raw); } catch (e) {}
      var pts = null;
      try { pts = DET[i][2](v, d); } catch (e) { pts = null; }
      if (pts === null || pts === undefined || isNaN(pts)) return null;
      return { juego: DET[i][1], fecha: d, pts: Math.round(+pts) };
    }
    return null;
  }

  function anotar(r) {
    var p = leer();
    var dia = p[r.fecha] || (p[r.fecha] = {});
    var antes = dia[r.juego];
    if (!antes || antes.pts !== r.pts) {
      dia[r.juego] = { pts: r.pts, t: Date.now() };
      escribir(p);
    }
    avisarRacha(r.juego);
  }

  var enviando = false;
  function avisarRacha(juego) {
    var d = hoy(), p = leer(), dia = p[d];
    if (!dia || dia._racha || enviando) return;
    if (!navigator.onLine && navigator.onLine !== undefined) return;
    enviando = true;
    var nick = (rawGet.call(store, 'isac_player_nickname') || '').slice(0, 40) || null;
    fetch(SB_URL + '/rest/v1/isac_racha', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ device_id: deviceId(), fecha: d, nickname: nick, juego: juego || null })
    }).then(function (res) {
      if (res.ok || res.status === 409) { var q = leer(); (q[d] = q[d] || {})._racha = true; escribir(q); }
    }).catch(function () {}).then(function () { enviando = false; });
  }

  /* 1) escuchar los guardados del juego */
  Storage.prototype.setItem = function (k, val) {
    var out = rawSet.apply(this, arguments);
    if (this === store && typeof k === 'string' && k.indexOf('isac_') === 0 && k !== KEY) {
      setTimeout(function () { var r = detectar(k, String(val)); if (r) anotar(r); }, 0);
    }
    return out;
  };

  /* 2) al abrir: revisar partidas de hoy ya terminadas (por si se jugaron antes de este script) y reintentar
        el aviso de racha si quedó pendiente (sin internet, etc.) */
  function revisar() {
    var d = hoy();
    for (var i = 0; i < DET.length; i++) {
      var k = DET[i][0] + d, raw = rawGet.call(store, k);
      if (raw) { var r = detectar(k, raw); if (r) anotar(r); }
    }
    var dia = leer()[d];
    if (dia && !dia._racha && Object.keys(dia).some(function (j) { return j.charAt(0) !== '_'; })) avisarRacha();
  }
  if (document.readyState === 'complete') setTimeout(revisar, 1500);
  else window.addEventListener('load', function () { setTimeout(revisar, 1500); });

  /* 3) para el hub */
  function jugadoHoy() {
    var d = hoy(), dia = leer()[d] || {}, out = {};
    Object.keys(dia).forEach(function (j) { if (j.charAt(0) !== '_') out[j] = dia[j].pts; });
    for (var i = 0; i < DET.length; i++) {  // respaldo: partidas de hoy que el hub puede leer directo
      if (out[DET[i][1]] !== undefined) continue;
      var raw = rawGet.call(store, DET[i][0] + d);
      if (raw) { var r = detectar(DET[i][0] + d, raw); if (r) out[r.juego] = r.pts; }
    }
    return out;
  }
  function rachaLocal() {
    var p = leer(), n = 0, dt = new Date(hoy() + 'T12:00:00Z');
    var tiene = function (s) { var x = p[s]; return x && Object.keys(x).some(function (j) { return j.charAt(0) !== '_'; }); };
    var s = dt.toISOString().slice(0, 10);
    if (!tiene(s)) { dt.setUTCDate(dt.getUTCDate() - 1); s = dt.toISOString().slice(0, 10); }
    while (tiene(s)) { n++; dt.setUTCDate(dt.getUTCDate() - 1); s = dt.toISOString().slice(0, 10); }
    return n;
  }
  function ranking(limit) {
    return fetch(SB_URL + '/rest/v1/rpc/isac_racha_ranking', {
      method: 'POST', cache: 'no-store',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_device: rawGet.call(store, 'isac_device_id'), p_limit: limit || 10 })
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* 4) sticker del ISACBOT del deporte del reto (Missing XI, ISAC-Grid y Connections; Krillion lo trae su skin;
        Adivina no, porque el deporte sería una pista). Se actualiza si el jugador cambia de día en el archivo. */
  var STICKER = { nfl: 'americano1', mlb: 'beis', nba: 'basket', fut: 'fut1', 'fútbol': 'fut1', futbol: 'fut1' };
  function deporteDelReto() {
    try {
      if (typeof puzzle === 'undefined' || !puzzle) return null;
      var path = location.pathname;
      if (/missing-?xi/.test(path)) return String(puzzle.sport || '').toLowerCase();
      if (/grid/.test(path)) return puzzle.league || null;
      if (/connections/.test(path)) {
        var t = puzzle.theme || '';
        return /\bMLB\b/.test(t) ? 'mlb' : /\bNFL\b/.test(t) ? 'nfl' : /\bNBA\b/.test(t) ? 'nba' : /f[uú]tbol/i.test(t) ? 'fut' : null;
      }
    } catch (e) {}
    return null;
  }
  function stickerDeporte() {
    try {
      var h1 = document.querySelector('h1');
      if (!h1) return;
      var file = STICKER[deporteDelReto()], img = document.getElementById('isac-sport-sticker');
      if (!file) { if (img) img.remove(); return; }
      if (!img) {
        img = document.createElement('img');
        img.id = 'isac-sport-sticker'; img.alt = ''; img.hidden = true;
        img.style.cssText = 'height:52px;width:auto;vertical-align:middle;margin-left:10px;';
        img.onload = function () { img.hidden = false; };
        img.onerror = function () { img.hidden = true; };
        h1.appendChild(img);
      }
      var src = '../assets/ISACLOGOS/' + file + '.webp';
      if (img.getAttribute('src') !== src) img.src = src;
    } catch (e) {}
  }
  setInterval(stickerDeporte, 1500);

  window.ISAC_PROGRESO = { hoy: hoy, jugadoHoy: jugadoHoy, rachaLocal: rachaLocal, ranking: ranking, revisar: revisar };
})();
