# 配信連動 協力ジグソーパズル（暫定テスト版）

ブラウザ上で動作する、配信コメント連動・P2P協力プレイ対応のジグソーパズルゲームです（現在は友人テストプレイ向けの暫定公開版です）。

## 主な機能

- **ソロ / WebRTC P2P マルチプレイ**: URL共有・合言葉・入室承認（ノック）対応の最大8人同時協力プレイ。
- **YouTube Live 連動（BYOK）**: 配信者自身の YouTube Data API v3 キーをブラウザメモリ上のみで使用し、視聴者コメント・SuperChat 連動のお邪魔イベント（落下・視覚妨害・巨大スパチャ・いたずら回転/裏返し）を発動。
- **最大 3,000 ピース対応**: 9〜3,000 ピースの分割プリセット、90度回転・裏返し、外枠/色別/エリア整列、3段階のカット複雑度、お手本表示切り替え（下絵・移動シート・小窓・非表示）。
- **セーブ / ロード**: パズル進捗を JSON ファイルとしてローカル保存し、同じ画像から途中再開可能。

## プライバシー・セキュリティ設計

- **サーバー非送信**: 選択した画像、セーブデータ、YouTube API キーは外部サーバーへ送信・保存されません（API キーは `localStorage` / `sessionStorage` にも保存せずページリロードで消去）。
- **ローカル診断ログ**: メニュー内の「診断ログ（テスト用）」はブラウザメモリ（直近 200 件）のみに保持し、外部へ自動送信しません。ユーザーが手動でコピー／JSON 保存する際も、API キー・合言葉・トークン・招待ルームID・画像データ URI は自動で `[REDACTED]` にマスクされます。

## ローカル起動・開発チェック

ビルドステップ不要の Vanilla JS（ES Modules）構成です。静的サーバーで配信して起動します。

```bash
npx serve .
# または
python -m http.server 8080
```

静的解析（整形 / CSS / JS / HTML / WCAG 2.1 AA コントラスト / 5層アーキテクチャ依存 / 未使用コード）:

```bash
npm run lint
npm run format   # Prettier で自動整形
npm test         # Vitest でテスト（*.node.test.js は Node、ほかはヘッドレス Chromium）
npm run test:mutation  # src/core のミューテーションテスト（Stryker。不定期・手動。結果は reports/mutation/core.html）
npm run measure  # 通信量・API 消費・配信サイズ・端末負荷を計測して measure/history.jsonl に記録
```

初回のみ `npx playwright install chromium` でテスト用ブラウザを取得してください。

`npm install` 時にコミット前フック（`simple-git-hooks`）が有効になり、コミットのたびに `npm run lint` と `npm test` が実行されます。規約の詳細は [docs/architecture-guidelines.md](docs/architecture-guidelines.md) を参照してください。
