// Lógica de la app de tareas.
//
// Todo se guarda primero en este dispositivo (localStorage), así la app
// abre al instante y funciona sin conexión. Por detrás, se sincroniza con
// el servidor (/api/sync) para tener lo mismo en el iPhone, el iPad y el ordenador.
//
// Nota: en el servidor las listas se llaman "proyectos", y "importante"
// se guarda como prioridad 1 (el resto, prioridad 4).

const COLORES = ["azul", "indigo", "morado", "rosa", "rojo", "naranja", "amarillo", "verde", "turquesa", "gris"];
const TIPOS = ["proyectos", "etiquetas", "tareas", "ajustes"];
const CLAVE = "tareas-v1";
const CLAVE_AJUSTES = "ajustes-v1";

const $ = (id) => document.getElementById(id);

// ---------- Datos guardados en el dispositivo ----------

function datosVacios() {
  return {
    proyectos: {}, etiquetas: {}, tareas: {}, ajustes: {},
    cursor: 0,                                                               // última versión recibida del servidor
    pendientes: { proyectos: [], etiquetas: [], tareas: [], ajustes: [] }, // ids aún sin enviar
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
// Datos guardados por una versión anterior de la app
db.ajustes ??= {};
db.pendientes.ajustes ??= [];

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

// Igual que guardar(), pero para muchos registros de golpe
function guardarVarios(tipo, registros) {
  for (const registro of registros) {
    registro.actualizado = Math.max(Date.now(), (db[tipo][registro.id]?.actualizado ?? 0) + 1);
    db[tipo][registro.id] = registro;
    if (!db.pendientes[tipo].includes(registro.id)) db.pendientes[tipo].push(registro.id);
  }
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
      for (const r of recibido[tipo] ?? []) {
        const local = db[tipo][r.id];
        if (!local || r.actualizado >= local.actualizado) db[tipo][r.id] = r;
      }
    }
    db.cursor = recibido.cursor;
    db.ultimaSync = Date.now();
    persistir();
    if (recibido.ajustes?.length) cargarAjustesCompartidos();
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

// ---------- Ajustes ----------
//
// El tema, los recuadros y el tamaño del texto se comparten entre tus
// dispositivos (se sincronizan como un registro "ajustes"). La foto de fondo
// se queda solo en el dispositivo donde la eliges, porque ocupa mucho.

// Fondos de color liso. "fijo" dice si el texto va en modo claro u oscuro.
const FONDOS = {
  // Claros
  glaciar:    { nombre: "Glaciar",    fijo: "claro",  v: "#dbe7f2" },
  perla:      { nombre: "Perla",      fijo: "claro",  v: "#ecebe7" },
  cielo:      { nombre: "Cielo",      fijo: "claro",  v: "#d3e4f8" },
  menta:      { nombre: "Menta",      fijo: "claro",  v: "#d5ede1" },
  lavanda:    { nombre: "Lavanda",    fijo: "claro",  v: "#e3def5" },
  melocoton:  { nombre: "Melocotón",  fijo: "claro",  v: "#f7e0d1" },
  arena:      { nombre: "Arena",      fijo: "claro",  v: "#eee4d2" },
  rosa:       { nombre: "Rosa",       fijo: "claro",  v: "#f5dbe4" },
  // Oscuros
  carbon:     { nombre: "Carbón",     fijo: "oscuro", v: "#1c1c1e" },
  negro:      { nombre: "Negro",      fijo: "oscuro", v: "#000000" },
  pizarra:    { nombre: "Pizarra",    fijo: "oscuro", v: "#1f2832" },
  medianoche: { nombre: "Medianoche", fijo: "oscuro", v: "#0f1a2e" },
  oceano:     { nombre: "Océano",     fijo: "oscuro", v: "#0c2a35" },
  bosque:     { nombre: "Bosque",     fijo: "oscuro", v: "#14241b" },
  ciruela:    { nombre: "Ciruela",    fijo: "oscuro", v: "#271c38" },
  vino:       { nombre: "Vino",       fijo: "oscuro", v: "#2d151c" },
  // Para los otros estilos
  ninguno:    { nombre: "Liso", claro: "#f2f2f7", oscuro: "#000000" },
};

// Lo que se comparte entre dispositivos
const COMPARTIDOS = ["temaElegido", "estilo", "variante", "fondo", "tema", "muestra", "recuadros", "texto"];

const ajustes = leerJSON(CLAVE_AJUSTES, {
  estilo: "cristal", variante: "liquido", recuadros: "cristal", temaElegido: "Glaciar", tema: "claro",
  fondo: "glaciar", texto: "normal", foto: null, usarFoto: false, fotoColor: null,
  colorDefecto: "azul", completadasAbiertas: false,
});

// Ajustes guardados por versiones anteriores de la app
if (ajustes.fondo === "foto") { ajustes.usarFoto = !!ajustes.foto; ajustes.fondo = ajustes.fondoAntesDeFoto; }
if (!FONDOS[ajustes.fondo] || ajustes.fondo === "ninguno" && ajustes.estilo === "cristal") {
  Object.assign(ajustes, { fondo: "glaciar", temaElegido: "Glaciar", estilo: "cristal", variante: "liquido", tema: "claro" });
}

function guardarAjustesLocales() {
  try {
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
  } catch {
    avisar("La foto es demasiado grande para guardarla");
    ajustes.foto = null;
    ajustes.usarFoto = false;
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
  }
  aplicarAjustes();
}

// Guarda en este dispositivo y lo manda a los demás
function guardarAjustes() {
  guardarAjustesLocales();
  const valor = Object.fromEntries(COMPARTIDOS.map((k) => [k, ajustes[k]]));
  guardar("ajustes", { id: "general", valor, borrado: false });
}

// Aplica los ajustes que llegan de otro dispositivo
function cargarAjustesCompartidos() {
  const r = db.ajustes.general;
  if (!r || r.borrado) return;
  const valor = { ...r.valor };
  if (valor.fondo && !FONDOS[valor.fondo]) delete valor.fondo;
  Object.assign(ajustes, valor);
  guardarAjustesLocales();
  if ($("dialogo-ajustes").open) pintarAjustes();
}

const oscuroDelSistema = matchMedia("(prefers-color-scheme: dark)");
oscuroDelSistema.addEventListener?.("change", () => aplicarAjustes());

const conFoto = () => ajustes.usarFoto && !!ajustes.foto;

function temaActual() {
  if (conFoto()) return "oscuro"; // con foto, letras blancas
  return FONDOS[ajustes.fondo]?.fijo ?? (ajustes.tema === "oscuro" ? "oscuro" : "claro");
}

function aplicarAjustes() {
  const tema = temaActual();
  const raiz = document.documentElement;
  raiz.dataset.tema = tema;
  raiz.dataset.estilo = ajustes.estilo;
  raiz.dataset.variante = ajustes.variante;
  raiz.dataset.recuadros = ajustes.recuadros ?? "cristal";
  raiz.dataset.texto = ajustes.texto ?? "normal";
  const f = FONDOS[ajustes.fondo] ?? FONDOS.ninguno;
  const color = conFoto() ? (ajustes.fotoColor ?? "#000000") : (ajustes.muestra ?? f.v ?? f[tema]);
  $("fondo").style.background = conFoto() ? `url(${ajustes.foto}) center / cover no-repeat` : color;
  document.body.classList.toggle("con-foto", conFoto());
  // La franja de arriba (hora y batería) del mismo color que el fondo
  raiz.style.background = color;
  document.querySelector('meta[name="theme-color"]').content = color;
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
  $("pantalla-inicio").hidden = !!id;
  $("pantalla-lista").hidden = !id;
  window.scrollTo(0, 0);
  pintar();
}

$("btn-volver").addEventListener("click", () => abrirLista(null));

function pintar() {
  if (arrastre) return; // no redibujar a mitad de un arrastre (se redibuja al soltar)
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
    const tarjeta = h("button", {
      class: "tarjeta-lista",
      "data-id": l.id,
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
    activarArrastre(tarjeta, {
      selector: ".tarjeta-lista[data-id]",
      alOrdenar: (ids) => reordenar("proyectos", ids),
    });
    return tarjeta;
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
  // Pendientes: primero las importantes, luego en el orden que hayas elegido
  const pendientes = tareas.filter((t) => !t.completada)
    .sort((a, b) => (a.prioridad === 1 ? 0 : 1) - (b.prioridad === 1 ? 0 : 1) || ordenDe(a) - ordenDe(b));
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
      h("div", { class: "fila-completadas" },
        h("button", {
          class: "cabecera-completadas" + (completadasAbiertas ? " abierta" : ""),
          onclick: () => {
            completadasAbiertas = !completadasAbiertas;
            ajustes.completadasAbiertas = completadasAbiertas;
            localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
            pintar();
          },
        }, h("span", { class: "flecha" }, "›"), `Completadas (${hechas.length})`),
        h("button", { class: "boton-vaciar", onclick: () => vaciarCompletadas(hechas) }, "Vaciar"),
      ),
      completadasAbiertas ? h("div", { class: "bloque" }, hechas.slice(0, 300).map(filaTarea)) : null,
    ));
  }
  $("tareas").replaceChildren(...partes);
}

function filaTarea(t) {
  const fila = h("div", { class: "fila-tarea" + (t.completada ? " completada" : ""), "data-id": t.id, "data-grupo": t.prioridad === 1 ? "1" : "4" },
    h("div", { class: "detras" },
      h("span", { class: "izq" }, h("b", {}, t.completada ? "↺" : "✓")),
      h("span", { class: "der" }, h("b", {}, "✕")),
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
  if (!t.completada) {
    activarArrastre(fila, {
      selector: ".fila-tarea[data-id]:not(.completada)",
      mismoGrupo: (otra) => otra.dataset.grupo === fila.dataset.grupo,
      bandeja: true,
      alOrdenar: (ids) => reordenar("tareas", ids),
      alMover: (listaId) => moverTarea(t.id, listaId),
    });
  }
  return fila;
}

// ---------- Deslizar: derecha = completar, izquierda = borrar ----------
//
// El color solo ocupa el hueco que deja la tarea al moverse, así nunca
// se queda una franja verde o roja encima de la tarea.

const UMBRAL = 60;         // px que hay que deslizar para que cuente
const UMBRAL_RAPIDO = 30;  // con un gesto rápido basta con menos
const VELOCIDAD = 0.3;     // px por ms para considerarlo gesto rápido

// Evita que el "clic" que llega justo después de un gesto abra la tarea
function ignorarSiguienteClic(el) {
  const parar = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener("click", parar, { capture: true, once: true });
  setTimeout(() => el.removeEventListener("click", parar, { capture: true }), 350);
}

// En el iPhone se usan los eventos táctiles: así el gesto funciona empezando
// en cualquier punto de la tarea (también encima del texto o de los botones).
const TACTIL = "ontouchstart" in window;

function activarDeslizar(fila, id) {
  const tarea = fila.querySelector(".tarea");
  const [izq, der] = fila.querySelector(".detras").children;
  let inicioX = 0, inicioY = 0, dx = 0, activo = false, decidido = false;
  let ultimoX = 0, ultimoT = 0, velocidad = 0, cuadro = 0;

  const pintarDesplazamiento = () => {
    cuadro = 0;
    tarea.style.transform = `translate3d(${dx}px,0,0)`;
    izq.style.width = Math.max(0, dx) + "px";
    der.style.width = Math.max(0, -dx) + "px";
    const pasa = Math.abs(dx) >= UMBRAL;
    izq.classList.toggle("listo", pasa && dx > 0);
    der.classList.toggle("listo", pasa && dx < 0);
  };

  // Deja la fila como estaba
  const limpiar = () => {
    cancelAnimationFrame(cuadro); cuadro = 0;
    activo = false; decidido = false; dx = 0;
    tarea.classList.remove("arrastrando");
    fila.classList.remove("deslizando");
    tarea.style.transform = "";
    izq.style.width = der.style.width = "0px";
    izq.classList.remove("listo"); der.classList.remove("listo");
  };

  const empezar = (x, y, t) => {
    inicioX = ultimoX = x; inicioY = y; ultimoT = t;
    dx = 0; velocidad = 0; activo = true; decidido = false;
  };

  // Devuelve true si el gesto es nuestro (horizontal) y hay que bloquear el scroll
  const mover = (x, y, t) => {
    if (!activo) return false;
    if (arrastre) { limpiar(); return false; } // se está arrastrando para reordenar
    const mx = x - inicioX, my = y - inicioY;
    if (!decidido) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return false;
      if (Math.abs(my) > Math.abs(mx)) { activo = false; return false; } // está haciendo scroll
      decidido = true;
      tarea.classList.add("arrastrando");
      fila.classList.add("deslizando");
    }
    const dt = t - ultimoT;
    if (dt > 0) velocidad = (x - ultimoX) / dt;
    ultimoX = x; ultimoT = t;
    dx = mx;
    if (!cuadro) cuadro = requestAnimationFrame(pintarDesplazamiento);
    return true;
  };

  const soltar = () => {
    if (!activo) return;
    if (!decidido) { activo = false; return; }
    ignorarSiguienteClic(fila);
    const rapido = Math.abs(velocidad) > VELOCIDAD && Math.abs(dx) > UMBRAL_RAPIDO && Math.sign(velocidad) === Math.sign(dx);
    const final = dx;
    const salir = (lado, accion) => {
      cancelAnimationFrame(cuadro); cuadro = 0;
      activo = false;
      tarea.classList.remove("arrastrando");
      fila.classList.remove("deslizando");
      tarea.style.transform = `translate3d(${lado * 100}%,0,0)`;
      (lado > 0 ? izq : der).style.width = "100%";
      setTimeout(() => { limpiar(); accion(); }, 160);
    };
    if (final >= UMBRAL || (rapido && final > 0)) return salir(1, () => alternarCompletada(id, false));
    if (final <= -UMBRAL || (rapido && final < 0)) return salir(-1, () => borrarTarea(id));
    limpiar(); // no ha llegado: vuelve a su sitio
  };

  if (TACTIL) {
    fila.addEventListener("touchstart", (e) => {
      if (e.touches.length > 1) return limpiar();
      const p = e.touches[0];
      empezar(p.clientX, p.clientY, performance.now());
    }, { passive: true });
    fila.addEventListener("touchmove", (e) => {
      const p = e.touches[0];
      if (mover(p.clientX, p.clientY, performance.now()) && e.cancelable) e.preventDefault();
    }, { passive: false });
    fila.addEventListener("touchend", soltar);
    fila.addEventListener("touchcancel", limpiar);
  } else {
    // Ratón (ordenador)
    tarea.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      empezar(e.clientX, e.clientY, e.timeStamp);
    });
    tarea.addEventListener("pointermove", (e) => {
      const antes = decidido;
      mover(e.clientX, e.clientY, e.timeStamp);
      if (!antes && decidido) try { tarea.setPointerCapture(e.pointerId); } catch {}
    });
    tarea.addEventListener("pointerup", soltar);
    tarea.addEventListener("pointercancel", limpiar);
    tarea.addEventListener("lostpointercapture", () => { if (activo) soltar(); });
  }
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

function alternarCompletada(id, celebrar = true) {
  const t = { ...db.tareas[id] };
  // Pequeña animación antes de que la tarea baje a "Completadas"
  const fila = !t.completada && celebrar && document.querySelector(`.fila-tarea[data-id="${CSS.escape(id)}"]`);
  if (fila && !fila.classList.contains("celebrando")) {
    fila.classList.add("celebrando");
    vibrar();
    setTimeout(() => alternarCompletada(id, false), 280);
    return;
  }
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

function vaciarCompletadas(hechas) {
  const antes = hechas.map((t) => ({ ...t }));
  guardarVarios("tareas", hechas.map((t) => ({ ...t, borrado: true })));
  vibrar();
  avisar(`${antes.length} tarea${antes.length > 1 ? "s" : ""} borrada${antes.length > 1 ? "s" : ""}`,
    () => guardarVarios("tareas", antes.map((t) => ({ ...t, borrado: false }))));
}

function moverTarea(id, listaId) {
  const t = db.tareas[id];
  const destino = db.proyectos[listaId];
  if (!t || !destino || t.proyecto_id === listaId) return;
  const antes = t.proyecto_id;
  guardar("tareas", { ...t, proyecto_id: listaId, orden: Date.now() });
  avisar(`Movida a “${destino.nombre}”`, () => guardar("tareas", { ...db.tareas[id], proyecto_id: antes }));
}

// Orden de las tareas (las antiguas no tenían, usan la fecha de creación)
const ordenDe = (t) => t.orden || t.creada;

// Guarda el nuevo orden tras arrastrar
function reordenar(tipo, ids) {
  const cambiados = [];
  ids.forEach((id, i) => {
    const r = db[tipo][id];
    if (r && r.orden !== i + 1) cambiados.push({ ...r, orden: i + 1 });
  });
  if (cambiados.length) guardarVarios(tipo, cambiados);
  else pintar();
}

// ---------- Arrastrar: mantener pulsado y mover ----------
//
// Sirve para ordenar listas y tareas. Al arrastrar una tarea aparecen abajo
// las demás listas: si la sueltas encima de una, se mueve a esa lista.

const ESPERA_ARRASTRE = 400; // ms manteniendo pulsado
let arrastre = null;

// Mientras se arrastra, que la pantalla no haga scroll
document.addEventListener("touchmove", (e) => { if (arrastre) e.preventDefault(); }, { passive: false });

function activarArrastre(el, op) {
  let temporizador = null, x0 = 0, y0 = 0;
  const cancelarEspera = () => clearTimeout(temporizador);

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".check, .estrella")) return;
    x0 = e.clientX; y0 = e.clientY;
    const pointerId = e.pointerId;
    cancelarEspera();
    temporizador = setTimeout(() => empezarArrastre(el, op, pointerId, x0, y0), ESPERA_ARRASTRE);
  });
  el.addEventListener("pointermove", (e) => {
    if (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8) cancelarEspera();
  });
  el.addEventListener("pointerup", cancelarEspera);
  el.addEventListener("pointercancel", cancelarEspera);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

