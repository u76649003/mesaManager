# MesaManager — Integración de IA Conversacional por Voz

## Instrucción principal para Antigravity

Quiero que evoluciones el asistente de voz **YA EXISTENTE** de MesaManager incorporándole una IA conversacional real.

> **No quiero una demo, una explicación ni pseudocódigo.**
>
> Quiero que analices el proyecto actual, implementes los cambios, compiles, pruebes y dejes la funcionalidad operativa sin romper lo que ya existe.

---

## 1. Contexto del proyecto

Repositorio:

`https://github.com/u76649003/mesaManager`

MesaManager es una aplicación de gestión de mesas y reservas para un bar/restaurante.

El proyecto ya dispone de un asistente de voz avanzado. Entre otros elementos, existen:

- `src/components/assistant/VoiceAssistantProvider.tsx`
- `@/lib/assistant/intents`
- `@/lib/assistant/reservations`
- `@/stores/useFloorStore`
- `@/stores/useReservationStore`
- `@/app/actions/payments`
- `@/app/actions/emails`
- Supabase
- Sistema WakeWord
- SpeechRecognition
- Text-To-Speech
- Gestión de reservas
- Gestión de mesas y salas
- Pagos
- Confirmaciones
- Conversaciones parciales ya implementadas

### Muy importante

**NO crees un asistente nuevo.**

**NO sustituyas `VoiceAssistantProvider.tsx` por una implementación nueva desde cero.**

**NO elimines WakeWord.**

**NO elimines SpeechRecognition.**

**NO elimines Text-To-Speech.**

**NO elimines `parseAssistantIntent` ni las operaciones existentes sin analizar antes qué hacen.**

**NO rompas reservas, mesas, salas, pagos, Bizum, enlaces de pago, Supabase ni ninguna funcionalidad existente.**

El objetivo es **evolucionar el asistente actual**, no reemplazarlo.

---

# 2. Objetivo funcional

Quiero que MesaManager permita mantener una conversación natural por voz con el camarero o encargado.

La experiencia debe sentirse como hablar con un ayudante del restaurante.

Ejemplo:

**Camarero:**

> Ey Mesa.

**Asistente:**

> Dime.

**Camarero:**

> ¿Cómo está el restaurante?

**Asistente:**

> Ahora mismo tienes 7 mesas ocupadas, 4 libres y dos reservas pendientes de llegar.

**Camarero:**

> ¿Tengo sitio para cuatro?

**Asistente:**

> Sí. La mejor opción es la mesa 8 del salón principal.

**Camarero:**

> Pues resérvala para las diez a nombre de Antonio.

**Asistente:**

> Perfecto. ¿Confirmo la reserva de Antonio para cuatro personas a las diez en la mesa 8?

**Camarero:**

> Sí.

**Asistente:**

> Reserva creada.

Todo esto debe ocurrir dentro de **UNA MISMA SESIÓN DE CONVERSACIÓN**.

No quiero tener que repetir la palabra de activación después de cada respuesta.

---

# 3. Analiza primero el sistema existente

Antes de modificar código, analiza en profundidad:

```text
src/components/assistant/VoiceAssistantProvider.tsx
src/lib/assistant/
src/stores/
src/app/actions/
src/types/
```

Y especialmente:

```text
@/lib/assistant/intents
@/lib/assistant/reservations
@/stores/useFloorStore
@/stores/useReservationStore
@/app/actions/payments
@/app/actions/emails
```

También debes analizar:

- configuración de Supabase;
- funcionamiento del WakeWord;
- SpeechRecognition;
- Text-To-Speech;
- estados conversacionales actuales;
- confirmaciones;
- gestión de reservas;
- gestión de mesas;
- gestión de salas;
- pagos;
- envío de solicitudes de pago;
- stores;
- server actions;
- cualquier API route existente;
- lógica Android/Capacitor relacionada con la voz.

Primero identifica **todas las acciones que el asistente ya puede ejecutar**.

No inventes una arquitectura paralela si la funcionalidad ya existe.

---

# 4. Principio de arquitectura

Quiero separar claramente:

## Interpretación

La IA entiende qué quiere el usuario.

## Ejecución

MesaManager realiza la operación usando exclusivamente su lógica de negocio existente.

El flujo conceptual debe ser:

```text
WakeWord
   ↓
SpeechRecognition
   ↓
Texto del usuario
   ↓
IA conversacional
   ↓
Intención / Tool Call estructurado
   ↓
Validación
   ↓
Operaciones reales de MesaManager
   ↓
Resultado real
   ↓
IA genera respuesta natural
   ↓
Text-To-Speech
   ↓
Seguir escuchando
```

### Regla crítica

La IA **NO puede modificar directamente la base de datos**.

La IA interpreta.

MesaManager ejecuta.

Todas las modificaciones deben pasar por:

- servicios existentes;
- stores;
- server actions;
- funciones de dominio;
- APIs existentes;
- lógica ya utilizada por la aplicación.

---

# 5. Servicio de IA desacoplado

No quiero seguir aumentando indefinidamente `VoiceAssistantProvider.tsx`.

Crea una capa específica para IA.

Una estructura posible sería:

```text
src/lib/assistant/ai/
    provider.ts
    ollama.ts
    context.ts
    tools.ts
    conversation.ts
    types.ts
```

O una estructura equivalente que encaje mejor con el proyecto.

El objetivo es que:

- `VoiceAssistantProvider` gestione principalmente voz y estado;
- la IA se gestione fuera;
- las tools estén separadas;
- la construcción de contexto esté separada;
- el proveedor de modelo sea sustituible.

---

# 6. Proveedor inicial: Ollama

Quiero utilizar inicialmente Ollama.

Configurable mediante variables de entorno.

Por ejemplo:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:2b
```

No hardcodees estos valores dentro de componentes.

Utiliza la API de **chat**, no generación aislada.

La arquitectura debe permitir cambiar posteriormente Ollama por:

- OpenAI;
- Gemini;
- Claude;
- otro proveedor;

sin tener que reescribir todo el asistente.

---

# 7. La IA no debe estar en el frontend si puede evitarse

Si técnicamente es posible con la arquitectura actual, la comunicación con Ollama debe hacerse desde el backend/server-side.

No quiero exponer innecesariamente configuración interna desde el cliente.

Implementa:

- timeout;
- cancelación;
- validación;
- manejo de errores;
- respuestas malformadas;
- modelo no disponible;
- Ollama desconectado;
- control de concurrencia.

---

# 8. Contexto real de MesaManager

La IA debe poder conocer el estado real del restaurante cuando sea necesario.

Posibles datos:

- mesas;
- etiquetas/números de mesa;
- capacidad;
- estado;
- sala;
- reservas;
- fecha;
- hora;
- duración;
- número de personas;
- nombre del cliente;
- notas;
- disponibilidad;
- ocupación;
- reservas próximas;
- reservas pendientes;
- pagos;
- cualquier otro dato que MesaManager ya gestione.

Pero **NO envíes todo el estado de la aplicación en cada petición**.

Construye contexto reducido según la consulta.

Ejemplo:

Si el usuario pregunta:

> ¿Tengo sitio para cuatro?

No es necesario enviar todos los datos de pagos históricos.

---

# 9. Tools / Function Calling

Quiero que la IA pueda decidir cuándo necesita consultar o ejecutar una operación.

Primero analiza las funciones que YA existen.

Después crea herramientas controladas.

Ejemplos conceptuales:

```text
consultar_estado_restaurante
consultar_mesas
consultar_mesas_libres
consultar_disponibilidad
buscar_mejor_mesa
consultar_salas
buscar_reserva
consultar_reservas
crear_reserva
modificar_reserva
cancelar_reserva
sentar_reserva
generar_pago
enviar_solicitud_pago
```

**Estos nombres son ejemplos.**

No implementes funciones duplicadas si MesaManager ya dispone de una operación equivalente.

Cada tool debe mapearse contra una función real de la aplicación.

---

# 10. Lenguaje natural

No quiero depender únicamente de comandos rígidos o expresiones regulares.

Todas estas frases deben poder interpretarse como la misma intención:

```text
¿Tengo sitio para cuatro?
¿Dónde meto a cuatro personas?
Me vienen cuatro ahora.
Busca una mesa para cuatro.
¿Hay alguna mesa libre para cuatro?
Necesito sitio para cuatro.
```

La IA debe comprender lenguaje natural y convertirlo en una intención estructurada.

---

# 11. Mantener el parser actual como fallback

No quiero perder el comportamiento que ya funciona.

El sistema actual basado en `parseAssistantIntent` debe mantenerse como fallback siempre que sea viable.

Flujo:

```text
Usuario habla
   ↓
