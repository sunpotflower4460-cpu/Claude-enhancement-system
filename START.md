# START — Claude-enhancement-system v0.2 / Schema v2

ローカルの判定器・再開・複数スプリントを実装済み。Claude Codeクラウド全体の受け入れは **UNVERIFIED**。この手順は親セッションが実行する。指示を読むだけで開始済み/完成と報告しない。

## 1. 識別・準備

対象と共通のGit root、remote、branch、worktreeを実測し、共通以外が1つなら対象を選ぶ。不明のまま書き込まない。AGENTS.md、docs/00〜03、対象固有の指示と原要求を読む。共通は読取専用（初回依存導入を除く）、全製品・状態・証拠は対象へ置く。

共通で `npm ci --ignore-scripts`。`node COMMON/scripts/doctor.mjs --target TARGET` を実行する。診断のUNVERIFIEDは成功ではない。原要求全文と要件IDをexamples/mission.json形式で保存し、`bootstrap.mjs --target TARGET --mission INPUT --profile backend`（web-app/gameも可）。既存状態は再利用、v1はmigrate.mjs、別パス/branchはreconnect.mjs。原要求の縮小や既存CLAUDE.md/.claude/AGENTS.mdの置換は禁止。

## 2. Native roleと隔離probe

`install-agents.mjs --target TARGET` は6役を衝突なく配置する。ミッション作成前の事前セットアップでも実行可能。新しいagents directoryをセッション開始後に作った場合や--add-dir側のagent変更は、公式仕様上再起動が必要。事前に環境setupで配置するか、既に発見済みのplugin native agentsを用いる。見つからなければ準備未完了と記録し、汎用writerをreviewerに割り当てない。

`/workflow-authoring`で現在のAPIを確認。Workflowのargsは実JSON object。`agent()`のtoolsオプションを仮定せず、`agentType`で`autodev-ROLE`または`claude-autodev:ROLE`を指定する。Read/Grep/Globだけのreviewer/auditorが実際に編集・Bash・MCP・委任を使えないことを隔離fixtureで確認する。

実機を最短で試す場合はdocs/live-probe.mdの一括準備を使う。モデル観測を現在runへ結ぶため、probe呼出前に手順3のroot leaseを一度だけbeginする。`runtime-probe.js`を共通scriptPathから起動し、結果・tool denial/unavailability・sentinel・モデル元記録を親が照合する。`registry_verified/readonly_verified`を自己申告だけでtrueにしない。

## 3. 親のrun所有権と実モデル記録

`state.mjs --target TARGET --action begin --run RUN --task mission --attempt ROOT_ATTEMPT`（同じleaseをprobe前に取得済みなら再beginしない）。IDは親で生成して保持し、終了したattemptを再利用しない。親は実際のWorkflow tool_use_id/taskId/runIdも記録する。stdoutのlaunchがasync_launchedでもerrorがあれば未起動。

SDK記録は`--output-format stream-json --verbose --forward-subagent-text`（CLI）またはforwardSubagentText（SDK）で取得する。`import-runtime.mjs`がSDK init.cwd、task_started、当該run区間内のassistant.message.model/uuid/timestamp、呼出の相関tagを検査する。期待モデルと実モデルが違えば未達。未知形式や記録欠損を架空ログで補わない。

`context.mjs --target TARGET --run RUN`からmission_id、session_id、observation_id、tasks/nextを取得する。親が新たに起動/再開するたびに現在のobservation_idを読み直す。Workflow argsは`{target,shared,mission_id,session_id,observation_id,run_id,attempt_id,agents,capabilities:{registry_verified:true,readonly_verified:true}}`。機械的に取得した値と実際に確認した能力だけを渡す。

## 4. 複数スプリントの自走

Workflowツールへ `scriptPath: COMMON/workflows/develop-mission.js` と上記のargs objectを渡す。共通パスが拒否されたら権限不足を記録し、同じnative Agent役を親が直列呼出する経路を検証する。NodeでWorkflowを実行して代用しない。

初回Opus設計→Sonnet計画→Haiku実装→独立Sonnetレビュー→Sonnet実行検証→task gate→次タスク。2回失敗でSonnet根本原因調査・実装、繰り返し失敗でOpus再計画。解決しないタスクは残したまま独立タスクへ進む。milestone_every（既定2）はprogress.jsonでburstをまたいで維持する。Opusは初期/節目/重大変更/難航/最終で呼ぶ。

Sonnet coordinatorは **skills/start-development/coordinator.md** のaction契約に従い、実際のCLI結果・独立評価を永続化する。各writerはoperation receiptを確認し、同じ変更を二重適用しない。中断後は構造化resumeの実タスクとstageを使う。親runのtask_id=missionとsprint_task_idを混同しない。

Workflowは非同期。完了結果を待ち、null/例外/欠落は未達として記録する。CONTINUE_PARENTでは状態を保存して現在のobservation_idで再投入し、/goalで継続する。burst上限はスコープ縮小や完成ではない。

## 5. 完成判定

`record.mjs`で実コマンドと種別別report・artifactを保存する。visual/playには実際の描画・操作・画像が必要。成功コマンドだけではUNVERIFIED。各タスクはcheck_refsと実行ID付き独立レビューからtask.mjsで合格させる。PASSの手書きだけでは完成しない。

最終レビュー/Opus監査は、現在の全タスクexecutionと原要求を評価したv2 assessmentを保存する。NEEDS_FIX/BLOCKED/UNVERIFIEDは指摘0件でも不合格。最後の検証で回帰があれば該当タスクをresetし計画→実装へ戻る。

全Workflow/agentの終了を実測し、`import-termination.mjs`で実Workflow呼出・launch・terminal・末尾までdrainedを検査する。親が`state.mjs --action end --proof TERMINATION_JSON`を行い、**その後**`verify.mjs --target TARGET`を実行してJSONと概要を会話へ出す。稼働中、未完了バックログ、欠落/古い証拠、重大指摘、未知モデル記録、未観察operationが残れば完成しない。

TEST FIXTUREは明示オプションでもTEST_COMPLETE等にしかならず、本番COMPLETEと区別する。人間確認が必要ならREADY_FOR_HUMAN_REVIEW。実機で確認できない条件はUNVERIFIEDのまま、独立して進められる作業は続ける。

詳細：docs/06-usage.md、docs/08-deep-audit.md、docs/runtime-spec-audit.md、docs/live-probe.md、docs/validation-results.md。
