const MODEL = "gemini-2.5-flash";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { action="generate", company="", role="", question="", limit=400, tone="自然で自分らしい", experience="", appeal="", current="" } = body;

    if (!question || !experience) {
      return Response.json({error:"設問と経験・エピソードを入力してください。"}, {status:400});
    }
    const key = context.env.GEMINI_API_KEY;
    if (!key) return Response.json({error:"GEMINI_API_KEYが設定されていません。CloudflareのVariables and Secretsに登録してください。"}, {status:500});

    let task = "";
    if (action === "adjust") {
      task = `以下の文章を、内容を変えずに${limit}字以内へ自然に調整してください。文字数を最優先し、冗長な表現を削ってください。文章だけを返してください。`;
    } else if (action === "polish") {
      task = "以下のESを、AIが書いたような不自然な表現を減らし、本人が実際に話しているような自然な日本語へ整えてください。事実の追加は禁止。文章だけを返してください。";
    } else {
      task = `設問に対する完成度の高いESを${limit}字程度（必ず${limit}字以内）で作成してください。
構成は「結論→具体的な行動・工夫→結果→学び/仕事への活かし方」を基本とします。
応募先・職種との関連が自然に出せる場合は反映してください。
入力にない実績・数字・出来事を創作してはいけません。
${tone}文章にしてください。
文章だけを返し、見出し・箇条書き・文字数表示は付けないでください。`;
    }

    const prompt = `
あなたは日本の新卒採用に詳しいES添削・作成アシスタントです。
「盛る」「嘘を作る」ことではなく、本人の素材から強みが伝わる文章を作ることを重視してください。

【企業】${company || "指定なし"}
【職種】${role || "指定なし"}
【設問】${question}
【経験・エピソード】
${experience}
【特に伝えたいこと】
${appeal || "指定なし"}

${action !== "generate" ? `【現在のES】\n${current}` : ""}
【依頼】
${task}
`;

    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{temperature:0.65, maxOutputTokens:1800}
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || "Gemini APIでエラーが発生しました。";
      return Response.json({error:msg}, {status:502});
    }
    const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
    if (!text) return Response.json({error:"AIから文章が返りませんでした。"}, {status:502});

    return Response.json({text, note:"AI生成文は必ず自分の経験・事実と一致しているか確認してください。"});
  } catch (e) {
    return Response.json({error:e?.message || "サーバーエラー"}, {status:500});
  }
}
