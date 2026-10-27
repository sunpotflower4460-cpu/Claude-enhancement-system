# 06 — v0.2の利用・証拠・再開

Node.js 22以上、Git、Linux/macOSを対象とする。各OSの実行状況はvalidation-results.mdを参照。CLIは機械用JSONをstdout、verify概要をstderrへ出す。終了0は本番COMPLETE、1は検査未達/人間確認/TEST判定、2は入力不正/診断未検証。`npm ci --ignore-scripts && npm test`で回帰試験（ブラウザ試験には`npx playwright install --with-deps chromium`）。製品利用の状態CLIはAjv以外の有料サービスを必要としない。

## 初回の一指示

対象と共通をClaude Codeで選択し、原要求の場所を埋めて送る。

```text
/goal 対象の［設計書パス］にある原要求と完成条件をすべて満たしてください。
Claude-enhancement-system/START.mdを実行し、Opus長期設計、Sonnet短期計画、
Haiku実装、独立Sonnetレビュー・実行検証、必要な修正と節目のOpus監査を進めてください。
未完了バックログが残れば次のWorkflowへ進み、節目にGit checkpointを保存・publishしてください。
実Workflow終了後の独立verifyまで実行し、未達成条件を縮小しないでください。
未確認のモデル・権限・実機品質をPASSにせず、独立して進められる作業は続けてください。
```

新規agent directoryの再起動要件はdocs/runtime-spec-audit.md参照。事前setupとして`node COMMON/scripts/install-agents.mjs --target TARGET`を実行できる（mission不要）。既存設定を上書きしない。cloudでの一指示開始、承認回数、モデルアクセス、共有scriptPathは未実証。

## ローカルCLIの開始と再開

対象をcwdにし、Bashで標準CLIへ一度の指示を渡す。AUTODEV_COMMONは共通repoの絶対パス、設計書パスは対象に合わせる。起動ごとに製品外の新しい保存先を作り、SDK元記録を端末表示と同時に保存する。

```bash
set -o pipefail
AUTODEV_COMMON=/absolute/path/to/Claude-enhancement-system
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0   # ヘッドレスは10分超の背景タスク（Opus初期設計）を止める
AUTODEV_SDK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/claude-autodev-sdk.XXXXXX")
export AUTODEV_RUNTIME_LOG="$AUTODEV_SDK_DIR/session.jsonl"
printf 'SDK record directory: %s\n' "$AUTODEV_SDK_DIR"
claude --model claude-sonnet-5-5 --plugin-dir "$AUTODEV_COMMON" --add-dir "$AUTODEV_COMMON" "$AUTODEV_SDK_DIR" \
  -p "/goal 対象の設計書の原要求をすべて満たすまで、${AUTODEV_COMMON}/START.mdに従い計画・実装・独立レビュー・実検証・修正・次Workflowを継続してください。SDK元記録は ${AUTODEV_RUNTIME_LOG} です。実際の相関イベントが保存されてから、このファイルを--rawへ指定してモデル・起動・終了証拠を取得してください。節目にcheckpointをpublishし、実runtime終了後の独立verifyを会話へ提示してください。未検証を完成扱いしないでください。" \
  --output-format stream-json --verbose --forward-subagent-text \
  2>"$AUTODEV_SDK_DIR/cli.stderr.txt" | tee "$AUTODEV_RUNTIME_LOG"
AUTODEV_PIPE_STATUS=("${PIPESTATUS[@]}")
printf 'claude=%s tee=%s\n' "${AUTODEV_PIPE_STATUS[0]}" "${AUTODEV_PIPE_STATUS[1]}" > "$AUTODEV_SDK_DIR/exit-status.txt"
(( AUTODEV_PIPE_STATUS[0] == 0 && AUTODEV_PIPE_STATUS[1] == 0 ))
```

`mktemp`の新directoryを使うため、再起動や再試験で過去のログを上書きしない。teeはstdoutだけを保存し、stderrをJSONLへ混ぜない。`exit-status.txt`でClaudeと保存処理の終了コードを別々に確認する。最後の条件式も、どちらかが失敗すれば非0となる。元ログは製品指紋の外側にあり、importが必要部分をハッシュ付きで対象のevidenceへ保存する。tmp領域はセッション間の永続保存ではないため、checkpointへ保存された参照と省略理由を確認し、必要な元ログは環境終了前に回収する。

親はこのパスを`import-runtime`、`burst attach`、`import-termination`の`--raw`へ渡す。追記中のJSONLは未完成の末尾行や未到着イベントを含み得るので、必要な完全行と実task情報が揃うまで待つ。モデル応答やWorkflow開始だけから終了を推定せず、実terminalと最新のdrained記録を収集する。CLI終了0や空ファイルを証拠にしない。必要なSDK envelopeが出力されない場合は元ログを保持しUNVERIFIEDとする。

