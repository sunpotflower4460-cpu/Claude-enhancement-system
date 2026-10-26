# 検証結果 — 長期継続監査 / 2026-10-25

**ローカルの実装・正常/故障/模擬統合・実Chromiumと、Claude Code実機の受け入れを区別する。V1全体はUNVERIFIED。**

> **2026-10-26 実機受け入れ追記**：Claude Code 2.1.310の実機で、実Opus/Sonnet/Haiku 5.5による4タスク開発が完走し、独立`verify.mjs`が`COMPLETE`（assurance=LIVE）。実機で見つかった20件の差分と修正、T01〜T20の照合、未検証項目は[10-live-acceptance.md](10-live-acceptance.md)。ローカル試験は205件。以下の「V1全体はUNVERIFIED」は、その文書の未検証項目（T04/T06/T07/T08/T10/T12/T15/T16/T17ほか）が残る限り維持する。

## 最新の長期継続強化

実装checkpointは `17825cc`（前段 `e7d6afa`）。前回80件を維持し、新clone・複数burst・中断・権限・実プロジェクトに近い検証を追加した。現在の全体試験結果は **177件PASS、失敗0、skip0**。[全出力](evidence/tests-long-running.txt)と[機械用結果](evidence/local-long-running-summary.json)を保存する。テスト対象の共通指紋にはスクリプト・Schema・役割/Workflow・依存ロックに加えSTART/AGENTSも含む。今回のBefore/AfterとR01〜R12対応は[長期監査](09-long-running-audit.md)。

| 実証範囲 | 結果・証拠 |
| --- | --- |
| 長期保存 | 8タスク中3タスクを実検査・task gateで完了→専用refをbare remoteへ実push→元checkout削除→新clone・別pathの共通repoから復元→残5タスクをselect/実装/独立評価/実検査/complete→最終再検証。モデルだけTEST FIXTURE、Git/ファイル/HTTPは実操作 |
| 複数burst | 5タスクの連続3burst以上、永続昇格、監査間隔、未実施監査の繰越、未達でCOMPLETE拒否 |
| 中断・故障 | SIGKILL、途中publish、Git終盤失敗、二度の初期計画停止、readonly writerなし停止、結果未受領、並行recover、欠落/改変・新draft競合を再現 |
| 証拠・完成 | 現snapshotをreadonlyへ渡すこと、全import/verifyのmutex、歴史的証拠と現在の受け入れの分離、省略ログの非現存扱い |
| Web | 実Chromiumで3画面・入力・localStorage再読込・mobile layout。保存欠落をFAIL→修復後全kind合格。[現在の実report/画像](evidence/durability/web/) |
| Game | 実キーでloss/restart/win、進行/境界/UI、40入力の時間上限。進行不能をFAIL→修復後合格。[現在の実report/画像](evidence/durability/game/) |
| 既存API | 複数module・設定の維持、税の互換性、新割引、実HTTP正常/異常。回帰と接続漏れを検出→修復 |
| Linux/macOS | Linuxの実プロセス/groupとencoded CLI path、Darwin adapterの単体。Ubuntu/macOS matrixの実実行は下記CIの同一headログを正本とする |
| 非特権の権限故障 | UID1000で実EACCES→原因修正→再準備成功。[出力](evidence/permissions-long-running.txt) |
| 独立監査 | 機能・故障・実用性を別コンテキストから逆監査。指摘を修正後、既知対象の限定再確認21件も合格（全体件数へ重複加算しない） |

機械ゲートの正常例はTEST_COMPLETE/TEST_READY_FOR_HUMAN_REVIEWに留まり、fixture許可なしはUNVERIFIED。実ブラウザ/HTTPの合格をClaudeモデルやnative Workflowの実証へ昇格しない。Gitのignored依存を持つsymlinkは保存前に拒否し、全依存を保存できる内部symlinkは正しく復元する。公開snapshot以前に失われた未保存データを復元できるとは主張しない。

