# [公開デプロイ用 2026-06-15] policy-frontend を本番(Coolify)で動かすためのDockerfile。
# 元々は「ソースをbindマウントして dev サーバーを起動」する設計だが、
# Coolify環境ではソースのbindマウントが効かず /app が空になりクラッシュするため、
# ソースをイメージに焼き込む方式に変更する。
FROM node:20-alpine
WORKDIR /app

# フロントエンドのソース一式をコピー（ビルドコンテキスト = ./policy-edit/frontend）
COPY . ./

# 依存をインストール
RUN npm install

# Vite 開発サーバーのポート
EXPOSE 5173

# 開発サーバーを 0.0.0.0 で起動（package.json の "dev": "vite" を使用）
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