対話操作が必要な環境では`-p`とその引数、stream出力用flagsを外し、`claude --model claude-sonnet-5-5 --plugin-dir COMMON --add-dir COMMON`で起動して上の/goalを一度送る。ただし対話画面のテキスト保存だけでは現在のSDK parserを満たさない。実際に取得できる構造化記録を確認するまでモデル/Workflow試験はUNVERIFIED。実モデル、registry、権限は起動flagだけでは実証にならない。必要な承認はClaude Codeの実承認箇所だけで行う。認証/モデル提供/組織policyをハーネスが回避することはない。

同じ保存済みsessionを使える場合は`claude --resume ACTUAL_SESSION_ID --model claude-sonnet-5-5 --plugin-dir COMMON --add-dir COMMON`。構造化証拠を収集する再開では上の保存手順を新directoryで実行し、Claudeの引数へ`--resume ACTUAL_SESSION_ID`を追加する。古いactive root/burstが残るなら実停止証拠から先に回復し、過去の観測を現起動の証拠へ付け替えない。公式仕様では未達のactive goalがresume時に復元されるが、達成済み/clear済みgoalは復元されない。`/goal`で現状態を確認し、必要なら同じ原要求の条件を再設定する。新cloneに古いClaude sessionが存在するとは仮定しない。

## 権限の事前付与と自動復帰（推奨の起動方法）

自律`/goal`を依頼した時点で、子agentが使う検査コマンドの実行は許可済みとして扱う。実機のヘッドレス実行は未信頼workspaceのprojectの`settings.json`を無視し、`node -e`・Chromium検査・gitなどがagentごとに拒否されて親が検査を代行していた。そこで許可リストを事前に生成し`--settings`で渡す。

```bash
node COMMON/scripts/permissions.mjs --target TARGET                    # .git/autodev-supervise/permissions.json を生成（pushは常に拒否、共通repoの編集も拒否）
node COMMON/scripts/permissions.mjs --target TARGET --allow_publish true  # checkpointの autodev/checkpoint/* へのpushだけ追加で許可
```

死んだ/無言になったCLIは`supervise.mjs`が同じsessionを`--resume`で自動再開する。初回だけ`--prompt`に/goal文を渡し、以後は保存したsession idから再開する。

```bash
node COMMON/scripts/supervise.mjs --target TARGET --prompt "/goal ..."     # 初回（許可リストも自動生成）
node COMMON/scripts/supervise.mjs --target TARGET                          # supervisor自体が死んだ後の再実行（同じsessionを継続）
```

- 毎回の終了後に独立`verify.mjs`を実行し、`COMPLETE`なら停止。そうでなければバックオフ後に標準の復旧指示（実terminal取り込み→burst finish→state recover→新attempt→next）で再開する。
- 出力が`--stall_minutes`（既定25分）止まったCLIはプロセスグループごと止めて再開。`--max_restarts`（既定12）と、backlog/burst/operationが変化しない再起動が`--no_progress_limit`（既定3）回続いた場合は`RESTART_BUDGET_EXHAUSTED`/`NO_PROGRESS`で停止し、理由を`.git/autodev-supervise/report.json`に残す（無限ループにしない）。
- supervisorは状態を自分では書き換えない。復旧は再開したモデルが通常のscripts経由で行い、完成は独立verifyだけが決める。
- コンテナごと再起動した場合は、同じコマンドをもう一度実行する（`.git/autodev-supervise/state.json`のsessionを継続）。

## コマンドの流れ

