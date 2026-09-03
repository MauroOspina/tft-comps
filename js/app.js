// MetaComps — lógica de la tier list. Sin build step: este archivo se
// carga directo como <script> después de config.js y del cliente de
// Supabase (ver index.html).

const TIERS = [
  { key: "S", label: "S — Prismática", badge: "S" },
  { key: "A", label: "A — Oro", badge: "A" },
  { key: "B", label: "B — Plata", badge: "B" },
  { key: "C", label: "C — Bronce", badge: "C" },
  { key: "UNRANKED", label: "Sin calificar todavía", badge: "?" },
];

// El agente programado guarda el tier tal cual lo lee de la página fuente
// (S/A/B/C/X, donde X suele ser "situacional"). Mismo orden visual que la
// tier list del grupo, más una entrada para lo que no matchee ninguna letra
// conocida en vez de perderlo silenciosamente.
const META_TIERS = [
  { key: "S", label: "S — Prismática", badge: "S" },
  { key: "A", label: "A — Oro", badge: "A" },
  { key: "B", label: "B — Plata", badge: "B" },
  { key: "C", label: "C — Bronce", badge: "C" },
  { key: "X", label: "Situacional", badge: "X" },
  { key: "OTRO", label: "Otras", badge: "·" },
];

function tierFor(avg, count) {
  if (count === 0) return "UNRANKED";
  if (avg >= 4.5 && count >= 3) return "S";
  if (avg >= 3.75) return "A";
  if (avg >= 3) return "B";
  return "C";
}

// ---------- identidad del que califica (sin login, es un grupo de confianza) ----------

const RATER_ID_KEY = "metacomps_rater_id";
const RATER_NAME_KEY = "metacomps_rater_name";

function getRaterId() {
  let id = localStorage.getItem(RATER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(RATER_ID_KEY, id);
  }
  return id;
}

function getRaterName() {
  return localStorage.getItem(RATER_NAME_KEY) || "";
}

function setRaterName(name) {
  localStorage.setItem(RATER_NAME_KEY, name.trim());
}

// ---------- cliente Supabase ----------

let db = null;
const configured =
  typeof SUPABASE_URL === "string" &&
  !SUPABASE_URL.includes("TU-PROYECTO") &&
  typeof SUPABASE_ANON_KEY === "string" &&
  !SUPABASE_ANON_KEY.includes("TU-ANON-KEY");

if (configured) {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  document.getElementById("setup-banner").hidden = false;
}

function showError(message) {
  const el = document.getElementById("error-banner");
  el.textContent = message;
  el.hidden = false;
}

// ---------- carga y agregación ----------

let comps = [];
let ratingsByComp = new Map(); // comp_id -> { avg, count, mine }

async function loadAll() {
  if (!db) return;
  const [{ data: compRows, error: compErr }, { data: ratingRows, error: ratingErr }] =
    await Promise.all([
      db.from("comps").select("*").order("created_at", { ascending: false }),
      db.from("ratings").select("*"),
    ]);

  if (compErr || ratingErr) {
    showError("No se pudo cargar la tier list: " + (compErr || ratingErr).message);
    return;
  }

  comps = compRows || [];
  ratingsByComp = new Map();
  const myId = getRaterId();

  for (const c of comps) ratingsByComp.set(c.id, { sum: 0, count: 0, mine: 0 });

  for (const r of ratingRows || []) {
    const bucket = ratingsByComp.get(r.comp_id);
    if (!bucket) continue;
    bucket.sum += r.score;
    bucket.count += 1;
    if (r.rater_id === myId) bucket.mine = r.score;
  }

  render();
}

// ---------- render ----------

const tierListEl = document.getElementById("tier-list");
const tierSectionTpl = document.getElementById("tier-section-template");
const compCardTpl = document.getElementById("comp-card-template");

function render() {
  tierListEl.innerHTML = "";

  const grouped = new Map(TIERS.map((t) => [t.key, []]));
  for (const c of comps) {
    const bucket = ratingsByComp.get(c.id) || { sum: 0, count: 0, mine: 0 };
    const avg = bucket.count ? bucket.sum / bucket.count : 0;
    grouped.get(tierFor(avg, bucket.count)).push({ comp: c, avg, count: bucket.count, mine: bucket.mine });
  }
  for (const list of grouped.values()) list.sort((a, b) => b.avg - a.avg || b.count - a.count);

  if (comps.length === 0) {
    tierListEl.innerHTML = '<p class="loading">Todavía no hay comps. ¡Aportá la primera!</p>';
    return;
  }

  for (const tier of TIERS) {
    const entries = grouped.get(tier.key);
    if (entries.length === 0 && tier.key === "UNRANKED") continue;

    const section = tierSectionTpl.content.cloneNode(true);
    const sectionEl = section.querySelector(".tier-section");
    sectionEl.dataset.tier = tier.key;
    sectionEl.querySelector(".tier-badge").textContent = tier.badge;
    sectionEl.querySelector(".tier-name").textContent = tier.label;
    sectionEl.querySelector(".tier-count").textContent = `${entries.length} comp${entries.length === 1 ? "" : "s"}`;

    const grid = sectionEl.querySelector(".comp-grid");
    const emptyEl = sectionEl.querySelector(".tier-empty");
    if (entries.length === 0) {
      emptyEl.hidden = false;
    } else {
      emptyEl.remove();
      for (const entry of entries) grid.appendChild(buildCard(entry));
    }

    tierListEl.appendChild(section);
  }
}

