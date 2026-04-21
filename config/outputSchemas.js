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
    ejemplo: { type: 'request|vote|rating|normal|spam', song: 'null | "artista - canción"' },
    campoTipo: 'type',
    campoCancion: 'song',
    instruccionFormato() {
      // No usar JSON.stringify aquí: song admite null literal (no el string "null"),
      // y la descripción de tipo ("request|vote|...") tampoco es un valor JSON válido.
      // Formatear manualmente para que el LLM entienda null como el literal JSON, no como string.
      return (
        `Devuelve EXCLUSIVAMENTE JSON válido con este formato:\n` +
        `{ "type": "${this.ejemplo.type}", "song": null | "artista - canción" }\n\n` +
        `Si el mensaje pide una canción, type debe ser "request" y song debe ser "artista - canción". ` +
        `Si no, type es uno de los otros y song es null.`
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