```bash
node COMMON/scripts/bootstrap.mjs --target TARGET --mission INPUT_JSON --profile backend   # backend | web-app | game | cli（HTTPを持たないCLI/ライブラリ）
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

| kind     | detailsと必須証拠                                                        |
| -------- | ------------------------------------------------------------------------ |
| test     | 実行件数、passed/failed/skipped、具体的なassertions                      |
| build    | 終了結果、実際の生成物とハッシュ                                         |
| api      | method/URL/status/期待status、応答本文artifactとSHA256、内容のassertions |
| behavior | 実入力、前状態、後状態、期待状態                                         |
| visual   | browser/viewport、実PNG/JPEG captures、検査内容とassertions              |
| play     | 実入力列、進行、到達結果/期待結果、実画像とassertions                    |

report自体とartifactをハッシュで照合し、コマンドからの新規nonceが無い旧reportを再利用しない。単なる`true`/`echo`では全kindとも未検証。ツール不足ならreportが揃わずUNVERIFIED、実行失敗やassert失敗ならFAIL。繰り返す操作入力は正当な列として扱う。画像があるだけで視覚的魅力や面白さを自動承認しない。

## モデル・独立評価

`import-runtime.mjs --target TARGET --raw RAW_JSONL --tool_use ACTUAL_TOOL_ID --task TASK_OR_mission --stage review --expected claude-sonnet-5-5`で既知SDK構造を照合する。CLI収集は`--forward-subagent-text`を使う。書類上のmodel文字列や自己紹介は採用しない。

SDK init.cwd、task/run区間、assistant UUID/model/timestamp、invocation tag（Workflowがlabelとpromptへ付与）を現在のmission/binding/run/task/attempt/stageと照合する。必要な形で記録が出ない実機ではUNVERIFIED。parserのために偽の実ログ形式を作らない。保持したplan/選択task executionに対応する過去観測は、元SDK記録と明示provenance（mission/repo/契約/元session/開始時刻/plan hash）を照合した場合だけHISTORICAL_VALIDとして役割の由来を示す。現在の工程へ付け替えない。省略rawや古い無provenanceの記録は未検証。現在のfinal review/audit/checks/runtime終了は別途必要。現contextの不正記録は失敗として残る。

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

## burst所有権と親の継続

root runは親の所有権、burstはnative Workflowの1起動単位。`state begin`後にcontextを取り、`burst.mjs --action claim --target TARGET --run RUN --task mission --attempt ROOT_ATTEMPT --observation_id HASH`。返されたargsへagents/capabilitiesを追加し、native Workflowへ渡す。現在の`burst_id`を含め、launch後は`burst attach --id BURST_ID --raw ACTUAL_JSONL --tool_use TOOL_ID`で実tool resultを相関する。

実terminal+drainedの取得後、import-termination→`burst finish --id BURST_ID --proof PROOF`。CONTINUE_PARENTなら新context→次claimで自走を続ける。max_sprintsは1回のburst上限であり、missionの完成/タスク削除条件ではない。CLAIMED/ATTACHEDが残ったときは新起動を拒否し、実task一覧と元launchを調べる。親が結果を受け取れなくても、実terminalの照合から復帰できる。launchの有無が確定しなければ管理者による復旧が必要なBLOCKEDとして残す。

## Git checkpointと新規clone

通常の`.autodev`は実行中のローカル状態で、通常branchへのpushだけでは次のcloneへ届かない。親は安全な節目で、実burst finish後に`state pause --proof PROOF`を行い、次を実行する。

```bash
node COMMON/scripts/checkpoint.mjs --target TARGET --action save --publish true
```

既定保存先は`autodev/checkpoint/MISSION_ID`。Opus設計前のPLANNING段階でも原要求と初期backlogを保存でき、contract未確定を完成扱いしない。別indexで製品snapshotを作り、未コミットtracked/非ignoreのuntracked/削除/permissionも保持する。元HEAD/index/worktreeや既存設定は変更しない。原要求、backlog、contract、plan、progress、failure/burst/operation履歴を最小状態として専用branchへ含める。PUBLISHEDはremote push成功、SAVED_LOCALは現在環境だけの保存であり、publish失敗を解決するまで新環境へ届いたと報告しない。

新環境では同じrepoをclone/fetchし、親が次を実行する。

```bash
node COMMON/scripts/checkpoint.mjs --target NEW_CLONE --action restore --ref origin/autodev/checkpoint/MISSION_ID
node COMMON/scripts/next.mjs --target NEW_CLONE
```

復元先は新しいresume branchになる。checkpointのsnapshotを既にcheckoutしていても、新しいresume branchへ分ける。repo/原要求/hashと製品を照合し、新sessionへ再接続する。dirty productや別の既存missionへは重ねない。復元した実装済みtaskを無条件に再実装せず、nextの実タスク/再開段階と製品差分を観察する。古いPASS宣言は現在の証拠の代用にならないため、全必須checksと最終独立review/audit/runtime終了を再検証する。

画像/巨大rawを全保存しない。小さいtext/JSON記録は制限内で保存し、大きいartifactはSHA256/size/省略理由として保持する。省略ファイルは復元先に存在するとは扱わない。必要なら元artifactをhash照合して回収するか実検査をやり直す。Git checkpoint自体の欠落・改変、別repoへの付替えは拒否する。復元後の`.autodev`はアプリのindexから外し、既存のignore設定を置換せずローカルGit excludeで管理する。外部DBや常駐serverは不要。

復元途中の強制終了や最終化失敗は、Git directoryに保存したjournalから再開する。

```bash
node COMMON/scripts/checkpoint.mjs --target TARGET --action recover-restore
```

復元はphaseごとのjournal、所有者のCAS照合、staged stateの一括publishを使い、最終化まで旧状態のbackupを保持する。復元ownerが生きた/不明の間は別の回復を開始しない。途中に別writerが状態を更新することも拒否する。製品/状態の欠落・改変は拒否して原因を残し、既存ファイルへ強制上書きして解決しない。

## 原因を残す回復と効率

`failure.mjs --action summary --target TARGET`はtaskごとの累積失敗、直近2件、最新仮説/実験、次の一手、要求する実装モデルを返す。`context.mjs`にもfailure_stateが含まれる。全ログを毎sprint読み直さず、関連する契約・差分・失敗参照を次役へ渡す。最終検証では全必須checkを省略しない。

分類はimplementation/review/test/repeated_fix/design/environment/model_limit/permission/terminated/evidence。コード由来の2失敗でSonnet診断/実装、4失敗でOpusの技術再評価へ進む。明示的な設計矛盾は即Opusへ戻す。環境/利用上限/権限の失敗はコード修正回数へ加算しない。同じ仮説と実験だけの再登録を拒否する。新しいOpus仮説/実験はSonnetの次修正枠を開き、履歴を消さない。上限でmissionを完成扱いせず、保留taskを残して独立taskを進める。

環境/モデル上限/承認待ちはコード修正と分ける。具体的復旧を試み、不可なら原因・証拠参照・再開条件を保存する。復旧した新しい根拠または戦略から再開し、元の必須条件は変えない。failure journalのmodel文字列は要求した担当であり、実ルーティングの証明ではない。

現在の実証範囲と未検証は[validation-results](validation-results.md)、Before/AfterとR01〜R12対応は[長期監査](09-long-running-audit.md)。

## 初期計画の中断と入力の互換性

Opusがbacklogを書いてからcontractを公開する前に停止すると、contextは未完成計画を完成した契約として扱わず拒否する。実停止・drainedを確認し、burst finish→state recoverの後で次を実行する。

```bash
node COMMON/scripts/repair-plan.mjs --target TARGET --proof TERMINATION_JSON
```

原要求・architecture.md・部分計画のhash付きarchiveを保持し、未検証の計画入口を再構成する。公開済み計画や完了taskの初期化には使用できない。古いv1移行後も元計画をarchiveから読んでOpus再計画へ進む。

root用task ID `mission`は予約済み。原要求IDがmissionでも原文/要件IDは保持し、bootstrapは衝突しない別task IDへ対応させる。通常検査のcommandは対象rootをcwdとし、`AUTODEV_COMMON`と`AUTODEV_NODE`をrecordが現在環境から供給する。例: `"$AUTODEV_NODE" "$AUTODEV_COMMON/examples/api-check.mjs"`。既存の絶対path入り契約を自動で文字置換せず、原契約を残して再計画・再検証する。

Schema v2のoptional provenanceは古い記録を自動で歴史的証拠へ昇格しない。共通検証器の更新も契約指紋を変えるため、過去の承認を最新実証として流用せず再評価する。

読み取り専用reviewerの停止にはstarted writer receiptが存在しない。nextの`recovery_kind=READONLY`では停止時state/proof/rawと既存実装を観察し、`task.mjs --action select --resume true --observed_fingerprint CURRENT_HASH --reason INSPECTION_REASON`でexecutionを維持する。完了済み/不在のreceiptへoperation.observeを行わない。製品が変わればREVIEWへ戻し、最新の独立評価・検査は取り直す。停止時の監査間隔が既に到来していれば、次タスクを実装する前に監査を終える。初期計画を再び中断した場合も、別実行の停止証拠から新しいrepair世代を作り、前世代の草案とjournalを保持する。

checkpointが保証するのはPUBLISHEDになった時点のsnapshotまで。環境破棄後に未pushの変更や一時ログを現存扱いしない。通常の長期運用では小さいburst（例: max_sprints=2）と安全な節目でのpublishを選ぶ。Gitが無視する参照先や途中symlinkがsnapshotから欠落する場合、saveはref更新/push前に拒否する。元ファイルやindexは変更しない。依存を製品として追跡するか環境専用の参照を分離した後に再検証・保存し、秘密情報を含むか不明なignoredファイルを勝手に追加しない。

Mac上の`/var`等のaliasは実pathで照合する。内部linkの内容指紋と、checkpointとして別pathへ移せるかは別検査である。checkpointは旧path固定の絶対symlinkをpublish前に拒否する。隔離probeのpushurlはローカルの拒否先へ設定されるため、sourceのremoteへ自動pushしない。probeのLOCAL再cloneをGitHub永続保存と混同しない。remote保存試験は明示的に書込許可されたテスト対象で別途実施し、guardを自動解除しない。