function buildCard({ comp, avg, count, mine }) {
  const card = compCardTpl.content.cloneNode(true);

  card.querySelector(".comp-name").textContent = comp.name;
  card.querySelector(".comp-playstyle").textContent = comp.playstyle;

  const champRow = card.querySelector(".champion-row");
  for (const champ of comp.champions || []) {
    champRow.appendChild(buildChampionChip(champ));
  }

  card.querySelector(".comp-items").textContent = comp.core_items || "";
  card.querySelector(".comp-description").textContent = comp.description || "";

  const hexWrap = card.querySelector(".rating-hexes");
  for (let score = 1; score <= 5; score++) {
    const hex = document.createElement("button");
    hex.type = "button";
    hex.className = "rating-hex";
    hex.dataset.score = String(score);
    hex.dataset.filled = String(score <= mine);
    hex.title = `Calificar ${score}/5`;
    hex.addEventListener("mouseenter", () => previewHexes(hexWrap, score));
    hex.addEventListener("mouseleave", () => previewHexes(hexWrap, mine));
    hex.addEventListener("click", () => rate(comp.id, score));
    hexWrap.appendChild(hex);
  }

  card.querySelector(".rating-summary").textContent = count
    ? `${avg.toFixed(1)} · ${count} voto${count === 1 ? "" : "s"}`
    : "sin votos";

  const submitted = comp.submitted_by || "Anónimo";
  const date = new Date(comp.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  card.querySelector(".comp-meta").textContent = `por ${submitted} · ${date}`;

  return card;
}

function previewHexes(hexWrap, upTo) {
  hexWrap.querySelectorAll(".rating-hex").forEach((hex) => {
    hex.dataset.filled = String(Number(hex.dataset.score) <= upTo);
  });
}

// ---------- meta (solo lectura, la escribe el agente programado) ----------

const metaTierListEl = document.getElementById("meta-tier-list");
const metaBandTpl = document.getElementById("meta-tier-band-template");
const metaChipTpl = document.getElementById("meta-comp-chip-template");
const metaSourceInfoEl = document.getElementById("meta-source-info");

async function loadMeta() {
  if (!db) return;
  const { data, error } = await db.from("meta_comps").select("*").order("tier", { ascending: true });
  if (error) {
    metaTierListEl.innerHTML = "";
    return showError("No se pudo cargar el meta: " + error.message);
  }
  renderMeta(data || []);
}

function renderMeta(rows) {
  metaTierListEl.innerHTML = "";

  if (rows.length === 0) {
    metaTierListEl.innerHTML =
      '<p class="loading">Todavía no corrió el agente que lee el meta. Volvé más tarde.</p>';
    metaSourceInfoEl.textContent = "";
    return;
  }

  const latest = rows.reduce((max, r) => (r.fetched_at > max ? r.fetched_at : max), rows[0].fetched_at);
  const allSourceNames = new Set();
  for (const row of rows) for (const s of row.sources || []) allSourceNames.add(s.name);
  metaSourceInfoEl.textContent = `según ${[...allSourceNames].join(", ") || "—"} · ${relativeTime(latest)}`;

  const grouped = new Map(META_TIERS.map((t) => [t.key, []]));
  for (const row of rows) {
    const key = grouped.has((row.tier || "").toUpperCase()) ? row.tier.toUpperCase() : "OTRO";
    grouped.get(key).push(row);
  }

  for (const tier of META_TIERS) {
    const entries = grouped.get(tier.key);
    if (entries.length === 0) continue;

    const band = metaBandTpl.content.cloneNode(true);
    const bandEl = band.querySelector(".tier-band");
    bandEl.dataset.tier = tier.key;
    bandEl.querySelector(".tier-tag-letter").textContent = tier.badge;
    bandEl.querySelector(".tier-tag-label").textContent = tier.label.split(" — ")[1] || tier.label;

    const scroll = bandEl.querySelector(".tier-band-scroll");
    for (const row of entries) scroll.appendChild(buildMetaChip(row));

    metaTierListEl.appendChild(band);
  }
}

// Cada comp del meta se ve como un racimo de íconos de campeón, sin
// nombre a la vista — igual que la tier list de TFTAcademy en la que nos
// basamos. El nombre y el detalle de qué fuente dijo qué tier quedan en
// el tooltip nativo (title), no ocupan espacio permanente en la franja.
function buildMetaChip(row) {
  const chip = metaChipTpl.content.cloneNode(true);
  const chipEl = chip.querySelector(".meta-comp-chip");
  chipEl.title = `${row.name}\n${sourceSummary(row.sources)}`;

  // Sin ícono conocido para ese campeón, no metemos un <img> sin src (se
  // ve como imagen rota) — se omite del racimo, el nombre de la comp
  // abajo sigue reflejando la comp completa igual.
  const iconsEl = chipEl.querySelector(".meta-comp-icons");
  for (const champ of row.champions || []) {
    if (!champ.icon) continue;
    const img = document.createElement("img");
    img.src = champ.icon;
    img.alt = champ.name;
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove(), { once: true });
    iconsEl.appendChild(img);
  }

  chipEl.querySelector(".meta-comp-name").textContent = row.name;
  return chip;
}

