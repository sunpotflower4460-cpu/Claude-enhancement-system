# 長期自走・移植性・実機移行の監査

開始headは`6b3b71e`。当初のR01〜R12、受け入れT01〜T20と今回のPhase A〜Gを基準に、既存実装を拡張した。PR #1の作業ブランチを継続し、Draftを維持する。Development系や他の開発AIとの統合は追加していない。

**実装・ローカル実証・Claude Code実機受け入れを分ける。V1全体はUNVERIFIED。** 最終件数、実行環境、CI、証拠ファイルは[検証結果](validation-results.md)を正本とする。

## 原要求からの対応

| 要求                       | 実装・今回の強化                                                | プログラムで検査する範囲                           | Claude実機で残ること                              |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| R01 2repo・非破壊初期化    | START、bootstrap、識別、agent installer、隔離probe              | 別repo拒否、既存設定保全、prepare故障/再実行       | クラウド2repo選択、共有scriptPath、初回承認数     |
| R02 モデル別の役割         | native agentTypeと明示モデル、原始SDK記録の照合、履歴provenance | 役割誤配線、旧run流用、モデル置換、履歴の欠落/改変 | 実5.5モデルの提供・ルーティング・読み取り専用制限 |
| R03 不合格なら修正         | 明示assessment、修正ループ、最終回帰からtask reset              | NEEDS_FIX/BLOCKED、実故障検出、再レビュー          | 本物のClaude役割間の判断と修正                    |
| R04 /goalとWorkflow継続    | burst journal、親の再観測、次burst情報、native CLI再開          | 連続burst、二重claim、古いlaunch/終了証拠拒否      | /goal背景待機・継続・停止・再開                   |
| R05 原要求・完成ゲート     | mission原文、全task/check/要件照合、verify独立再計算            | 手書きPASS、未完了、証拠欠損/改変、契約変更の拒否  | 実モデル/実権限/実runtimeの証拠を揃えた最終判定   |
| R06 実際の品質検証         | typed reports、HTTP、Chromium、Web/game/既存変更fixture         | 入力、保存、遷移、勝敗、再開、画像、故障→修正      | Claudeが対象ごとに選ぶ実検査、主観的な最終品質    |
| R07 状態保存・再開         | Git checkpoint、session分離、resume、operation、handoff         | 新規clone、途中変更、状態欠落/改変、再検証         | クラウド環境終了→再選択で同じ開始体験             |
| R08 難航時の昇格           | failure journal、Sonnet診断、Opus再計画、独立task継続           | 昇格履歴保持、異なる仮説、外部blocker分離          | 実モデルでの診断品質と消費量                      |
| R09 複数分野               | backend/web-app/game profiles、耐久fixture                      | 必須kind、従来機能、実ブラウザの正常/故障          | 実開発案件での受け入れ品質                        |
| R10 制約の正直な報告       | doctor、probe結果、failure分類、UNVERIFIED/BLOCKED              | 準備失敗、権限/モデル/環境不足の状態保存           | アカウント、利用上限、承認ダイアログの実挙動      |
| R11 部分完了・二重適用防止 | burst所有権、operation観察、復元時の実タスクexecution維持       | 中断、古いprocess、partial edit、新ownerでのresume | native Workflowの実停止通知とdrained一覧          |
| R12 証拠鮮度               | 製品/契約指紋、生成状態除外、証拠hash                           | 未追跡、削除、mode、欠落artifact、自己無効化防止   | 実ツール記録が専用parserの必要情報を出すか        |

## Before / Afterと理由

