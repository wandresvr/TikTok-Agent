// config/outputSchemas.js
// Fuente de verdad para los esquemas JSON que el LLM debe devolver.
//
// IMPORTANTE: cada esquema está acoplado al código de parseo que lo consume:
//   - clasificador → llm/classifier.js (result.type, result.song)
//   - generador    → llm/generator.js  (parsed.message)
//
// Modificar un esquema aquí requiere actualizar también el parser correspondiente.
// Por eso estos fragmentos NO están en prompts.json: si cambia el schema, cambia el código.

module.exports = {
  clasificador: {
    ejemplo: { type: 'request|vote|rating|normal|spam|curiosity', song: 'null | "artista - canción"' },
    campoTipo: 'type',
    campoCancion: 'song',
    instruccionFormato() {
      return (
        `Devuelve EXCLUSIVAMENTE JSON válido con este formato:\n` +
        `{ "type": "${this.ejemplo.type}", "song": null | "nombre de la canción" }\n\n` +
        `Reglas:\n` +
        `- "request": el mensaje PIDE que se ponga una canción. song = "artista - canción".\n` +
        `- "curiosity": el mensaje PREGUNTA algo sobre una canción (año, artista, significado, origen, álbum, letra, etc.). song = nombre de la canción.\n` +
        `- "vote", "rating", "normal", "spam": otros casos. song = null.`
      );
    },
  },

  generador: {
    ejemplo: { message: 'tu frase aquí' },
    campoMensaje: 'message',
    instruccionFormato() {
      return (
        `Formato: responde ÚNICAMENTE un JSON: ${JSON.stringify(this.ejemplo)}\n` +
        `Máximo 80 caracteres en "${this.campoMensaje}". Usa emojis. Sé animado y variado.`
      );
    },
  },
};
