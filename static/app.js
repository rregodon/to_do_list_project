// Lógica de la app de tareas.
//
// Todo se guarda primero en este dispositivo (localStorage), así la app
// abre al instante y funciona sin conexión. Por detrás, se sincroniza con
// el servidor (/api/sync) para tener lo mismo en el iPhone, el iPad y el ordenador.
//
// Nota: en el servidor las listas se llaman "proyectos", y "importante"
// se guarda como prioridad 1 (el resto, prioridad 4).

const COLORES = ["azul", "indigo", "morado", "rosa", "rojo", "naranja", "amarillo", "verde", "turquesa", "gris"];
const TIPOS = ["proyectos", "etiquetas", "tareas"];
const CLAVE = "tareas-v1";
const CLAVE_AJUSTES = "ajustes-v1";

const $ = (id) => document.getElementById(id);

// ---------- Datos guardados en el dispositivo ----------

function datosVacios() {
  return {
    proyectos: {}, etiquetas: {}, tareas: {},
    cursor: 0,                                                 // última versión recibida del servidor
    pendientes: { proyectos: [], etiquetas: [], tareas: [] }, // ids aún sin enviar
    ultimaSync: null,
  };
}

function leerJSON(clave, porDefecto) {
  try {
    return { ...porDefecto, ...JSON.parse(localStorage.getItem(clave)) };
  } catch {
    return porDefecto;
  }
}

const db = leerJSON(CLAVE, datosVacios());

function persistir() {
  localStorage.setItem(CLAVE, JSON.stringify(db));
}

function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// Guarda (crea o modifica) un registro y lo apunta para sincronizar
function guardar(tipo, registro) {
  registro.actualizado = Math.max(Date.now(), (db[tipo][registro.id]?.actualizado ?? 0) + 1);
  db[tipo][registro.id] = registro;
  if (!db.pendientes[tipo].includes(registro.id)) db.pendientes[tipo].push(registro.id);
  persistir();
  pintar();
  programarSync(800);
}

const vivos = (tipo) => Object.values(db[tipo]).filter((r) => !r.borrado);

// ---------- Sincronización ----------

let sincronizando = false;
let temporizadorSync = null;

function programarSync(ms = 0) {
  clearTimeout(temporizadorSync);
  temporizadorSync = setTimeout(sincronizar, ms);
}

async function sincronizar() {
  if (sincronizando) return programarSync(1000);
  sincronizando = true;
  const envio = { cursor: db.cursor };
  for (const tipo of TIPOS) {
    envio[tipo] = db.pendientes[tipo].map((id) => db[tipo][id]).filter(Boolean);
  }

  try {
    const respuesta = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envio),
    });
    if (respuesta.status === 401) {
      location.href = "/login.html";
      return;
    }
    if (!respuesta.ok) throw new Error(`Error ${respuesta.status}`);
    const recibido = await respuesta.json();

    for (const tipo of TIPOS) {
      // Quitar de pendientes lo enviado (salvo si se ha vuelto a cambiar mientras tanto)
      const enviados = new Map(envio[tipo].map((r) => [r.id, r.actualizado]));
      db.pendientes[tipo] = db.pendientes[tipo].filter(
        (id) => !enviados.has(id) || db[tipo][id].actualizado !== enviados.get(id)
      );
      // Aplicar lo que llega de otros dispositivos (gana el cambio más reciente)
      for (const r of recibido[tipo]) {
        const local = db[tipo][r.id];
        if (!local || r.actualizado >= local.actualizado) db[tipo][r.id] = r;
      }
    }
    db.cursor = recibido.cursor;
    db.ultimaSync = Date.now();
    persistir();
    pintar();
    mostrarEstadoSync();
  } catch (error) {
    mostrarEstadoSync(
      !navigator.onLine ? "Sin conexión"
        : error.message.startsWith("Error") ? `El servidor ha fallado (${error.message})`
        : "No se pudo conectar con el servidor"
    );
    programarSync(30000); // reintentar dentro de 30 s
  } finally {
    sincronizando = false;
  }
}