Intentar IA
   ↓
IA disponible y respuesta válida
   ↓
Procesar con IA

SI FALLA:
   ↓
parseAssistantIntent actual
   ↓
Ejecutar comportamiento antiguo

SI TAMPOCO SE ENTIENDE:
   ↓
"No te he entendido. ¿Puedes repetirlo?"
```

Esto es muy importante.

Si Ollama está apagado, las órdenes que antes funcionaban deben seguir funcionando.

---

# 12. Conversación con contexto

La conversación debe mantener memoria durante la sesión activa.

Ejemplo:

**Usuario:**

> ¿Tengo sitio para cuatro?

**IA:**

> Sí, la mesa 7 está disponible.

**Usuario:**

> ¿Y para seis?

Debe entender que seguimos preguntando por disponibilidad.

**IA:**

> Para seis tienes disponible la mesa 12.

**Usuario:**

> Pues la de cuatro resérvamela para Antonio a las diez.

Debe recordar:

- que "la de cuatro" se refiere a la mesa 7;
- que hablamos de una reserva;
- que la hora es 22:00;
- que el cliente es Antonio.

---

# 13. Referencias posteriores

Ejemplo:

**Usuario:**

> Busca la reserva de Antonio.

**IA:**

> Antonio tiene una reserva a las 21:30 para cuatro personas.

**Usuario:**

> Pásala a las diez.

Debe saber que:

```text
reserva objetivo = reserva de Antonio
nueva hora = 22:00
```

No debe volver a preguntar qué reserva es si el contexto ya lo deja claro.

---

# 14. Ambigüedad

Si existen varias posibilidades, la IA NO puede inventar.

Ejemplo:

**Usuario:**

> Cambia la reserva de Antonio.

Si existen dos:

**Asistente:**

> Tengo dos reservas de Antonio: una a las nueve y otra a las diez. ¿Cuál quieres modificar?

**Usuario:**

> La de las diez.

Debe continuar usando el contexto anterior.

---

# 15. Estado conversacional

Debe existir una máquina de estados clara.

Como mínimo:

```text
IDLE
ACTIVATED
LISTENING
PROCESSING
SPEAKING
CONFIRMING
ERROR
```

Flujo normal:

```text
IDLE
 ↓ WakeWord
ACTIVATED
 ↓
LISTENING
 ↓ usuario termina
PROCESSING
 ↓
SPEAKING
 ↓ TTS termina
LISTENING
```

No quiero estados inconsistentes ni múltiples procesos de voz compitiendo.

---

# 16. WakeWord inicia una sesión

La palabra de activación debe abrir una sesión de conversación.

Ejemplo:

```text
"Ey Mesa"
   ↓
"Dime"
   ↓
Usuario habla
   ↓
IA responde
   ↓
Usuario puede volver a hablar
   ↓
IA responde
   ↓
