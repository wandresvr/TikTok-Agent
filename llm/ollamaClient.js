// llm/ollamaClient.js

async function analyze(text) {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      format: 'json',        // 🔥 ESTO ES LA CLAVE
      stream: false,
      messages: [
        {
          role: 'system',
          content: `
Eres un moderador experto de lives musicales.
Responde SOLO con JSON válido.
No expliques nada.
`
        },
        {
          role: 'user',
          content: `
Clasifica este mensaje.

Devuelve exactamente este formato:
{
  "type": "request|vote|rating|normal|spam",
  "song": null | "artista - canción"
}

Mensaje:
"${text}"
`
        }
      ]
    })
  });

  const data = await res.json();

  // 👇 ahora SIEMPRE es JSON válido
  return data.message.content;
}

module.exports = { analyze };
