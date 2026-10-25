# PR #1 深層監査と修正（2026-10-25、v0.2）

ユーザーのPhase A〜Gを実装・回帰試験・独立監査へ対応させた。mainは9f5a63c、開始PR headはa7a594f。PRは既存ブランチ上でDraftを維持し、mainへマージしていない。レビュー履歴はDraft未レビューのbotコメントのみで、人間/独立AIによる既存の承認は無かった。

## 再現から修正した内容

| 項目 | Before | After・理由/試験 |
| --- | --- | --- |
| A1 backlog | UNVERIFIED/FAIL/BLOCKEDでも他証拠を揃えるとCOMPLETE | 全タスク宣言状態＋check_refsの実証拠＋全原要件対応から再計算。手書きPASSだけでも拒否。4失敗の元出力はevidence/audit-before.txt。 |
| A2 decision | assessmentにstatusが無くNEEDS_FIX等を失う | 明示status/scope/task_ids/executions/run/attempt/session。空指摘の非PASSも拒否。コード/実行ID変更後は承認失効。 |
| Schema移行 | v1証拠の意味が曖昧 | schemas/v1を保存、v2へ自動承認変換せず、原文/旧証拠をarchiveしUNVERIFIEDから再計画。 |
| A3 model | 元ログhashと自己正規化modelだけ | 既知SDK構造・cwd・呼出相関tag・task/run区間・UUID・model・開始日時を照合。旧assistantを新SDK runへ流用不可。 |
| TEST FIXTURE | テストのCOMPLETEと実機を混同しやすい | modeを明示し、既定は拒否。明示許可でもTEST_COMPLETE/TEST_READY_FOR_HUMAN_REVIEW、終了0にしない。 |
| B1 identity | 絶対パス/gitDir/branch全一致だけ | 永続canonical repo IDとsession bindingを分離。同じrepoは別clone/worktreeへreconnect可能。別repo同名folderは拒否。 |
| B1 freshness | 移行時の扱いが未定 | 原要求を維持し、old binding/operations/routingを保全。current sessionで証拠を再評価。SSH/HTTPS同repo、branch/detached、dirty filesを検査。 |
| B2 replay | active flagと過去fpのみ | task/attempt/operation receipt、全attempt履歴、選択中sprint ID、実稼働proof、同時writer拒否。変更後状態更新前を観察しREVIEWへ。 |
| G interrupted op | recover後も旧started receiptが新attemptを永久block | interrupted→現在fpの明示observe→新attemptへ引継ぎ。原適用結果は消さず保全。 |
| G actual test interruption | shellの親停止で状態不明 | 検査groupのPID/startを永続化。実record processをkillする故障試験で、生きた検査groupがある限りunlock/recoverを拒否。 |
| C1 evidence kinds | 同じ成功コマンドでvisual/play等もPASS | 共通report interfaceでtest件数/build出力/API応答/操作/描画/プレイを区別。nonceとreport/artifact hash、実assertionsを検査。 |
| C1 actual browser | 模擬visualコマンドしか実行しない | Chromiumで描画・画像・3入力・勝利到達を実測。壊した操作はFAIL。代表画像/reportをevidence/browserに保存。これはClaude実モデルの証拠ではない。 |
| C2 fingerprint | 削除のstage/commitで再失効し得る、共通adapter/外部link実体が漏れる | 現存path集合で削除を表す。内部link実体hash、外部/状態/directory link拒否。共通コード/adapter/規則/依存ロックも契約versionへ含める。 |
| D1 multi-sprint | 単発sprintの例のみ | develop-missionが初期計画→タスク選択→修正→検査→次タスク→節目/最終監査を直列制御。親/goalとWorkflow/CLIの責任を明文化。 |
| G resume wiring | nextのRESUME_*とcontroller期待値が不一致、親task=missionを実タスクと混同 | 構造化resume(stage/task/operation)とsprint_task_idを共通化。実next出力をcontrollerへ渡す試験で実装skip→R2 reviewを確認。 |
| G burst IDs/cache | sequenceだけのIDが別burst/taskで衝突、古いinspectがcacheされ得る | task/execution/phaseのreceipt ID、親から現在observation_idを渡す。1-sprint burstを連続実行して監査間隔も保持。 |
| D3 final failure | 最終検証NEEDS_FIXで返答終了、全タスクPASSのままループ | 失敗taskを新executionでreset→PLAN→再実装。最終回帰を注入して実際に再修正するE2E。 |
| D3 independent work | 失敗上限で全体が止まりやすい | 未解決taskは残して独立taskを進める。4タスクのうち1つがBLOCKEDでもR4を合格させ、全体完成は拒否。 |
| E args/API | JSON.parse(args)、未確認tools override | actual objectとnative agentType。汎用writerへの誤配線はmission/milestone/probe全てで拒否。根拠はruntime-spec-audit.md。 |
| F manual burden | 実機手順/結果形式未整備 | live-probe prepareでsource不変の隔離clone、故障fixture、契約、native roles、開始prompt、全項目未検証の結果表を生成。 |
| G terminal proof | 空snapshotだけ、他projectの終了記録も付替え可能 | raw Workflow args/launch/terminalを現在bindingへ相関し、空snapshot後に開始したtaskも追跡。古い空一覧でCOMPLETEにならない。 |
| G atomic setup | bootstrap公開後にsessionを書き、途中停止で復旧不能 | sessionを含めてstaging→一括publish。移行もbackup/hash/staging/journalから再開。agent定義は完全なtmpをpublishし既存fileは非置換。 |

## 独立監査

実装担当とは別コンテキストの読み取り専用監査を依頼し、原設計から逆方向に確認した。監査者は共有ファイルを編集せず、隔離fixtureでlate writer・新attemptの停止・旧SDK応答流用を実際に再現した。上表の追加修正へ反映後、同じ3件の拒否/再開を再監査で確認。単体milestone/probeのrole whitelistも再読し解消確認済み。新たなP1相当の完成判定穴は報告されていない。

これは実装作業の独立コード監査であり、製品が要求する実Opus/Sonnet/Haikuでの監査試験の代用ではない。

## 完成の範囲

コード・ローカル試験・CIの最新結果はvalidation-results.md。Phase A〜Dのプログラム部分、Fの準備、Gのローカル監査を実装した。Eは公式文書/APIの静的照合を完了した。

Claudeクラウド2repo、一指示での初期発見、実モデル提供/置換、native権限制限、実Workflow内SDK相関記録、/goal背景継続と本物の停止再開はUNVERIFIED。これらを原要求から削除せず、docs/live-probe.mdへ集約した。実機でログ形式/権限が異なれば観測に沿って修正し、再試験する。
