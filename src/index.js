const MODEL = "gemini-3.6-flash";

const START_TAG = "@@ES_START@@";
const END_TAG = "@@ES_END@@";

const FORMAT_RULE = `
【出力形式（厳守）】
前置き・確認・注釈・見出し・箇条書き・文字数表示・(1)(2)のような番号・コードブロック（\`\`\`）は一切書かないでください。
本文だけを、必ず次の形式で出力してください。タグの外側には何も書かないでください。
${START_TAG}
（ここにES本文のみ）
${END_TAG}
`;

function countChars(s) { return [...s].length; }

// 万一タグが無いレスポンスが返ってきた場合の保険的クリーンアップ
function fallbackClean(s) {
  return s
    .replace(new RegExp(START_TAG, "g"), "")
    .replace(new RegExp(END_TAG, "g"), "")
    .replace(/```[a-z]*/gi, "")
    .replace(/\(\d+\)/g, "")
    .split("\n")
    .filter(line => !/^(出力ルール|ルール確認|確認[:：]|これで最終|最終出力|注意事項|チェック|format|Format)/.test(line.trim()))
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractFinal(raw) {
  const m = raw.match(new RegExp(START_TAG.replace(/[@]/g, "\\@") + "([\\s\\S]*?)" + END_TAG.replace(/[@]/g, "\\@")));
  const inner = m ? m[1].trim() : fallbackClean(raw);
  return inner.replace(/^```[a-z]*\n?/i, "").replace(/```$/,"").trim();
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
  const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!raw) {
    const err = new Error("AIから文章が返りませんでした。");
    err.status = 502;
    throw err;
  }
  return extractFinal(raw);
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
      const target = Number(targetCount) || Number(limit);
      const pctLabel = targetPercent ? `（目標文字数の${targetPercent}%）` : "";
      const tolerance = Math.max(5, Math.round(target * 0.03)); // ±3%（最低5字）を許容誤差とする
      const minAcceptable = target * 0.5; // これ未満は「壊れた出力」とみなす

      let best = null; // {text, actual, diff}
      let text = current;

      for (let attempt = 0; attempt < 3; attempt++) {
        const prevActual = countChars(text);
        const promptBody = attempt === 0
          ? `${base}
【現在のES】
${current}
【依頼】
以下の文章を、内容や事実を一切変えずに、${target}字ちょうど${pctLabel}に近づけて調整してください。
文字数の一致を最優先し、表現の詳しさ・言い回しの長さで調整してください。
${FORMAT_RULE}`
          : (() => {
              const diff = prevActual - target;
              const direction = diff > 0 ? `${diff}字ほど長い` : `${Math.abs(diff)}字ほど短い`;
              return `${base}
【現在のES（${prevActual}字）】
${text}
【依頼】
このESは目標の${target}字に対して${direction}状態です。内容や事実を変えずに、${target}字ちょうどになるよう文字数だけを精密に調整してください。
${FORMAT_RULE}`;
            })();

        try {
          text = await callGemini(promptBody, key);
        } catch (e) {
          break; // API自体のエラーはループを抜けてbestで判定
        }

        const actual = countChars(text);
        const diff = Math.abs(actual - target);

        if (actual >= minAcceptable && (!best || diff < best.diff)) {
          best = { text, actual, diff };
        }

        if (diff <= tolerance) break; // 十分な精度になったら終了
      }

      if (!best) {
        return Response.json({ error: "AIの出力が不安定でした。もう一度「文字数に調整」を押してみてください。" }, { status: 502 });
      }

      return Response.json({
        text: best.text,
        note: "AI生成文は必ず自分の経験・事実と一致しているか確認してください。",
        targetCount: target,
        actualCount: best.actual
      });
    }

    let task = "";
    if (action === "polish") {
      task = "以下のESを、AIが書いたような不自然な表現を減らし、本人が実際に話しているような自然な日本語へ整えてください。事実の追加は禁止。";
    } else {
      task = `設問に対する完成度の高いESを${limit}字程度（必ず${limit}字以内）で作成してください。
構成は「結論→具体的な行動・工夫→結果→学び/仕事への活かし方」を基本とします。
応募先・職種との関連が自然に出せる場合は反映してください。
入力にない実績・数字・出来事を創作してはいけません。
${tone}文章にしてください。`;
    }

    const prompt = `${base}
${action !== "generate" ? `【現在のES】\n${current}` : ""}
【依頼】
${task}
${FORMAT_RULE}`;

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
