# 実機受け入れ試験 — 2026-10-26

**結論：本物のOpus/Sonnet/Haiku 5.5による自律開発の完走と独立`verify.mjs`の`COMPLETE`（assurance=LIVE）を、固定fixture（4関数）と通常手順の新規webアプリ（6タスク）の2件で実機確認した。V1全体は、下記のUNVERIFIED項目が残るため「実用開始可・追加検証あり」とし、全項目PASSとは主張しない。**

- 環境：Claude Code 2.1.310（クラウドコンテナ、OAuth認証、`claude -p`のヘッドレス子session）。モデルは`claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5`をruntimeのworkflow_agent進捗から実測。
- 共通基盤：`Claude-enhancement-system`。PR #1の実装（`feat/claude-autonomous-harness`）は本試験の開始前に`main`へマージ・クローズ済みだった（`merged_at` 2026-10-26T10:31Z）。Draftへ戻せないため、同一内容の作業ブランチ`claude/enhancement-system-acceptance-test-ux80sk`に修正を積んだ。mainへは触れていない。新規PRは作っていない。
- 開発対象：`dream-box`（READMEのみのrepo）から隔離probe（4関数の故障fixture）。元repoのローカルcloneは変更0、GitHub上の`main`は`8a25f7a`のまま。probeの`pushurl`は存在しないローカル先で、`git push`は許可規則でも拒否。

## 1. 最終受け入れの結果（run 7、`dreambox-7`）

| 項目 | 結果 |
| --- | --- |
| 独立`verify.mjs` | **COMPLETE（assurance=LIVE）、4/4 task、8/8 check、issues=[]、終了0**。親sessionが全子プロセス終了・稼働一覧が空・全burst FINISHED・state IDLEを確認した後に2回実行。[1回目](evidence/live/run7-COMPLETE-2026-10-26/independent-verify-1-before-stop-resume.json) / [最終状態](evidence/live/run7-COMPLETE-2026-10-26/independent-verify-2-final-state.json) |
| 製品の独立実行 | add/divide/greet/clampの要件9件＋divide(1,0)例外を私が直接実行して全てOK |
| 使用モデル | Opus（architecture、milestone audit、final audit）、Sonnet（inspect/plan/persist/close、review、verify）、Haiku（implement）。全て実機の`workflow_agent`進捗とtool一覧で確認、`CURRENT_VALID`。architectureだけは保持した設計として`HISTORICAL_VALID` |
| burst | 14（probe 1＋開発13）。ユーザー指示なしで`/goal`が継続 |
| 開発サイクル | R1〜R4を各々 plan→Haiku実装→独立Sonnet review→Sonnet実検証(record.mjs)→task gate。Opus milestone audit複数回、最終Sonnet review PASS、最終Opus audit（NEEDS_FIX 1回→PASS） |
| 中断・復元 | 下記3節 |
| ローカルテスト | **205件PASS**（従来177件＋実機差分の回帰27件）。CIは各コミットでLinux/macOS成功（最新は[Actions](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/actions)） |

run 6（`dreambox-6`）は修正を重ねながら同じ工程を通した探索run。run 7は修正を一切加えない清浄な再実行で、これが受け入れ根拠。

### 1.1 通常の開始手順によるweb開発（`web-todo`、実Chromium）

`live-probe`の固定fixtureではなく、空の新規repoに`DESIGN.md`（原要求と完成条件）だけを置き、START.mdと`/goal`1回の通常手順で開始した。

