// Lógica de la to do list.
//
// Todo se guarda primero en este dispositivo (localStorage), así la app
// abre al instante y funciona sin conexión. Por detrás, se sincroniza con
// el servidor (/api/sync) para tener lo mismo en el iPhone, el iPad y el ordenador.

const COLORES = ["gris", "rojo", "naranja", "amarillo", "verde", "azul", "morado", "rosa"];
const TIPOS = ["proyectos", "etiquetas", "tareas"];
const CLAVE = "tareas-v1";

const $ = (id) => document.getElementById(id);

// ---------- Datos guardados en el dispositivo ----------

function datosVacios() {
  return {
    proyectos: {}, etiquetas: {}, tareas: {},
    cursor: 0,                                          // última versión recibida del servidor
    pendientes: { proyectos: [], etiquetas: [], tareas: [] }, // ids aún sin enviar
    ultimaSync: null,
  };
}

function cargarDatos() {
  try {
    return { ...datosVacios(), ...JSON.parse(localStorage.getItem(CLAVE)) };
  } catch {
    return datosVacios();
  }
}

const db = cargarDatos();

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
let estadoSync = "";

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
  const hayCambios = TIPOS.some((t) => envio[t].length);
  if (hayCambios) mostrarEstadoSync("Sincronizando…");

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
  } else if (texto !== "Sincronizando…") {
    texto += " · los cambios se guardan en este dispositivo";
  }
  estadoSync = texto;
  $("estado-sync").textContent = texto;
}

// ---------- Fechas ----------

