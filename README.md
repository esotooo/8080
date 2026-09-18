# Intel 8080 Emulator with Floating Point Coprocessor

Emulador y ensamblador del **Intel 8080** extendido con un **coprocesador de punto flotante (FPU IEEE-754 Float32)** conectado conceptualmente al bus de Entrada/Salida del CPU.

Todo está construido con tecnología 100% web pura (**HTML5, CSS3 y Vanilla JavaScript**), sin frameworks ni dependencias externas. Funciona como sitio estático: compatible con GitHub Pages.

---

## Proyecto original

Este proyecto es un **fork / extensión académica** del repositorio original:

- **Repositorio original:** [https://github.com/alexeiiw/8080](https://github.com/alexeiiw/8080)

No se oculta la autoría original: todas las funcionalidades del emulador Intel 8080 y su ensamblador (registros, flags, pila, memoria, Step/Run/Reset, Stack View, tooltips, etc.) se conservan exactamente. Este trabajo **extiende** la arquitectura existente sin reescribirla.

---

## Objetivo

Integrar conceptual y funcionalmente un **coprocesador de punto flotante (FPU)** al emulador Intel 8080.

La FPU **no** es una calculadora independiente: es un **dispositivo periférico conectado al bus I/O del 8080** y solo puede comunicarse usando las instrucciones estándar del ensamblador:

- `OUT` (envío de datos del CPU a la FPU)
- `IN` (lectura de datos de la FPU por el CPU)

No se inventó ninguna instrucción nueva (`FADD`, `FMUL`, `FDIV`, etc.). La comunicación se realiza exclusivamente mediante el par `IN`/`OUT` que el Intel 8080 ya soporta.

---

## Arquitectura

```
  Intel 8080
      |
      v
  Bus de Entrada / Salida (I/O)
      |
      v
  Puertos IN / OUT  (F0H - F5H)
      |
      v
  Floating Point Unit (FPU)
      |
      v
  Operaciones IEEE-754 Float32
```

- **CPU → FPU:** el CPU coloca un byte en el registro `A` y ejecuta `OUT puerto`. El byte viaja por el bus I/O hasta la FPU.
- **FPU → CPU:** el CPU ejecuta `IN puerto`; la FPU coloca un byte sobre el bus y el CPU lo guarda en el registro `A`.

La interfaz muestra en vivo esta comunicación (diagrama CPU ↔ I/O BUS ↔ FPU), resaltando la dirección activa del flujo.

---

## Puertos

| PORT | DIRECTION | FUNCTION |
| :--- | :--- | :--- |
| `F0H` | OUT | Byte de **Operando A** |
| `F1H` | OUT | Byte de **Operando B** |
| `F2H` | OUT | **Comando / Operación** |
| `F3H` | IN | Byte del **Resultado** |
| `F4H` | IN | **Estado** de la FPU |
| `F5H` | OUT | **Reset** de la FPU |

### Estados devueltos por `IN F4H`

| Código | Significado |
| :--- | :--- |
| `00H` | READY (lista) |
| `01H` | BUSY (ocupada; en este emulador el cálculo es síncrono, por lo que el estado vuelve de inmediato) |
| `02H` | DIVISION BY ZERO |
| `FFH` | ERROR |

---

## Float32 y endianness

El Intel 8080 trabaja con bytes de 8 bits. La FPU trabaja con números **IEEE-754 Float32 (32 bits)**, por lo que **cada valor se transmite como 4 bytes consecutivos en *little-endian*** (primero el byte menos significativo).

Las conversiones se realizan con `ArrayBuffer`, `DataView.setFloat32/getFloat32` y `Math.fround()` (para normalizar cada valor a precisión Float32 real, no a `Number` de JavaScript).

Ejemplo:

| Valor | IEEE-754 (32 bits) | Bytes little-endian |
| :--- | :--- | :--- |
| `1.5` | `0x3FC00000` | `00 00 C0 3F` |
| `2.25` | `0x40100000` | `00 00 10 40` |
| `3.75` | `0x40700000` | `00 00 70 40` |

Transmisión de `1.5` hacia la FPU (byte a byte):

```
MVI A, 00H
OUT F0H     ; byte 0
MVI A, 00H
OUT F0H     ; byte 1
MVI A, C0H
OUT F0H     ; byte 2
MVI A, 3FH
OUT F0H     ; byte 3  -> la FPU reconstruye 1.5 (Float32)
```

---

## Operaciones soportadas

Enviadas con `OUT F2H`:

| Código | Operación |
| :--- | :--- |
| `01H` | ADD → `OperandoA + OperandoB` |
| `02H` | SUB → `OperandoA - OperandoB` |
| `03H` | MUL → `OperandoA * OperandoB` |
| `04H` | DIV → `OperandoA / OperandoB` |

Ejemplo:

```
MVI A, 01H
OUT F2H
```

**División entre cero** no rompe el emulador: se aplica la semántica IEEE-754 (`+Infinity`, `-Infinity` o `NaN`), el resultado se almacena de todos modos y el estado de la FPU pasa a **DIVISION BY ZERO (`02H`)**, mostrado claramente en la interfaz.

---

## Ejemplo completo

### `1.5 + 2.25 = 3.75`

Ensamblador (sintaxis exacta del proyecto):

```
MVI A, 00H
OUT F0H
MVI A, 00H
OUT F0H
MVI A, C0H
OUT F0H
MVI A, 3FH
OUT F0H

MVI A, 00H
OUT F1H
MVI A, 00H
OUT F1H
MVI A, 10H
OUT F1H
MVI A, 40H
OUT F1H

MVI A, 01H
OUT F2H

IN F3H
STA 2000H
IN F3H
STA 2001H
IN F3H
STA 2002H
IN F3H
STA 2003H

HLT
```

Resultado en memoria:

```
2000H = 00
2001H = 00
2002H = 70
2003H = 40
```

Que equivale a **`0x40700000` = 3.75**.

La interfaz mostrará:

```
Operand A: 1.5       (0x3FC00000, bytes: 00 00 C0 3F)
Operand B: 2.25      (0x40100000, bytes: 00 00 10 40)
Operation: ADD
Result:    3.75      (0x40700000, bytes: 00 00 70 40)
Status:    READY
```

### Demos precargadas

Dentro de la interfaz hay botones que cargan automáticamente el código en el editor:

| Demo | Operación |
| :--- | :--- |
| ADD | `1.5 + 2.25 = 3.75` |
| SUB | `10.5 - 3.25 = 7.25` |
| MUL | `10.5 * 4 = 42` |
| DIV | `20 / 8 = 2.5` |
| ERROR | `10 / 0` → `DIVISION BY ZERO` |

---

## Cómo ejecutar

El proyecto es 100 % estático. Puedes abrirlo directamente o servirlo con cualquier servidor HTTP simple.

### Opción A — servidor local con Python

```bash
python -m http.server 8080
```

Luego abre en tu navegador:

```
http://localhost:8080
```

### Opción B — abrir el archivo directamente

Abre `index.html` en tu navegador (funciona sin servidor, aunque se recomienda un servidor local para GitHub Pages-style).

> ⚠️ Nota: si abres las demos en un navegador *moderno* mantén un servidor local; el emulador funciona igualmente sin él.

---

## Cómo usar

1. Abre la página.
2. Selecciona una demo FPU (p. ej. **FPU ADD Demo**) o pega tu propio código.
3. Pulsa **Assemble & Load**. (Al ensamblar se limpia la FPU para iniciar una sesión limpia.)
4. Usa **Step** para ejecutar instrucción por instrucción y observar:
   - cada `MVI A, xxH` carga el registro `A`;
   - cada `OUT FxH` envía un byte por el bus I/O a la FPU (se resalta el flujo CPU → FPU);
   - al completar los 4 bytes del operando, aparece el valor Float32;
   - `OUT F2H` ejecuta la operación y la FPU muestra el resultado;
   - cada `IN F3H` devuelve un byte al registro `A` (flujo FPU → CPU);
   - `STA` guarda ese byte en memoria (ver `2000H`–`2003H`).
5. O usa **Run** para ejecutar el programa completo.
6. Revisa el panel **FPU — Floating Point Unit**: operandos A/B, operación, resultado, estado, tabla de puertos, historial y gráfica de resultados.
7. **Reset** reinicia el CPU y la FPU (operandos, resultado, errores, lectura pendiente e historial).

---

## Cómo publicar con GitHub Pages

1. Sube este repositorio a GitHub.
2. Ve a **Settings → Pages** del repositorio.
3. En **Source**, elige `Deploy from a branch`.
4. Selecciona la rama principal (`main` o `master`) y carpeta `/ (root)`.
5. Pulsa **Save**.
6. El sitio quedará disponible en:

```
https://<usuario>.github.io/<repositorio>/
```

También puedes publicarlo desde cualquier otra carpeta del repo (por ejemplo `docs/`), moviendo `index.html`, `cpu.js`, `assembler.js`, `fpu.js`, `main.js` y `styles.css` a esa carpeta. Al estar basado en GitHub Actions, la rama `gh-pages` es otra opción equivalente.

---

## Pruebas

Ejecuta las pruebas unitarias (Node.js) en la raíz del proyecto:

```bash
node test.js
```

Cubren: conversiones IEEE-754 little-endian, operaciones ADD/SUB/MUL/DIV, comunicación completa CPU↔FPU vía `IN`/`OUT` y memoria, lectura secuencial del resultado, división entre cero, estado vía `F4H`, reset vía puerto `F5H` y reset general.

---

## Archivos

| Archivo | Descripción |
| :--- | :--- |
| `index.html` | Interfaz web (editor, CPU dashboard, panel FPU). |
| `styles.css` | Estilos (incluye el panel del coprocesador, el diagrama y la gráfica). |
| `cpu.js` | CPU Intel 8080 + **bus I/O** (`connectIO`, `inPort`, `outPort`). |
| `assembler.js` | Ensamblador Intel 8080 (reutilizado tal cual; ya soportaba `IN`/`OUT`). |
| `fpu.js` | **Coprocesador** `FloatingPointUnit` (módulo independiente). |
| `main.js` | Controlador de la UI, demos, historial y gráfica. |
| `test.js` | Pruebas unitarias (CPU, assembler y FPU). |

---

## Versión y licencia

- **Versión del proyecto:** 2.2.0 (FPU / Floating Point Coprocessor)
- Basado en la versión original **2.1.0** de [alexeiiw/8080](https://github.com/alexeiiw/8080).
- **Licencia:** MIT