| 項目 | 結果 |
| --- | --- |
| 独立`verify.mjs` | **COMPLETE（assurance=LIVE）、6/6 task、23/23 check、issues=[]、終了0**。全子プロセス終了・稼働一覧が空・state end後に私が実行。[出力](evidence/live/web-todo-COMPLETE-2026-10-26/independent-verify.json) |
| 独立の実Chromium確認 | 私自身が375px/1280pxで追加・空入力無視・空白除去・完了切替・3フィルタ・削除・リロード保持・壊れた保存データ・横スクロールなし・コンソールエラーなしの22項目を実行し全てOK（[script](evidence/live/web-todo-COMPLETE-2026-10-26/independent-web-check.mjs)、[375px](evidence/live/web-todo-COMPLETE-2026-10-26/web-375.png) / [1280px](evidence/live/web-todo-COMPLETE-2026-10-26/web-1280.png)） |
| 経過 | 初回起動はヘッドレスの10分背景タスク上限でOpus初期設計が途中停止（所見20）→ 環境変数を付けて同じsessionを`--resume` → 子は`repair-plan`を実行せずOpus設計を再実行して27KBの設計を完成 → 6タスクを22 burstで開発 |
| 使われたモデル（再開後） | Opus architect 3 / Opus auditor 9 / Sonnet planner 138 / reviewer 21 / verifier 14 / Haiku builder 14（workflow_agent進捗） |
| ゲートの動作 | Opus最終監査が「タッチ対象44x44px」の実品質と、「T1の現在の実装段階にモデル証拠が無い」点（親が直接製品を編集した結果）を指摘してNEEDS_FIX→再検証→PASS。最終`verify`前に親が1度finalizeをやり直した |

## 2. 実機で見つかった問題と修正（Before / After）

分類：**環境**＝実行環境・権限、**API差**＝想定した記録形式との違い、**モデル**＝実モデルの出力のゆれ、**実装**＝ハーネスの欠陥。全て回帰テストで再現してから直した（修正前に失敗することを確認）。

