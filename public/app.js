const $=id=>document.getElementById(id);
const form=$("esForm"), result=$("result"), status=$("status"), output=$("output"), count=$("count"), feedback=$("feedback");
const adjustPercent=$("adjustPercent"), targetHint=$("targetHint"), genPercent=$("genPercent");
const actionButtons=[$("copy"),$("shorten"),$("polish")];
let lastPayload=null;

function countChars(s){return [...s].length}
function updateCount(){count.textContent=`${countChars(output.value)}字`}
output.addEventListener("input",updateCount);

function updateTargetHint(){
  const limit=Number($("limit").value);
  const pct=Number(adjustPercent.value);
  const target=Math.round(limit*pct/100);
  targetHint.textContent=`目標 約${target}字`;
}
adjustPercent.addEventListener("change",updateTargetHint);
$("limit").addEventListener("change",updateTargetHint);
updateTargetHint();

function setButtonsDisabled(disabled){
  actionButtons.forEach(b=>b.disabled=disabled);
  adjustPercent.disabled=disabled;
}

async function callAI(action="generate"){
  const limit=Number($("limit").value);
  const payload={
    action,
    company:$("company").value.trim(),
    role:$("role").value.trim(),
    question:$("question").value.trim(),
    limit,
    tone:$("tone").value,
    experience:$("experience").value.trim(),
    appeal:$("appeal").value.trim(),
    current:output.value
  };
  if(action==="generate"){
    const pct=Number(genPercent.value);
    payload.targetPercent=pct;
    payload.targetCount=Math.round(limit*pct/100);
  }
  if(action==="adjust"){
    const pct=Number(adjustPercent.value);
    payload.targetPercent=pct;
    payload.targetCount=Math.round(limit*pct/100);
  }
  if(action!=="generate" && !payload.current) return;
  lastPayload=payload;

  const isInitialGenerate = action==="generate";

  if(isInitialGenerate){
    // 初回生成: これまで通りフルスクリーンのローディング/空状態を使う
    status.className="loading";
    status.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span><span>AIが考えています…</span>';
    result.classList.add("hidden");
    feedback.textContent="";
  }else{
    // 調整・自然化: 生成結果パネルはそのまま残し、ボタンだけ一時的に無効化する
    setButtonsDisabled(true);
    feedback.textContent="AIが調整しています…";
  }

  try{
    const r=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"生成に失敗しました");
    output.value=data.text||"";
    updateCount();
    result.classList.remove("hidden");
    status.className="empty hidden";
    let msg=data.note||"";
    if(action==="adjust"||action==="generate"){
      const target=data.targetCount??payload.targetCount;
      if(target){
        const actual=data.actualCount??countChars(output.value);
        const diff=actual-target;
        const diffMsg=`目標${target}字 / 実際${actual}字（差 ${diff>=0?"+":""}${diff}字）`;
        msg=msg?`${diffMsg}\n${msg}`:diffMsg;
      }
    }
    feedback.textContent=msg;
  }catch(e){
    if(isInitialGenerate){
      status.className="empty";
      status.innerHTML=`<div class="empty-icon">!</div><h3>生成できませんでした</h3><p>${escapeHtml(e.message)}</p>`;
    }else{
      // 調整・自然化の失敗時は元の文章を残したまま、エラーだけ伝えて再試行できるようにする
      feedback.textContent=`調整できませんでした：${e.message}`;
    }
  }finally{
    if(!isInitialGenerate) setButtonsDisabled(false);
  }
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
form.addEventListener("submit",e=>{e.preventDefault(); if(!$("question").value.trim()||!$("experience").value.trim()){alert("設問と経験・エピソードを入力してください。");return} callAI("generate")});
$("copy").onclick=async()=>{await navigator.clipboard.writeText(output.value);feedback.textContent="コピーしました。"};
$("shorten").onclick=()=>callAI("adjust");
$("polish").onclick=()=>callAI("polish");
