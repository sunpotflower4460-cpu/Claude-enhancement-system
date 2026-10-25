# Claude Code実機の一括probe

通常の開発対象を変更する前に、**テストrepoの隔離コピー**で実アカウント/クラウド固有の項目をまとめて観測する。4機能（加算、除算と0エラー、挨拶、clamp）には初期故障があり、受け入れtest/APIは実assertionsとHTTPを使う。fixtureモデルログを実モデル記録へ代用しない。

## クラウドの一指示

Claude Codeでテストrepoと共通repoを選び、次を一度送る。初回の実権限承認や必要なagent再発見だけは、その環境で求められる操作を残す。

```text
/goal Claude-enhancement-system/docs/live-probe.mdの隔離実機試験を最後まで実行してください。
選択したテストrepoをsourceとしてlive-probe prepareでrepo外の新しい隔離cloneを作り、
生成された.autodev/probe-prompt.txtとSTART.mdに従ってください。sourceのファイル・設定・branchは変更しないでください。
クラウド2repo、共有Workflow、native agent発見、実Opus/Sonnet/Haiku 5.5、reviewerの実読み取り専用制限、
/goal継続、max_sprints=1による3burst以上のclaim/実起動/完了待機、実装→レビュー→故障修正→次task、実検証、中断と再開を観測してください。
節目にGit checkpointをpublishし、隔離コピーの別cloneで原要求・進捗・部分実装を復元し、最終検証も再実行してください。
最後は実Workflowがdrainedになってから独立verifyを実行し、モデル元記録・拒否の根拠・結果を保存してください。
確認不能はUNVERIFIEDのまま、独立して試せる項目は続けてください。
```

cloud内の親が生成promptを直接実行する場合、新しい独立試験ごとに新しい出力先をprepareする。同じ途中試験を再開する場合は、元のroot/burst/operationの回復手順を使う。下のCLI `run`をcloud内で起動するだけでは、対話cloud側の2repo選択/agent発見を実証しない。

直接cloud試験では、選択元repo・親sessionのcwd・隔離cloneのrootを別々に採取する。現在のモデル/起動parserはSDK `init.cwd`が検査対象rootと一致することを要求する。cloud側が選択元sessionのcwdを維持し、隔離cloneを指さない場合はその記録を受理できないためUNVERIFIEDとする。隔離先に置いたnative agentsが現在sessionで発見されるかも未実証。実観測から有効な対象binding/収集経路を確認するか、隔離先cwdから開始する新sessionが必要になる。cwdを書き換えたログや架空のagent発見記録で解決しない。ローカルCLI `run`は隔離先cwdで起動するが、cloudの同じ条件を実証したことにはならない。

## ローカルCLIの最短実行

共通repoで`npm ci --ignore-scripts`を済ませ、次の2コマンドを実行する。

```bash
node COMMON/scripts/live-probe.mjs --mode prepare --source TEST_REPO --output NEW_DIR
node COMMON/scripts/live-probe.mjs --mode run --target NEW_DIR
```

sourceはローカルGit cloneの読み取り元。元worktree/branch/configを変更しない。出力はsource/共通の外側で、既存directoryを置換しない。prepareはsibling stagingでfixture・contract・native agents・probe-input/prompt/resultsを作り、完了後に一括publishする。初期結果は全項目UNVERIFIED。

`run`は通常の`claude -p "/goal ..."`を呼ぶ。実binaryは`--claude /absolute/path/to/claude`で指定可能。`--model claude-sonnet-5-5 --add-dir COMMON --plugin-dir COMMON --output-format stream-json --verbose --include-partial-messages --forward-subagent-text`を使い、認証/権限を迂回するflagを追加しない。

各runに別invocation_idを付け、evidenceへ`live-sdk-ID.jsonl`、`live-cli-ID.stderr.txt`、`live-run-ID.json`を保存する。旧結果と入力はarchiveし、現結果はUNVERIFIEDから始める。CLI終了0だけで試験PASSにしない。`--resume ACTUAL_SDK_SESSION_ID`は標準Claude sessionの再開を選ぶ。元rootがactive/unknownなら先に停止証拠から回復し、二重起動しない。

## 準備失敗・中断・再実行

