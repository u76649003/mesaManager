# MesaManager — Agente de Voz con IA Local en Android

## Objetivo

Quiero que implementes en **MesaManager** un agente de voz con IA que pueda funcionar **directamente en el dispositivo Android**, sin depender obligatoriamente de mi ordenador, de Docker ni de una API de IA de pago.

Repositorio:

`https://github.com/u76649003/mesaManager`

La solución debe integrarse sobre el asistente de voz YA EXISTENTE en MesaManager.

No quiero crear un segundo asistente separado ni reescribir desde cero lo que ya funciona.

---

# 1. Resultado esperado

Quiero poder instalar MesaManager en una tablet o móvil Android y mantener conversaciones naturales como:

**Usuario:** “Ey Mesa”

**MesaManager:** “Dime.”

**Usuario:** “¿Tengo sitio para cuatro?”

**MesaManager:** “Sí. La mesa 7 está libre.”

**Usuario:** “Pues resérvamela para Antonio a las diez.”

**MesaManager:** “¿Confirmo mesa 7 para Antonio, cuatro personas, a las diez?”

**Usuario:** “Sí.”

**MesaManager:** “Hecho.”

Después debe volver automáticamente a escuchar sin repetir “Ey Mesa” en cada intervención.

La IA debe ejecutarse preferentemente EN EL PROPIO DISPOSITIVO Android.

---

# 2. Arquitectura objetivo

```text
MesaManager APK
    ↓
WakeWord existente
    ↓
Speech-To-Text existente
    ↓
Texto
    ↓
IA LOCAL
llama.cpp + modelo GGUF
    ↓
Tool / intención estructurada
    ↓
Lógica REAL de MesaManager
    ↓
Stores / Actions / Supabase
    ↓
Resultado real
    ↓
Respuesta breve
    ↓
Text-To-Speech
    ↓
Volver a escuchar
```

---

# 3. No ejecutar Docker dentro de Android

No quiero intentar ejecutar Docker dentro de la APK.

No quiero que Android dependa obligatoriamente de:

```text
docker
docker-compose
Ollama ejecutándose en mi PC
localhost:11434
```

Ollama puede mantenerse OPCIONALMENTE como proveedor alternativo, pero el proveedor principal debe poder funcionar localmente en Android.

---

# 4. Motor de inferencia local

Utiliza **llama.cpp** para ejecutar modelos GGUF en Android.

Repositorio oficial:

`https://github.com/ggml-org/llama.cpp`

Documentación Android:

`https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md`

La integración final debe ser nativa. No quiero utilizar Termux como requisito para el usuario.

---

# 5. Integración con Capacitor

MesaManager utiliza Capacitor.

Analiza primero:

- proyecto `android/`;
- plugins Capacitor;
- WakeWord actual;
- permisos del micrófono;
- código Java/Kotlin;
- lifecycle;
- Gradle;
- configuración NDK/CMake;
- `VoiceAssistantProvider.tsx`.

Implementa un bridge/plugin nativo para IA local.

Arquitectura sugerida:

```text
React / Next / Capacitor
        ↓
LocalAI Capacitor Plugin
        ↓
Kotlin
        ↓
JNI / llama.cpp
        ↓
GGUF
```

Los nombres pueden variar si existe una solución más coherente con la arquitectura actual.

---

# 6. API conceptual del plugin

Una interfaz equivalente a:

```ts
interface LocalAIPlugin {
  isSupported(): Promise<{ supported: boolean }>;

  getDeviceCapabilities(): Promise<{
    ramMb?: number;
    architecture?: string;
    recommendedContext?: number;
  }>;

  isModelInstalled(): Promise<{
    installed: boolean;
    model?: string;
  }>;

  loadModel(options: {
    path: string;
  }): Promise<{ loaded: boolean }>;

  chat(options: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): Promise<LocalAIResponse>;

  cancel(): Promise<void>;

  unloadModel(): Promise<void>;
}
```

Adáptalo a la implementación real de llama.cpp.

