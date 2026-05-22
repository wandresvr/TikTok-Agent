// config/promptLoader.js
// Carga prompts.json y ensambla los system/user prompts para cada módulo LLM.
// Los fragmentos editables vienen de prompts.json.
// Los esquemas de salida (no editables) vienen de outputSchemas.js.

const prompts = require('./prompts.json');
const schemas = require('./outputSchemas');

/**
 * Accede a una clave dot-notation del JSON de prompts.
 * Ejemplo: get('generador.sistema_rol_base')
 * @param {string} key
 * @returns {string}
 */
function get(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], prompts) ?? '';
}

/**
 * Obtiene un prompt y reemplaza los placeholders {clave} con los valores de vars.
 * Ejemplo: resolve('clasificador.usuario', { texto: 'hola' })
 * @param {string} key
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function resolve(key, vars = {}) {
  let text = get(key);
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, v ?? '');
  }
  return text;
}

/**
 * Ensambla el system prompt del clasificador.
 * = rol editable (prompts.json) + esquema JSON protegido (outputSchemas.js)
 * @returns {string}
 */
function buildClassifierSystemPrompt() {
  return [
    get('clasificador.sistema_rol'),
    schemas.clasificador.instruccionFormato(),
  ].join('\n\n');
}

/**
 * Ensambla el system prompt del generador.
 * = rol + identidad (condicional) + reglas + instrucciones + esquema protegido
 * @param {string|null} moderatorName
 * @returns {string}
 */
function buildGeneratorSystemPrompt(moderatorName) {
  const identidad = moderatorName
    ? resolve('generador.sistema_identidad_moderador', {
        nombre: moderatorName,
        nombre_sin_espacios: moderatorName.replace(/\s/g, ''),
      })
    : '';

  return [
    get('generador.sistema_rol_base'),
    identidad,
    get('generador.sistema_regla_autenticidad'),
    get('generador.sistema_regla_variedad'),
    get('generador.sistema_regla_longitud'),
    get('generador.sistema_instrucciones_por_tipo'),
    schemas.generador.instruccionFormato(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Construye el fragmento de contexto RAG para incluir en el user prompt.
 * @param {{ found: boolean, canonical: string }} ragResult
 * @returns {string}
 */
function buildRagContext(ragResult) {
  if (ragResult.found) {
    return resolve('repertorio.cancion_encontrada', { canonical: ragResult.canonical });
  }
  return get('repertorio.cancion_no_encontrada');
}

module.exports = { get, resolve, buildClassifierSystemPrompt, buildGeneratorSystemPrompt, buildRagContext };