| 項目                | Before                                                                                | After                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新規clone           | reconnectは同一repoを識別できるが、ignoreされた`.autodev`自体はpushされない           | 専用`autodev/checkpoint/MISSION_ID`へ製品snapshotと最小状態を保存。明示publishでGitHubへ送り、新cloneから復元する                                                                                    |
| 未コミット実装      | 対象branchへの通常pushだけでは未保存の変更を失う                                      | 別Git indexでtracked/非ignoreのuntracked/削除/実行bitをsnapshot化。saveは対象HEAD/index/worktreeを変更しない                                                                                         |
| 証拠の持ち運び      | ローカルpathにログが残る前提になりやすい                                              | 小さい記録を制限付きで保存。大きいログ/画像はSHA256/size/未取得理由を保持し、復元先で現存扱いしない                                                                                                  |
| 部分編集のreconnect | receiptのarchiveだけで次の実装へ戻る場合がある                                        | interrupted receiptと実タスクのREVIEW/VERIFY再開地点を維持し、差分観察を要求する                                                                                                                     |
| task execution      | 新root runでselectすると途中実装のexecutionが変わり得る                               | 確認済みの構造化resumeでは既存executionを維持。coordinatorのroot leaseと実装の由来を分ける                                                                                                           |
| 長期モデル証拠      | すべてをcurrent root runだけに要求すると、保持した長期設計/実装の正当な再利用が不可能 | 元SDK記録と明示provenanceを原要求/契約/保持plan/選択executionへ照合。履歴はHISTORICAL_VALIDと表示し、現在の最終評価・検証は別に要求する                                                              |
| 複数Workflow        | 同じroot leaseで複数のnative起動を防ぐ専用記録がない                                  | claim→実launch attach→実terminal/drained finish。CLAIMED/ATTACHEDが残る間は次のclaimを拒否する                                                                                                       |
| 失敗の学習          | Workflow内のローカルcounterだけでは新burst/contextでHaikuへ戻り得る                   | task単位のfailure履歴を保存。コード由来の2失敗でSonnet、4失敗でOpus再計画、明示的設計矛盾は即Opus。外部制約はコード修正回数に加算しない。新しい仮説/実験で次のSonnet修正枠へ進み、独立taskは継続する |
| 外部制約            | ツール不足までコード再設計へ回しやすい                                                | environment/model_limit/permission/terminated/evidenceを分け、具体的回復→保留とする。復旧した根拠を保存して再開する                                                                                  |
| process識別         | `/proc`前提、観測失敗をdeadにし得る                                                   | LinuxとDarwinの観測を分離。不明はunknownのまま。runner/子groupも照合し、生きたwriterを奪わない                                                                                                       |
| probe準備           | clone後に失敗すると出力先が途中状態で残る                                             | sibling stagingとjournalから一括publish。元repo配下を拒否し、準備失敗・中断の復旧手順を保存する                                                                                                      |
| probe再実行         | 旧PASSと新ログの混在が起き得る                                                        | invocationごとのraw/stderr/manifestと結果表。現invocationが一致しない更新を拒否する                                                                                                                  |
| コンテキスト        | 古い全ログの再読、同じ初期inspectの重複                                               | failure summaryは直近2件と最新仮説/次の実験。各burstのhandoffは最新観測から作り、初回の重複inspectを省く                                                                                             |

## 保存の境界

通常の`.autodev/`はローカル状態であり、対象branchへの通常pushだけでは保存されない。checkpointは専用branchにのみ状態を含める。元要求、backlog、contract、plan、進捗、failure/burst/operationの履歴を引き継ぎ、通常のアプリbranchへ巨大ログや画像をすべてcommitする運用を要求しない。復元後はprivate状態をアプリのindexから外し、ローカルexcludeを使う。

checkpointの保存上限や省略は取得不能を意味する。省略された元SDK記録が必要なモデルprovenanceはUNVERIFIEDになり、現検証/最終review/auditを自動合格へ変換しない。元記録をSHA256で照合して回収するか、必要な実観測をやり直す。対象のignore設定で除外された未追跡の製品ソースはsnapshot対象外のため、製品ソースをignoreしない。

外部DB・常駐サーバー・独自の大規模オーケストレーターは追加しない。セッション継続はClaude Code、工程はDynamic Workflow、永続checkpointはGitが担当する。`/goal`は新しいセッションを勝手に開始しない。

## 監査の分離

機能充足はR01〜R12から逆引きする。故障耐性は別path/clone、状態欠落・改変、process/group、中断/重複launch、モデル記録を検査する。実用性は初回指示、標準CLI再開、隔離probe、必要な証拠だけのhandoffを検査する。

