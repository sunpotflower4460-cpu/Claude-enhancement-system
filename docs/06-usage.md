# 06 — v0.2の利用・証拠・再開

Node.js 22以上、Git、Linux/POSIXを前提とする。CLIは機械用JSONをstdout、verify概要をstderrへ出す。終了0は本番COMPLETE、1は検査未達/人間確認/TEST判定、2は入力不正/診断未検証。`npm ci --ignore-scripts && npm test`で回帰試験（ブラウザ試験には`npx playwright install --with-deps chromium`）。製品利用の状態CLIはAjv以外の有料サービスを必要としない。

## 初回の一指示

対象と共通をClaude Codeで選択し、原要求の場所を埋めて送る。

```text
/goal 対象の［設計書パス］にある原要求と完成条件をすべて満たしてください。
Claude-enhancement-system/START.mdを実行し、Opus長期設計、Sonnet短期計画、
Haiku実装、独立Sonnetレビュー・実行検証、必要な修正と節目のOpus監査を進めてください。
未完了バックログが残れば次のスプリントへ進み、終了したWorkflowの後で最終verifyを実行してください。
未確認のモデル・権限・実機品質をPASSにせず、独立して進められる作業は続けてください。
```

新規agent directoryの再起動要件はdocs/runtime-spec-audit.md参照。事前setupとして`node COMMON/scripts/install-agents.mjs --target TARGET`を実行できる（mission不要）。既存設定を上書きしない。cloudでの一指示開始、承認回数、モデルアクセス、共有scriptPathは未実証。

## コマンドの流れ

```bash
node COMMON/scripts/bootstrap.mjs --target TARGET --mission INPUT_JSON --profile backend
node COMMON/scripts/doctor.mjs --target TARGET
node COMMON/scripts/state.mjs --target TARGET --action begin --run RUN --task mission --attempt ATTEMPT
node COMMON/scripts/context.mjs --target TARGET --run RUN
node COMMON/scripts/record.mjs --target TARGET --check CHECK_ID
node COMMON/scripts/verify.mjs --target TARGET
```

bootstrapの代わりに`--repositories '["/absolute/common","/absolute/target"]'`で対象候補を渡せる。共通以外が1つに定まらなければ拒否。原文/要件IDの入力はexamples/mission.json形式。bootstrapはsessionを含む状態をatomic publishする。既存missionとの衝突は上書きせず拒否する。

Opusは原要求を全タスクへ分解し、backlogのcheck_refsとcontractのtask_id/requirement_refsを双方に対応させる。全タスクが受け入れ検査を持ち、全要件がタスク/チェック/評価に含まれる必要がある。backendはtest/api、web-appはtest/build/behavior/visual、gameはさらにplayが必須。

## 種別別の実行report

contract commandは実際のテスト/ブラウザ/ビルドツールを起動する。recordは`AUTODEV_REPORT_PATH`と`AUTODEV_CHECK_CONTEXT`（nonce/check/task/run/attempt/session/kind）を渡す。runnerは`scripts/lib/reports.mjs`のwriteReportで結果を出す。実例はexamples/api-check.mjs、examples/browser-check.mjs。

| kind | detailsと必須証拠 |
| --- | --- |
| test | 実行件数、passed/failed/skipped、具体的なassertions |
| build | 終了結果、実際の生成物とハッシュ |
| api | method/URL/status/期待status、応答本文artifactとSHA256、内容のassertions |
| behavior | 実入力、前状態、後状態、期待状態 |
| visual | browser/viewport、実PNG/JPEG captures、検査内容とassertions |
| play | 実入力列、進行、到達結果/期待結果、実画像とassertions |

report自体とartifactをハッシュで照合し、コマンドからの新規nonceが無い旧reportを再利用しない。単なる`true`/`echo`では全kindとも未検証。ツール不足ならreportが揃わずUNVERIFIED、実行失敗やassert失敗ならFAIL。繰り返す操作入力は正当な列として扱う。画像があるだけで視覚的魅力や面白さを自動承認しない。

## モデル・独立評価

`import-runtime.mjs --target TARGET --raw RAW_JSONL --tool_use ACTUAL_TOOL_ID --task TASK_OR_mission --stage review --expected claude-sonnet-5-5`で既知SDK構造を照合する。CLI収集は`--forward-subagent-text`を使う。書類上のmodel文字列や自己紹介は採用しない。