function mostrarEstadoSync(texto) {
  if (texto === undefined) {
    const pendientes = TIPOS.reduce((n, t) => n + db.pendientes[t].length, 0);
    texto = pendientes
      ? `${pendientes} cambio(s) por sincronizar`
      : db.ultimaSync
        ? `Sincronizado a las ${new Date(db.ultimaSync).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
        : "";
  } else {
    texto += " · tus cambios están guardados en este dispositivo";
  }
  $("estado-sync").textContent = texto;
  $("info-ajustes").textContent = texto;
}

// ---------- Ajustes (de este dispositivo) ----------

const FONDOS = {
  ninguno:   { nombre: "Liso",      claro: "var(--fondo)", oscuro: "var(--fondo)" },
  arena:     { nombre: "Arena",     claro: "#f4eee4", oscuro: "#1d1a16" },
  salvia:    { nombre: "Salvia",    claro: "#e6eee4", oscuro: "#151b15" },
  cielo:     { nombre: "Cielo",     claro: "#e4edf7", oscuro: "#121821" },
  lavanda:   { nombre: "Lavanda",   claro: "#ece8f6", oscuro: "#18151f" },
  amanecer:  { nombre: "Amanecer",  claro: "linear-gradient(160deg,#ffe3d3,#fbd3e9 55%,#e3dcff)", oscuro: "linear-gradient(160deg,#3a2430,#24203a)" },
  oceano:    { nombre: "Océano",    claro: "linear-gradient(160deg,#d7f0ff,#c9f3ec 60%,#e6f7d9)", oscuro: "linear-gradient(160deg,#0f2530,#0f2a26)" },
  atardecer: { nombre: "Atardecer", claro: "linear-gradient(160deg,#ffd6a5,#ffadad 60%,#e8b4f8)", oscuro: "linear-gradient(160deg,#40261c,#3a1f33)" },
  noche:     { nombre: "Noche",     claro: "linear-gradient(160deg,#c3cfe2,#e2d1f9)", oscuro: "linear-gradient(160deg,#0f1028,#2b1340)" },
};

const ajustes = leerJSON(CLAVE_AJUSTES, { estilo: "clasico", tema: "claro", fondo: "ninguno", foto: null, colorDefecto: "azul", completadasAbiertas: false });

function guardarAjustes() {
  try {
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
  } catch {
    avisar("La foto es demasiado grande para guardarla");
    ajustes.foto = null;
    ajustes.fondo = "ninguno";
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
  }
  aplicarAjustes();
}

const oscuroDelSistema = matchMedia("(prefers-color-scheme: dark)");
oscuroDelSistema.addEventListener?.("change", () => aplicarAjustes());

function temaActual() {
  if (ajustes.tema === "auto") return oscuroDelSistema.matches ? "oscuro" : "claro";
  return ajustes.tema;
}

function aplicarAjustes() {
  const tema = temaActual();
  document.documentElement.dataset.tema = tema;
  document.documentElement.dataset.estilo = ajustes.estilo;
  document.querySelector('meta[name="theme-color"]').content = tema === "oscuro" ? "#000000" : "#f2f2f7";
  const fondo = $("fondo");
  document.body.classList.toggle("con-foto", ajustes.fondo === "foto" && !!ajustes.foto);
  if (ajustes.fondo === "foto" && ajustes.foto) {
    fondo.style.background = `url(${ajustes.foto}) center / cover no-repeat`;
  } else {
    fondo.style.background = (FONDOS[ajustes.fondo] ?? FONDOS.ninguno)[tema];
  }
}

// ---------- Utilidades ----------

// Crea un elemento HTML: h("div", { class: "x" }, "texto", otroElemento)
function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...hijos.flat().filter((x) => x != null && x !== false));
  return el;
}

function svg(html) {
  const plantilla = document.createElement("template");
  plantilla.innerHTML = html.trim();
  return plantilla.content.firstChild;
}

const colorCss = (color) => `var(--${COLORES.includes(color) ? color : "azul"})`;
const ICONO_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const SIN_LISTA = "__sin_lista__"; // tareas antiguas que no están en ninguna lista

function listas() {
  return vivos("proyectos").sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}

function tareasDeLista(id) {
  return vivos("tareas").filter((t) => (id === SIN_LISTA ? !t.proyecto_id || !db.proyectos[t.proyecto_id] || db.proyectos[t.proyecto_id].borrado : t.proyecto_id === id));
}

// ---------- Pantallas ----------

let listaAbierta = null; // id de la lista abierta, o null en la pantalla de inicio

function abrirLista(id) {
  listaAbierta = id;
  localStorage.setItem("lista-abierta", id ?? "");
  $("pantalla-inicio").hidden = !!id;
  $("pantalla-lista").hidden = !id;
  window.scrollTo(0, 0);
  pintar();
}

$("btn-volver").addEventListener("click", () => abrirLista(null));

function pintar() {
  if (listaAbierta && listaAbierta !== SIN_LISTA && !db.proyectos[listaAbierta]?.nombre) listaAbierta = null;
  if (listaAbierta && db.proyectos[listaAbierta]?.borrado) listaAbierta = null;
  $("pantalla-inicio").hidden = !!listaAbierta;
  $("pantalla-lista").hidden = !listaAbierta;
  if (listaAbierta) pintarLista();
  else pintarInicio();
}

function pintarInicio() {
  const tarjetas = listas().map((l) => {
    const pendientes = tareasDeLista(l.id).filter((t) => !t.completada);
    const importantes = pendientes.filter((t) => t.prioridad === 1).length;
    const total = tareasDeLista(l.id).length;
    const hecho = total ? Math.round(((total - pendientes.length) / total) * 100) : 0;
    return h("button", {
      class: "tarjeta-lista",
      style: `--c:${colorCss(l.color)};background:var(--c)`,
      onclick: () => abrirLista(l.id),
    },
      h("span", { class: "contador" }, String(pendientes.length)),
      h("span", {},
        h("div", { class: "nombre" }, l.nombre),
        importantes ? h("div", { class: "sub" }, `★ ${importantes} importante${importantes > 1 ? "s" : ""}`) : null,
        h("div", { class: "progreso" }, h("i", { style: `width:${hecho}%` })),
      ),
    );
  });

  const sueltas = tareasDeLista(SIN_LISTA).filter((t) => !t.completada).length;
  if (sueltas) {
    tarjetas.push(h("button", { class: "tarjeta-lista", style: "--c:var(--gris);background:var(--c)", onclick: () => abrirLista(SIN_LISTA) },
      h("span", { class: "contador" }, String(sueltas)),
      h("span", {}, h("div", { class: "nombre" }, "Sin lista")),
    ));
  }

  tarjetas.push(h("button", { class: "tarjeta-lista tarjeta-nueva", onclick: () => abrirFormLista(null) },
    h("span", { class: "mas" }, "+"),
    h("span", {}, "Nueva lista"),
  ));
  $("rejilla").replaceChildren(...tarjetas);
}

let completadasAbiertas = ajustes.completadasAbiertas;

function pintarLista() {
  const esSinLista = listaAbierta === SIN_LISTA;
  const lista = esSinLista ? { nombre: "Sin lista", color: "gris" } : db.proyectos[listaAbierta];
  const color = colorCss(lista.color);
  $("pantalla-lista").style.setProperty("--color-lista", color);
  $("titulo-lista").textContent = lista.nombre;
  $("titulo-lista").style.color = color;
  $("btn-editar-lista").hidden = esSinLista;
  $("btn-nueva-tarea").hidden = esSinLista;

  const tareas = tareasDeLista(listaAbierta);
  // Pendientes: primero las importantes, luego por orden de creación
  const pendientes = tareas.filter((t) => !t.completada)
    .sort((a, b) => (a.prioridad === 1 ? 0 : 1) - (b.prioridad === 1 ? 0 : 1) || a.creada - b.creada);
  const hechas = tareas.filter((t) => t.completada)
    .sort((a, b) => (b.completada_en ?? 0) - (a.completada_en ?? 0));

  const partes = [];
  if (!pendientes.length && !hechas.length) {
    partes.push(h("p", { class: "vacio" }, h("span", { class: "grande" }, "✓"), "Lista vacía.", h("br"), "Pulsa + para añadir una tarea."));
  } else if (!pendientes.length) {
    partes.push(h("p", { class: "vacio" }, h("span", { class: "grande" }, "🎉"), "¡Todo hecho!"));
  } else {
    partes.push(h("div", { class: "bloque" }, pendientes.map(filaTarea)));
  }

  if (hechas.length) {
    partes.push(h("section", { class: "seccion-completadas" },
      h("button", {
        class: "cabecera-completadas" + (completadasAbiertas ? " abierta" : ""),
        onclick: () => {
          completadasAbiertas = !completadasAbiertas;
          ajustes.completadasAbiertas = completadasAbiertas;
          localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
          pintar();
        },
      }, h("span", { class: "flecha" }, "›"), `Completadas (${hechas.length})`),
      completadasAbiertas ? h("div", { class: "bloque" }, hechas.slice(0, 300).map(filaTarea)) : null,
    ));
  }
  $("tareas").replaceChildren(...partes);
}

function filaTarea(t) {
  const fila = h("div", { class: "fila-tarea" + (t.completada ? " completada" : "") },
    h("div", { class: "detras" },
      h("span", { class: "izq" }, t.completada ? "↺ Pendiente" : "✓ Hecha"),
      h("span", { class: "der" }, "Borrar"),
    ),
    h("div", { class: "tarea" },
      h("button", {
        class: "check" + (t.completada ? " hecha" : ""),
        "aria-label": t.completada ? "Marcar como pendiente" : "Completar",
        onclick: () => alternarCompletada(t.id),
      }, svg(ICONO_CHECK)),
      h("button", { class: "tarea-cuerpo", onclick: () => verTarea(t.id) },
        h("div", { class: "tarea-titulo" }, t.titulo, t.notas ? h("span", { class: "icono-notas" }, "☰") : null),
      ),
      h("button", {
        class: "estrella" + (t.prioridad === 1 ? " activa" : ""),
        "aria-label": t.prioridad === 1 ? "Quitar importante" : "Marcar como importante",
        onclick: () => guardar("tareas", { ...db.tareas[t.id], prioridad: t.prioridad === 1 ? 4 : 1 }),
      }, t.prioridad === 1 ? "★" : "☆"),
    ),
  );
  activarDeslizar(fila, t.id);
  return fila;
}

// ---------- Deslizar: derecha = completar, izquierda = borrar ----------

const UMBRAL = 90;

function activarDeslizar(fila, id) {
  const tarea = fila.querySelector(".tarea");
  const detras = fila.querySelector(".detras");
  const [izq, der] = detras.children;
  let inicioX = 0, inicioY = 0, dx = 0, activo = false, decidido = false;

  tarea.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    inicioX = e.clientX; inicioY = e.clientY; dx = 0; activo = true; decidido = false;
  });

  tarea.addEventListener("pointermove", (e) => {
    if (!activo) return;
    const mx = e.clientX - inicioX, my = e.clientY - inicioY;
    if (!decidido) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) { activo = false; return; } // está haciendo scroll
      decidido = true;
      tarea.setPointerCapture(e.pointerId);
      tarea.classList.add("arrastrando");
    }
    dx = mx;
    tarea.style.transform = `translateX(${dx}px)`;
    const haciaDerecha = dx > 0;
    detras.style.background = haciaDerecha ? "var(--verde)" : "var(--peligro)";
    izq.style.opacity = haciaDerecha && dx > 30 ? 1 : 0;
    der.style.opacity = !haciaDerecha && dx < -30 ? 1 : 0;
  });

  const soltar = () => {
    if (!activo) return;
    activo = false;
    if (!decidido) return;
    tarea.classList.remove("arrastrando");
    // Evita que el "clic" al soltar abra la tarea
    tarea.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
    if (dx > UMBRAL) {
      tarea.style.transform = "translateX(100%)";
      setTimeout(() => alternarCompletada(id), 180);
    } else if (dx < -UMBRAL) {
      tarea.style.transform = "translateX(-100%)";
      setTimeout(() => borrarTarea(id), 180);
    } else {
      tarea.style.transform = "";
    }
  };
  tarea.addEventListener("pointerup", soltar);
  tarea.addEventListener("pointercancel", () => { activo = false; tarea.classList.remove("arrastrando"); tarea.style.transform = ""; });
}

// ---------- Acciones sobre tareas ----------

let temporizadorAviso = null;

function avisar(texto, deshacer) {
  $("aviso-texto").textContent = texto;
  $("aviso-boton").hidden = !deshacer;
  $("aviso-boton").onclick = () => { deshacer(); $("aviso").hidden = true; };
  $("aviso").hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => ($("aviso").hidden = true), 4000);
}

function vibrar() {
  navigator.vibrate?.(10);
}

function alternarCompletada(id) {
  const t = { ...db.tareas[id] };
  t.completada = !t.completada;
  t.completada_en = t.completada ? Date.now() : null;
  guardar("tareas", t);
  vibrar();
  if (t.completada) avisar("Tarea completada", () => alternarCompletada(id));
}

function borrarTarea(id) {
  const anterior = { ...db.tareas[id] };
  guardar("tareas", { ...anterior, borrado: true });
  vibrar();
  avisar("Tarea borrada", () => guardar("tareas", { ...anterior, borrado: false }));
}

// ---------- Hojas ----------

function prepararHoja(dialogo) {
  dialogo.addEventListener("click", (e) => { if (e.target === dialogo) dialogo.close(); });
  dialogo.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => dialogo.close()));
}
document.querySelectorAll("dialog").forEach(prepararHoja);

// Ver tarea
let tareaViendo = null;

function verTarea(id) {
  const t = db.tareas[id];
  tareaViendo = id;
  $("ver-titulo").textContent = (t.prioridad === 1 ? "★ " : "") + t.titulo;
  $("ver-notas").textContent = t.notas ?? "";
  const creada = new Date(t.creada).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  $("ver-info").textContent = `Creada el ${creada}` +
    (t.completada && t.completada_en ? ` · hecha el ${new Date(t.completada_en).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}` : "");
  $("dialogo-ver").showModal();
}

$("btn-editar-tarea").addEventListener("click", () => {
  $("dialogo-ver").close();
  abrirFormTarea(tareaViendo);
});

$("btn-borrar-tarea").addEventListener("click", () => {
  $("dialogo-ver").close();
  borrarTarea(tareaViendo);
});

// Nueva / editar tarea
let tareaEditando = null;

function abrirFormTarea(id) {
  tareaEditando = id;
  const t = id ? db.tareas[id] : null;
  const form = $("form-tarea");
  $("titulo-form-tarea").textContent = t ? "Editar tarea" : "Nueva tarea";
  form.titulo.value = t?.titulo ?? "";
  form.notas.value = t?.notas ?? "";
  form.importante.checked = t?.prioridad === 1;
  $("dialogo-tarea").showModal();
  form.titulo.focus();
}

$("btn-nueva-tarea").addEventListener("click", () => abrirFormTarea(null));

$("form-tarea").addEventListener("submit", (e) => {
  const form = e.target;
  const titulo = form.titulo.value.trim();
  if (!titulo) return e.preventDefault();
  const cambios = {
    titulo,
    notas: form.notas.value.trim() || null,
    prioridad: form.importante.checked ? 1 : 4,
  };
  if (tareaEditando) {
    guardar("tareas", { ...db.tareas[tareaEditando], ...cambios });
  } else {
    guardar("tareas", {
      id: nuevoId(), ...cambios, proyecto_id: listaAbierta, etiquetas: [], fecha: null,
      completada: false, completada_en: null, creada: Date.now(), orden: 0, borrado: false,
      recordatorio: null, recurrencia: null, padre_id: null,
    });
  }
});

// Nueva / editar lista
let listaEditando = null;
let colorElegido = "azul";

function pintarColores(contenedor, elegido, alElegir) {
  contenedor.replaceChildren(
    ...COLORES.map((c) => h("button", {
      type: "button", "aria-label": c,
      class: "color" + (c === elegido ? " elegido" : ""),
      style: `background:${colorCss(c)}`,
      onclick: () => alElegir(c),
    }))
  );
}

function pintarColoresLista() {
  pintarColores($("colores"), colorElegido, (c) => { colorElegido = c; pintarColoresLista(); });
}

function abrirFormLista(id) {
  listaEditando = id;
  const l = id ? db.proyectos[id] : null;
  $("titulo-form-lista").textContent = l ? "Editar lista" : "Nueva lista";
  $("form-lista").nombre.value = l?.nombre ?? "";
  colorElegido = l?.color ?? ajustes.colorDefecto;
  pintarColoresLista();
  $("btn-borrar-lista").hidden = !l;
  $("dialogo-lista").showModal();
}

$("btn-editar-lista").addEventListener("click", () => abrirFormLista(listaAbierta));

$("form-lista").addEventListener("submit", (e) => {
  const nombre = e.target.nombre.value.trim();
  if (!nombre) return e.preventDefault();
  if (listaEditando) {
    guardar("proyectos", { ...db.proyectos[listaEditando], nombre, color: colorElegido });
  } else {
    const nueva = { id: nuevoId(), nombre, color: colorElegido, orden: Date.now(), borrado: false };
    guardar("proyectos", nueva);
    abrirLista(nueva.id);
  }
});

$("btn-borrar-lista").addEventListener("click", () => {
  const l = db.proyectos[listaEditando];
  const tareas = tareasDeLista(listaEditando);
  const texto = tareas.length
    ? `¿Borrar la lista “${l.nombre}” y sus ${tareas.length} tarea(s)?`
    : `¿Borrar la lista “${l.nombre}”?`;
  if (!confirm(texto)) return;
  for (const t of tareas) guardar("tareas", { ...t, borrado: true });
  guardar("proyectos", { ...l, borrado: true });
  $("dialogo-lista").close();
  abrirLista(null);
});

// Ajustes
const ESTILOS = [["clasico", "Clásico"], ["bento", "Bento"], ["cristal", "Cristal"], ["papel", "Papel"], ["monocromo", "Monocromo"]];

function pintarAjustes() {
  $("estilos").replaceChildren(
    ...ESTILOS.map(([valor, texto]) => h("button", {
      type: "button", class: "estilo-opcion" + (ajustes.estilo === valor ? " elegido" : ""),
      onclick: () => { ajustes.estilo = valor; guardarAjustes(); pintarAjustes(); pintar(); },
    }, texto))
  );

  $("segmentos-tema").replaceChildren(
    ...[["claro", "Claro"], ["oscuro", "Oscuro"], ["auto", "Auto"]].map(([valor, texto]) =>
      h("button", {
        type: "button", class: ajustes.tema === valor ? "elegido" : "",
        onclick: () => { ajustes.tema = valor; guardarAjustes(); pintarAjustes(); },
      }, texto)
    )
  );

  const tema = temaActual();
  const muestras = Object.entries(FONDOS).map(([clave, f]) =>
    h("button", {
      type: "button",
      class: "muestra-fondo" + (ajustes.fondo === clave ? " elegido" : ""),
      style: `background:${f[tema]}`,
      onclick: () => { ajustes.fondo = clave; guardarAjustes(); pintarAjustes(); },
    }, f.nombre)
  );
  if (ajustes.foto) {
    muestras.push(h("button", {
      type: "button",
      class: "muestra-fondo" + (ajustes.fondo === "foto" ? " elegido" : ""),
      style: `background-image:url(${ajustes.foto})`,
      onclick: () => { ajustes.fondo = "foto"; guardarAjustes(); pintarAjustes(); },
    }, "Tu foto"));
  }
  $("fondos").replaceChildren(...muestras);

  pintarColores($("colores-defecto"), ajustes.colorDefecto, (c) => {
    ajustes.colorDefecto = c; guardarAjustes(); pintarAjustes();
  });
}

$("btn-ajustes").addEventListener("click", () => {
  pintarAjustes();
  mostrarEstadoSync();
  $("dialogo-ajustes").showModal();
});

// Foto de fondo: se reduce para que ocupe poco y se guarda en este dispositivo
$("input-foto").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  try {
    const imagen = await createImageBitmap(archivo);
    const escala = Math.min(1, 1400 / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    ajustes.foto = lienzo.toDataURL("image/jpeg", 0.8);
    ajustes.fondo = "foto";
    guardarAjustes();
    pintarAjustes();
  } catch {
    avisar("No se pudo abrir esa imagen");
  }
});

// ---------- Atajos de teclado (ordenador) ----------

document.addEventListener("keydown", (e) => {
  const escribiendo = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  if (escribiendo || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
  if ((e.key === "n" || e.key === "q") && listaAbierta && listaAbierta !== SIN_LISTA) {
    e.preventDefault();
    abrirFormTarea(null);
  } else if (e.key === "Escape" && listaAbierta) {
    abrirLista(null);
  }
});

// ---------- Arranque ----------

aplicarAjustes();
listaAbierta = localStorage.getItem("lista-abierta") || null;
pintar();
mostrarEstadoSync();
sincronizar();

// Sincronizar al volver a la app y cada minuto mientras está abierta
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { pintar(); sincronizar(); }
});
window.addEventListener("online", () => sincronizar());
setInterval(() => document.visibilityState === "visible" && sincronizar(), 60000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