...
```

No quiero tener que decir:

```text
"Ey Mesa"
pregunta
"Ey Mesa"
segunda pregunta
"Ey Mesa"
tercera pregunta
```

Una activación abre la conversación.

---

# 17. Volver a escuchar automáticamente

Después de responder por voz:

```text
stopListening()
↓
speak(respuesta)
↓
esperar a que termine TTS
↓
startListening()
```

El micrófono debe volver a activarse automáticamente.

---

# 18. Evitar que el asistente se escuche a sí mismo

Esto es crítico.

Mientras el TTS está reproduciendo audio:

**SpeechRecognition debe estar detenido.**

No deben existir simultáneamente:

```text
TTS hablando
+
SpeechRecognition escuchando
```

Evita:

- bucles de voz;
- que el asistente responda a su propia voz;
- listeners duplicados;
- múltiples SpeechRecognition;
- múltiples llamadas a la IA;
- respuestas TTS solapadas.

Debe existir **una única fuente de verdad para el estado del micrófono**.

---

# 19. Interrupciones

Si es técnicamente viable, prepara el diseño para soportar posteriormente interrupciones del usuario mientras la IA habla.

No hace falta complicar esta primera versión si amenaza la estabilidad.

Prioridad:

1. estabilidad;
2. conversación fluida;
3. evitar autoescucha;
4. después interrupciones avanzadas.

---

# 20. Fin de conversación

La IA debe entender expresiones naturales como:

```text
gracias
eso es todo
perfecto gracias
ya está
terminamos
adiós
hasta luego
```

Cuando realmente indiquen fin:

```text
Asistente: "Perfecto."
↓
cerrar sesión
↓
IDLE
↓
esperar WakeWord
```

También debe existir timeout de inactividad razonable.

---

# 21. Personalidad del asistente

MesaManager no debe responder como un chatbot genérico.

Debe comportarse como un ayudante rápido de un camarero o encargado.

## Malo

> Claro, estaré encantado de ayudarte. Según la información proporcionada actualmente, parece que...

## Bueno

> Tienes tres libres: 4, 7 y 12.

## Malo

> Basándome en los datos proporcionados, la opción más adecuada sería...

## Bueno

> La mejor es la 7. Caben cuatro y está libre.

Reglas:

- respuestas cortas;
- claras;
- naturales;
- español;
- lenguaje de restaurante;
- evitar explicaciones innecesarias;
- no mencionar internamente tools, JSON, modelos, prompts ni APIs.

---

# 22. Datos reales, nunca inventados

Para preguntas sobre:

- mesas;
- reservas;
- disponibilidad;
- clientes;
- pagos;
- ocupación;
- salas;

la IA debe consultar datos reales.

Nunca debe inventar que una mesa está libre.

Nunca debe inventar una reserva.

Nunca debe inventar un pago.

La IA interpreta y redacta.

**MesaManager es la fuente de verdad.**

---

# 23. Confirmaciones

Las consultas normales NO deben pedir confirmación.

Ejemplos:

```text
¿Qué mesas tengo libres?
¿Qué reservas tengo esta noche?
¿Cómo está el salón?
¿Tengo sitio para seis?
¿Dónde puedo sentar a cuatro?
```

Se ejecutan directamente.

Las operaciones importantes o destructivas sí deben utilizar confirmación.

Ejemplos:

```text
cancelar reserva
eliminar algo
cambiar datos importantes
operaciones de pago cuando corresponda
```

---

# 24. No duplicar confirmaciones

Si el flujo existente ya implementa confirmación, reutilízalo.

No quiero:

```text
IA pregunta confirmación
↓
sistema interno vuelve a preguntar confirmación
```

Solo una confirmación.

---

# 25. Uso del contexto para confirmar

Ejemplo:

**Usuario:**

> Cancela la reserva de Antonio.

**Asistente:**

> ¿Cancelo la reserva de Antonio de las 21:30 para cuatro?

**Usuario:**

> Sí.

Debe ejecutar exactamente esa reserva.

La confirmación debe estar ligada a una operación estructurada pendiente.

---

# 26. Contexto temporal

La IA debe interpretar correctamente expresiones como:

```text
hoy
mañana
esta noche
dentro de media hora
a las diez
media hora más tarde
una hora antes
```

Siempre partiendo de fecha/hora reales de la aplicación o servidor.

No permitas que el modelo invente fechas.

---

# 27. Consultas útiles para un restaurante

Quiero preparar el asistente para responder correctamente a preguntas como:

```text
¿Cómo está el restaurante?

¿Cuántas mesas tengo libres?

¿Qué reservas vienen ahora?

¿Quién llega después?

¿Tengo sitio para seis?

¿Dónde puedo meter a ocho?

¿Qué mesa lleva más tiempo ocupada?

¿Qué mesas están disponibles en terraza?

¿Qué reservas tengo esta noche?

Busca la reserva de Antonio.

¿A qué hora viene María?

¿Qué mesa tiene Antonio?

¿Cuándo queda libre la mesa 4?
```

Solo implementa aquellas que puedan responderse con datos reales disponibles en el proyecto.

---

# 28. Acciones útiles

Quiero aprovechar las operaciones reales existentes para expresiones como:

```text
Reserva una mesa para cuatro a las diez a nombre de Antonio.

Cambia la reserva de Antonio a las diez y media.

Cancela la reserva de María.

Sienta la reserva de Antonio.

Busca sitio para seis.

Pon a Juan en la mesa 7.

Genera el pago.