function empezarArrastre(el, op, pointerId, x, y) {
  // Si la pantalla se ha redibujado mientras se mantenía pulsado, usar el elemento nuevo
  if (!el.isConnected) el = document.querySelector(`${op.selector}[data-id="${CSS.escape(el.dataset.id)}"]`);
  if (!el || document.querySelector("dialog[open]")) return;
  const r = el.getBoundingClientRect();
  const fantasma = el.cloneNode(true);
  fantasma.classList.add("fantasma");
  fantasma.removeAttribute("data-id");
  Object.assign(fantasma.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  document.body.append(fantasma);
  el.classList.add("hueco");
  arrastre = { el, op, fantasma, dx: x - r.left, dy: y - r.top, destino: null };
  // Se escucha en toda la ventana: al cambiar de sitio el elemento, el navegador lo "suelta"
  addEventListener("pointermove", moverArrastre);
  addEventListener("pointerup", soltarArrastre);
  addEventListener("pointercancel", cancelarArrastre);
  if (op.bandeja) mostrarBandeja();
  vibrar();
}

function moverArrastre(e) {
  const a = arrastre;
  a.fantasma.style.left = e.clientX - a.dx + "px";
  a.fantasma.style.top = e.clientY - a.dy + "px";

  // Si llega al borde, la pantalla avanza sola
  if (e.clientY < 90) window.scrollBy(0, -10);
  else if (e.clientY > innerHeight - 90 && !a.op.bandeja) window.scrollBy(0, 10);

  const debajo = document.elementFromPoint(e.clientX, e.clientY);
  // ¿Encima de una lista de la bandeja?
  const chip = debajo?.closest(".chip-lista");
  document.querySelectorAll(".chip-lista.encima").forEach((c) => c !== chip && c.classList.remove("encima"));
  a.destino = chip?.dataset.id ?? null;
  if (chip) { chip.classList.add("encima"); return; }

  // ¿Encima de otro elemento? Se cambia de sitio
  const otro = debajo?.closest(a.op.selector);
  if (!otro || otro === a.el || otro.parentElement !== a.el.parentElement) return;
  if (a.op.mismoGrupo && !a.op.mismoGrupo(otro)) return;
  const hermanos = [...a.el.parentElement.children];
  if (hermanos.indexOf(a.el) < hermanos.indexOf(otro)) otro.after(a.el);
  else otro.before(a.el);
}

function cancelarArrastre() { soltarArrastre(null); }

function soltarArrastre(e) {
  const a = arrastre;
  if (!a) return;
  arrastre = null;
  removeEventListener("pointermove", moverArrastre);
  removeEventListener("pointerup", soltarArrastre);
  removeEventListener("pointercancel", cancelarArrastre);
  a.fantasma.remove();
  a.el.classList.remove("hueco");
  $("bandeja").hidden = true;
  // Que el "clic" al soltar no abra la lista o la tarea
  const parar = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener("click", parar, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", parar, { capture: true }), 400);

  if (!e) return pintar(); // cancelado
  if (a.destino && a.op.alMover) return a.op.alMover(a.destino);
  const ids = [...a.el.parentElement.querySelectorAll(a.op.selector)].map((x) => x.dataset.id);
  a.op.alOrdenar(ids);
}

function mostrarBandeja() {
  const otras = listas().filter((l) => l.id !== listaAbierta);
  if (!otras.length) return;
  $("bandeja-listas").replaceChildren(...otras.map((l) =>
    h("div", { class: "chip-lista", "data-id": l.id, style: `--c:${colorCss(l.color)}` }, l.nombre)));
  $("bandeja").hidden = false;
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
      completada: false, completada_en: null, creada: Date.now(), orden: Date.now(), borrado: false,
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

// Ajustes: cada tema es un aspecto completo (fondo + estilo). Un toque y listo.
const L = (fondo) => [FONDOS[fondo].nombre, { estilo: "cristal", variante: "liquido", fondo }];
const GRUPOS_TEMAS = [
  ["Colores claros", ["glaciar", "perla", "cielo", "menta", "lavanda", "melocoton", "arena", "rosa"].map(L)],
  ["Colores oscuros", ["carbon", "negro", "pizarra", "medianoche", "oceano", "bosque", "ciruela", "vino"].map(L)],
  ["Otros estilos", [
    ["Clásico", { estilo: "clasico", fondo: "ninguno", tema: "claro", muestra: "#f2f2f7" }],
    ["Clásico oscuro", { estilo: "clasico", fondo: "ninguno", tema: "oscuro", muestra: "#000000" }],
    ["Bento", { estilo: "bento", fondo: "ninguno", tema: "claro", muestra: "#f2f2f7" }],
    ["Papel", { estilo: "papel", fondo: "ninguno", tema: "claro", muestra: "#f5efe3" }],
    ["Monocromo", { estilo: "monocromo", fondo: "ninguno", tema: "claro", muestra: "#ffffff" }],
  ]],
];

function elegirTema(nombre, t) {
  Object.assign(ajustes, {
    temaElegido: nombre,
    estilo: t.estilo,
    variante: t.variante ?? "liquido",
    fondo: t.fondo,
    tema: t.tema ?? FONDOS[t.fondo]?.fijo ?? "claro",
    muestra: t.muestra ?? null,
    usarFoto: false, // al elegir un color, se deja de usar la foto
  });
  guardarAjustes(); pintarAjustes();
}

function segmentos(contenedor, opciones, actual, alElegir) {
  contenedor.replaceChildren(
    ...opciones.map(([valor, texto]) => h("button", {
      type: "button", class: actual === valor ? "elegido" : "",
      onclick: () => { alElegir(valor); guardarAjustes(); pintarAjustes(); },
    }, texto))
  );
}

function pintarAjustes() {
  $("temas").replaceChildren(
    ...GRUPOS_TEMAS.map(([titulo, temas]) => h("div", {},
      h("p", { class: "etiqueta-grupo" }, titulo),
      h("div", { class: "grupo" }, h("div", { class: "fondos" },
        temas.map(([nombre, t]) => {
          const f = FONDOS[t.fondo];
          const oscuro = (t.tema ?? f?.fijo) === "oscuro";
          return h("button", {
            type: "button",
            class: "muestra-fondo muestra-tema" + (ajustes.temaElegido === nombre && !conFoto() ? " elegido" : ""),
            style: `background:${t.muestra ?? f.v}`,
            "data-oscuro": oscuro,
            onclick: () => elegirTema(nombre, t),
          }, h("span", { class: "mini-tarjeta" }), h("span", { class: "mini-tarjeta" }), nombre);
        })
      )),
    ))
  );

  segmentos($("segmentos-recuadros"), [["cristal", "Del tema"], ["color", "De color"]],
    ajustes.recuadros ?? "cristal", (v) => (ajustes.recuadros = v));
  segmentos($("segmentos-texto"), [["normal", "Normal"], ["grande", "Grande"], ["enorme", "Muy grande"]],
    ajustes.texto ?? "normal", (v) => (ajustes.texto = v));

  $("texto-foto").textContent = conFoto() ? "Cambiar mi foto…" : ajustes.foto ? "Usar otra foto…" : "Usar mi foto…";
  $("btn-usar-foto").hidden = !ajustes.foto || conFoto();
  $("btn-quitar-foto").hidden = !conFoto();
}

$("btn-usar-foto").addEventListener("click", () => {
  ajustes.usarFoto = true;
  guardarAjustesLocales(); pintarAjustes();
});

$("btn-quitar-foto").addEventListener("click", () => {
  ajustes.usarFoto = false;
  guardarAjustesLocales(); pintarAjustes();
});

$("btn-ajustes").addEventListener("click", () => {
  pintarAjustes();
  mostrarEstadoSync();
  $("dialogo-ajustes").showModal();
});

// Foto de fondo: se reduce para que ocupe poco y se guarda solo en este dispositivo
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
    const ctx = lienzo.getContext("2d");
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    // Color medio de la parte de arriba, para la franja de la hora y la batería
    const franja = ctx.getImageData(0, 0, lienzo.width, Math.max(1, Math.round(lienzo.height * 0.05))).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < franja.length; i += 4) { r += franja[i]; g += franja[i + 1]; b += franja[i + 2]; }
    const n = franja.length / 4;
    ajustes.fotoColor = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    ajustes.foto = lienzo.toDataURL("image/jpeg", 0.8);
    ajustes.usarFoto = true;
    guardarAjustesLocales();
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
cargarAjustesCompartidos();
pintar(); // siempre empieza en el inicio
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