[公式資料の取得hash](evidence/official-spec-long-running.json)、[CLI認証可否の非機密観測](evidence/claude-availability-long-running.json)、[再現時の失敗](evidence/long-running-before.txt)も保存した。公式配布2.1.310は認証されておらず、モデル/APIへの実行要求は行っていない。npm auditは開発依存を含め脆弱性0件。

CIは[PR #1の当該head checks](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/pull/1/checks)と[branchのworkflow runs](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/actions/workflows/test.yml?query=branch%3Afeat%2Fclaude-autonomous-harness)を参照する。Node22、Ubuntu/macOS、Chromiumの成功/失敗を独立に記録し、matrixを設定しただけで実macOS成功とはしない。PR本文と最終報告には確認したrunを記載する。

残る実機項目はcloudの2repo/隔離先cwd・native agents再発見、実5.5ルーティング、readonly実権限、SDK記録の実形式、/goal・native Workflowの継続/停止/再開、実Claudeによる3分野の追試。まとめて[隔離probe](live-probe.md)を実行し、実観測された違いだけadapterへ反映してT01〜T20を再評価する。V1全体はUNVERIFIEDのまま。

## 前回80件の基準と履歴

## 実行環境と証拠

Linux、Node.js v24.19.0、Ajv 8.20.0、Playwright 1.64.1、Chromium 156.0.8078.4。`npm ci --ignore-scripts`、ブラウザ導入、`npm test`、`npm audit --json`、`git diff --check`を実行。前回の最終ローカル試験は**80件PASS、失敗0、skip0**。最終テスト件数/結果は[evidence/tests-v2.txt](evidence/tests-v2.txt)。[機械用結果](evidence/local-v2-summary.json)も保存した。依存監査は脆弱性0件。GitHub ActionsでもNode.js 22.23.3＋実Chromiumで**80件PASS、失敗0、skip0**。push用[run 40195098672](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/actions/runs/40195098672)、PR用[run 40195103065](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/actions/runs/40195103065)の成功とログを確認。コードcommitは`d4bf7d0`。[PR CI metadata](evidence/github-ci-v2.json)、[push CI metadata](evidence/github-push-ci-v2.json)。

初回バグの再現は[evidence/audit-before.txt](evidence/audit-before.txt)。バックログのUNVERIFIED/FAIL/BLOCKED、偽のplay/visual成功に対して期待する拒否assertが4件失敗し、v0.1のfalse COMPLETEを確認した。v0.1の24件成功は[evidence/tests.txt](evidence/tests.txt)に履歴として残す。

## 実際に確認したこと

- 一時Git repoで既存設定を保全し、対象自動選択、初期化、別clone/worktree/branch/detachedへのreconnect、v1→v2途中停止からの移行再実行を確認。
- node:assertとHTTPサーバー/fetchを実行。故障コード/状態は非0またはFAIL report。成功を装うshell終了0でも失敗assertがあればFAIL。
- 実Chromiumで描画bounds・見出し・例外0件・Start→3回Collect→score3/Wonを確認。壊した入力処理はFAIL。代表画像と[実プレイreport](evidence/browser/actual-play-report.json)を保存。これは小規模fixtureのブラウザ検証で、Claudeの実モデルでゲームを開発した証拠ではない。
- 実recordプロセスを検査中にkill。子検査groupが生きた間は復旧を拒否し、停止後にlock/recover/部分ファイル保全を確認。
- 4タスクのmock agent統合で実ファイル編集/検査を進めた。R1の故障レビュー→修正、R3の2失敗→Sonnet診断/実装、Opus milestoneの未完了指摘→再計画、全タスク→最終gate。別例ではR1をBLOCKEDに残して独立R4を完了。最終回帰→task reset→再修正、および1-sprint burstを繰り返す場合の監査間隔/receiptも検査した。
- mockモデルはすべてTEST FIXTUREと明記。parser/完成ゲートの正例もTEST_COMPLETE等であり、本番COMPLETEや実ルーティングPASSとは扱わない。

## 原T01〜T20の位置づけ

| ID | v0.2のローカル/模擬実証 | Claude実機を含む全体 |
| --- | --- | --- |
| T01 | 識別、非破壊setup、canonical remote、reconnect | UNVERIFIED：cloud2repo |
| T02 | multi-sprint/複数burstのmock controller | UNVERIFIED：本物/goal |
| T03 | SDK既知envelopeのmodel/cwd/run区間/tag/時刻照合、置換拒否 | UNVERIFIED：実5.5 |
| T04 | 故障コードの実assert、mock独立review→修正 | UNVERIFIED：実Haiku/Sonnet |
| T05 | 欠落/古い証拠・report/log/artifact改変を拒否 | ローカル機械ゲート検証済み |
| T06 | 実Chromium操作故障をFAIL、偽visual/play成功をUNVERIFIED | ローカル機械ゲート/ブラウザ検証済み |
| T07 | 全タスク/要件/check/assessment対応、未達可視化 | UNVERIFIED：自然言語の実Opus監査 |
| T08 | 2失敗の原因調査とSonnet昇格、Opus再計画 | UNVERIFIED：実モデル |
| T09 | durable operation/attempt、lost reply、next→controllerのresume | UNVERIFIED：native runtime cache |
| T10 | 設定/agent衝突の拒否、atomic publish、事前配置 | UNVERIFIED：cloud発見 |
| T11 | 欠損CLI/モデル記録/権限の正直な未検証、blocked独立継続 | UNVERIFIED：実提供/拒否 |
| T12 | 3profile＋実API/Chromium/game fixture | UNVERIFIED：実Claudeの3種類開発 |
| T13 | evidence自己無効化なし、原要求/契約/共通adapter変更で失効 | ローカル機械ゲート検証済み |
| T14 | untracked/削除/mode/link実体、外部link拒否 | ローカル機械ゲート検証済み |
| T15 | 各null/例外/欠落で後続拒否 | UNVERIFIED：native stall/replay |
| T16 | 部分編集、旧attempt継承、実検査killからの復旧 | UNVERIFIED：native再起動 |
| T17 | 元SDK model置換、旧SDK run流用/別project流用拒否 | UNVERIFIED：実policy置換 |
| T18 | native mapping不足/不正を拒否、probeを準備 | UNVERIFIED：実scriptPath拒否/承認 |
| T19 | native固定roleとRead/Grep/Glob、汎用writer誤配線拒否 | UNVERIFIED：実ツール拒否 |
| T20 | active/pending receipt/check、検査中変更、空snapshot後writerを拒否 | UNVERIFIED：実Workflow稼働照合 |

ユーザーPhase A〜Gの個別Before/Afterは[08-deep-audit.md](08-deep-audit.md)。独立した別コンテキスト監査の再現・再監査でも主要修正を確認した。

## 残る作業

実コード上の既知P1は独立再監査時点で未報告。実環境との不一致が見つかれば修正する。現時点で残すのは以下の実機条件。

1. 選択したClaude cloud2repoから共通scriptPath/Read/Workflowを起動できるか。初回native agentsの発見・必要な再起動/承認回数。
2. 実Opus/Sonnet/Haiku 5.5の提供/アクセス/実モデル、native readonlyの書込/委任拒否。
3. 実Workflow内のSDK記録が既知parserの相関情報を出すか。出なければUNVERIFIEDとして実観測されたadapterまたはnative Agent経路を検証する。
4. /goalの背景待機と複数sprint継続、実際の途中停止/再開、実ClaudeでのWeb/既存変更/game追試。

[隔離一括probe](live-probe.md)で生成から記録まで同じ手順で試せる。未知のログ/モデルを推測し、未実施項目をPASSへ変える作業は行わない。

初回macOS CIは9件失敗したため終了判定を保留し、実pathの正規化、故障注入の実path照合、コマンド配置差を修正した。[実失敗抜粋](evidence/macos-regressions-before.txt)。新しいコードでLinux全177件を再実行し、macOSは再push後の同一head CIを確認する。probeでは元repoへのremote pushを禁止し、checkpoint再cloneはLOCAL検証と明記する。実GitHub公開は許可された開発対象で別途実証する。

macOS修正後の独立再確認では、旧9失敗条件と関連5条件の計14件も合格した。これは177件へ重複加算せず、同一headのmacOS CIによる実環境合格とも区別する。
