/**
 * Timeline Studio — Conexión con Supabase (sincronización en tiempo real).
 *
 * Este archivo expone utilidades para conectar la app con Supabase.
 * Los datos (líneas, pestañas con color/orden, usuarios) se guardan en una
 * sola fila de la tabla `progress` como JSON, y cada dispositivo los lee y
 * escribe. Los cambios se propagan en tiempo real vía websockets.
 *
 * No se requiere token secreto: se usa la clave pública "anon", pensada para
 * ir en el código del frontend.
 */
(function () {
  const TABLE = 'progress';
  const ROW_ID = 1;

  /**
   * Crea un cliente Supabase.
   * @param {string} url  Project URL (https://xxxx.supabase.co)
   * @param {string} key  anon public key
   */
  function createClient(url, key) {
    if (!window.supabase) {
      throw new Error('Supabase no está cargado. Revisá index.html.');
    }
    return window.supabase.createClient(url, key);
  }

  /**
   * Script SQL para crear la tabla (ejecutar una vez en Supabase > SQL Editor).
   */
  const SQL_SETUP = `
create table if not exists progress (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into progress (id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;
alter table progress enable row level security;
drop policy if exists "public read" on progress;
drop policy if exists "public write" on progress;
drop policy if exists "public insert" on progress;
create policy "public read" on progress for select using (true);
create policy "public write" on progress for update using (true) with check (true);
create policy "public insert" on progress for insert with check (true);
`;

  window.TimelineSync = {
    TABLE,
    ROW_ID,
    SQL_SETUP,
    createClient,
  };
})();
