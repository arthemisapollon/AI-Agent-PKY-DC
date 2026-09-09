// Urutan chain = urutan fallback: kalau model paling depan (atau
// preferred_model dari dropdown) kena rate limit (429/RESOURCE_EXHAUSTED),
// proxy otomatis nyoba model berikutnya di daftar ini sampai ada yang jawab.
// Mapping nama tampilan "Odyssey x.x" -> id Gemini asli ada di report-agent.html
// (konstanta ODYSSEY_MODEL_NAMES), urutannya sengaja disamain persis biar gak
// bingung pas debug.
const GEMINI_MODEL_CHAIN = [
  "gemini-2.5-flash-lite",  // Odyssey 2.5
  "gemini-2.5-flash",       // Odyssey 2.5 Pro
  "gemini-3-flash",         // Odyssey 3.0
  "gemini-3.1-flash-lite",  // Odyssey 3.1
  "gemini-3.5-flash",       // Odyssey 3.5 Pro
  "gemini-3.5-flash-lite",  // Odyssey 3.5
  "gemini-3.6-flash",       // Odyssey 3.6
  "gemini-3.7-flash",       // Odyssey 3.7
  "gemini-3.8-flash",       // Odyssey 3.8
];

function geminiUrlFor(model) {
  return "https://generativelanguage.googleapis.com/v1beta/models/" +
    model + ":generateContent";
}

function isRateLimitError(status, data){
  if (status === 429) return true;
  const msg = JSON.stringify((data && data.error) || "");
  return /RESOURCE_EXHAUSTED/i.test(msg);
}

function buildChain(preferredModel){
  if (!preferredModel || GEMINI_MODEL_CHAIN.indexOf(preferredModel) === -1){
    return GEMINI_MODEL_CHAIN;
  }
  return [preferredModel].concat(GEMINI_MODEL_CHAIN.filter(m => m !== preferredModel));
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "GEMINI_API_KEY belum di-set di Environment Variables Netlify"
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Body request bukan JSON valid" })
    };
  }

  const { system, contents, max_tokens, thinking_level, preferred_model } = payload;

  if (!contents || !Array.isArray(contents)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Field 'contents' wajib ada dan berupa array" })
    };
  }

  const allowedThinkingLevels = ["minimal", "low", "medium", "high"];
  const thinkingLevel = allowedThinkingLevels.includes(thinking_level) ? thinking_level : "minimal";

  const geminiBody = {
    contents: contents,
    generationConfig: {
      maxOutputTokens: max_tokens || 1000,
      thinkingConfig: { thinkingLevel: thinkingLevel },
      // Maksa Gemini balikin JSON yang beneran valid (bukan cuma nurut
      // instruksi teks di system prompt yang sifatnya "permintaan" doang).
      // Ini yang bikin balesan bisa berantakan/gagal JSON.parse sebelumnya,
      // apalagi di model Lite yang kurang nurut instruksi format.
      responseMimeType: "application/json"
    }
  };
  if (system) {
    geminiBody.system_instruction = { parts: [{ text: system }] };
  }

  const modelChain = buildChain(preferred_model);
  let lastResult = null;
  for (let i = 0; i < modelChain.length; i++){
    const model = modelChain[i];
    try {
      const geminiRes = await fetch(geminiUrlFor(model) + "?key=" + apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody)
      });
      const data = await geminiRes.json();
      lastResult = { status: geminiRes.status, data: data };

      if (!isRateLimitError(geminiRes.status, data)){
        data.modelUsed = model;
        return {
          statusCode: geminiRes.status,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        };
      }
    } catch (e) {
      lastResult = { status: 502, data: { error: "Gagal menghubungi Gemini API (" + model + "): " + e.message } };
    }
  }

  const finalData = lastResult ? lastResult.data : { error: "Semua model di GEMINI_MODEL_CHAIN gagal, gak ada respons." };
  return {
    statusCode: (lastResult && lastResult.status) || 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalData)
  };
};