SDK init.cwd、task/run区間、assistant UUID/model/timestamp、invocation tag（Workflowがlabelとpromptへ付与）を現在のmission/binding/run/task/attempt/stageと照合する。必要な形で記録が出ない実機ではUNVERIFIED。parserのために偽の実ログ形式を作らない。過去executionの成功観測はrouting_historyに表示し、現executionのモデル証拠から外す。現contextの不正記録は失敗として残る。

assessmentはv2。status、scope、task_ids、各taskのexecutions、run/task/attempt/session、product/contract/identity、原要件refs、findings、runtime_refを保持する。`assessment.mjs --target TARGET --input ACTUAL_ASSESSMENT --kind review --scope task --task TASK --runtime IMPORTED_REF`で、独立に返された評価を改変せず保存する。古いコードへ現在指紋を後付けしたり、NEEDS_FIXを指摘0件だからPASSへ変えたりしない。

タスク選択/完了はtask.mjs（action select/complete/reset/block/fail）。completeはcurrent evidenceと独立task reviewから判定する。resetは新execution IDで古い承認を失効させる。最終評価は現在の全task executionを含むscope=finalで再取得する。

## 中断と再接続

runはmission全体の所有者、sprint_task_idは実タスク。実装前にoperation.mjs start、適用後にcompleteして結果を保存する。同じreceiptを再投入した場合、同じ製品ならALREADY_APPLIED、差異があればOBSERVE_REQUIRED。未終了writerがあれば別writerを開始しない。

親は実際のWorkflow停止/終了と稼働一覧を取得し、`import-termination.mjs --target TARGET --raw RAW --tool_use WORKFLOW_TOOL_ID`を実行する。rawのWorkflow args・launch taskId/runId・terminal notification・empty snapshot以後の開始まで検査する。古い空snapshotを最新のdrained証拠にしない。

```bash
node COMMON/scripts/state.mjs --target TARGET --action recover --proof TERMINATION_JSON
node COMMON/scripts/state.mjs --target TARGET --action begin --run RUN --task mission --attempt NEW_ATTEMPT
node COMMON/scripts/next.mjs --target TARGET --run RUN
```

recoverは部分編集を保持し、旧started operationをinterruptedへ記録、resume.jsonで実タスクと段階を渡す。差分を観察後、`operation.mjs --action observe`と`observed_fingerprint/reason`を持つ検査JSONで旧receiptを引き継ぐ。実装途中の変更ならレビューから、レビュー/テスト途中なら当該検査から再開する。旧attemptを再利用しない。CLIとWorkflowは同じ構造化resumeを使う。

クラッシュでmutexが残ったときはrecover-lock.mjs。生きたowner/検査processや他hostの不明ownerを自動で奪わない。テスト実行中の親停止でも検査processの停止確認が必要。解消しない他host/欠損runtimeは人間/環境による復旧待ちとしてBLOCKEDを記録する。

同じremoteの別clone/worktree/branchは`reconnect.mjs --target NEW_PATH`。missionにはcanonical repository ID、sessionには現在のパス/worktree/branchを分けて保存する。異なるrepoは拒否。旧run activeなら現在の停止証拠が必要。旧state/evidence/operationsは保存し、現在bindingで製品・検証・モデル・評価を再判定する。未コミット変更を捨てない。

v1は`migrate.mjs --target TARGET`。原文・旧Schema・証拠を保存し、全条件をUNVERIFIEDへ戻して再計画/再検証する。migration journalにより途中停止後も再実行でき、未関係の編集が混入したら拒否。旧共通パスが存在しない場合は当時のremoteを`--legacy_shared_remote URL`で明示する。

## 指紋と信頼境界

製品はtracked＋ignoreされていないuntrackedの内容/種別/mode。削除は現存ファイル集合から消えるため、削除のstage/commitだけで再度無効化しない。内部symlinkの実体もhashし、外部/状態/ディレクトリsymlinkとsubmoduleは拒否。.autodevは除外するが、原要求・契約・backlog構造・共通検証器/検査adapter/役割規則/依存ロックは別契約指紋へ含める。ignoreした未追跡ソースは対象外なので、製品ソースをignoreしない。

信頼された親とツール実行者を前提にした誤判定防止であり、任意shellや悪意ある偽造JSONの署名/隔離基盤ではない。実際のログを収集する親の信頼性と、最新の外部runtime観測は必要。TEST FIXTUREを使った試験は明示的に分離し、`--fixture true`でもTEST_COMPLETE等を返し、終了0や実機PASSにしない。
