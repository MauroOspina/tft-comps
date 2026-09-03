// Lee 3 tier lists de referencia (TFTAcademy, MetaTFT, Mobalytics), le pide
// a Gemini que extraiga las comps de cada una y las reconcilie en una sola
// lista, y reemplaza el contenido de `meta_comps` en Supabase con eso.
//
// Corre desde .github/workflows/refresh-meta.yml (cron diario + botón
// manual). Necesita 3 variables de entorno: GEMINI_API_KEY, SUPABASE_URL,
// SUPABASE_SECRET_KEY — en Actions vienen de repo secrets, en local de tu
// shell (ver README).

import { chromium } from "playwright";

const GEMINI_API_KEY = requireEnv("GEMINI_API_KEY");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SECRET_KEY = requireEnv("SUPABASE_SECRET_KEY");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// TFTAcademy renderiza las comps en el HTML que devuelve el server: un
// fetch simple alcanza. MetaTFT y Mobalytics arman la tabla con JS del
// lado del cliente — sin un navegador real, el HTML llega prácticamente
// vacío (verificado a mano antes de escribir esto).
const SOURCES = [
  { name: "TFTAcademy", url: "https://tftacademy.com/tierlist/comps", needsBrowser: false },
  { name: "MetaTFT", url: "https://www.metatft.com/comps", needsBrowser: true },
  { name: "Mobalytics", url: "https://mobalytics.gg/tft/tier-list", needsBrowser: true },
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta la variable de entorno ${name}`);
    process.exit(1);
  }
  return value;
}

// El HTML real trae toneladas de SVG inline, data: URIs y CSS que no
// aportan nada a la extracción y sí inflan el prompt — los sacamos antes
// de mandarlo a Gemini.
function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/\s(src|href)="data:[^"]*"/gi, "")
    .replace(/\s+/g, " ")
    .slice(0, 150000);
}

async function fetchStatic(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
  return res.text();
}

async function fetchWithBrowser(browser, url) {
  const page = await browser.newPage({ userAgent: UA });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500); // margen para hidratación / animaciones tardías
    return await page.content();
  } finally {
    await page.close();
  }
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    comps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          tier: { type: "string", enum: ["S", "A", "B", "C", "X"] },
          champions: { type: "array", items: { type: "string" } },
        },
        required: ["name", "tier", "champions"],
      },
    },
  },
  required: ["comps"],
};

const RECONCILE_SCHEMA = {
  type: "object",
  properties: {
    comps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          tier: { type: "string", enum: ["S", "A", "B", "C", "X"] },
          champions: { type: "array", items: { type: "string" } },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                tier: { type: "string" },
              },
              required: ["name", "tier"],
            },
          },
        },
        required: ["name", "tier", "champions", "sources"],
      },
    },
  },
  required: ["comps"],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// El free tier de Gemini devuelve 503 ("high demand") o 429 (rate limit)
// de vez en cuando bajo carga — son transitorios, no errores nuestros.
// Reintentamos con backoff antes de darnos por vencidos.
async function callGemini(prompt, schema, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    }),
  });

  const MAX_ATTEMPTS = 6;
  if (!res.ok) {
    const bodyText = await res.text();
    const transient = res.status === 503 || res.status === 429;
    if (transient && attempt < MAX_ATTEMPTS) {
      const waitMs = attempt * 20000;
      console.log(
        `  Gemini respondió ${res.status} (intento ${attempt}/${MAX_ATTEMPTS - 1}), reintentando en ${waitMs / 1000}s...`
      );
      await sleep(waitMs);
      return callGemini(prompt, schema, attempt + 1);
    }
    throw new Error(`Gemini respondió ${res.status}: ${bodyText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini no devolvió contenido: " + JSON.stringify(data));
  return JSON.parse(text);
}

async function extractFromSource(source, html) {
  const prompt = `Esta es una tier list de composiciones (comps) de Teamfight Tactics (TFT), tomada del sitio ${source.name}. El HTML viene con clases y atributos ruidosos de un framework de UI — ignoralos y enfocate en el contenido real: encabezados de tier (S/A/B/C/Situational) y, agrupadas debajo de cada uno, las comps con sus campeones clave.

Para cada comp que encuentres, devolvé:
- name: el nombre de la comp tal como aparece
- tier: "S", "A", "B", "C", o "X" si está en la sección situacional/situational
- champions: los 3 a 5 campeones carry/clave que la definen, en inglés, con el nombre tal cual se usa en el juego (sin acentos ni apodos)

Si una sección de tier dice algo como "no comp meets the criteria" o está vacía, no generes ninguna comp para esa tier — es un estado normal, no un error.

HTML:
${html}`;
  const result = await callGemini(prompt, EXTRACT_SCHEMA);
  return result.comps || [];
}

async function reconcile(perSource) {
  const prompt = `Tenés listas de comps de TFT extraídas de 3 sitios de referencia distintos (TFTAcademy, MetaTFT, Mobalytics). La misma comp puede tener nombre distinto en cada sitio — identificala por superposición de campeones clave, no por coincidencia exacta de nombre.

Combiná las 3 listas en una sola. Para cada comp distinta que identifiques, devolvé:
- name: el nombre más claro entre los que aparecen en las fuentes que la reportan
- champions: la unión de los campeones clave que reportaron esas fuentes
- sources: un array con una entrada por cada fuente que la reportó — {name, tier} — usando el tier REAL que le dio cada fuente, sin inventar
- tier: el tier final consolidado. Si 2 o más fuentes coinciden, usá ese tier. Si solo una fuente la reportó, usá el tier de esa fuente. Si las fuentes discrepan sin mayoría, usá un criterio razonable (por ejemplo, el tier intermedio, redondeando hacia arriba si están a un solo escalón de distancia)

No inventes comps que ninguna fuente reportó, y no combines dos comps distintas solo porque comparten un campeón secundario — el criterio es superposición de los campeones CLAVE/carry.

Datos por fuente:
${JSON.stringify(perSource, null, 2)}`;
  const result = await callGemini(prompt, RECONCILE_SCHEMA);
  return result.comps || [];
}

async function writeToSupabase(comps) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // meta_comps es un snapshot, no un histórico: cada corrida reemplaza
  // todo el contenido anterior.
  const delRes = await fetch(`${SUPABASE_URL}/rest/v1/meta_comps?id=not.is.null`, {
    method: "DELETE",
    headers,
  });
  if (!delRes.ok) throw new Error(`DELETE en Supabase falló: ${delRes.status} ${await delRes.text()}`);

  if (comps.length === 0) return;

  const rows = comps.map((c) => ({
    name: c.name,
    tier: c.tier,
    champions: c.champions,
    sources: (c.sources || []).map((s) => ({
      name: s.name,
      tier: s.tier,
      url: SOURCES.find((src) => src.name === s.name)?.url || null,
    })),
  }));

  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/meta_comps`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });
  if (!insRes.ok) throw new Error(`INSERT en Supabase falló: ${insRes.status} ${await insRes.text()}`);
}

async function main() {
  const browser = await chromium.launch();
  const perSource = [];

  try {
    for (const source of SOURCES) {
      try {
        console.log(`Leyendo ${source.name}...`);
        const html = source.needsBrowser
          ? await fetchWithBrowser(browser, source.url)
          : await fetchStatic(source.url);
        const comps = await extractFromSource(source, cleanHtml(html));
        console.log(`  -> ${comps.length} comps encontradas en ${source.name}`);
        perSource.push({ source: source.name, comps });
      } catch (err) {
        // Una fuente caída no debería tumbar la corrida entera — seguimos
        // con las que sí funcionaron y lo dejamos anotado en el log.
        console.error(`  Falló ${source.name}, la salteamos esta corrida: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (perSource.length === 0) {
    throw new Error("Ninguna de las 3 fuentes respondió — no hay nada para reconciliar.");
  }

  console.log("Reconciliando fuentes...");
  const finalComps = await reconcile(perSource);
  console.log(`Meta final: ${finalComps.length} comps`);
  for (const tier of ["S", "A", "B", "C", "X"]) {
    const count = finalComps.filter((c) => c.tier === tier).length;
    if (count) console.log(`  ${tier}: ${count}`);
  }

  console.log("Escribiendo en Supabase...");
  await writeToSupabase(finalComps);
  console.log("Listo.");
}

main().catch((err) => {
  console.error("Falló la actualización del meta:", err);
  process.exit(1);
});
