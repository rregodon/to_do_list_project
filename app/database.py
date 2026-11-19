"""Conexión con la base de datos.

En tu ordenador usamos SQLite (un simple archivo, tareas.db).
En internet usamos PostgreSQL: basta con definir la variable de entorno
DATABASE_URL con la dirección que te da Neon.
"""
import os

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///tareas.db")

# Neon da direcciones "postgresql://..."; le indicamos qué librería usar (psycopg)
if DATABASE_URL.startswith(("postgres://", "postgresql://")):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.split("://", 1)[1]

if DATABASE_URL.startswith("sqlite"):
    # check_same_thread solo hace falta con SQLite
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # pool_pre_ping: comprueba la conexión antes de usarla (Neon cierra las inactivas)
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)


# Columnas que guardan milisegundos y no caben en un número normal (INTEGER)
COLUMNAS_GRANDES = {
    "proyecto": ["actualizado"],
    "etiqueta": ["actualizado"],
    "tarea": ["actualizado", "creada", "completada_en", "recordatorio"],
}


def crear_tablas():
    SQLModel.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        # Arregla las tablas creadas por la primera versión (con INTEGER)
        with engine.begin() as conexion:
            for tabla, columnas in COLUMNAS_GRANDES.items():
                for columna in columnas:
                    conexion.execute(text(f"ALTER TABLE {tabla} ALTER COLUMN {columna} TYPE BIGINT"))


def obtener_sesion():
    # FastAPI llama a esta función en cada petición y cierra la sesión al terminar
    with Session(engine) as sesion:
        yield sesion
