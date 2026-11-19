"""Tests del acceso con contraseña."""
import pytest

from app import auth
from tests.test_sync import cliente, tarea  # noqa: F401 (fixture)


@pytest.fixture
def con_contrasena(monkeypatch):
    monkeypatch.setattr(auth, "CONTRASENA", "secreta")
    monkeypatch.setattr(auth.time, "sleep", lambda s: None)  # que los tests no esperen


def test_sin_contrasena_configurada_no_pide_login(cliente):
    assert cliente.post("/api/sync", json={}).status_code == 200


def test_sin_login_no_se_sincroniza(cliente, con_contrasena):
    assert cliente.post("/api/sync", json={"tareas": [tarea()]}).status_code == 401


def test_contrasena_incorrecta(cliente, con_contrasena):
    assert cliente.post("/api/login", json={"contrasena": "otra"}).status_code == 401
    assert cliente.post("/api/sync", json={}).status_code == 401


def test_login_y_logout(cliente, con_contrasena):
    assert cliente.post("/api/login", json={"contrasena": "secreta"}).status_code == 204
    assert cliente.post("/api/sync", json={}).status_code == 200
    assert cliente.post("/api/logout").status_code == 204
    assert cliente.post("/api/sync", json={}).status_code == 401


def test_salud_no_necesita_login(cliente, con_contrasena):
    assert cliente.get("/api/salud").json() == {"estado": "ok"}
