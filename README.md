# Timeline Studio

Aplicación web SPA minimalista para crear líneas de tiempo colaborativas. Diseño Glassmorphism estilo Apple, con modo oscuro y **sincronización automática en tiempo real** (Supabase) para ver tu progreso en cualquier dispositivo.

## Estructura

```
timeline-app/
├── index.html           # Estructura de la SPA
├── styles.css           # Glassmorphism design system + responsive + dark mode
├── app.js               # Lógica de la aplicación (incluye la sincronización con Supabase)
├── github-api.js        # Utilidades de conexión con la nube (Supabase) + script SQL
└── data/
    └── timelines.json   # Archivo de datos local (respaldo)
```

## Cómo probar (local)

**Opción A — abrir directo:** doble clic en `index.html` (funciona con `file://`).

**Opción B — con servidor local:**
```
npx --yes serve timeline-app -l 8080
```
Luego abre http://localhost:8080

> La sincronización con GitHub requiere internet. La página funciona sin conexión usando solo `localStorage`.

## Recorrido del usuario

1. **Login "¿Sos uno de estos?"** — elegí o creá tu usuario (se guarda en `localStorage` y firma cada cambio). Una vez dentro, hacé clic en tu **nombre (badge)** para **cambiar o crear otro usuario**.
2. **Menú principal** — lista las líneas de tiempo. Podés abrir, editar (lápiz), eliminar (basura), crear nueva, e importar/exportar respaldos.
3. **Workspace (la línea)** — fondo y color de la barra se configuran por separado en **Editar**.

### Barra de herramientas inferior
- **Nueva** — crea una pestaña al final
- **Editar** — color de fondo, color de línea, nombre, eliminar
- **Deshacer / Rehacer** — un cambio a la vez
- **Guardar** — guarda en el dispositivo **y/**o sube tu progreso a GitHub (si está configurado)
- **Sync GitHub** — abre la configuración de sincronización o sube el progreso al instante
- **Historial** — todos los cambios de la línea
- **Info** — guía de uso

### Pestañas
- **Agregar**: clic en la línea → circular + → + inserta ahí. **Doble clic en la línea** crea una pestaña en esa posición desplazando las demás.
- **Editar**: doble clic sobre la pestaña (título, descripción, 12 colores o RGB).
- **Ver descripción**: un solo clic despliega la descripción.
- **Reordenar (línea)**: arrastrá por la patita (puntito).
- **Menú de pestañas (☰)**: un clic edita, arrastrá para reordenar (sincronizado con la línea).
- **Scroll**: barra arriba de todo.

### Atajos
- `Ctrl/Cmd + Z` — deshacer · `Ctrl/Cmd + Y` — rehacer · `Ctrl/Cmd + S` — guardar/sincronizar · `Esc` — cerrar modales

## Sincronización con la nube (Supabase) — automática y en tiempo real

El progreso (pestañas, colores, orden, usuarios) se guarda en una base de datos de **Supabase** (plan gratuito, sin tarjeta). Al abrir la app en cualquier dispositivo, **lee lo que hay en la nube** y lo muestra; y cada cambio se **sube automáticamente** en tiempo real (sin botón de guardar).

### Configurar Supabase (una vez por proyecto)

1. Creá una cuenta gratis en https://supabase.com → **New project** (el plan Free no pide tarjeta). Anotá el **Project URL** (ej: `https://xxxx.supabase.co`) y la **clave anon/public** (Settings → API). Estas son **públicas**, seguras de poner en el código.
2. Corré **una sola vez** este script en **SQL Editor** (icono `>_`) para crear la tabla de datos:

```sql
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
```

3. En la app, tocá el botón **Nube** (`🔄`) y confirmá que aparezcan tu **URL** y tu **clave** ya cargadas → **Guardar**. (Los valores ya vienen precargados; si cambiaste de proyecto, reemplazalos.)

### Cómo se comporta
- **Al abrir la app**: baja automáticamente el progreso más reciente de la nube.
- **Al hacer cualquier cambio** (crear/editar/borrar pestaña, colorear, reordenar, agregar usuario): se sube solo en tiempo real.
- **Otro dispositivo abierto** recibe el cambio al instante (websockets) y refresca la pantalla.
- El botón **Guardar** y `Ctrl+S` suben de inmediato si querés forzarlo.

> Cambios colgando: una redirigida. Cuando el sicronismo no esté disponible (sin internet), los cambios quedan en `localStorage` local y se suben al reconectar.

## Cómo publicarlo en GitHub Pages (hosteado gratis)

La app es 100% estática; el único requisito es internet para la sincronización con Supabase.

1. **Subí los 6 elementos de la carpeta `timeline-app`**:
   ```
   cd timeline-app
   git init
   git add .
   git commit -m "Timeline Studio con sync Supabase"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
2. **Activá GitHub Pages** en el repo:
   - Repositorio → **Settings** → **Pages** → **Deploy from a branch** → `main` / `/ (root)` → **Save**.
3. Esperá ~1 min y quedará en:
   ```
   https://TU_USUARIO.github.io/TU_REPO/
   ```

> Como los datos viven en Supabase (no en GitHub), **todos los que abran esa URL** comparten el mismo progreso en tiempo real, sin importar el dispositivo.

## Seguridad

- La clave usada es la **pública** (`anon`/`publishable`), pensada para ir en el frontend. **No** uses la clave `service_role` (secreta) ni tokens personales.
- Está bien que la clave pública aparezca en el código: Supabase la valida con las políticas de seguridad (Row Level Security) de tu tabla.

## Notas
- Los datos también se guardan en `localStorage` (funciona sin conexión; al reconectar se sincronizan).
- La sincronización usa [supabase-js](https://supabase.com/docs/reference/javascript) vía CDN y los Realtime channels de Supabase.