function aTexto(fecha) {
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${m}-${d}`;
}

function deTexto(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function sumarDias(fecha, dias) {
  const r = new Date(fecha);
  r.setDate(r.getDate() + dias);
  return r;
}

const hoy = () => aTexto(new Date());

function fechaLegible(texto) {
  const h = new Date();
  if (texto === aTexto(h)) return "Hoy";
  if (texto === aTexto(sumarDias(h, 1))) return "Mañana";
  if (texto === aTexto(sumarDias(h, -1))) return "Ayer";
  const fecha = deTexto(texto);
  const opciones = { weekday: "short", day: "numeric", month: "short" };
  if (fecha.getFullYear() !== h.getFullYear()) opciones.year = "numeric";
  const texto2 = new Intl.DateTimeFormat("es-ES", opciones).format(fecha);
  return texto2[0].toUpperCase() + texto2.slice(1);
}

// ---------- Listas (vistas) ----------

const LISTAS = {
  bandeja:     { nombre: "Bandeja de entrada", icono: "📥", color: "azul",
                 filtro: (t) => !t.completada && !t.proyecto_id },
  hoy:         { nombre: "Hoy", icono: "★", color: "verde",
                 filtro: (t) => !t.completada && t.fecha && t.fecha <= hoy() },
  proximos:    { nombre: "Próximos", icono: "📅", color: "rojo",
                 filtro: (t) => !t.completada && t.fecha },
  importantes: { nombre: "Importantes", icono: "!", color: "naranja",
                 filtro: (t) => !t.completada && t.prioridad <= 2 },
  todas:       { nombre: "Todas", icono: "≡", color: "gris",
                 filtro: (t) => !t.completada },
  completadas: { nombre: "Completadas", icono: "✓", color: "morado",
                 filtro: (t) => t.completada },
};

let vista = { tipo: "bandeja" }; // o { tipo: "proyecto", id } / { tipo: "etiqueta", id }
let busqueda = "";

function filtroVista(v) {
  if (v.tipo === "proyecto") return (t) => !t.completada && t.proyecto_id === v.id;
  if (v.tipo === "etiqueta") return (t) => !t.completada && t.etiquetas.includes(v.id);
  return LISTAS[v.tipo].filtro;
}

function tareasDe(v) {
  return vivos("tareas").filter(filtroVista(v));
}

// Orden: prioridad, luego fecha (sin fecha al final), luego la más antigua primero
function ordenar(tareas) {
  return tareas.sort((a, b) =>
    a.prioridad - b.prioridad ||
    (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") ||
    a.creada - b.creada
  );
}

function normalizar(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------- Pintar la pantalla ----------

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

const colorCss = (color) => `var(--${color})`;

function pintar() {
  pintarMenu();
  pintarTareas();
}

function pintarMenu() {
  const contenedor = $("listas-inteligentes");
  contenedor.replaceChildren(
    ...Object.entries(LISTAS).map(([clave, lista]) =>
      h("button", {
        class: "lista-inteligente" + (vista.tipo === clave && !busqueda ? " activa" : ""),
        onclick: () => abrirVista({ tipo: clave }),
      },
        h("span", { class: "icono", style: `background:${colorCss(lista.color)}` }, lista.icono),
        h("span", { class: "contador" }, clave === "completadas" ? "" : String(tareasDe({ tipo: clave }).length)),
        h("span", { class: "nombre" }, lista.nombre),
      )
    )
  );

  const proyectos = vivos("proyectos").sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  $("lista-proyectos").replaceChildren(
    ...proyectos.map((p) => h("li", {},
      h("button", {
        class: vista.tipo === "proyecto" && vista.id === p.id && !busqueda ? "activa" : "",
        onclick: () => abrirVista({ tipo: "proyecto", id: p.id }),
      },
        h("span", { class: "punto", style: `background:${colorCss(p.color)}` }),
        h("span", { class: "nombre" }, p.nombre),
        h("span", { class: "contador" }, String(tareasDe({ tipo: "proyecto", id: p.id }).length)),
      )
    ))
  );

  const etiquetas = vivos("etiquetas").sort((a, b) => a.nombre.localeCompare(b.nombre));
  $("lista-etiquetas").replaceChildren(
    ...etiquetas.map((e) => h("li", {},
      h("button", {
        class: vista.tipo === "etiqueta" && vista.id === e.id && !busqueda ? "activa" : "",
        onclick: () => abrirVista({ tipo: "etiqueta", id: e.id }),
      },
        h("span", { class: "almohadilla", style: `color:${colorCss(e.color)}` }, "@"),
        h("span", { class: "nombre" }, e.nombre),
        h("span", { class: "contador" }, String(tareasDe({ tipo: "etiqueta", id: e.id }).length)),
      )
    ))
  );
  $("estado-sync").textContent = estadoSync;
}

function tituloVista() {
  if (busqueda) return `Buscar: “${busqueda}”`;
  if (vista.tipo === "proyecto") return db.proyectos[vista.id]?.nombre ?? "";
  if (vista.tipo === "etiqueta") return "@" + (db.etiquetas[vista.id]?.nombre ?? "");
  return LISTAS[vista.tipo].nombre;
}

// Agrupa las tareas en secciones según la vista
function secciones(tareas) {
  if (busqueda) {
    const pendientes = ordenar(tareas.filter((t) => !t.completada));
    const hechas = tareas.filter((t) => t.completada);
    return [["", pendientes], ["Completadas", hechas]];
  }
  if (vista.tipo === "hoy") {
    const h0 = hoy();
    return [["Vencidas", ordenar(tareas.filter((t) => t.fecha < h0))],
            ["Hoy", ordenar(tareas.filter((t) => t.fecha === h0))]];
  }
  if (vista.tipo === "proximos") {
    const porFecha = new Map();
    for (const t of tareas.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      const clave = t.fecha < hoy() ? "Vencidas" : fechaLegible(t.fecha);
      if (!porFecha.has(clave)) porFecha.set(clave, []);
      porFecha.get(clave).push(t);
    }
    return [...porFecha].map(([k, v]) => [k, ordenar(v)]);
  }
  if (vista.tipo === "todas") {
    const grupos = [["Bandeja de entrada", ordenar(tareas.filter((t) => !t.proyecto_id))]];
    for (const p of vivos("proyectos").sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))) {
      grupos.push([p.nombre, ordenar(tareas.filter((t) => t.proyecto_id === p.id))]);
    }
    return grupos;
  }
  if (vista.tipo === "completadas") {
    return [["", tareas.sort((a, b) => (b.completada_en ?? 0) - (a.completada_en ?? 0)).slice(0, 200)]];
  }
  return [["", ordenar(tareas)]];
}

function pintarTareas() {
  $("titulo-lista").textContent = tituloVista();
  $("btn-editar-lista").hidden = busqueda || !["proyecto", "etiqueta"].includes(vista.tipo);
  $("captura").hidden = vista.tipo === "completadas" && !busqueda;

  let tareas;
  if (busqueda) {
    const q = normalizar(busqueda);
    tareas = vivos("tareas").filter((t) => normalizar(`${t.titulo} ${t.notas ?? ""}`).includes(q));
  } else {
    tareas = tareasDe(vista);
  }

  const grupos = secciones(tareas).filter(([, lista]) => lista.length);
  if (!grupos.length) {
    $("tareas").replaceChildren(h("p", { class: "vacio" }, busqueda ? "Nada encontrado" : "Sin tareas 🎉"));
    return;
  }
  $("tareas").replaceChildren(
    ...grupos.map(([titulo, lista]) => h("section", { class: "grupo-tareas" },
      titulo ? h("h3", { class: titulo === "Vencidas" ? "vencidas" : "" }, titulo) : null,
      h("ul", {}, lista.map(filaTarea)),
    ))
  );
}

function filaTarea(t) {
  const meta = [];
  if (t.fecha) {
    const clase = t.completada ? "" : t.fecha < hoy() ? "vencida" : t.fecha === hoy() ? "hoy" : "";
    meta.push(h("span", { class: clase }, "📅 " + fechaLegible(t.fecha)));
  }
  const proyecto = db.proyectos[t.proyecto_id];
  if (proyecto && !proyecto.borrado && !(vista.tipo === "proyecto" && !busqueda)) {
    meta.push(h("span", {}, h("span", { style: `color:${colorCss(proyecto.color)}` }, "● "), proyecto.nombre));
  }
  for (const id of t.etiquetas) {
    const e = db.etiquetas[id];
    if (e && !e.borrado) meta.push(h("span", { style: `color:${colorCss(e.color)}` }, "@" + e.nombre));
  }

  return h("li", { class: "tarea" + (t.completada ? " completada" : "") },
    h("button", {
      class: `check p${t.prioridad}` + (t.completada ? " hecha" : ""),
      "aria-label": t.completada ? "Marcar como pendiente" : "Completar",
      onclick: () => alternarCompletada(t.id),
    }),
    h("button", { class: "tarea-cuerpo", onclick: () => abrirTarea(t.id) },
      h("div", { class: "tarea-titulo" }, t.titulo),
      t.notas ? h("div", { class: "tarea-notas" }, t.notas) : null,
      meta.length ? h("div", { class: "tarea-meta" }, meta) : null,
    ),
  );
}

// ---------- Navegación ----------

function abrirVista(v) {
  vista = v;
  busqueda = "";
  $("buscar").value = "";
  document.body.classList.add("en-lista");
  localStorage.setItem("vista", JSON.stringify(v));
  pintar();
  actualizarVistaPrevia();
}

$("btn-volver").addEventListener("click", () => {
  document.body.classList.remove("en-lista");
  busqueda = "";
  $("buscar").value = "";
  pintar();
});

$("buscar").addEventListener("input", (e) => {
  busqueda = e.target.value.trim();
  if (busqueda) document.body.classList.add("en-lista");
  pintar();
});

// ---------- Completar con "Deshacer" ----------

let temporizadorAviso = null;

function avisar(texto, deshacer) {
  $("aviso-texto").textContent = texto;
  $("aviso-boton").hidden = !deshacer;
  $("aviso-boton").onclick = () => { deshacer(); $("aviso").hidden = true; };
  $("aviso").hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => ($("aviso").hidden = true), 4000);
}

function alternarCompletada(id) {
  const t = { ...db.tareas[id] };
  t.completada = !t.completada;
  t.completada_en = t.completada ? Date.now() : null;
  guardar("tareas", t);
  if (t.completada) {
    avisar("Tarea completada", () => alternarCompletada(id));
  }
}

// ---------- Captura rápida ----------
// Escribe por ejemplo: "Llamar al banco #Trabajo @llamadas p1 mañana"
//   #proyecto   @etiqueta   p1/p2/p3 (prioridad)   hoy / mañana

function buscarPorNombre(tipo, nombre) {
  const n = normalizar(nombre).replace(/[\s_-]/g, "");
  return vivos(tipo).find((r) => normalizar(r.nombre).replace(/[\s_-]/g, "") === n);
}

function interpretar(texto) {
  const r = { titulo: [], proyecto: null, etiquetas: [], prioridad: null, fecha: null };
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const minus = normalizar(palabra);
    if (/^#.+/.test(palabra)) r.proyecto = palabra.slice(1).replace(/_/g, " ");
    else if (/^@.+/.test(palabra)) r.etiquetas.push(palabra.slice(1));
    else if (/^(p|!)[1-4]$/.test(minus)) r.prioridad = Number(minus[1]);
    else if (minus === "hoy") r.fecha = hoy();
    else if (minus === "manana") r.fecha = aTexto(sumarDias(new Date(), 1));
    else r.titulo.push(palabra);
  }
  r.titulo = r.titulo.join(" ");
  return r;
}

function actualizarVistaPrevia() {
  const r = interpretar($("captura-texto").value);
  const partes = [];
  if (r.proyecto) {
    const existe = buscarPorNombre("proyectos", r.proyecto);
    partes.push(existe ? `Proyecto: ${existe.nombre}` : `Proyecto nuevo: ${r.proyecto}`);
  }
  for (const e of r.etiquetas) partes.push("@" + (buscarPorNombre("etiquetas", e)?.nombre ?? e));
  if (r.prioridad) partes.push(`Prioridad ${r.prioridad}`);
  if (r.fecha) partes.push(fechaLegible(r.fecha));
  $("captura-vista-previa").replaceChildren(...partes.map((p) => h("span", { class: "etiqueta-previa" }, p)));
}

function obtenerOCrear(tipo, nombre) {
  const existente = buscarPorNombre(tipo, nombre);
  if (existente) return existente.id;
  const nuevo = { id: nuevoId(), nombre, color: tipo === "proyectos" ? "azul" : "gris", orden: Date.now(), borrado: false };
  guardar(tipo, nuevo);
  return nuevo.id;
}

$("captura-texto").addEventListener("input", actualizarVistaPrevia);

$("captura").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = interpretar($("captura-texto").value);
  if (!r.titulo) return;

  // Lo que no se indica se toma de la lista abierta
  let proyecto_id = vista.tipo === "proyecto" && !busqueda ? vista.id : null;
  const etiquetas = vista.tipo === "etiqueta" && !busqueda ? [vista.id] : [];
  let fecha = vista.tipo === "hoy" && !busqueda ? hoy() : null;
  let prioridad = vista.tipo === "importantes" && !busqueda ? 2 : 4;

  if (r.proyecto) proyecto_id = obtenerOCrear("proyectos", r.proyecto);
  for (const nombre of r.etiquetas) {
    const id = obtenerOCrear("etiquetas", nombre);
    if (!etiquetas.includes(id)) etiquetas.push(id);
  }
  if (r.fecha) fecha = r.fecha;
  if (r.prioridad) prioridad = r.prioridad;

  guardar("tareas", {
    id: nuevoId(), titulo: r.titulo, notas: null, proyecto_id, etiquetas, prioridad, fecha,
    completada: false, completada_en: null, creada: Date.now(), orden: 0, borrado: false,
    recordatorio: null, recurrencia: null, padre_id: null,
  });
  $("captura-texto").value = "";
  actualizarVistaPrevia();
});

// ---------- Hoja de edición de tarea ----------

let tareaEditando = null;
let prioridadElegida = 4;
let etiquetasElegidas = new Set();

function cerrarAlPulsarFuera(dialogo) {
  dialogo.addEventListener("click", (e) => { if (e.target === dialogo) dialogo.close(); });
  dialogo.querySelector("[data-cerrar]").addEventListener("click", () => dialogo.close());
}
cerrarAlPulsarFuera($("dialogo-tarea"));
cerrarAlPulsarFuera($("dialogo-grupo"));

function pintarPrioridad() {
  $("segmentos-prioridad").replaceChildren(
    ...[1, 2, 3, 4].map((p) => h("button", {
      type: "button",
      class: p === prioridadElegida ? "elegido" : "",
      style: p < 4 ? `color:var(--p${p})` : "",
      onclick: () => { prioridadElegida = p; pintarPrioridad(); },
    }, p < 4 ? `P${p}` : "—"))
  );
}

function pintarChipsEtiquetas() {
  const etiquetas = vivos("etiquetas").sort((a, b) => a.nombre.localeCompare(b.nombre));
  $("chips-etiquetas").replaceChildren(
    ...etiquetas.map((e) => h("button", {
      type: "button",
      class: "chip" + (etiquetasElegidas.has(e.id) ? " elegido" : ""),
      onclick: () => {
        etiquetasElegidas.has(e.id) ? etiquetasElegidas.delete(e.id) : etiquetasElegidas.add(e.id);
        pintarChipsEtiquetas();
      },
    }, "@" + e.nombre)),
    h("button", {
      type: "button", class: "chip",
      onclick: () => {
        const nombre = prompt("Nombre de la nueva etiqueta");
        if (nombre?.trim()) {
          etiquetasElegidas.add(obtenerOCrear("etiquetas", nombre.trim().slice(0, 100)));
          pintarChipsEtiquetas();
        }
      },
    }, "+ Nueva"),
  );
}

function abrirTarea(id) {
  const t = db.tareas[id];
  tareaEditando = id;
  const form = $("form-tarea");
  form.titulo.value = t.titulo;
  form.notas.value = t.notas ?? "";
  form.fecha.value = t.fecha ?? "";

  const proyectos = vivos("proyectos").sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  $("select-proyecto").replaceChildren(
    h("option", { value: "" }, "Bandeja de entrada"),
    ...proyectos.map((p) => h("option", { value: p.id }, p.nombre)),
  );
  form.proyecto_id.value = t.proyecto_id && db.proyectos[t.proyecto_id] && !db.proyectos[t.proyecto_id].borrado ? t.proyecto_id : "";

  prioridadElegida = t.prioridad;
  etiquetasElegidas = new Set(t.etiquetas.filter((e) => db.etiquetas[e] && !db.etiquetas[e].borrado));
  pintarPrioridad();
  pintarChipsEtiquetas();

  const creada = new Date(t.creada).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  $("info-tarea").textContent = `Creada el ${creada}` +
    (t.completada && t.completada_en ? ` · completada el ${new Date(t.completada_en).toLocaleDateString("es-ES")}` : "");
  $("error-tarea").hidden = true;
  $("dialogo-tarea").showModal();
}

$("btn-quitar-fecha").addEventListener("click", () => ($("form-tarea").fecha.value = ""));

$("form-tarea").addEventListener("submit", (e) => {
  const form = e.target;
  const titulo = form.titulo.value.trim();
  if (!titulo) {
    e.preventDefault();
    $("error-tarea").textContent = "El título no puede estar vacío";
    $("error-tarea").hidden = false;
    return;
  }
  guardar("tareas", {
    ...db.tareas[tareaEditando],
    titulo,
    notas: form.notas.value.trim() || null,
    proyecto_id: form.proyecto_id.value || null,
    fecha: form.fecha.value || null,
    prioridad: prioridadElegida,
    etiquetas: [...etiquetasElegidas],
  });
});

$("btn-eliminar-tarea").addEventListener("click", () => {
  const id = tareaEditando;
  const anterior = { ...db.tareas[id] };
  guardar("tareas", { ...anterior, borrado: true });
  $("dialogo-tarea").close();
  avisar("Tarea eliminada", () => guardar("tareas", { ...anterior, borrado: false }));
});

// ---------- Hoja de proyecto / etiqueta ----------

let grupoEditando = null; // { tipo: "proyectos" | "etiquetas", id: null = nuevo }
let colorElegido = "azul";

function pintarColores() {
  $("colores").replaceChildren(
    ...COLORES.map((c) => h("button", {
      type: "button", "aria-label": c,
      class: "color" + (c === colorElegido ? " elegido" : ""),
      style: `background:${colorCss(c)}`,
      onclick: () => { colorElegido = c; pintarColores(); },
    }))
  );
}

function abrirGrupo(tipo, id = null) {
  grupoEditando = { tipo, id };
  const registro = id ? db[tipo][id] : null;
  const singular = tipo === "proyectos" ? "proyecto" : "etiqueta";
  $("titulo-form-grupo").textContent = registro ? `Editar ${singular}` : (tipo === "proyectos" ? "Nuevo proyecto" : "Nueva etiqueta");
  $("form-grupo").nombre.value = registro?.nombre ?? "";
  colorElegido = registro?.color ?? (tipo === "proyectos" ? "azul" : "gris");
  pintarColores();
  $("btn-eliminar-grupo").hidden = !registro;
  $("btn-eliminar-grupo").textContent = `Eliminar ${singular}`;
  $("dialogo-grupo").showModal();
}

$("btn-nuevo-proyecto").addEventListener("click", () => abrirGrupo("proyectos"));
$("btn-nueva-etiqueta").addEventListener("click", () => abrirGrupo("etiquetas"));
$("btn-editar-lista").addEventListener("click", () =>
  abrirGrupo(vista.tipo === "proyecto" ? "proyectos" : "etiquetas", vista.id)
);

$("form-grupo").addEventListener("submit", (e) => {
  const nombre = e.target.nombre.value.trim();
  if (!nombre) return e.preventDefault();
  const { tipo, id } = grupoEditando;
  const registro = id
    ? { ...db[tipo][id], nombre, color: colorElegido }
    : { id: nuevoId(), nombre, color: colorElegido, orden: Date.now(), borrado: false };
  guardar(tipo, registro);
  if (!id) abrirVista({ tipo: tipo === "proyectos" ? "proyecto" : "etiqueta", id: registro.id });
});

$("btn-eliminar-grupo").addEventListener("click", () => {
  const { tipo, id } = grupoEditando;
  const registro = db[tipo][id];
  if (tipo === "proyectos") {
    const tareas = vivos("tareas").filter((t) => t.proyecto_id === id);
    if (!confirm(`¿Eliminar el proyecto “${registro.nombre}” y sus ${tareas.length} tarea(s)?`)) return;
    for (const t of tareas) guardar("tareas", { ...t, borrado: true });
  } else {
    if (!confirm(`¿Eliminar la etiqueta “${registro.nombre}”? Las tareas no se borran.`)) return;
    for (const t of vivos("tareas").filter((t) => t.etiquetas.includes(id))) {
      guardar("tareas", { ...t, etiquetas: t.etiquetas.filter((e) => e !== id) });
    }
  }
  guardar(tipo, { ...registro, borrado: true });
  $("dialogo-grupo").close();
  abrirVista({ tipo: "bandeja" });
  document.body.classList.remove("en-lista");
});

// ---------- Atajos de teclado (ordenador) ----------

document.addEventListener("keydown", (e) => {
  const escribiendo = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
  if (escribiendo || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
  if (e.key === "q" || e.key === "n") {
    e.preventDefault();
    document.body.classList.add("en-lista");
    $("captura-texto").focus();
  } else if (e.key === "/") {
    e.preventDefault();
    $("buscar").focus();
  }
});

// ---------- Arranque ----------

try {
  const guardada = JSON.parse(localStorage.getItem("vista"));
  if (guardada && (LISTAS[guardada.tipo] || db[guardada.tipo + "s"]?.[guardada.id])) vista = guardada;
} catch { /* sin vista guardada */ }

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
