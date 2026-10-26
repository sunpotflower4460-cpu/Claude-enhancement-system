# START — Claude-enhancement-system / Schema v2

親セッションがこの手順を実行する。**V1のClaude Code実機受け入れはUNVERIFIED**。原要求・全backlog・実証拠から独立verifyが合格するまで完成と報告しない。ユーザーは対象と共通repoを選び、[06-usage](docs/06-usage.md)の一指示を渡す。

## 1. 対象の識別と状態の取得

対象と共通のGit root/remote/branch/worktreeを実測し、共通以外の1repoを対象とする。対象固有のAGENTS/CLAUDE.md、原設計、本リポジトリのAGENTSとdocs/00〜03を読む。共通は初回依存導入を除き読取中心。原要求の縮小や既存設定の置換をしない。

共通で`npm ci --ignore-scripts`、`doctor.mjs --target TARGET`。version文字列だけで機能をPASSにしない。既存`.autodev`は再利用し、v1はmigrate、別path/branchはreconnect、active/unknownなownerは実停止証拠からrecoverする。

新cloneで状態がない場合、originの`autodev/checkpoint/MISSION_ID`を探す。該当checkpointがあれば`checkpoint.mjs --action restore --target TARGET --ref origin/autodev/checkpoint/MISSION_ID`。repo/原要求/hashを照合し、新しいresume branchへ復元する。dirty productや別missionへ重ねない。省略ログは現存扱いせず再取得/再検証する。復元途中で停止した場合は`checkpoint.mjs --action recover-restore --target TARGET`で保存済みjournalから回復し、復元中の状態へ別writerを重ねない。checkpointがなければ原要求をexamples/mission.json形式で保存し、bootstrapを行う。Opus設計前でもPLANNING状態のcheckpointを保存できるので、原要求を先にpublishする。

初期Opus計画の途中停止でbacklogだけ更新されcontractが未完成の場合、実terminal/drainedでburst finish・state recoverを済ませ、`repair-plan.mjs --target TARGET --proof TERMINATION_JSON`を実行する。部分backlog/contractはhash付きでarchiveし、原要求から未検証の計画入口を再構成する。architecture.mdは保持し、Opusは保存した草案から続ける。既に公開した計画・完了taskを初期化する用途には使わない。

## 2. Native roleと実機能力

`install-agents.mjs --target TARGET`で6役を非破壊配置できる。CLIの`--plugin-dir COMMON --add-dir COMMON`でも標準発見を利用できる。初めてagents directoryを作った後など、公式仕様上の再起動が必要な場合は準備完了と誤表示しない。クラウドにローカルpluginが自動移行するとは仮定しない。

`/workflow-authoring`で現runtimeのAPIを確認。Workflow argsはJSON object。`agentType`は発見済みの`autodev-ROLE`または`claude-autodev:ROLE`。未確認の`agent({tools:...})`で制限したことにしない。reviewer/auditorはRead/Grep/Globだけのnative定義を使い、実ツール一覧・拒否/不在・sentinel不変を[隔離probe](docs/live-probe.md)で確認する。

実機で判明：native Workflowのagentは転送された`assistant`メッセージではなく、SDKの`system/task_progress.workflow_progress[workflow_agent]`（agentType/model/state/タグ）で報告され、`import-runtime.mjs --burst BURST_ID`が読む。agentのtool一覧はruntimeが書く`prefix.json`で、`readonly-evidence.mjs --target TARGET --raw SDK_JSONL --tool_use WORKFLOW_TOOL_ID`が採取する。launch結果の`runId`(wf_…)はSDKのstream `run_id`と別で、終了証拠はimport-terminationが解決する（[隔離probe](docs/live-probe.md)の運用メモ参照）。

probeの前に手順3のroot leaseを一度だけ取得し、probe自体もburstとしてclaim/実起動/finishを管理する。Opus/Sonnet/Haiku 5.5の実modelはSDK元記録からimport-runtimeで照合する。CLI収集には`--output-format stream-json --verbose --forward-subagent-text`。未知形式・欠損・代替モデルはUNVERIFIED。probe\_\*の診断記録は実装工程のモデル証拠へ流用しない。実測前に`registry_verified/readonly_verified`をtrueにしない。

## 3. 所有権とnative Workflow起動

親が一度だけ`state.mjs --action begin --target TARGET --run RUN --task mission --attempt ROOT_ATTEMPT`。終了したattemptを再利用しない。`context.mjs --target TARGET --run RUN`でmission/session/observation/next/failure_stateを取得する。

native Workflowの前に`burst.mjs --action claim --target TARGET --run RUN --task mission --attempt ROOT_ATTEMPT --observation_id CURRENT_HASH --script_path COMMON/workflows/develop-mission.js`。返された`burst_id`と現在のargsにagents/capabilitiesを加え、Workflowツールへ`scriptPath`と**args object**を渡す。NodeでWorkflowを実行して代用しない。