---

# 7. El modelo no debe ir obligatoriamente dentro del APK

Evita crear una APK de varios GB.

Flujo recomendado:

```text
Instalar MesaManager
       ↓
Configuración → Asistente IA
       ↓
Comprobar modelo
       ↓
Si no existe:
"Descargar modelo IA"
       ↓
Descargar GGUF
       ↓
Guardar en almacenamiento privado
       ↓
Validar integridad
       ↓
Cargar modelo
```

---

# 8. Gestión del modelo

Crear una configuración similar a:

```text
Configuración
└── Asistente IA

IA local: Activada
Modelo: <nombre>
Estado: Disponible
Tamaño: xxx MB
Motor: llama.cpp

[ Descargar modelo ]
[ Cambiar modelo ]
[ Eliminar modelo ]
[ Probar IA ]
```

Respeta el diseño actual de MesaManager.

---

# 9. Elegir un modelo pequeño

MesaManager no necesita un modelo gigantesco.

La IA debe principalmente:

- entender español;
- interpretar órdenes;
- mantener contexto corto;
- seleccionar tools;
- extraer parámetros;
- resolver referencias;
- responder brevemente.

Ejemplo:

```text
"Busca sitio para cuatro"
```

debe producir una intención equivalente a:

```json
{
  "tool": "buscar_disponibilidad",
  "arguments": {
    "partySize": 4
  }
}
```

No necesito conocimiento general enorme.

---

# 10. Selección de modelo

Evalúa modelos GGUF pequeños compatibles con llama.cpp.

Prioriza:

1. español;
2. instruction following;
3. structured output;
4. tool calling o JSON fiable;
5. tamaño;
6. RAM;
7. velocidad ARM64;
8. licencia compatible;
9. funcionamiento offline.

No hardcodees un modelo sin justificarlo.

El sistema debe permitir cambiar de modelo posteriormente.

---

# 11. Cuantización

Utiliza GGUF cuantizado.

Prioriza equilibrio entre:

```text
calidad
RAM
velocidad
tamaño
```

No asumas que el dispositivo tiene mucha RAM.

---

# 12. Detección de capacidades

Antes de cargar el modelo, detecta cuando sea posible:

- arquitectura;
- RAM aproximada;
- Android;
- ABI;
- espacio libre.

Si el dispositivo no puede ejecutar el modelo:

```text
Este dispositivo no tiene memoria suficiente para ejecutar este modelo.
Prueba un modelo más pequeño.
```

No provocar crash.

---

# 13. Context window reducido

Empieza con un contexto razonable para móvil, por ejemplo 2048 o 4096 según modelo/RAM.

No uses contextos gigantescos sin necesidad.

---

# 14. Salidas estructuradas

Para acciones de MesaManager, NO confíes únicamente en texto libre.

Usa:

- tool calling cuando sea fiable;
- JSON Schema;
- grammar/structured output;

según la mejor opción compatible con el modelo.

Ejemplo:

```json
{
  "type": "tool_call",
  "tool": "crear_reserva",
  "arguments": {
    "guestName": "Antonio",
    "partySize": 4,
    "tableId": "uuid",
    "date": "2026-09-03",
    "time": "22:00"
  }
}
```

Validar siempre antes de ejecutar.

---

# 15. La IA nunca ejecuta directamente

La IA NO puede:

- escribir directamente en Supabase;
- generar/ejecutar SQL;
- ejecutar JavaScript arbitrario;
- ejecutar shell;
- modificar archivos;
- llamar URLs arbitrarias;
- inventar funciones;
- saltarse la lógica de negocio.

Solo puede solicitar tools expresamente registradas.

MesaManager decide si se ejecutan.

---

# 16. Analizar primero las capacidades actuales

Analiza:

```text
src/components/assistant/VoiceAssistantProvider.tsx
src/lib/assistant/
src/stores/
src/app/actions/
src/types/
```

Especialmente:

