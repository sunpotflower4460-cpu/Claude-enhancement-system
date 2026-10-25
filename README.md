# Claude-enhancement-system

Claude Codeの標準 `/goal`、Dynamic Workflows、native custom agentsを使い、**開発対象＋共通リポジトリ**から設計・計画・実装・独立レビュー・修正・検証を進める軽量開発基盤。

## 現在の状態

**v0.2実装 / Schema v2。ローカル実証とClaude Code実機受け入れを分離しています。V1全体はUNVERIFIEDです。**

- Opus 5.5：長期設計、重要判断、節目/最終監査。
- Sonnet 5.5：短期計画、独立レビュー、実行検証、進行管理。難航時の実装。
- Haiku 5.5：標準実装と修正。
- 親セッション＋/goal：Workflow起動・完了待機、現在状態からの再開、未達時の継続。
- 機械ゲート：全原要件・全タスク・種別別証拠・独立評価・実モデル記録・稼働状態から完成を再計算。

共通/対象の識別、非破壊bootstrap、永続状態、再接続、operation journal、Schema移行、複数sprint、故障時昇格、実HTTP/Chromiumの検証interfaceを実装しています。TEST FIXTUREから本番COMPLETEは出しません。

## 試す

```bash
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm test
```

Node.js 22以上、Git、Linux/POSIX。ブラウザ検査は開発用Playwrightで実行し、製品側CLIの必須外部依存はAjvのみです。

通常のClaude開始は [START.md](START.md)。原要求を保全して対象だけへ書き込みます。最初の実機受け入れは [隔離一括probe](docs/live-probe.md) へ。選択したテストリポジトリを変更せず、隔離clone・故障fixture・開始指示・結果表を生成できます。

## 実証と未検証

[検証結果](docs/validation-results.md)にローカル/CI、正常/故障、実ブラウザ、模擬モデルを区別して記録しています。クラウド2repo、一指示起動、実5.5モデル、native権限制限、実Workflow内の記録、/goal停止再開は未検証です。必要なruntime記録が取れなければUNVERIFIEDを返します。

## 設計と運用

1. [要求](docs/00-requirements.md)
2. [構成](docs/01-architecture.md)
3. [実行プロトコル](docs/02-execution-protocol.md)
4. [品質契約](docs/03-quality-contract.md)
5. [調査資料](docs/04-research-sources.md)
6. [実装計画と受け入れ試験](docs/05-implementation-plan.md)
7. [コマンド・再開・証拠形式](docs/06-usage.md)
8. [深層監査のBefore/After](docs/08-deep-audit.md)
9. [公式仕様照合](docs/runtime-spec-audit.md)

Development系の長期統合基盤や他社coding-agent adapterは含めません。アプリ開発中の共通側は読取中心、製品・要求・計画・証拠は対象側へ保存します。作業規則は [AGENTS.md](AGENTS.md)。
