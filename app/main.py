"""Servidor de la to do list.

Arrancar con:  uvicorn app.main:app --reload

La app guarda todo en el propio dispositivo y funciona sin conexión.
El servidor solo hace de "punto de encuentro" para sincronizar:
cada dispositivo le envía sus cambios y recibe los de los demás.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select
from starlette.middleware.sessions import SessionMiddleware

from . import auth
from .database import crear_tablas, obtener_sesion
from .models import Ajuste, Contador, DatosSync, Etiqueta, Proyecto, Tarea

CARPETA_STATIC = Path(__file__).resolve().parent.parent / "static"
TABLAS = {"proyectos": Proyecto, "etiquetas": Etiqueta, "tareas": Tarea, "ajustes": Ajuste}


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    crear_tablas()  # al arrancar el servidor
    yield


app = FastAPI(title="Mis tareas", lifespan=ciclo_de_vida)
app.add_middleware(
    SessionMiddleware,
    secret_key=auth.CLAVE_SECRETA,
    max_age=365 * 24 * 3600,  # la sesión dura un año
    https_only=auth.EN_INTERNET,
)
app.include_router(auth.router)


@app.get("/api/salud")
def salud():
    """Para comprobar que el servidor está encendido (no necesita contraseña)."""
    return {"estado": "ok"}


def contador(sesion: Session, bloquear: bool) -> Contador:
    consulta = select(Contador).where(Contador.id == 1)
    if bloquear:
        # En PostgreSQL, espera a que termine otra sincronización a la vez
        consulta = consulta.with_for_update()
    fila = sesion.exec(consulta).first()
    if not fila:
        fila = Contador(id=1, valor=0)
        sesion.add(fila)
        sesion.flush()
    return fila


@app.post("/api/sync", dependencies=[Depends(auth.requiere_login)])
def sincronizar(datos: DatosSync, sesion: Session = Depends(obtener_sesion)):
    # 1. Guardar los cambios que trae el dispositivo
    hay_cambios = any(getattr(datos, nombre) for nombre in TABLAS)
    if hay_cambios:
        fila = contador(sesion, bloquear=True)
        fila.valor += 1
        version = fila.valor
        for nombre, Tabla in TABLAS.items():
            for recibido in getattr(datos, nombre):
                existente = sesion.get(Tabla, recibido.id)
                if existente is None:
                    sesion.add(Tabla(**recibido.model_dump(), version=version))
                elif recibido.actualizado > existente.actualizado:
                    # Gana el cambio más reciente
                    existente.sqlmodel_update(recibido.model_dump())
                    existente.version = version
        sesion.commit()

    # 2. Devolver todo lo que ha cambiado desde la última vez
    hasta = contador(sesion, bloquear=False).valor
    respuesta = {"cursor": hasta}
    for nombre, Tabla in TABLAS.items():
        filas = sesion.exec(
            select(Tabla).where(Tabla.version > datos.cursor, Tabla.version <= hasta)
        ).all()
        respuesta[nombre] = [f.model_dump(exclude={"version"}) for f in filas]
    sesion.commit()
    return respuesta


# La interfaz (HTML, CSS, JS). Va al final para no tapar las rutas /api
app.mount("/", StaticFiles(directory=CARPETA_STATIC, html=True), name="static")