`claude -p`のヘッドレスには承認者がいない。対象の`.claude/settings.json`のallowは未信頼workspaceで無視されるため、必要な範囲だけを`--settings FILE`で起動側から渡す（`git push`と共通repoへの書込はdeny）。SDK元記録は`--output-format stream-json --verbose --forward-subagent-text`の出力を保存したファイル（`$AUTODEV_RUNTIME_LOG`）で、`attach`・`import-*`の`--raw`に使う。実行中は共通repoを更新しない（契約ダイジェストが変わり全証拠が失効する）。

実launchを元SDK記録から`burst.mjs --action attach --target TARGET --id BURST_ID --raw ACTUAL_JSONL --tool_use WORKFLOW_TOOL_ID`で結ぶ。error付きasync_launched、null、欠落、結果未受領は未達。CLAIMED/ATTACHEDが残れば別Workflowを起動しない。ローカルprocessが消えたことだけでnative Workflow終了と判断しない。

## 4. 複数スプリントと難航時の回復

初回Opus長期計画→Sonnet短期計画→Haiku実装→独立Sonnetレビュー→Sonnet実検証→task gate→次task。milestone_every既定2の監査間隔はprogress.jsonでburst間も維持する。Opusは初期/節目/重大判断/難航/最終に使い、毎sprintの必須呼出にはしない。

coordinatorは[実行契約](skills/start-development/coordinator.md)に従い、writerのoperation receiptと原要求との対応を保存する。failure.jsonには失敗分類、仮説、試験、次の一手、参照、実行IDを残す。コード由来の2失敗でSonnet診断・実装、4失敗でOpus再計画。明示的な設計矛盾は回数を待たずOpusへ戻す。環境/利用上限/権限の失敗は履歴に残し、コード修正の昇格回数へ加算しない。新仮説/実験によって次の修正枠へ進む。環境・利用上限・権限は具体的な復旧を試み、解決できなければそのtaskを保留して独立taskを進める。

中断時は実terminal+drainedを取得し、burst finishとstate recoverを行う。nextが返す実タスク/REVIEW/VERIFY再開地点から部分変更を観察する。確認済みの構造化resumeだけtask selectの`--resume true`で旧executionを維持する。親rootのtask_id=mission、sprint_task_id、実装executionを混同しない。

## 5. burst終了、永続保存、次burst

Workflowは非同期。結果を待ち、実terminal/drainedをimport-terminationで照合する。`burst.mjs --action finish --target TARGET --id BURST_ID --proof TERMINATION_JSON`を先に実行する。未終了/不明burstがあれば再投入しない。

CONTINUE_PARENTは完成ではない。backlog未完了なら親が現在contextを再確認し、/goalが有効な間は新burstをclaimして続ける。同じroot leaseを保持するなら再beginしない。

セッションの節目では、完了したburstのproofで`state.mjs --action pause`（最終完成前）またはrecover（停止/失敗）し、`checkpoint.mjs --action save --target TARGET --publish true`。PUBLISHEDだけがremote保存完了。SAVED_LOCALなら保存先は現在環境だけなので、push失敗を解決してpublishする。checkpointのpublishを対象mainへのmergeと混同しない。再開は新root attemptと新観測から行う。

CLIを強制終了した場合は終了通知もdrainedも残らない。`claude --resume SESSION --max-turns 1 -p "Observation only"`の再開ログに、runtimeが各taskの`status:"stopped"`通知を出す。`import-termination.mjs --raw ORIGINAL --resume_raw RESUMED --tool_use ID`で取り込み（再init・直前の稼働一覧の全task・再開後のtask_startedなしを会計）、`burst finish`→`state recover`。

`/goal`は現sessionを継続し、新sessionを勝手に作らない。同じCLI sessionは標準`claude --resume ID`、新cloneはcheckpoint復元と新しい/goalを用いる。

## 6. 独立した最終判定

recordで全必須kindの実report/artifactを更新する。visual/playは実描画・操作・画像を必要とする。成功コマンドや手書きPASSで代用しない。全task/原要件、現在product/contract/executionに一致する最終Sonnet reviewとOpus auditを取得する。最終回帰はtask reset→計画/実装へ戻す。

全Workflow/agentが終了した実証拠でburst finish→`state end --proof TERMINATION_JSON`を行い、**その後**`verify.mjs --target TARGET`。JSONと概要を会話にも提示する。省略/古い証拠、モデル不明、未完了backlog、重大指摘、未観察operation、進行中writerがあればCOMPLETEにしない。

保持した設計/実装のモデル記録は元SDK記録とprovenanceを照合したHISTORICAL_VALIDとして扱い、現runの実行へ付け替えない。現在の実検証・最終評価・runtime終了証拠は別に必要。TEST FIXTUREはTEST_COMPLETE等にしかならず、本番完成を証明しない。
