# ES Maker

AIでエントリーシートを作成、調整する小さなWebアプリです。

## 構成
- Frontend: HTML/CSS/JavaScript
- AI: Gemini API
- Backend: Cloudflare Pages Functions
- APIキー: Cloudflare Secret (`GEMINI_API_KEY`)

## ローカルで動かす

Node.js をインストールした後、

```bash
npm install -D wrangler
```

`.dev.vars` を作成：

```env
GEMINI_API_KEY="あなたのGemini APIキー"
```

起動：

```bash
npx wrangler pages dev public
```

## Cloudflare Pagesへデプロイ

1. GitHubにこのフォルダをpush
2. Cloudflare Dashboard → Workers & Pages → Create application → Pages
3. GitHubリポジトリを接続
4. Build commandは空欄、Output directoryは `public`
5. デプロイ
6. Pagesプロジェクトの Settings → Variables and Secrets → Add
7. Production に `GEMINI_API_KEY` を追加し、Encrypt（Secret）を選択
8. 再デプロイ

APIキーはブラウザに置かず、Pages Functionからのみ利用します。