| # | 分類 | 実機の観測（Before） | 修正（After） | commit |
| --- | --- | --- | --- | --- |
| 1 | 環境 | Playwright 1.64のChromium revisionが無く、ブラウザ3テスト失敗（174/177） | `AUTODEV_CHROMIUM_EXECUTABLE`で実行ファイルを指定可能（既定は不変） | d51e2c5 |
| 2 | 環境＋実装 | `claude -p`は承認者がおらず最初の`node`で停止。clone内`.claude/settings.json`のallowは未信頼workspaceで**無視**される | prepareが`.autodev/probe-permissions.json`を生成し、runが`--settings`で渡す限定allowlist。`git push`と共通repoへの書込はdeny | 3e282a1 918dc10 |
| 3 | API差 | 子へのsubagent本文転送は無く、model証拠が取れない。Workflow起動結果の`runId`(wf_…)とSDKイベントの`run_id`が別ID | `workflow_progress[workflow_agent]`のagentType/model/state/タグをmodel証拠に採用。stream側`run_id`を`task_started`(tool_use_id)から解決。曖昧は拒否 | a0e669f |
| 4 | API差 | 読み取り専用はモデルの自己申告しかない | runtimeが書くagent別`prefix.json`のtoolNames（reviewer＝Read/Grep/Glob/StructuredOutput、builder＝Bash/Edit/Write付き）を`readonly-evidence.mjs`で採取、書込系があればFAIL | 2fd97e6 |
| 5 | 実装 | プロンプトがSDK記録の場所を示さず子が迷う | 自session capture（`live-sdk-*.jsonl`）の場所を明記 | 229741e |
| 6 | モデル＋実装 | 実plannerのinspectが自由形式snapshotを返し`Missing persisted snapshot`で落ちる | inspect専用schema（observation_id/tasks[]/architecture_ready等）＋1回の訂正＋fail closed | 8be346b |
| 7 | モデル | 実plannerが`next.mjs --run`や`failure.mjs --action`を省略し「Active/unknown owner」等の誤誘導 | `AUTODEV_REQUEST.commands`に正確なコマンド行、`next.mjs`は`MISSING_ARGUMENT`、`failure.mjs`は用法を返す | caecd4e 6164036 |
| 8 | 実装 | 成功したinspectをplannerがUNVERIFIEDと答え、controllerが即終了 | PASS＝CLI出力取得成功、と定義。許可規則に`node scripts/*` | 6164036 |
| 9 | API差＋実装 | CLIをkillすると終了通知もdrainedもなく復旧不能 | 再開sessionの`stopped`通知を、再init・直前稼働一覧の全task・「previous session ended」境界・再開後task_startedなしの会計で終了証拠に採用 | 893e800 0287f30 |
| 10 | 実装 | `architecture_ready`のCLI出力が無くplannerがfalse→Opus設計を毎burst再実行 | `context.mjs`が決定的に計算 | f8e6038 |
| 11 | モデル＋実装 | 簡略化したtasks[]で`t.dependencies.every`が落ちる | tasks[]要素にid/status/dependencies必須、controllerのゲートを分離 | 44dc218 |
| 12 | 実装 | 新しいroot attemptで実装済みタスクが新規SPRINTに戻り、レビューに進めない。builderの`node -e`が拒否 | retained execution＋完了IMPLEMENT receiptから`RESUME/REVIEW`を導出。allowlistに`node -e`等 | 0e964e9 |
| 13 | モデル | 後段未実施の事実を`major`としplanがPASSできない | severityの定義をpromptとcoordinator.mdに明記 | 301c801 |
| 14 | モデル＋実装 | plannerが`next.mjs`出力を入れ子のまま`snapshot.resume`へ。controllerが平坦形のみ読んでいた | `resume.resume ?? resume`を受理 | 300f138 |
| 15 | 実装 | 実reviewerの結果を調整役が永続化できない（v2封筒＋runtime_refを手組みすると別指紋の貼付けになる） | `assess.mjs`：封筒のproduct/contract/identityはassessor自身のsnapshot、model証拠はsdk captureから。古い製品のreviewはassessment.mjsが拒否 | b86f3f2 |
| 16 | 実装 | milestone cadenceがresetできない（全taskのexecution必須で、最後のtask着手までresetが原理的に不可） | 直近でPASSしたtaskのauditを受理（全taskは後方互換） | 5059ca8 |
| 17 | 実装 | R4の編集で製品指紋が変わりR1〜R3の証拠が失効、Opusが正しくNEEDS_FIX | 最終review/auditの**前**に全checkを現製品で再実行 | b1d3f3c |
| 18 | 実装 | architecture/plan/implementのmodel証拠を取り込む手段がなく`verify`がUNVERIFIED。`operation complete`が`result:null`を許し永久にUNVERIFIED。取込のたびにcapture全体を複製（1.7GB） | `import-runtime --burst`と取込コマンドの配布、`complete`は結果必須（null受領は1回だけ修復可）、保存captureから`stream_event`を除去 | 6561ff0 |
| 19 | 実装 | 取込がagentの`done`進捗の書込前に走り`Subagent evidence absent`（余計なNEEDS_FIX 1回） | `import-runtime --wait`：一時的な欠落だけ再試行、置換・曖昧は即失敗。**単体試験のみ。実機再検証は未実施** | 6931873 |
| 20 | 環境 | ヘッドレス`claude -p`は最後のターンから10分を過ぎた背景タスクを止める（標準エラー`Background tasks still running 10m … stopping them`）。web開発のOpus初期設計(`Agent`の背景起動)が途中で止まり、`contract.json`/backlogだけが書かれ`architecture.md`はプレースホルダ | `live-probe`の起動に`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`、START.md/06-usageに回避（前景実行または同環境変数）と`repair-plan`での回復を明記 | 3073c8d |

## 3. 停止・復元・長期継続（実機）

