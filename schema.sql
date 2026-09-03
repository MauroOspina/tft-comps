-- TFT Comps Tier List — esquema de Supabase
-- Correr esto una sola vez en el SQL Editor del proyecto de Supabase
-- (Project -> SQL Editor -> New query -> pegar todo -> Run).

create table if not exists comps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  playstyle text not null default 'Standard',
  champions text[] not null default '{}',
  core_items text,
  description text,
  submitted_by text not null default 'Anónimo',
  created_at timestamptz not null default now()
);

create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  comp_id uuid not null references comps(id) on delete cascade,
  rater_id text not null,
  rater_name text,
  score int not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comp_id, rater_id)
);

create index if not exists ratings_comp_id_idx on ratings (comp_id);

-- Snapshot del meta "oficial", leído periódicamente de varias páginas de
-- referencia (TFTAcademy, MetaTFT, Mobalytics) por un job programado — no
-- lo escribe nadie del grupo a mano. Cada corrida borra y vuelve a
-- insertar todo (ver README), así que esta tabla siempre refleja la
-- última lectura ya reconciliada entre fuentes.
-- `sources` guarda, por cada sitio que reportó esta comp, su nombre, su
-- propio tier para ella y la url — así la tarjeta puede mostrar "S según
-- TFTAcademy y MetaTFT, A según Mobalytics" en vez de un solo tier ciego.
-- `champions` es un array de {name, icon} — icon puede ser null si no se
-- encontró la imagen real para ese campeón esa corrida.
create table if not exists meta_comps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier text not null,
  champions jsonb not null default '[]',
  sources jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);

create index if not exists meta_comps_fetched_at_idx on meta_comps (fetched_at);

-- RLS: el grupo es de confianza (amigos), no hay login. Se habilita RLS de
-- todos modos para no dejar el resto del proyecto de Supabase expuesto por
-- accidente, con policies abiertas solo en las tablas que de verdad
-- necesitan escritura pública.
alter table comps enable row level security;
alter table ratings enable row level security;
alter table meta_comps enable row level security;

create policy "comps_public_read" on comps
  for select using (true);
create policy "comps_public_insert" on comps
  for insert with check (true);

create policy "ratings_public_read" on ratings
  for select using (true);
create policy "ratings_public_insert" on ratings
  for insert with check (true);
create policy "ratings_public_update" on ratings
  for update using (true) with check (true);

-- meta_comps: solo lectura pública. Nadie tiene permiso de insert/update/
-- delete acá — la escritura la hace exclusivamente el agente programado,
-- usando la service role key, que de por sí ignora RLS.
create policy "meta_comps_public_read" on meta_comps
  for select using (true);
