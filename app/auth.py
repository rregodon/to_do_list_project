"""Acceso con contraseña.

La contraseña se configura con la variable de entorno APP_PASSWORD.
Si no está definida (por ejemplo, en tu ordenador), no se pide contraseña.
Al iniciar sesión, el navegador guarda una cookie firmada durante un año.
"""
import hmac
import os
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

CONTRASENA = os.environ.get("APP_PASSWORD")
# Clave para firmar la cookie. En internet hay que definirla (Render la genera sola)
CLAVE_SECRETA = os.environ.get("SECRET_KEY", "solo-para-desarrollo-local")
EN_INTERNET = bool(os.environ.get("RENDER"))  # Render define esta variable

if EN_INTERNET and (not CONTRASENA or "SECRET_KEY" not in os.environ):
    # Mejor no arrancar que dejar la app abierta a cualquiera
    raise RuntimeError("Faltan las variables de entorno APP_PASSWORD o SECRET_KEY")

router = APIRouter(prefix="/api")


def requiere_login(request: Request):
    """Dependencia: corta la petición si no se ha iniciado sesión."""
    if CONTRASENA and not request.session.get("autenticado"):
        raise HTTPException(status_code=401, detail="Hay que iniciar sesión")


class DatosLogin(BaseModel):
    contrasena: str


@router.post("/login", status_code=204)
def login(datos: DatosLogin, request: Request):
    # compare_digest compara sin dar pistas por el tiempo que tarda
    if not CONTRASENA or not hmac.compare_digest(datos.contrasena.encode(), CONTRASENA.encode()):
        time.sleep(1)  # frena a quien intente adivinarla probando muchas
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")
    request.session["autenticado"] = True


@router.post("/logout", status_code=204)
def logout(request: Request):
    request.session.clear()