- **run 6：実際のSIGTERMを2回**（Workflow実行中）。再起動後は`claude --resume`で再開し、runtimeが各taskに`status:"stopped"`の`task_notification`を出すことを観測。取り込み→`burst finish`→`state recover`の後、Opusの`architecture.md`は中断前と**バイト一致**、backlog保持、`next.mjs`が再開地点を返した。二重起動は`live-probe`が拒否（root run active/unknown）。
- **run 7：`TaskStop`によるnative Workflowの実停止**（SDK status `stopped`）→ import-termination → burst finish → state recover → 新attempt → 再起動burstが`READY_FOR_PARENT_GATE`まで完走 → 再度`verify`が`COMPLETE`。
- **Git checkpoint**：run 6/7ともLOCAL保存（`--publish`なし）→ 隔離cloneから第2cloneへ復元。第2cloneはfetch URLを元repoのまま保持し`pushurl`をclone自身の存在しないpathに固定。mission_id一致、製品・backlog（PASS済みtask）を復元、`next.mjs`が同じ再開地点を返すことを私が独立に確認。GitHub上に`autodev/checkpoint/*`は作られていない。
- 過去のモデルログは新しい工程の証拠として使われていない（再開後にruntime-probeと必要な検査をやり直し、旧invocationのPASSは持ち越されない）。

## 4. 原T01〜T20の照合

凡例：**PASS**＝実機で確認、**UNVERIFIED**＝実機未確認（ローカル/模擬のみ）、**BLOCKED**＝外部条件待ち、**FAIL**＝実機で失敗（現時点なし）。

| ID | 実機判定 | 実機での根拠・範囲 |
| --- | --- | --- |
| T01 | **PASS（範囲限定）** | 共通＋対象の2repoが選ばれたcloud sessionから隔離初期化。元repo無変更、push不能。クラウド親session自身のcwd/agent再発見は使っていない（子CLIは隔離cwd）ためその部分はUNVERIFIED |
| T02 | **PASS** | 14 burstがユーザー指示なしに継続。stop hookが止めても同じ`/goal`が再開（`active_goal`イベント） |
| T03 | **PASS** | opus-5-5/sonnet-5-5/haiku-5-5をworkflow_agent進捗で実測、`CURRENT_VALID`、`verify`のrouting_provenanceに反映 |
| T04 | **UNVERIFIED** | 実Haikuは初回から正しいコードを出し、実レビューが「コード欠陥を検出→修正」する場面は起きなかった。NEEDS_FIXは全て証拠の失効・不足 |
| T05 | **PASS** | 実機の初回`verify`が`UNVERIFIED`で、失効run_id・null結果・Opus観測欠落を列挙。Opus auditも失効証拠を指摘 |
| T06 | **UNVERIFIED** | 実機のweb開発で実Chromiumの視覚・操作検査は合格したが、「UI失敗なのに完成にしない」拒否の場面は実機で起きていない |
| T07 | **UNVERIFIED** | 要件削除の注入は実機未実施（Opus auditは「要件が落ちていない」ことを毎回確認） |
| T08 | **UNVERIFIED** | コード由来の連続失敗が起きずSonnet診断/Opus再計画は未発火。permission分類の失敗は昇格回数に加算されず保留されることのみ確認 |
| T09 | **PASS** | SIGTERM×2、TaskStop×1から二重実装なしで再開。完了済みimplement receiptは`ALREADY_APPLIED`で再編集されない |
| T10 | **UNVERIFIED** | 対象に既存`.claude/`が無い（ローカル試験のみ） |
| T11 | **PASS** | ヘッドレス権限不足を子が`UNVERIFIED/permission`と報告し、偽の成功や証拠の手書きをしなかった（複数run） |
| T12 | **PASS（web-app）** | 同じ共通基盤で、backend fixtureに加えweb-app profileの新規プロジェクトを通常手順で完走（`verify` COMPLETE LIVE）。game・既存アプリは未実施 |
| T13 | **PASS** | evidenceだけの更新で製品指紋は不変、共通repo更新で契約ダイジェストが変わり既存レビュー/証拠が失効 |
| T14 | **PASS（範囲限定）** | 未追跡の`autodev-probe/app.mjs`編集で製品指紋が変わり証拠が失効。削除・mode変更は実機未確認 |
| T15 | **UNVERIFIED** | Workflow agentのnull/stallは実機で発生せず（`TypeError`でのWorkflow失敗は失敗burstとして記録され、捨てられなかった） |
| T16 | **UNVERIFIED** | 停止は製品編集の前/後の境界で起き、編集の途中は実機で再現していない |
| T17 | **UNVERIFIED** | 方針によるモデル置換は発生せず（置換の拒否はローカルの単体試験のみ） |
| T18 | **PASS** | `permission_denied`イベントと未信頼workspaceのsettings無視を観測し、承認待ちを実行済みと誤表示しなかった |
| T19 | **PASS** | reviewerのruntime記録toolNamesに書込・委任・Bashが無く、sentinelは不在（試みて拒否ではなく「不在」） |
| T20 | **PASS** | R4の編集後にOpus最終監査がNEEDS_FIX、共通repo更新後に旧レビューが失効し`COMPLETE`が拒否された |

