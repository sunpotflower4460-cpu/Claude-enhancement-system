# 06 — 利用と再開

ローカル状態・検証CLIはNode.js 22以上とGitで動作する。Claude Codeクラウドの一指示開始は未検証。実際の利用は START.md に従い、未確認の機能をPASSにしない。

## 初回指示

Claude Codeクラウドで対象と共通の2リポジトリを選び、以下を送る。

```text
/goal 開発対象の原要求と完成条件をすべて満たすまで自律開発してください。
Claude-enhancement-system/START.mdを読み、対象と共通を識別して実行してください。
Opus 5.5で長期設計と監査、Sonnet 5.5で短期計画・独立レビュー・実行検証、
Haiku 5.5で実装し、失敗を修正して続行してください。
原要求は対象の［設計書のパス］です。範囲を縮小しないでください。
Workflow終了後、現在の成果物に最終verifyを実行し、結果を表示してください。
確認できない機能はUNVERIFIEDとし、独立に進められる作業は続けてください。
```

権限承認は環境設定に依存する。初回承認回数と再起動時の発見動作は未実測。プラグインが自動適用されるとは仮定しない。

## ローカルコマンド

共通にて `npm ci --ignore-scripts`。以下のCOMMON/TARGET/INPUTを実際の絶対パスに置き換える。

```bash
node COMMON/scripts/doctor.mjs --target TARGET
node COMMON/scripts/bootstrap.mjs --target TARGET --mission INPUT --profile backend
node COMMON/scripts/record.mjs --target TARGET --check CHECK_ID
node COMMON/scripts/verify.mjs --target TARGET
```

対象自動選択は `--target` の代わりに `--repositories '["/absolute/common","/absolute/target"]'`。共通以外が1つに定まらなければ拒否する。mission入力はexamples/mission.json形式で原文とID付き要件を渡す。既存状態を上書きしない。新要求は既存原文を消さず、人間の明示的な追記を別途保存し再計画する（自動要件マージは提供しない）。

bootstrap後にOpusが `.autodev/contract.json` をschemas/contract.schema.jsonに沿って作る。チェックはid、requirement_refs、kind、command、timeout_ms。backendはtest/api、web-appはtest/build/behavior/visual、gameはtest/build/behavior/visual/playが必須。各コマンドは期待動作をassertし、失敗を非0で返す。検査実行が製品ファイルを書き換える場合、証拠は失効する。テスト時生成物は適切にgitignoreし、製品ソースはignoreしない。

`record`は実際にコマンドを実行し、終了コード・signal・ログハッシュ・実行環境・前後指紋を保存する。verifyの出力はJSON、stderrは概要。終了0はCOMPLETE、1は未達/人間レビュー、2は入力不正/診断未検証。

CLI利用は `claude --model claude-sonnet-5-5 --add-dir COMMON --plugin-dir COMMON`。agents/skillsとworkflowsの発見・ツール制限・モデル適用は起動後に実測する。

## 状態と再開

```bash
node COMMON/scripts/state.mjs --target TARGET --action begin --run RUN_ID --task TASK_ID
node COMMON/scripts/state.mjs --target TARGET --action transition --run RUN_ID --task TASK_ID --stage ARCHITECTURE
node COMMON/scripts/state.mjs --target TARGET --action end --run RUN_ID --task TASK_ID
```

初回はIDLE→ARCHITECTURE→PLAN、以後PLAN→IMPLEMENT→REVIEW→VERIFY→AUDIT→IDLE。修正はREVIEW/VERIFY→IMPLEMENT。次スプリントはVERIFY/AUDIT→PLAN。各writeは直列、run/task所有権を確認する。状態履歴とhandoffを読む。中断でactiveが残ると新規beginは拒否される。ランタイムで旧writerの終了を確認し、終了ログを `--action recover --proof /absolute/stopped-log.txt` へ渡す。BLOCKEDになり、変更指紋が記録される。Git diffと部分編集を観察してからPLAN/REVIEW/VERIFY/AUDITへ再開する。証拠が最新なら不要な再実装はしない。

プロセスクラッシュで `.autodev/.mutex` が残った場合は、関連プロセスとWorkflowが全て停止したことを確認し、ファイルを退避してからrecoverする。自動で生きたlockを奪わない。別worktree・branch・remoteへ移動すると識別不一致で拒否する。意図的な移行は元状態を保全して再初期化し、証拠を再取得する。

## レビュー・モデルの記録

`evidence/review.json` / `audit.json` はassessment.schema.json準拠。productはfingerprint、contractはcontracts().digest、identityはhash(JSON.stringify(mission.target))。findingsとrequirement_refsは独立エージェントの出力を保持する。runtime_recordはevidence内の元ランタイムログのbasename、runtime_hashはそのSHA256、expected_model/observed_modelは実際の観測値。ログが無ければ作らず未検証のままにする。

`.autodev/routing.json` は以下の配列を3モデル分保存する。

```json
[{"expected":"claude-opus-5-5","observed":"claude-opus-5-5","record":"actual-task-detail.txt","hash":"SHA256_OF_ACTUAL_LOG"}]
```

ゲートはモデル一致とログの現存・ハッシュを確認する。ただし任意形式のランタイムログからモデル名を自動解析するアダプタは未実装。ログと正規化値の照合は親セッションの責任。エージェント自身の「私はOpus」は根拠にならない。

## 判定の限界

この基盤は信頼された親とエージェントを前提に、欠損・古い証拠・通常の誤判定を防ぐ。任意shellの隔離、ログの署名、悪意あるエージェントによる証拠偽造の防止は提供しない。レビューの読み取り専用境界はClaude Codeの実ツール制限で担保する必要があり、実測前にはWorkflowを起動しない。

製品指紋はGitで追跡済み＋ignoreされていない未追跡ファイル（内容・種別・mode・削除）。.autodevは除外。原要求・契約・バックログ構造・共通検証器は別指紋に含む。未追跡でもignoreされたソース、submoduleは未対応（submoduleは拒否）。原要件IDの意味と原文の完全な対応はOpus監査が必要。