// "S: TFTAcademy, MetaTFT" — agrupa las fuentes por el tier que le dieron,
// así se lee de una si hubo consenso o no.
function sourceSummary(sources) {
  const byTier = new Map();
  for (const s of sources || []) {
    if (!byTier.has(s.tier)) byTier.set(s.tier, []);
    byTier.get(s.tier).push(s.name);
  }
  return [...byTier.entries()].map(([tier, names]) => `${tier}: ${names.join(", ")}`).join(" · ");
}

// Acepta tanto un string (comps del grupo, texto libre sin ícono conocido)
// como un {name, icon} (comps del meta, con ícono real cuando se pudo
// sacar de la fuente) — así el mismo chip sirve para las dos secciones.
function buildChampionChip(champ) {
  const isObj = typeof champ === "object" && champ !== null;
  const name = (isObj ? champ.name : champ).trim();
  const icon = isObj ? champ.icon : null;

  const chip = document.createElement("span");
  chip.className = "champion-chip";
  if (icon) {
    const img = document.createElement("img");
    img.src = icon;
    img.alt = "";
    img.loading = "lazy";
    // Si la url guardada alguna vez deja de servir, no dejamos un ícono
    // roto — nos caemos al chip de solo texto.
    img.addEventListener("error", () => img.remove(), { once: true });
    chip.appendChild(img);
  }
  chip.append(name);
  return chip;
}

function relativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const hours = Math.round(diffMs / 3600000);
  if (hours < 1) return "hace unos minutos";
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} día${days === 1 ? "" : "s"}`;
}

async function rate(compId, score) {
  if (!db) return showError("Configurá Supabase primero (ver banner arriba).");
  const raterName = getRaterName();
  if (!raterName) {
    document.getElementById("rater-name").focus();
    return showError('Poné tu nombre en "Jugás como" antes de calificar.');
  }
  const { error } = await db.from("ratings").upsert(
    {
      comp_id: compId,
      rater_id: getRaterId(),
      rater_name: raterName,
      score,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "comp_id,rater_id" }
  );
  if (error) return showError("No se pudo guardar la calificación: " + error.message);
  await loadAll();
}

// ---------- identidad: input ----------

const nameInput = document.getElementById("rater-name");
nameInput.value = getRaterName();
nameInput.addEventListener("change", () => setRaterName(nameInput.value));

// ---------- modal: aportar comp ----------

const overlay = document.getElementById("modal-overlay");
const form = document.getElementById("comp-form");

function openModal() {
  overlay.hidden = false;
  document.getElementById("f-name").focus();
}
function closeModal() {
  overlay.hidden = true;
  form.reset();
}

document.getElementById("add-comp-btn").addEventListener("click", openModal);
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!db) return showError("Configurá Supabase primero (ver banner arriba).");

  const name = document.getElementById("f-name").value.trim();
  const playstyle = document.getElementById("f-playstyle").value;
  const champions = document
    .getElementById("f-champions")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const coreItems = document.getElementById("f-items").value.trim();
  const description = document.getElementById("f-description").value.trim();
  const submittedBy = getRaterName() || "Anónimo";

  const { error } = await db.from("comps").insert({
    name,
    playstyle,
    champions,
    core_items: coreItems,
    description,
    submitted_by: submittedBy,
  });

  if (error) return showError("No se pudo publicar la comp: " + error.message);
  closeModal();
  await loadAll();
});

loadAll();
loadMeta();