| 状況                        | 処理                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| source/共通配下、既存output | 変更前に拒否。別の新しいrepo外directoryを選ぶ                                                                     |
| clone/生成/権限で準備失敗   | outputは公開せずstagingを掃除。`OUTPUT.autodev-probe-prepare.json`に原因を記録し、原因修正後に同じprepareを再実行 |
| 強制終了でPREPARINGが残る   | ownerの実停止後、下のrecover-prepare。生きた/他host不明ownerを奪わない                                            |
| 公開後にjournal最終化失敗   | 既存outputを調査する。recoverが公開済みdirectoryを削除することはない                                              |
| CLI起動失敗/中断            | invocationごとのraw/stderr/manifestは残り、PASSにならない。active/unknown root・child groupを確認して回復         |
| 新しい試験として再run       | 現invocationの未検証結果を新設し、旧PASSを混ぜない。古いinvocation IDでの結果更新は拒否                           |

```bash
node COMMON/scripts/live-probe.mjs --mode recover-prepare --output NEW_DIR
```

これは準備ownerが停止済みと分かったときだけ使う。復旧後は元sourceとoutputでprepareを繰り返す。状態の手動削除や通常repoへの再試行で問題を隠さない。

## 親が一連で確認すること

1. 実際のcloud選択repo/pathsと共通read/scriptPathを記録。root run/attemptをbeginし、doctor、native discovery、runtime-probeを実行する。
2. reviewerに書き込み/任意Bash/委任経路がないことを、実ツール一覧・実拒否/不在とsentinel不変から確認する。プロンプトの禁止や自己申告だけなら未検証。
3. SDK元記録からモデルをimport-runtimeで照合。probe\_\*は診断専用で、実装工程の役割証拠には使わない。必要なcwd/timestamp/task/tag等が観測されなければ、架空adapterで補わずUNVERIFIED。
4. 現contextからburstをclaimし、実測済みcapabilitiesだけを渡してnative Workflowを起動。実launchをattachする。4taskで故障検出→修正→独立review→実HTTP/test→次taskを観測する。
5. 生成argsのmax_sprints=1で3burst以上を継続し、/goalの自動継続とmilestone間隔、Sonnet昇格/Opus再計画の記録を確認する。上限到達を完成とは扱わない。
6. 実装/レビュー途中でnative Workflowを停止。実terminal+drainedをimportしburst finish→state recover。nextの実タスク/段階とoperation.observeから再開し、部分編集を二重適用しない。
7. 完了したburst後にstate pause→checkpoint save/publish。隔離コピーの別cloneでcheckpoint restoreし、原要求・未完了task・既実装部分・省略証拠の扱いを確認する。restore途中の停止は`checkpoint.mjs --action recover-restore --target TARGET`から再開し、状態を手動削除して合格にしない。
8. 全必須checksと最終Sonnet review/Opus auditを更新。実runtimeがdrained後にburst finish→state end→verify。COMPLETE以外を完成扱いしない。

native Workflowが使えない場合、同じ制限付きnative Agent役を親が直列に呼ぶ標準経路を評価できる。ただしそれをWorkflow試験合格とはせず、現在のWorkflow専用終了証拠を偽造しない。実行可能な別経路の受け入れ設計と実観測が揃うまではUNVERIFIED。

## 結果の回収

`probe-results.json`はtwo_repositories、goal_continuation、actual_models、native_readonly_denial、workflow_start_wait、repair_loop、real_verification、stop_resume、final_gate、multi_burst_state、checkpoint_recloneを列挙する。CLI `run`が出した現invocation_idを結果更新へ渡す。

```bash
node COMMON/scripts/probe-result.mjs --target ISOLATED --invocation CURRENT_INVOCATION_ID --check CHECK_ID --status PASS --evidence '[{"path":"actual-log.jsonl","sha256":"ACTUAL_SHA256"}]' --reason "具体的な実観測"
```

PASS/FAILは実ファイルとhashを必要とする。これは親の観察を保存するinterfaceで、任意ログの意味内容を自動承認する機能ではない。モデルは専用parser、完成はverifyが独立再計算する。raw/stderr/manifest、probe-results、最終verify JSON、必要な画像/拒否ログ、checkpoint branch/commitを一組として回収し、未実行項目は未検証理由と次の採取手順を残す。

ローカル試験が証明するのは隔離準備・故障復旧・状態/証拠処理、模擬モデル継続、実Git/HTTP/Chromium等の範囲。実5.5モデル、cloud2repo、native read-only拒否、本物の/goalとWorkflow停止再開は、この実機試験で初めて確認する。
