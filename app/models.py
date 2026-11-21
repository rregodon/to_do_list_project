"""Modelos de datos: proyectos, etiquetas y tareas.

Todos los registros tienen:
- id: lo genera el móvil/ordenador (así se pueden crear tareas sin conexión).
- actualizado: momento del último cambio (milisegundos desde 1970; son
  números muy grandes, por eso se guardan como BigInteger). Si dos dispositivos
  cambian lo mismo, gana el cambio más reciente.
- borrado: en vez de borrar de verdad, se marca, para que el borrado
  llegue también a los demás dispositivos.
- version: número que pone el servidor en cada cambio. Cada dispositivo
  recuerda la última versión que vio y pide solo lo nuevo.
"""
import json
import re

from pydantic import field_validator
from sqlalchemy import JSON, BigInteger, Column
from sqlmodel import Field, SQLModel

COLORES = ["gris", "rojo", "naranja", "amarillo", "verde", "turquesa", "azul", "indigo", "morado", "rosa"]
PATRON_ID = r"^[A-Za-z0-9_-]{1,40}$"
PATRON_FECHA = r"^\d{4}-\d{2}-\d{2}$"


class Comun(SQLModel):
    id: str = Field(primary_key=True, max_length=40)
    actualizado: int = Field(ge=0, sa_type=BigInteger)
    borrado: bool = False

    @field_validator("id")
    @classmethod
    def id_valido(cls, v):
        if not re.match(PATRON_ID, v):
            raise ValueError("Identificador no válido")
        return v


class ProyectoBase(Comun):
    nombre: str = Field(min_length=1, max_length=100)
    color: str = "azul"
    orden: float = 0

    @field_validator("color")
    @classmethod
    def color_valido(cls, v):
        if v not in COLORES:
            raise ValueError(f"El color debe ser uno de: {', '.join(COLORES)}")
        return v


class EtiquetaBase(ProyectoBase):
    color: str = "gris"


class TareaBase(Comun):
    titulo: str = Field(min_length=1, max_length=500)
    notas: str | None = Field(default=None, max_length=5000)
    proyecto_id: str | None = Field(default=None, max_length=40)  # None = Bandeja de entrada
    etiquetas: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    prioridad: int = Field(default=4, ge=1, le=4)  # 1 = urgente ... 4 = sin prioridad
    fecha: str | None = Field(default=None)
    completada: bool = False
    completada_en: int | None = Field(default=None, sa_type=BigInteger)
    creada: int = Field(ge=0, sa_type=BigInteger)
    orden: float = 0
    # Preparados para la fase 2 (recordatorios, repeticiones y subtareas)
    recordatorio: int | None = Field(default=None, sa_type=BigInteger)
    recurrencia: str | None = Field(default=None, max_length=100)
    padre_id: str | None = Field(default=None, max_length=40)

    @field_validator("fecha")
    @classmethod
    def fecha_valida(cls, v):
        if v is not None and not re.match(PATRON_FECHA, v):
            raise ValueError("La fecha debe tener el formato AAAA-MM-DD")
        return v

    @field_validator("etiquetas")
    @classmethod
    def etiquetas_validas(cls, v):
        if len(v) > 50 or any(not re.match(PATRON_ID, e) for e in v):
            raise ValueError("Etiquetas no válidas")
        return v


class AjusteBase(Comun):
    """Preferencias de aspecto (tema, fondo...) compartidas entre dispositivos."""

    valor: dict = Field(default_factory=dict, sa_column=Column(JSON))

    @field_validator("valor")
    @classmethod
    def valor_valido(cls, v):
        if len(json.dumps(v)) > 4000:
            raise ValueError("Ajustes demasiado grandes")
        return v


class Proyecto(ProyectoBase, table=True):
    version: int = Field(default=0, index=True)


class Etiqueta(EtiquetaBase, table=True):
    version: int = Field(default=0, index=True)


class Tarea(TareaBase, table=True):
    version: int = Field(default=0, index=True)


class Ajuste(AjusteBase, table=True):
    version: int = Field(default=0, index=True)


class Contador(SQLModel, table=True):
    """Una sola fila con la última versión repartida."""

    id: int = Field(default=1, primary_key=True)
    valor: int = 0


class DatosSync(SQLModel):
    """Lo que envía un dispositivo al sincronizar."""

    cursor: int = 0  # última versión que ya tiene
    proyectos: list[ProyectoBase] = Field(default_factory=list, max_length=5000)
    etiquetas: list[EtiquetaBase] = Field(default_factory=list, max_length=5000)
    tareas: list[TareaBase] = Field(default_factory=list, max_length=20000)
    ajustes: list[AjusteBase] = Field(default_factory=list, max_length=10)