## 5. 未検証・外部条件

- **UNVERIFIED（実機未実施）**：上表のT04, T06, T07, T08, T10, T15, T16, T17、T01/T14の範囲外。game・既存アプリを実Claudeで開発する追試。`import-runtime --wait`の実機再検証。
- **BLOCKED（明示承認待ち）**：checkpointのGitHub公開（検証用の公開先が許可されていない。probeは元repoへpush禁止）。クラウド親sessionでのagent再発見とcwd束縛の実証（子CLIは隔離cwdで起動）。
- 設計上の制限：共通repoの変更は契約ダイジェストを変えるため、実行中に共通repoを更新すると全証拠が失効する（意図どおり）。受け入れ`COMPLETE`は共通repo `4cad18f`時点のscript状態で得たもので、より新しいcommitでは再検証が必要。
- 同じ`/goal`が目標未達のまま繰り返し報告する場合、生きた実行は止める（今回の子はその間も証拠を偽造しなかった）。

## 6. 再現と再開

```bash
cd COMMON && npm ci --ignore-scripts && AUTODEV_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm test   # 205件
node scripts/live-probe.mjs --mode prepare --source TEST_REPO --output NEW_DIR
node scripts/live-probe.mjs --mode run --target NEW_DIR                                              # 本物の/goalを開始
node scripts/live-probe.mjs --mode run --target NEW_DIR --resume SDK_SESSION_ID                      # 同じsessionの再開
```

CLIが死んだ場合：`claude --resume SESSION --settings NEW_DIR/.autodev/probe-permissions.json --max-turns 1 -p "Observation only"`で再開ログを採取し、`import-termination.mjs --raw ORIGINAL --resume_raw RESUMED --tool_use ID`→`burst.mjs --action finish`→`state.mjs --action recover`。

次の自律実行点：(1) game・既存アプリの実機追試、(2) T04/T08/T16の故障注入（意図的に誤ったコードや実装途中のkillを入れた実run）、(3) 許可された公開先でのcheckpoint publishと新session復元。

## 7. 証拠

`docs/evidence/live/`配下。各runに圧縮済みSDK capture（部分streamを除去、元ファイルのsha256付き）、manifest、probe-results、assessment、agentのmeta/prefix/journal、独立verify出力。
[run3](evidence/live/run3-2026-10-26) / [run4](evidence/live/run4-2026-10-26) / [run5](evidence/live/run5-2026-10-26) / [run6中断・復元](evidence/live/run6-2026-10-26-interrupted) / [run6 R1 PASS](evidence/live/run6e-R1-PASS-2026-10-26) / [run6最終ゲート](evidence/live/run6f-final-gate-first-verify-2026-10-26) / [**run7 COMPLETE**](evidence/live/run7-COMPLETE-2026-10-26) / [**web-todo COMPLETE**](evidence/live/web-todo-COMPLETE-2026-10-26)