```text
@/lib/assistant/intents
@/lib/assistant/reservations
@/stores/useFloorStore
@/stores/useReservationStore
@/app/actions/payments
@/app/actions/emails
```

Identifica todas las operaciones reales existentes y crea tools sobre ellas.

Ejemplos conceptuales:

```text
consultar_estado_restaurante
consultar_mesas
consultar_mesas_libres
consultar_disponibilidad
buscar_mejor_mesa
buscar_reserva
consultar_reservas
crear_reserva
modificar_reserva
cancelar_reserva
sentar_reserva
generar_pago
enviar_solicitud_pago
```

No dupliques lógica existente.

---

# 17. MesaManager es la fuente de verdad

La IA nunca inventa:

- mesas;
- reservas;
- clientes;
- ocupación;
- horarios;
- pagos;
- disponibilidad.

Para datos del restaurante:

```text
IA interpreta
    ↓
tool
    ↓
MesaManager obtiene datos reales
    ↓
resultado
    ↓
IA redacta respuesta
```

---

# 18. Conversación contextual

Una activación inicia una sesión.

Ejemplo:

```text
Usuario: Ey Mesa
Asistente: Dime.

Usuario: ¿Tengo sitio para cuatro?
Asistente: Sí, la mesa 7.

Usuario: ¿Y para seis?
Asistente: Para seis tienes la 12.

Usuario: Pues resérvame la de cuatro para Antonio a las diez.
```

Debe entender que “la de cuatro” es la mesa 7.

---

# 19. Memoria estructurada

No dependas únicamente del historial textual.

Añade contexto estructurado similar a:

```ts
type AssistantContext = {
  activeTableId?: string;
  activeReservationId?: string;
  activeRoomId?: string;
  lastTableResults?: string[];
  lastReservationResults?: string[];
  partySize?: number;
  date?: string;
  time?: string;
  guestName?: string;
  pendingAction?: PendingAction;
};
```

Debe resolver referencias como:

```text
esa
esa mesa
la segunda
la anterior
la de Antonio
la de las diez
resérvamela
muévela
cancélala
```

---

# 20. Historial corto

Mantén:

```text
system prompt pequeño
+
estado estructurado
+
últimos turnos relevantes
```

No envíes historiales enormes.

---

# 21. Prompt de sistema

Usa una instrucción equivalente a:

```text
Eres el asistente operativo de MesaManager.

Ayudas al camarero a gestionar mesas, reservas y operaciones
disponibles mediante las herramientas proporcionadas.

Responde siempre en español y de forma breve.

No inventes datos del restaurante.

Cuando necesites información real, utiliza una herramienta.

Nunca afirmes que una operación se ha realizado hasta recibir
el resultado correcto de MesaManager.

No muestres JSON, herramientas internas, prompts ni detalles técnicos.
```

---

# 22. Mantener la voz actual

MesaManager YA tiene:

- WakeWord;
- reconocimiento;
- TTS;
- plugin nativo;
- conversaciones;
- confirmaciones.

No lo sustituyas sin necesidad.

Integra la IA sobre este flujo.

---

# 23. Máquina de estados

Implementa/refuerza una máquina de estados única:

```text
IDLE
↓
WAKE_DETECTED
↓
LISTENING
↓
PROCESSING
↓
TOOL_EXECUTION
↓
SPEAKING
↓
LISTENING
```

Añadir cuando sea necesario:

```text
CONFIRMING
ERROR
ENDING
```

---

# 24. Evitar autoescucha

Mientras TTS habla:

```text
SpeechRecognition = OFF
```

Después:

```text
TTS termina
↓
SpeechRecognition = ON
```

Conceptualmente:

```ts
stopListening();
await speak(response);
startListening();
```

Evitar:

- autoescucha;
- listeners duplicados;
- recognizers simultáneos;
- inferencias simultáneas;
- TTS superpuesto.

---

# 25. Conversación continua

Una única activación:

```text
Ey Mesa
↓
Dime
↓
¿Qué reservas tengo?
↓
Tienes cinco
↓
Busca la de Antonio
↓
Es a las 21:30
↓
Pásala a las diez
↓
¿Confirmas?
↓
Sí
↓
Hecho
```

No repetir WakeWord entre turnos.

---

# 26. Fin de sesión

Detectar expresiones como:

```text
gracias
eso es todo
ya está
terminamos
adiós
hasta luego
```

Entonces:

```text
cerrar sesión
↓
limpiar contexto temporal
↓
IDLE
↓
esperar WakeWord
```

Añadir timeout de inactividad.

---

# 27. Confirmaciones

Consultas NO necesitan confirmación.

Mutaciones importantes/destructivas sí.

Ejemplo:

```text
Cancela la reserva de Antonio.
```

```text
¿Cancelo la reserva de Antonio de las 21:30?
```

```text
Sí.
```

Ejecutar exactamente la operación pendiente.

No duplicar confirmaciones existentes.

---

# 28. Fallback obligatorio

Flujo mínimo:

```text
IA LOCAL llama.cpp
       ↓ si falla
parseAssistantIntent actual
       ↓ si falla
"No te he entendido. ¿Puedes repetirlo?"
```

No eliminar el parser actual.

---

# 29. Ollama opcional

Diseña una interfaz común:

```ts
interface AIProvider {
  chat(request: AssistantRequest): Promise<AssistantResponse>;
}
```

Implementaciones posibles:

```text
LocalLlamaProvider
OllamaProvider
```

Modos:

```text
LOCAL:
llama.cpp
↓
parser

SERVIDOR:
Ollama
↓
llama.cpp
↓
parser
```

El modo LOCAL debe funcionar sin PC.

---

# 30. IA offline

Una vez descargado el modelo:

```text
inferencia IA = offline
```

Las partes de MesaManager que necesiten Supabase/internet siguen funcionando como actualmente.

No confundir inferencia offline con base de datos offline.

---

# 31. STT y TTS

En esta fase:

- conserva Speech-To-Text actual si funciona;
- conserva TTS actual si funciona;
- no añadas Whisper/Piper si complica innecesariamente la primera integración.

Prioridad:

```text
integrar el modelo de lenguaje local
```

Deja la arquitectura preparada para cambiar STT/TTS en el futuro.

---

# 32. Rendimiento

Optimiza para móvil/tablet:

- modelo pequeño;
- GGUF cuantizado;
- contexto limitado;
- respuestas breves;
- modelo cargado y reutilizado;
- una inferencia simultánea como máximo;
- cancelación;
- evitar recargas del modelo.

---

# 33. Lifecycle del modelo

No hacer:

```text
pregunta
↓
cargar modelo
↓
responder
↓
descargar modelo
```

Mantén el motor preparado durante el uso razonable de la app.

Libera memoria solo cuando corresponda.

---

# 34. Cancelación y errores

Controlar:

- modelo inexistente;
- modelo corrupto;
- poca RAM;
- falta de espacio;
- error JNI;
- timeout;
- generación cancelada;
- respuesta inválida;
- Android mata Activity/proceso.

Nunca provocar crash completo si se puede manejar.

---

# 35. UI de estado

Mostrar estados como:

```text
🎙 Escuchando
✨ Pensando
🔊 Hablando
```

Para modelo:

```text
Preparando IA...
```

Si no está disponible:

```text
IA local no disponible.
Los comandos básicos siguen funcionando.
```

---

# 36. Descarga segura del modelo

La descarga debe:

- mostrar progreso;
- reintentar;
- detectar archivo incompleto;
- validar tamaño/hash cuando sea posible;
- evitar duplicados;
- permitir eliminar;
- permitir actualizar.

No considerar válido un modelo incompleto.

---

# 37. Android / ABI / build

Priorizar `arm64-v8a` si coincide con la app actual.

Analiza ABIs reales.

Integra llama.cpp con NDK/CMake/Gradle de forma reproducible.

No quiero tener que compilar manualmente llama.cpp cada vez para generar la APK.

