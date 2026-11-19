# Mis tareas

Lista de tareas personal (estilo Todoist / Recordatorios de iOS), instalable
en iPhone, iPad y ordenador, y sincronizada entre todos.

## Qué hace (fase 1)

- **Listas**: Bandeja de entrada, Hoy (con vencidas), Próximos, Importantes, Todas y Completadas.
- **Proyectos y etiquetas** con colores.
- **Prioridades** P1–P4 (el círculo de la tarea toma su color).
- **Captura rápida**: escribe `Llamar al banco #Trabajo @llamadas p1 mañana`
  y se rellenan solos el proyecto, la etiqueta, la prioridad y la fecha.
  Si el proyecto o la etiqueta no existen, se crean.
- **Buscar** en títulos y notas. Completar y borrar con **Deshacer**.
- **Funciona sin conexión**: todo se guarda en el dispositivo y se sincroniza
  en cuanto hay internet (si dos dispositivos cambian lo mismo, gana el último cambio).
- Atajos en el ordenador: `q` o `n` para añadir tarea, `/` para buscar.

## Estructura

```
├── app/              ← servidor en Python (FastAPI)
│   ├── main.py       ← la sincronización (/api/sync)
│   ├── models.py     ← cómo son una tarea, un proyecto y una etiqueta
│   ├── auth.py       ← contraseña de acceso
│   └── database.py   ← conexión con la base de datos
├── static/           ← la app (lo que ves)
│   ├── index.html, styles.css, app.js
│   ├── login.html    ← pantalla de contraseña
│   └── sw.js         ← guarda la app en el dispositivo (abre al instante y sin conexión)
└── tests/            ← pruebas automáticas
render.yaml           ← configuración para publicarla en Render
```

## Arrancarla en tu ordenador (Windows)

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Abre <http://localhost:8000>. Pasar los tests: `python -m pytest`.

## Publicarla en internet

- **Base de datos**: PostgreSQL gratuito en [Neon](https://neon.tech).
- **Servidor**: plan gratuito de [Render](https://render.com), configurado en `render.yaml`.
- Variables de entorno en Render: `DATABASE_URL` (la dirección de Neon) y
  `APP_PASSWORD` (tu contraseña). `SECRET_KEY` la genera Render.

## Hoja de ruta

- [x] **Fase 1**: tareas, proyectos, etiquetas, prioridades, captura rápida, sincronización
- [ ] **Fase 2**: recordatorios con notificaciones y tareas recurrentes
- [ ] **Fase 3**: subtareas, filtros guardados, reordenar arrastrando, más atajos
