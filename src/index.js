const MODEL = "gemini-3.6-flash";

function countChars(s) { return [...s].length; }

// AIが文字数調整のために紛れ込ませる (1)(2)のような番号注釈やラベルを取り除く
function sanitizeText(s) {
  return s
    .replace(/\(\d+\)/g, "")            // (1) (23) のような番号
    .replace(/【[^】]{0,10}】(?=\S{0,3}$)/g, "") // 末尾に紛れ込む短いラベル
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function callGemini(prompt, key) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 1800 }
    })
  });
  const data = await resp.json();
  if (!resp.ok) {
    const msg = data?.error?.message || "Gemini APIでエラーが発生しました。";
    const err = new Error(msg);
    err.status = 502;
    throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!text) {
    const err = new Error("AIから文章が返りませんでした。");
    err.status = 502;
    throw err;
  }
  return sanitizeText(text);
}

async function handleGenerate(request, env) {
  try {
    const body = await request.json();
    const {
      action = "generate", company = "", role = "", question = "", limit = 400,
      tone = "自然で自分らしい", experience = "", appeal = "", current = "",
      targetCount, targetPercent
    } = body;

    if (!question || !experience) {
      return Response.json({ error: "設問と経験・エピソードを入力してください。" }, { status: 400 });
    }
    const key = env.GEMINI_API_KEY;
    if (!key) return Response.json({ error: "GEMINI_API_KEYが設定されていません。CloudflareのVariables and Secretsに登録してください。" }, { status: 500 });

    const base = `
あなたは日本の新卒採用に詳しいES添削・作成アシスタントです。
「盛る」「嘘を作る」ことではなく、本人の素材から強みが伝わる文章を作ることを重視してください。

【企業】${company || "指定なし"}
【職種】${role || "指定なし"}
【設問】${question}
【経験・エピソード】
${experience}
【特に伝えたいこと】
${appeal || "指定なし"}
`;

    if (action === "adjust") {
      // targetCount（%指定）が来ていればそれを厳密なターゲットにする。無ければ limit を上限として扱う。
      const target = Number(targetCount) || Number(limit);
      const pctLabel = targetPercent ? `（目標文字数の${targetPercent}%）` : "";
      const tolerance = Math.max(5, Math.round(target * 0.03)); // ±3%（最低5字）を許容誤差とする

      let text = await callGemini(`${base}
【現在のES】
${current}
【依頼】
以下の文章を、内容や事実を一切変えずに、${target}字ちょうど${pctLabel}に近づけて調整してください。
文字数の一致を最優先し、表現の詳しさ・言い回しの長さで調整してください。
出力は日本語の本文のみとし、見出し・箇条書き・文字数表示・(1)(2)のような番号や注釈は絶対に付けないでください。
`, key);

      let actual = countChars(text);
      // 誤差が許容範囲外なら、実際の文字数を伝えて再調整を1回だけ依頼する
      if (Math.abs(actual - target) > tolerance) {
        const diff = actual - target;
        const direction = diff > 0 ? `${diff}字ほど長い` : `${Math.abs(diff)}字ほど短い`;
        text = await callGemini(`${base}
【現在のES（${actual}字）】
${text}
【依頼】
このESは目標の${target}字に対して${direction}状態です。内容や事実を変えずに、${target}字ちょうどになるよう文字数だけを精密に調整してください。
出力は日本語の本文のみとし、見出し・箇条書き・文字数表示・(1)(2)のような番号や注釈は絶対に付けないでください。
`, key);
        actual = countChars(text);
      }

      if (actual < target * 0.3) {
        return Response.json({ error: "AIの出力が不安定でした。もう一度「文字数に調整」を押してみてください。" }, { status: 502 });
      }

      return Response.json({
        text,
        note: "AI生成文は必ず自分の経験・事実と一致しているか確認してください。",
        targetCount: target,
        actualCount: actual
      });
    }

    let task = "";
    if (action === "polish") {
      task = "以下のESを、AIが書いたような不自然な表現を減らし、本人が実際に話しているような自然な日本語へ整えてください。事実の追加は禁止。文章だけを返してください。";
    } else {
      task = `設問に対する完成度の高いESを${limit}字程度（必ず${limit}字以内）で作成してください。
構成は「結論→具体的な行動・工夫→結果→学び/仕事への活かし方」を基本とします。
応募先・職種との関連が自然に出せる場合は反映してください。
入力にない実績・数字・出来事を創作してはいけません。
${tone}文章にしてください。
文章だけを返し、見出し・箇条書き・文字数表示は付けないでください。`;
    }

    const prompt = `${base}
${action !== "generate" ? `【現在のES】\n${current}` : ""}
【依頼】
${task}
`;

    const text = await callGemini(prompt, key);
    return Response.json({ text, note: "AI生成文は必ず自分の経験・事実と一致しているか確認してください。" });
  } catch (e) {
    return Response.json({ error: e?.message || "サーバーエラー" }, { status: e?.status || 500 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return handleGenerate(request, env);
    }

    // それ以外は静的アセット（index.html / app.js / style.css など）を配信
    return env.ASSETS.fetch(request);
  }
};