Envíale la solicitud de pago.
```

Siempre respetando las reglas reales del proyecto.

---

# 29. Elección inteligente de mesa

Si ya existe lógica de selección óptima de mesa, reutilízala.

La IA no debe elegir aleatoriamente.

Debe respetar:

- capacidad;
- disponibilidad;
- reservas solapadas;
- sala;
- estado de mesa;
- criterios ya implementados.

---

# 30. Memoria de sesión

Mantén un historial limitado durante la conversación.

Ejemplo conceptual:

```json
[
  {
    "role": "system",
    "content": "Eres el asistente de MesaManager..."
  },
  {
    "role": "user",
    "content": "¿Tengo sitio para cuatro?"
  },
  {
    "role": "assistant",
    "content": "Sí, la mesa 7."
  },
  {
    "role": "user",
    "content": "Resérvala para Antonio a las diez."
  }
]
```

No permitas que el historial crezca indefinidamente.

Define una estrategia razonable:

- últimos N turnos;
- resumen;
- estado estructurado;
- o combinación.

---

# 31. Memoria estructurada

Además del historial textual, recomiendo conservar contexto estructurado cuando corresponda.

Por ejemplo:

```ts
type ConversationContext = {
  activeReservationId?: string;
  activeTableId?: string;
  activeRoomId?: string;
  lastSearchResults?: string[];
  partySize?: number;
  date?: string;
  time?: string;
  guestName?: string;
  pendingOperation?: unknown;
}
```

Adapta el modelo a las necesidades reales del proyecto.

Esto debe permitir resolver referencias como:

```text
esa
la segunda
la de Antonio
esa mesa
la anterior
la de las diez
```

---

# 32. Validar salida de la IA

No confíes en texto libre para ejecutar acciones.

Si la IA quiere ejecutar una operación, debe devolver o utilizar una estructura validable.

Ejemplo conceptual:

```json
{
  "tool": "crear_reserva",
  "arguments": {
    "tableId": "...",
    "guestName": "Antonio",
    "date": "2026-08-30",
    "time": "22:00",
    "partySize": 4
  }
}
```

Valida:

- nombre de tool permitido;
- tipos;
- IDs;
- fechas;
- horas;
- parámetros obligatorios;
- permisos;
- reglas de negocio.

Si algo no es válido, no ejecutes.

---

# 33. Seguridad

La IA NO puede:

- ejecutar SQL generado por el modelo;
- ejecutar JavaScript arbitrario;
- ejecutar shell;
- ejecutar comandos del sistema;
- modificar archivos del servidor;
- llamar endpoints arbitrarios;
- elegir funciones que no estén en una whitelist;
- escribir directamente en Supabase saltándose la lógica de negocio;
- inventar IDs;
- ejecutar tools desconocidas.

Solo puede utilizar las herramientas explícitamente registradas.

---

# 34. Control de concurrencia

Evita:

- dos peticiones de IA simultáneas;
- dos mutaciones por una misma orden;
- doble reserva por respuesta duplicada;
- doble pago;
- doble cancelación.

Añade protección ante respuestas/eventos duplicados.

---

# 35. Manejo de errores

Quiero mensajes naturales.

Por ejemplo:

Ollama caído:

> Ahora mismo no puedo usar la IA, pero puedo seguir entendiendo los comandos básicos.

Error consultando datos:

> No he podido consultar las reservas. Inténtalo otra vez.

Ambigüedad:

> Tengo dos reservas de Antonio. ¿La de las nueve o la de las diez?

No mostrar al usuario final:

- stack traces;
- JSON;
- errores de Supabase;
- detalles internos;
- nombres de funciones.

---

# 36. Observabilidad durante desarrollo

Durante desarrollo sí quiero logs claros que permitan saber:

```text
wake word detectado
transcripción recibida
IA solicitada
tool propuesta
tool validada
tool ejecutada
resultado
TTS iniciado
TTS terminado
reconocimiento reactivado
```

Pero evita logs con información sensible en producción.

---

# 37. No romper Android / Capacitor

MesaManager dispone de APK y lógica nativa relacionada con voz.

Comprueba específicamente:

- Capacitor;
- WakeWord plugin;
- permisos de micrófono;
- compilación Android;
- funcionamiento WebView;
- variables de entorno;
- llamadas desde dispositivo físico a Ollama.

### Atención con localhost

Si Ollama está ejecutándose en otro equipo o servidor, `localhost` desde Android NO representa necesariamente ese equipo.

La configuración de URL debe ser flexible.

No hardcodees `127.0.0.1` dentro de la app móvil.

---

# 38. No romper Web

Comprueba también el flujo desde navegador.

Debe seguir funcionando donde antes funcionaba.

---

# 39. Refactor progresivo de VoiceAssistantProvider

`VoiceAssistantProvider.tsx` ya tiene muchas responsabilidades.

Puedes extraer código, pero hazlo progresivamente.

Posibles piezas:

```text
useVoiceRecognition
useVoiceSession
useAssistantConversation
assistantAIClient
assistantTools
assistantContextBuilder
assistantToolExecutor
assistantFallback
```

No es obligatorio usar esos nombres.

El objetivo es reducir responsabilidades sin reescribir todo de golpe.

---

# 40. Prioridad de implementación

Implementa en este orden:

## Fase 1 — Auditoría

Identificar comportamiento actual.

## Fase 2 — Abstracción IA

Crear proveedor y tipos.

## Fase 3 — Contexto

Construir contexto de MesaManager.

## Fase 4 — Tools

Exponer acciones existentes.

## Fase 5 — Conversación

Mantener sesión y referencias.

## Fase 6 — Voz

Integrar ciclo:

```text
escuchar → procesar → hablar → escuchar
```

## Fase 7 — Fallback

Mantener parser existente.

## Fase 8 — Errores

Ollama offline y errores reales.

## Fase 9 — Tests

Probar conversación completa.

## Fase 10 — APK

Verificar compilación Android.

---

# 41. Pruebas obligatorias

## Caso 1 — Disponibilidad y reserva contextual

**Usuario:**

> Ey Mesa.

**Asistente:**

> Dime.

**Usuario:**

> ¿Tengo sitio para cuatro?

Debe consultar disponibilidad real.

**Asistente:**

> Sí, la mesa X está libre.

**Usuario:**

> Resérvala para las diez a nombre de Antonio.

Debe recordar la mesa anterior.

**Asistente:**

> ¿Confirmo la reserva de Antonio para cuatro a las diez en la mesa X?

**Usuario:**

> Sí.

Debe crear la reserva real.

---

# 42. Caso 2 — Modificación contextual

**Usuario:**

> Ey Mesa.

**Usuario:**

> ¿Qué reservas tengo esta noche?

Responder con datos reales.

**Usuario:**

> Busca la de Antonio.

Mantener contexto.

**Usuario:**

> Pásala media hora más tarde.

Debe calcular la nueva hora.

Pedir confirmación si corresponde.

Ejecutar modificación real.

---

# 43. Caso 3 — Estado del restaurante

**Usuario:**

> ¿Cómo está el restaurante?

Responder resumidamente con información disponible y útil.

Ejemplo:

> Tienes 8 mesas ocupadas, 5 libres y tres reservas en la próxima hora.

No inventar datos que el sistema no pueda obtener.

---

# 44. Caso 4 — Ambigüedad

Crear escenario con dos reservas de Antonio.

**Usuario:**

> Busca la reserva de Antonio.

**Asistente:**

> Tengo dos: una a las nueve y otra a las diez. ¿Cuál?

**Usuario:**

> La de las diez.

Debe seleccionar correctamente.

---

# 45. Caso 5 — Fallback

Apagar Ollama.

Probar un comando que actualmente funcione con `parseAssistantIntent`.

Debe seguir funcionando.

---

# 46. Caso 6 — Autoescucha

Hacer que el asistente responda con TTS.

Comprobar que su propia voz NO genera una nueva petición.

---

# 47. Caso 7 — Conversación continua

Una única activación:

```text
Ey Mesa
↓
pregunta
↓
respuesta
↓
segunda pregunta
↓
respuesta
↓
tercera pregunta
↓
respuesta
↓
gracias, eso es todo
↓
cerrar sesión
```

Debe funcionar sin repetir WakeWord.

---

# 48. Caso 8 — Confirmación

**Usuario:**

> Cancela la reserva de Antonio.

Debe pedir confirmación una sola vez.

**Usuario:**

> Sí.

Debe cancelar exactamente la reserva seleccionada.

---

# 49. Caso 9 — Ollama devuelve respuesta incorrecta

Simular:

- timeout;
- JSON inválido;
- tool inexistente;
- argumentos incompletos.

No ejecutar operaciones peligrosas.

Fallback o mensaje natural.

---

# 50. Caso 10 — Compilación

Ejecutar:

- lint si existe;
- typecheck;
- tests;
- build;
- compilación necesaria del proyecto;
- build Android/APK cuando sea viable en el entorno.

Corregir errores derivados de la implementación.

---

# 51. Criterios de aceptación

La tarea NO se considera terminada hasta cumplir:

- [ ] WakeWord sigue funcionando.
- [ ] SpeechRecognition sigue funcionando.
- [ ] TTS sigue funcionando.
- [ ] El asistente no se escucha a sí mismo.
- [ ] Una activación abre una sesión conversacional.
- [ ] No hay que repetir WakeWord entre preguntas.
- [ ] La IA entiende lenguaje natural.
- [ ] La IA mantiene contexto.
- [ ] Puede resolver referencias como "esa", "la segunda" o "la de Antonio".
- [ ] Las tools utilizan operaciones reales de MesaManager.
- [ ] La IA no modifica directamente la base de datos.
- [ ] Las consultas usan datos reales.
- [ ] Las mutaciones utilizan la lógica existente.
- [ ] Las confirmaciones funcionan.
- [ ] No existen dobles confirmaciones.
- [ ] No existen dobles mutaciones.
- [ ] Existe fallback mediante el sistema actual.
- [ ] El asistente sigue funcionando parcialmente con Ollama apagado.
- [ ] Los errores se comunican de forma natural.
- [ ] La app web sigue funcionando.
- [ ] Android/Capacitor no se rompe.
- [ ] El proyecto compila.
- [ ] La APK sigue pudiéndose generar.
- [ ] No se han eliminado funcionalidades actuales.

---

# 52. Informe final obligatorio

Cuando termines, entrega un informe con:

## Arquitectura

Explica brevemente la arquitectura final.

## Archivos creados

Lista exacta.

## Archivos modificados

Lista exacta.

## Refactor

Qué responsabilidades se han extraído de `VoiceAssistantProvider.tsx`.

## IA

- proveedor;
- endpoint;
- modelo;
- variables de entorno;
- timeouts.

## Tools

Tabla con:

| Tool | Función real utilizada | Consulta/Mutación | Requiere confirmación |
|---|---|---|---|

## Contexto

Cómo se conserva el contexto de conversación.

## Memoria

Cómo se resuelven referencias posteriores.

## Voz

Cómo funciona:

```text
escuchar → procesar → hablar → escuchar
```

## Autoescucha

Cómo se evita que el asistente se escuche a sí mismo.

## Fallback

Cómo funciona cuando Ollama no está disponible.

## Seguridad

Qué validaciones protegen las mutaciones.

## Configuración

Variables de entorno necesarias.

## Ollama

Comandos necesarios para preparar el modelo.

## Pruebas

Qué casos se han probado y resultado.

## Android

Cómo generar la APK.

## Limitaciones

Qué cosas no pudieron verificarse realmente.

No afirmes que algo se ha probado si no se ha podido ejecutar.

---

# 53. Restricciones finales

No quiero que respondas únicamente con una explicación.

No quiero pseudocódigo como resultado final.

No quiero un segundo chatbot independiente.

No quiero reemplazar el sistema actual por una demo.

No quiero perder funcionalidades actuales.

No quiero dependencias nuevas innecesarias.

No quiero lógica sensible directamente en el frontend.

No quiero SQL generado por IA.

No quiero acciones inventadas.

No quiero que la IA tenga acceso libre a funciones internas.

---

# 54. Instrucción final

## Ejecuta este trabajo de forma autónoma

1. Analiza primero el repositorio completo relevante.
2. Entiende el asistente actual.
3. Identifica todas las capacidades existentes.
4. Diseña la integración sobre lo existente.
5. Implementa la IA.
6. Añade contexto.
7. Añade tools sobre operaciones reales.
8. Mantén fallback.
9. Integra la conversación continua.
10. Asegura el ciclo correcto del micrófono/TTS.
11. Compila.
12. Ejecuta tests.
13. Corrige errores.
14. Verifica Android/Capacitor.
15. Entrega el informe final.

> **No me describas cómo podría hacerse: haz los cambios en el proyecto y déjalo funcionando.**
