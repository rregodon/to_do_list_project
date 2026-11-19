"""Tests de la sincronización. Ejecutar con:  python -m pytest"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.database import obtener_sesion
from app.main import app


@pytest.fixture
def cliente():
    # Base de datos en memoria: cada test empieza vacío
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)

    def sesion_de_prueba():
        with Session(engine) as sesion:
            yield sesion

    app.dependency_overrides[obtener_sesion] = sesion_de_prueba
    yield TestClient(app)
    app.dependency_overrides.clear()


def tarea(id="t1", actualizado=1000, **extra):
    return {"id": id, "titulo": "Comprar pan", "creada": 1000, "actualizado": actualizado, **extra}


def sync(cliente, cursor=0, **cambios):
    r = cliente.post("/api/sync", json={"cursor": cursor, **cambios})
    assert r.status_code == 200, r.text
    return r.json()


def test_sincronizacion_vacia(cliente):
    assert sync(cliente) == {"cursor": 0, "proyectos": [], "etiquetas": [], "tareas": []}


def test_un_dispositivo_crea_y_otro_lo_recibe(cliente):
    proyecto = {"id": "p1", "nombre": "Casa", "color": "verde", "actualizado": 1000}
    etiqueta = {"id": "e1", "nombre": "recados", "actualizado": 1000}
    t = tarea(proyecto_id="p1", etiquetas=["e1"], prioridad=1, fecha="2026-11-20")
    r = sync(cliente, proyectos=[proyecto], etiquetas=[etiqueta], tareas=[t])
    assert r["cursor"] == 1

    otro = sync(cliente, cursor=0)
    assert otro["proyectos"][0]["nombre"] == "Casa"
    assert otro["etiquetas"][0]["color"] == "gris"
    recibida = otro["tareas"][0]
    assert recibida["etiquetas"] == ["e1"]
    assert recibida["prioridad"] == 1
    assert "version" not in recibida

    # Quien ya está al día no recibe nada
    assert sync(cliente, cursor=1)["tareas"] == []


def test_gana_el_cambio_mas_reciente(cliente):
    sync(cliente, tareas=[tarea(actualizado=1000)])
    sync(cliente, tareas=[tarea(actualizado=3000, titulo="Nuevo")])
    # Llega tarde un cambio más antiguo: se ignora
    sync(cliente, tareas=[tarea(actualizado=2000, titulo="Viejo")])
    assert sync(cliente)["tareas"][0]["titulo"] == "Nuevo"


def test_borrado_llega_a_los_demas(cliente):
    sync(cliente, tareas=[tarea()])
    r = sync(cliente, cursor=1, tareas=[tarea(actualizado=2000, borrado=True)])
    assert r["cursor"] == 2
    assert r["tareas"][0]["borrado"] is True


def test_datos_no_validos(cliente):
    for mala in [tarea(prioridad=7), tarea(titulo=""), tarea(fecha="mañana"), tarea(id="a b")]:
        assert cliente.post("/api/sync", json={"tareas": [mala]}).status_code == 422
    proyecto = {"id": "p1", "nombre": "X", "color": "fucsia", "actualizado": 1}
    assert cliente.post("/api/sync", json={"proyectos": [proyecto]}).status_code == 422