Documenta cualquier `.so`, JNI, CMake o binding creado.

---

# 38. Refactor progresivo

`VoiceAssistantProvider.tsx` ya contiene mucha lógica.

No metas toda la integración nueva ahí.

Extrae responsabilidades.

Posible estructura:

```text
src/lib/assistant/ai/
    provider.ts
    localProvider.ts
    context.ts
    toolDefinitions.ts
    toolExecutor.ts
    schemas.ts
    conversation.ts
```

Y lado Android:

```text
LocalAIPlugin.kt
LocalAIEngine.kt
JNI / llama.cpp
```

Adapta nombres a la arquitectura real.

---

# 39. Flujo completo esperado

```text
Usuario:
¿Tengo sitio para cuatro?

IA:
tool = consultar_disponibilidad
partySize = 4

MesaManager:
mesa 7 disponible

IA:
La mesa 7 está libre.

Usuario:
Resérvamela para Antonio a las diez.

Contexto:
mesa = 7
personas = 4
nombre = Antonio
hora = 22:00

IA:
crear_reserva(...)

MesaManager:
pide confirmación

Usuario:
Sí.

MesaManager:
ejecuta reserva real

IA:
Hecho.
```

Nunca decir “Hecho” antes de recibir éxito real.

---

# 40. Pruebas obligatorias

## Caso A — disponibilidad + reserva contextual

```text
Ey Mesa
Dime.
¿Tengo sitio para cuatro?
Sí, la mesa 7.
Resérvamela para Antonio a las diez.
¿Confirmo...?
Sí.
Hecho.
```

Verificar reserva real.

## Caso B — modificación contextual

```text
Busca la reserva de Antonio.
Está a las nueve y media.
Pásala media hora más tarde.
¿Confirmo cambiarla a las diez?
Sí.
Hecho.
```

Verificar modificación real.

## Caso C — contexto

```text
¿Qué reservas tengo esta noche?
...
¿Y cuál viene primero?
```

Debe mantener contexto.

## Caso D — ambigüedad

Dos reservas de Antonio:

```text
Busca la de Antonio.
```

Debe preguntar cuál.

## Caso E — IA no disponible

Debe funcionar `parseAssistantIntent`.

## Caso F — modelo no instalado

Mostrar instalación. No crash.

## Caso G — modelo corrupto

Detectar y bloquear carga.

## Caso H — poca RAM

No provocar cierre inesperado.

## Caso I — autoescucha

TTS no debe ser reconocido como voz del usuario.

## Caso J — conversación continua

Una activación y múltiples turnos.

---

# 41. Benchmark de desarrollo

Medir cuando sea posible:

```text
tiempo de carga
tiempo al primer token
tiempo total
tokens/segundo
RAM aproximada
```

No hace falta mostrarlo al usuario final.

---

# 42. Criterios de aceptación

- [ ] MesaManager arranca sin Ollama.
- [ ] MesaManager funciona sin PC.
- [ ] GGUF se ejecuta localmente en Android.
- [ ] El modelo se puede instalar/gestionar.
- [ ] El motor se reutiliza eficientemente.
- [ ] WakeWord sigue funcionando.
- [ ] SpeechRecognition sigue funcionando.
- [ ] TTS sigue funcionando.
- [ ] Conversación continua funciona.
- [ ] No se escucha a sí mismo.
- [ ] Mantiene contexto.
- [ ] Las tools usan lógica real.
- [ ] La IA no modifica directamente Supabase.
- [ ] Tools y argumentos se validan.
- [ ] Confirmaciones funcionan.
- [ ] No hay operaciones duplicadas.
- [ ] `parseAssistantIntent` sigue como fallback.
- [ ] Si falla la IA, la app sigue siendo utilizable.
- [ ] Falta de modelo no provoca crash.
- [ ] RAM/contexto están controlados.
- [ ] Build Android funciona.
- [ ] APK puede generarse.

---

