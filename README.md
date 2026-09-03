# MetaComps

Tier list de composiciones de TFT armada y calificada por el grupo, más una
sección de "meta actual" que se actualiza sola todos los días leyendo
TFTAcademy, MetaTFT y Mobalytics, y reconciliando lo que dice cada una.

Dos partes, dos costos, los dos en $0:

- **La página** (`index.html` / `css/` / `js/app.js`): HTML/JS vanilla, sin
  build step. La sirve GitHub Pages gratis.
- **El refresco del meta** (`scripts/refresh-meta.mjs`): corre 1 vez al día
  en un GitHub Actions gratis, usa la API gratis de Gemini para leer y
  reconciliar las 3 fuentes, y escribe el resultado en Supabase (también
  gratis).

## 1. Crear el proyecto de Supabase

1. [supabase.com](https://supabase.com) → **New project** (plan Free).
2. **SQL Editor → New query**, pegá todo [`schema.sql`](schema.sql) y **Run**.
   Crea `comps`, `ratings` y `meta_comps` con sus policies.
3. **Project Settings → API**: copiá el **Project URL** y la
   **Publishable key** (antes se llamaba "anon key") a
   [`js/config.js`](js/config.js).
4. De la misma pantalla, copiá también la **Secret key** (antes
   "service_role key") — la vas a necesitar en el paso 4. Es una clave con
   acceso total a la base: no la pongas en `js/config.js` (ese archivo lo ve
   cualquiera que abra la página), solo va como secret de GitHub.

## 2. Subir el proyecto a GitHub

1. Creá un repo nuevo en GitHub (público o privado, cualquiera sirve).
2. Subí toda la carpeta `tft-comps` (con `js/config.js` ya completado).

## 3. Activar GitHub Pages

**Settings → Pages** del repo → **Source: Deploy from a branch** → rama
`main`, carpeta `/ (root)` → **Save**. En un par de minutos el link público
va a estar activo (GitHub te lo muestra en esa misma pantalla) — ese es el
que compartís con tus amigos.

## 4. Conseguir la API key gratis de Gemini

1. [aistudio.google.com](https://aistudio.google.com) → login con cuenta de
   Google → **Get API key** → **Create API key**. Gratis, sin tarjeta.
2. Guardala, la necesitás en el paso siguiente.

## 5. Configurar los secrets del robot en GitHub

**Settings → Secrets and variables → Actions → New repository secret**, uno
por uno:

| Nombre | Valor |
|---|---|
| `GEMINI_API_KEY` | la key del paso 4 |
| `SUPABASE_URL` | el Project URL de Supabase (paso 1.3) |
| `SUPABASE_SECRET_KEY` | la Secret key de Supabase (paso 1.4) |

## 6. Probar que el robot funciona

**Actions** (pestaña del repo) → **Actualizar meta de TFT** → **Run
workflow** → esperá 2-4 minutos (baja 3 páginas, dos de ellas con un
navegador headless, así que no es instantáneo) → si termina en verde, la
sección "Meta ahora" de la página ya debería mostrar datos.

Después de esta primera vez corre solo, todos los días a las 8am hora
Bogotá — no hay que volver a tocar nada.

## Cómo funciona el robot (`scripts/refresh-meta.mjs`)

1. **Lee las 3 fuentes.** TFTAcademy manda las comps ya en el HTML (un
   fetch simple alcanza); MetaTFT y Mobalytics las arman con JavaScript del
   lado del cliente, así que esas dos necesitan un navegador headless
   (Playwright) para poder verlas.
2. **Le pide a Gemini que extraiga cada una** por separado: nombre, tier,
   campeones clave. El HTML real es un enredo de clases de framework — por
   eso hace falta una IA leyendo con criterio en vez de un selector CSS fijo
   (más resistente a que alguno de los 3 sitios rediseñe su página).
3. **Reconcilia las 3 listas en una.** La misma comp puede llamarse distinto
   en cada sitio — Gemini la identifica por superposición de campeones
   clave, no por nombre exacto, y arma un tier final: si 2+ fuentes
   coinciden, gana ese tier; si solo una la reportó, queda con su tier y
   marcada como tal.
4. **Reemplaza `meta_comps` en Supabase** entero (borra todo lo viejo,
   inserta lo nuevo) — la tabla es un snapshot de la última lectura, no un
   histórico.

## Probar en local

```bash
npm install
npx playwright install --with-deps chromium
GEMINI_API_KEY=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run refresh-meta
```

Y para la página en sí, cualquiera de estas (no hace falta build):

```bash
python -m http.server 8080
# o, si tenés Node:
npx serve .
```

## Roadmap

- Hoy: página web + meta actualizado solo todos los días desde 3 fuentes.
- Más adelante: empaquetar con Capacitor como app de Android (mismo patrón
  que `worldbox-clone` — envolver `index.html` en un WebView).

## Notas de diseño

- **Tier del grupo vs. tier del meta**: son dos cosas separadas a
  propósito. El de arriba ("Meta ahora") lo arma el robot solo, leyendo
  fuentes externas; el de abajo ("Tier list del grupo") lo arma el voto de
  tus amigos. Ninguno pisa al otro.
- **`meta_comps` es de solo lectura pública**: nadie puede escribir ahí con
  la Publishable key (probado a mano) — solo el robot, con la Secret key,
  que ignora las policies de RLS. Ver `schema.sql`.
- **Identidad sin login** (para `comps`/`ratings`): cada visitante tiene un
  id aleatorio en `localStorage` y un nombre que él mismo pone. No es
  autenticación real — para un grupo de amigos de confianza es un tradeoff
  razonable a cambio de cero fricción.
- **Costo**: revisado a mano — Actions, Gemini y Supabase se mantienen
  dentro de sus límites gratuitos con esta frecuencia (1 corrida/día, 3
  fuentes, ~20-30 comps). Si en algún momento se vuelve más pesado (más
  fuentes, más frecuencia), revisar esos límites antes de subir la
  frecuencia.