正常系だけでなく、故障を検出して未達に戻す試験と、修正後の正しい成果物を受け入れる試験を併用する。モデル役は模擬試験、ブラウザ/HTTP/process/Git操作は実行試験であることを分ける。今回のローカル/CI結果と未検証事項は[検証結果](validation-results.md)、最短の実機受け入れは[一括probe](live-probe.md)、運用は[06-usage](06-usage.md)を参照。

## 複数観点の再監査で追加した修正

| 問題 | Before | After |
| --- | --- | --- |
| 初回起動 | 未作成contractを要求しOpusへ到達できない | 受け入れと分離したplanning observation。欠落/不正な完成契約を合格へ降格しない |
| 初期計画の途中停止 | 部分backlogとcontract欠落で再起動不能 | 実停止証拠に基づくrepair-plan。元草案/archiveを残してOpusへ戻す |
| 独立評価への入力 | 実装前snapshotをレビューへ渡し、milestoneにはsnapshotなし | 各readonly呼出直前に実状態を再観測。異なるinspect連番と現観測IDで古いcacheを回避 |
| 復元途中の停止 | session更新後にGit処理が失敗すると再実行不能 | phase journal、状態staging、原状態backup、Git CASによる排他的recover-restore |
| 正当な復元の拒否 | decisions.mdとdecisions/配下で一覧順が不一致 | 全inventoryを同じpath順へ正規化 |
| 完成ゲートとの並行書込 | model/terminal/assessment importがmutexを無視 | 全証拠importとverifyを同一mutexで直列化 |
| CLIの起動path | 空白/日本語/symlinkで入口処理が実行されない | fileURLToPathとcanonical実pathで入口を判定 |
| root/taskの名前 | 要件ID missionがroot taskと衝突 | 原要求IDを保持し、backlog task IDだけ安全に分離 |
| 共通repoの移動 | contract内の絶対pathに依存 | 現recordの環境変数で共通adapter/Nodeを参照。別pathの共通cloneから実検査 |

機能充足・故障耐性・実用性を別コンテキストへ割り当てて監査し、指摘ごとに再現と修正後の試験を実施した。模擬agentが実装後の現指紋で勝手に評価を作り直すと検出できなかった問題は、実際にreadonly agentへ渡る入力自体を検査する試験で補った。

最終の故障注入では、初期計画の二度の停止、repair適用途中のSIGKILLと新しいdraftの競合、writer receiptを持たないreadonlyレビューの停止、実装完了後の結果未受領、未実施milestone監査の繰越も再現した。repairは世代付きjournalと初期不在の記録を持ち、readonly再開は停止時state/proof/rawおよび既存実装の観察を基礎とする。これらは現在の受け入れ証拠を代替せず、再実装の重複を防ぐための履歴である。

保存前の最終検査では、ignored参照先/中間リンクを持つsymlinkも確認した。元環境で指紋が有効でもGit snapshotから依存が抜ける場合は、復元不能なcheckpointをpublishする前に拒否する。全依存が保存される内部symlinkは復元可能。実機probeはmax_sprints=1を生成し、複数burstとcheckpoint再cloneの実証項目を未検証の結果表へ明示する。

## 実macOS CIからの追加修正

最初のmatrix実行はUbuntu成功、macOS165/174成功・9失敗だった。[失敗の実ログ抜粋](evidence/macos-regressions-before.txt)を保存した。`/var`と`/private/var`のalias差により内部symlinkを外部と誤認し、故障注入のpath一致も外れていた。fingerprintはrootと現存参照先を実pathで照合し、外部/状態へのlink拒否は維持する。fixtureの実rootを正規化して故障注入を確実に適用し、falseコマンドは実配置を調べて同じ終了1を検査する。条件や期待する拒否を緩めて解消していない。

checkpointでは、旧checkoutに固定された絶対symlinkも保存前に拒否する。相対内部linkは全依存がsnapshotに入る場合に復元可能。実機probeのoriginはfetch用識別に残す一方、pushurlは存在しないローカル先に固定し、普通のcheckpoint publishが元repoを変更しないようにした。probeのcheckpoint試験はLOCAL保存/追加LOCAL cloneであり、GitHub公開は実証していない。通常の明示許可された開発対象へのcheckpoint publishは別経路として維持する。