# 43. Auditoría obligatoria antes de implementar

Identifica:

1. arquitectura actual;
2. WakeWord;
3. SpeechRecognition;
4. TTS;
5. estados;
6. intents;
7. operaciones;
8. confirmaciones;
9. stores;
10. server actions;
11. Supabase;
12. plugins Android;
13. Capacitor;
14. Gradle;
15. Android SDK/minSdk/targetSdk;
16. ABIs;
17. sistema de build.

Después implementa sobre esa base.

---

# 44. NO HACER

NO:

- crear otro chatbot;
- eliminar el asistente actual;
- ejecutar Docker dentro de Android;
- obligar a usar mi PC;
- obligar a usar Ollama;
- hardcodear localhost;
- usar un modelo enorme sin evaluar RAM;
- meter toda la lógica en `VoiceAssistantProvider.tsx`;
- ejecutar SQL generado por IA;
- ejecutar código arbitrario;
- confiar en output sin validar;
- inventar datos;
- eliminar el fallback;
- crear una APK gigantesca sin plantear descarga de modelo;
- declarar éxito solo porque compile.

---

# 45. Informe final obligatorio

Entrega:

## Arquitectura final

Diagrama y explicación.

## llama.cpp

- versión;
- integración;
- NDK/CMake;
- ABI;
- JNI/Kotlin.

## Modelo

- nombre;
- parámetros;
- cuantización;
- tamaño;
- RAM aproximada;
- contexto;
- motivo de elección;
- licencia.

## Gestión de modelos

- descarga;
- almacenamiento;
- validación;
- actualización;
- eliminación.

## Capacitor

- plugin creado/modificado;
- métodos disponibles.

## Tools

| Tool | Función real MesaManager | Consulta/Mutación | Confirmación |
|---|---|---|---|

## Contexto

Cómo se mantienen referencias.

## Voz

```text
Wake → escucha → IA → tool → respuesta → TTS → escucha
```

## Fallback

Qué ocurre si:

- IA falla;
- modelo no instalado;
- poca RAM;
- output inválido.

## Archivos

Todos los creados/modificados.

## Build

Comandos exactos para:

- dependencias;
- Capacitor sync;
- build Android;
- APK.

## Pruebas

Indicar cuáles se ejecutaron realmente.

No afirmar que algo se probó si no pudo ejecutarse.

## Rendimiento

Si se puede medir:

- carga;
- latencia;
- tokens/s;
- RAM.

## Limitaciones

Explicar limitaciones reales.

---

# 46. Prioridad

```text
1. NO romper MesaManager.
2. IA local real en Android.
3. Conversación natural.
4. Tools fiables.
5. Fallback.
6. Rendimiento.
7. Ollama opcional como proveedor alternativo.
```

---

# 47. Resultado final

```text
TABLET ANDROID
    ↓
MesaManager APK
    ↓
WakeWord
    ↓
SpeechRecognition
    ↓
llama.cpp
    ↓
modelo GGUF
    ↓
tools MesaManager
    ↓
Supabase / lógica real
    ↓
TTS
    ↓
respuesta hablada
```

Sin depender obligatoriamente de:

```text
PC
Docker
Ollama externo
API de IA de pago
```

---

# INSTRUCCIÓN FINAL PARA ANTIGRAVITY

**NO me expliques solamente cómo se podría implementar.**

Quiero que:

1. analices el repositorio;
2. inspecciones la implementación actual;
3. diseñes la integración;
4. implementes llama.cpp en Android;
5. implementes gestión de modelos GGUF;
6. conectes la IA con el asistente existente;
7. crees tools sobre operaciones reales;
8. mantengas contexto;
9. mantengas fallback;
10. compiles;
11. pruebes;
12. corrijas errores;
13. verifiques/generes la APK;
14. documentes el resultado.

**No sustituyas funcionalidad existente por una demo.**

**No hagas una implementación ficticia.**

**No simules tool calls.**

**No des por completada la tarea hasta que el flujo real esté conectado.**
